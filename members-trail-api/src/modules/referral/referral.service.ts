import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Commission, GameSession, ReferralEdge, User } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { appConfig } from "@/config/configuration";
import { Inject } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { paginate, type Paginated } from "@/common/dto";
import { addDays, anonLabel, dec, toDbAmount } from "@/common/utils";
import { CommissionPlanService } from "./commission-plan.service";
import { MAX_DEPTH } from "./dto/commission.dto";
import type {
  DownlineMemberResponse, DownlineQuery, LevelBreakdown, ReferralCodeResponse,
  ReferralStatsResponse,
} from "./dto/referral.dto";

/* ============================================================================
 * The referral network, as the member sees it (FRD R-01 … R-03).
 *
 * The rule that shapes every query in this file: a member may see the SHAPE of
 * their downline — how many, which tier, whether they are active, what they
 * earned — and never the IDENTITY of anyone in it. Names, emails and handles do
 * not appear in any response here, by construction rather than by filtering at
 * the edge, because a filter is one refactor away from being forgotten.
 *
 * Depth is 3. The edge table has no level 4 and this service never asks for one.
 * ========================================================================== */

/** A member counts as active if they played a validated session recently. */
const ACTIVE_WINDOW_DAYS = 30;

const LEVELS = [1, 2, 3] as const;

