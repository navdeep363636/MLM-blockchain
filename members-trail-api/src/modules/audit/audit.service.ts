import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLog } from "@/database/entities";
import { Ref } from "@/common/utils";

/* ============================================================================
 * Audit trail writer.
 *
 * Every sensitive action in the platform writes one row here (conventions §12).
 * Centralised so the redaction rules below cannot be forgotten per-module: a
 * before/after snapshot taken naively from an entity would otherwise carry a
 * password hash or a TOTP ciphertext into a table that support staff can read.
 * ========================================================================== */

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  /** Dotted verb, e.g. "auth.login.success", "kyc.decision.reject". */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  requiredSecondApproval?: boolean;
  approvedById?: string | null;
}

/** Keys whose values must never reach the audit table. */
const REDACT = /pass|secret|token|hash|otp|code|seed|private/i;
const REDACTED = "[redacted]";

export function redactSnapshot(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = REDACT.test(k) ? REDACTED : v;
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /**
   * Best-effort write. Used on high-volume paths (login, logout) where a
   * transient database problem must not turn into a failed user action — the
   * failure is logged at error level so it is still visible in alerting.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.write(entry);
    } catch (e) {
      this.log.error(
        `audit write failed for ${entry.action}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Write that must succeed. Used for compliance decisions (KYC outcomes, SAR
   * escalation, 2FA removal) where an unrecorded action is worse than a failed
   * one, so the caller is expected to let the error propagate.
   */
  async recordOrThrow(entry: AuditEntry): Promise<void> {
    await this.write(entry);
  }

  private async write(entry: AuditEntry): Promise<AuditLog> {
    const row = this.repo.create({
      ref: Ref.audit(),
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: redactSnapshot(entry.before),
      after: redactSnapshot(entry.after),
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 400) ?? null,
      requestId: entry.requestId ?? null,
      requiredSecondApproval: entry.requiredSecondApproval ?? false,
      approvedById: entry.approvedById ?? null,
    });
    return this.repo.save(row);
  }
}