@Injectable()
export class ReferralService {
  private readonly log = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(ReferralEdge) private readonly edges: Repository<ReferralEdge>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Commission) private readonly commissions: Repository<Commission>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    private readonly plans: CommissionPlanService,
    private readonly ledger: LedgerService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /* ==================================================================== *
   * Code and link
   * ==================================================================== */

  async code(userId: string): Promise<ReferralCodeResponse> {
    const user = await this.requireUser(userId);
    const directJoins = await this.edges.count({ where: { ancestorId: userId, level: 1 } });
    return {
      code: user.referralCode,
      link: this.link(user.referralCode),
      directJoins,
    };
  }

  private link(code: string): string {
    const base = (this.app.webUrl ?? "").replace(/\/+$/, "");
    return `${base}/register?ref=${encodeURIComponent(code)}`;
  }

  /* ==================================================================== *
   * Stats
   * ==================================================================== */

  /** The referral dashboard: shape of the network and what it has earned. */
  async stats(userId: string): Promise<ReferralStatsResponse> {
    const user = await this.requireUser(userId);
    const plan = await this.plans.active();
    const balance = await this.ledger.getBalance(userId);
    const since = addDays(new Date(), -ACTIVE_WINDOW_DAYS);

    const levels: LevelBreakdown[] = [];
    let totalDownline = 0;
    let activeDownline = 0;

    for (const level of LEVELS) {
      const memberIds = (
        await this.edges.find({ where: { ancestorId: userId, level }, select: { userId: true } })
      ).map((e) => e.userId);

      const activeMembers = memberIds.length > 0 ? await this.countActive(memberIds, since) : 0;
      const earnedMtt = await this.sumEarnedAtLevel(userId, level);

      levels.push({
        level,
        members: memberIds.length,
        activeMembers,
        earnedMtt,
        /* Zero when no plan is in force — the member is not shown a rate that
         * nobody has approved. */
        rateBps: plan ? this.plans.rateFor(plan, level) : 0,
      });

      totalDownline += memberIds.length;
      activeDownline += activeMembers;
    }

    return {
      code: user.referralCode,
      link: this.link(user.referralCode),
      totalDownline,
      activeDownline,
      levels,
      lifetimeEarnedMtt: toDbAmount(balance.commissionLifetime),
      claimableMtt: toDbAmount(balance.commissionAvailable),
      pendingMtt: toDbAmount(balance.commissionPending),
      maxDepth: plan ? Math.min(plan.maxDepth, MAX_DEPTH) : MAX_DEPTH,
      planVersion: plan?.version ?? null,
    };
  }

  /* ==================================================================== *
   * Downline
   * ==================================================================== */

  /**
   * The member's downline, anonymised.
   *
   * `label` is derived from the member's public reference, not their name, and
   * the response carries no field from which an identity could be recovered.
   */
  async downline(userId: string, q: DownlineQuery): Promise<Paginated<DownlineMemberResponse>> {
    const where = q.level
      ? { ancestorId: userId, level: q.level as 1 | 2 | 3 }
      : { ancestorId: userId };

    const [edges, total] = await this.edges.findAndCount({
      where,
      order: { level: "ASC", createdAt: "DESC" },
      skip: q.skip,
      take: q.limit,
    });

    if (edges.length === 0) return paginate([], total, q);

    const ids = edges.map((e) => e.userId);
    const members = await this.users.find({ where: { id: In(ids) } });
    const byId = new Map(members.map((m) => [m.id, m]));

    const since = addDays(new Date(), -ACTIVE_WINDOW_DAYS);
    const activeIds = await this.activeIds(ids, since);
    const earned = await this.earnedPerDownline(userId, ids);

    const rows: DownlineMemberResponse[] = edges.map((edge) => {
      const member = byId.get(edge.userId);
      return {
        /* Anonymous by construction: nothing identifying is read into this
         * object in the first place. */
        label: member ? anonLabel(member.ref) : "Member",
        level: edge.level,
        joinedAt: (member?.createdAt ?? edge.createdAt).toISOString().slice(0, 10),
        active: activeIds.has(edge.userId),
        earnedFromMtt: earned.get(edge.userId) ?? toDbAmount(0),
        verified: (member?.kycTier ?? 0) >= 1,
      };
    });

    return paginate(rows, total, q);
  }

  /* ------------------------------------------------------------------ */

  private async countActive(memberIds: string[], since: Date): Promise<number> {
    const raw = await this.sessions
      .createQueryBuilder("s")
      .select("COUNT(DISTINCT s.userId)", "count")
      .where("s.userId IN (:...ids)", { ids: memberIds })
      .andWhere("s.status = :status", { status: "validated" })
      .andWhere("s.createdAt >= :since", { since })
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }

  private async activeIds(memberIds: string[], since: Date): Promise<Set<string>> {
    const rows = await this.sessions
      .createQueryBuilder("s")
      .select("DISTINCT s.userId", "userId")
      .where("s.userId IN (:...ids)", { ids: memberIds })
      .andWhere("s.status = :status", { status: "validated" })
      .andWhere("s.createdAt >= :since", { since })
      .getRawMany<{ userId: string }>();
    return new Set(rows.map((r) => r.userId));
  }

  /** Committed commission earned from a specific tier. */
  private async sumEarnedAtLevel(userId: string, level: number): Promise<string> {
    const raw = await this.commissions
      .createQueryBuilder("c")
      .select("COALESCE(SUM(c.amountMtt), 0)", "sum")
      .where("c.recipientId = :userId", { userId })
      .andWhere("c.level = :level", { level })
      .andWhere("c.status IN (:...statuses)", { statuses: ["released", "claimed"] })
      .getRawOne<{ sum: string | null }>();
    return toDbAmount(raw?.sum ?? 0);
  }

  /** Committed commission earned from each downline member, in one query. */
  private async earnedPerDownline(userId: string, ids: string[]): Promise<Map<string, string>> {
    const rows = await this.commissions
      .createQueryBuilder("c")
      .select("c.downlineUserId", "downlineUserId")
      .addSelect("COALESCE(SUM(c.amountMtt), 0)", "sum")
      .where("c.recipientId = :userId", { userId })
      .andWhere("c.downlineUserId IN (:...ids)", { ids })
      .andWhere("c.status IN (:...statuses)", { statuses: ["released", "claimed"] })
      .groupBy("c.downlineUserId")
      .getRawMany<{ downlineUserId: string; sum: string }>();

    return new Map(rows.map((r) => [r.downlineUserId, toDbAmount(dec(r.sum ?? 0))]));
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    return user;
  }
}
