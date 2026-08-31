import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import type { Abi, Address } from "viem";
import { getAddress, isAddress } from "viem";
import { CONTRACT_SPECS, Contracts, specFor, type ContractName } from "./chain.constants";
import { knownDeployment, expectedRelayer } from "./deployment";
import { RpcService } from "./rpc.service";
import { ChainWriteService } from "./chain-write.service";

/* ============================================================================
 * Does the environment point at the contracts we think it points at?
 *
 * Every other guard in the chain layer protects against the code being wrong.
 * This one protects against the DEPLOYMENT being wrong — a stale address left
 * over from a previous testnet run, a truncated paste, a mainnet address in a
 * staging environment, an ORACLE_PRIVATE_KEY whose signer holds none of the
 * roles it needs.
 *
 * All of those fail silently today. A wrong address is not a crash: getLogs
 * matches nothing (so the indexer reports healthy and indexes zero events) and
 * reads revert into the read layer's honest nulls (so dashboards show dashes).
 * A wrong signer fails per transaction, on chain, after spending gas and burning
 * a nonce that everything queued behind it waits on.
 *
 * WHAT IT CHECKS, CHEAPEST FIRST
 * ------------------------------
 *  1. Format. An address that is not 20 bytes, or whose EIP-55 case is wrong,
 *     never reaches the network — viem would throw deep inside a read.
 *  2. Recorded deployment. If this chain has an entry in deployment.ts, the
 *     configured address must equal it.
 *  3. Code presence. An address with no bytecode is not a contract.
 *  4. Identity. Every peripheral contract names the token it settles in
 *     (`mtt()`, or `token()` on a vesting wallet). All of them must name the
 *     configured MTTToken. This is the check that catches a swapped pair, which
 *     format and code-presence checks both pass.
 *  5. Shape. The staking contract should report the pools the deployment
 *     created — a count of zero against a recorded four means an address from a
 *     different run.
 *  6. Relayer identity, when a recorded deployment names one.
 *
 * WHY IT DOES NOT REFUSE TO BOOT
 * ------------------------------
 * Because it cannot tell a wrong address from an unreachable RPC without the
 * RPC. Crashing on a provider hiccup would turn a transient outage into an
 * outage that needs a human to restart it. Instead every problem is logged at
 * error level and served from `GET /admin/chain/deployment`, so the state is
 * both alarming and inspectable — and a deployment problem is reported as
 * `verified: false` rather than as silence.
 * ========================================================================== */

export type FindingLevel = "error" | "warning" | "info";

export interface DeploymentFinding {
  level: FindingLevel;
  contract: ContractName | "relayer" | "indexer" | null;
  message: string;
}

export interface DeploymentReport {
  chainId: number;
  network: string | null;
  /** True when the run completed and produced no error-level findings. */
  verified: boolean;
  /** False when the RPC was unreachable, so absence of findings proves nothing. */
  reachable: boolean;
  checkedAt: string;
  contracts: {
    name: ContractName;
    configured: string | null;
    matchesRecord: boolean | null;
    hasCode: boolean | null;
    settlesInMtt: boolean | null;
  }[];
  relayer: { configured: string | null; expected: string | null; matches: boolean | null };
  findings: DeploymentFinding[];
}

/** The function on each peripheral contract that names the token it settles in. */
const SETTLEMENT_TOKEN_FN: Partial<Record<ContractName, "mtt" | "token">> = {
  [Contracts.Staking]: "mtt",
  [Contracts.ReferralDistributor]: "mtt",
  [Contracts.Payout]: "mtt",
  [Contracts.TeamVesting]: "token",
  [Contracts.AdvisorsVesting]: "token",
};

/**
 * How long the whole verification may take before it gives up and reports the
 * chain unreachable.
 *
 * Needed because "unreachable" is the slow answer, not the fast one. An RPC host
 * that blackholes a connection burns the client's full per-request timeout on
 * every attempt, and with retries across two endpoints that is ~90s per read —
 * so the first version of this check, which read every contract in sequence with
 * no overall bound, took about twenty minutes to conclude nothing was reachable,
 * and the admin re-verify endpoint held an HTTP request open for all of it.
 *
 * A health check has to bound its own runtime. Past this, the report says
 * `reachable: false` and says why, which is the correct answer anyway.
 */
const VERIFY_DEADLINE_MS = 20_000;

/** Resolves to `fallback` if `work` has not settled within `ms`. */
async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class DeploymentVerifierService implements OnApplicationBootstrap {
  private readonly log = new Logger(DeploymentVerifierService.name);
  private last: DeploymentReport | null = null;

  constructor(
    private readonly rpc: RpcService,
    private readonly writes: ChainWriteService,
  ) {}

  /**
   * Runs after the whole application is up, not on module init, so a slow or
   * failing RPC delays nothing that HTTP traffic depends on.
   */
  onApplicationBootstrap(): void {
    void this.verify()
      .then((report) => this.report(report))
      .catch((err) => this.log.error(`deployment verification could not run: ${String(err)}`));
  }

  /** The most recent report, or null if the first run has not finished. */
  latest(): DeploymentReport | null {
    return this.last;
  }

  /** Re-runs every check. Exposed so an operator can re-verify after a redeploy. */
  async verify(): Promise<DeploymentReport> {
    const chainId = this.rpc.chainId;
    const record = knownDeployment(chainId);
    const findings: DeploymentFinding[] = [];
    const contracts: DeploymentReport["contracts"] = [];

    if (!record) {
      findings.push({
        level: "warning",
        contract: null,
        message:
          `No deployment is recorded for chain ${chainId} in deployment.ts, so configured ` +
          `addresses cannot be cross-checked. On-chain identity checks still run.`,
      });
    }

    /* Resolve the token address first: every other identity check compares
       against it, so a problem here makes the rest of them meaningless. */
    const tokenConfigured = this.configured(Contracts.MttToken);

    /* ---- offline phase: everything that needs no network, so a dead RPC still
            produces the findings it cannot hide. ---- */
    const onChainTargets: { spec: (typeof CONTRACT_SPECS)[number]; address: Address }[] = [];

    for (const spec of CONTRACT_SPECS) {
      const configured = this.configured(spec.name);
      const recorded = record?.addresses[spec.name] ?? null;

      if (!configured) {
        findings.push({
          level: recorded ? "error" : "warning",
          contract: spec.name,
          message: recorded
            ? `${spec.name} has no address configured, but chain ${chainId} has one recorded ` +
              `(${recorded}). The indexer will skip it and every read returns null.`
            : `${spec.name} has no address configured and none is recorded.`,
        });
        contracts.push({
          name: spec.name, configured: null, matchesRecord: null, hasCode: null, settlesInMtt: null,
        });
        continue;
      }

      let matchesRecord: boolean | null = null;
      if (recorded) {
        matchesRecord = recorded.toLowerCase() === configured.toLowerCase();
        if (!matchesRecord) {
          findings.push({
            level: "error",
            contract: spec.name,
            message:
              `${spec.name} is configured as ${configured} but the recorded deployment for ` +
              `chain ${chainId} is ${recorded}. One of the two is stale — update the env, or ` +
              `update deployment.ts if this is a new deployment.`,
          });
        }
      }

      contracts.push({
        name: spec.name, configured, matchesRecord, hasCode: null, settlesInMtt: null,
      });
      onChainTargets.push({ spec, address: configured });
    }

    const relayer = this.checkRelayer(chainId, findings);
    this.checkIndexerStart(record, findings);

    /* ---- network phase: in parallel and under one deadline. Sequentially, an
            RPC that blackholes turns this into twenty minutes of waiting. ---- */
    const timedOut = Symbol("timeout");
    const network = await withDeadline(
      (async () => {
        const results = await Promise.all(
          onChainTargets.map(({ spec, address }) =>
            this.checkOnChain(spec.name, address, spec.abi, tokenConfigured, findings)
              .then((r) => ({ name: spec.name, ...r })),
          ),
        );
        await this.checkPoolShape(record, findings);
        return results;
      })(),
      VERIFY_DEADLINE_MS,
      timedOut as unknown as { name: ContractName; hasCode: boolean | null; settlesInMtt: boolean | null; rpcFailed: boolean }[],
    );

    let reachable = true;
    if ((network as unknown) === timedOut) {
      reachable = false;
      findings.push({
        level: "warning",
        contract: null,
        message:
          `Chain checks did not finish within ${VERIFY_DEADLINE_MS}ms, so the addresses could ` +
          `not be confirmed against the chain. The RPC endpoints are unreachable or very slow ` +
          `from this host — treat this report's on-chain fields as unknown, not as clean.`,
      });
    } else {
      for (const r of network) {
        const row = contracts.find((c) => c.name === r.name);
        if (row) {
          row.hasCode = r.hasCode;
          row.settlesInMtt = r.settlesInMtt;
        }
        if (r.rpcFailed) reachable = false;
      }
    }

    const report: DeploymentReport = {
      chainId,
      network: record?.network ?? null,
      reachable,
      verified: reachable && findings.every((f) => f.level !== "error"),
      checkedAt: new Date().toISOString(),
      contracts,
      relayer,
      findings,
    };
    this.last = report;
    return report;
  }

  /* ------------------------------------------------------------------ */

  /** The configured address, validated and checksummed, or null. */
  private configured(name: ContractName): Address | null {
    const raw = this.writes.addressOf(name);
    if (!raw) return null;
    if (!isAddress(raw)) return null;
    return getAddress(raw);
  }

  private async checkOnChain(
    name: ContractName,
    address: Address,
    abi: Abi,
    tokenConfigured: Address | null,
    findings: DeploymentFinding[],
  ): Promise<{ hasCode: boolean | null; settlesInMtt: boolean | null; rpcFailed: boolean }> {
    let hasCode: boolean | null = null;
    try {
      hasCode = await this.rpc.hasCode(address);
    } catch (err) {
      findings.push({
        level: "warning",
        contract: name,
        message: `could not read code at ${address}: ${String(err)}`,
      });
      return { hasCode: null, settlesInMtt: null, rpcFailed: true };
    }

    if (!hasCode) {
      findings.push({
        level: "error",
        contract: name,
        message:
          `${address} has no bytecode on chain ${this.rpc.chainId}. It is an EOA or an unused ` +
          `address, so reads revert and getLogs matches nothing — silently.`,
      });
      return { hasCode: false, settlesInMtt: null, rpcFailed: false };
    }

    const fn = SETTLEMENT_TOKEN_FN[name];
    if (!fn || !tokenConfigured) return { hasCode, settlesInMtt: null, rpcFailed: false };

    try {
      /* Uncached: a boot check must read the chain, not a previous boot. */
      const token = await this.rpc.read<Address>({
        address, abi, functionName: fn, cacheSeconds: 0,
      });
      const settlesInMtt = token.toLowerCase() === tokenConfigured.toLowerCase();
      if (!settlesInMtt) {
        findings.push({
          level: "error",
          contract: name,
          message:
            `${name} settles in ${token}, not the configured MTTToken ${tokenConfigured}. ` +
            `Either the addresses belong to different deployments, or two of them are swapped.`,
        });
      }
      return { hasCode, settlesInMtt, rpcFailed: false };
    } catch (err) {
      findings.push({
        level: "warning",
        contract: name,
        message: `${name}.${fn}() could not be read at ${address}: ${String(err)}`,
      });
      return { hasCode, settlesInMtt: null, rpcFailed: true };
    }
  }

  /**
   * The staking contract should hold the pools the deployment created.
   *
   * A count of zero where four are recorded is an address from a different run
   * that happens to be a staking contract — which every earlier check passes.
   */
  private async checkPoolShape(
    record: ReturnType<typeof knownDeployment>,
    findings: DeploymentFinding[],
  ): Promise<void> {
    if (!record) return;
    const address = this.configured(Contracts.Staking);
    if (!address) return;

    try {
      const count = Number(
        await this.rpc.read<bigint>({
          address,
          abi: specFor(Contracts.Staking).abi,
          functionName: "poolCount",
          cacheSeconds: 0,
        }),
      );
      if (count < record.expectedPoolCount) {
        findings.push({
          level: "error",
          contract: Contracts.Staking,
          message:
            `staking reports ${count} pool(s) but the recorded deployment created ` +
            `${record.expectedPoolCount}. This is very likely a staking address from a ` +
            `different run.`,
        });
      } else if (count > record.expectedPoolCount) {
        findings.push({
          level: "info",
          contract: Contracts.Staking,
          message:
            `staking reports ${count} pools against ${record.expectedPoolCount} at deployment — ` +
            `pools were added since. Expected if an admin created them.`,
        });
      }
    } catch {
      /* Already surfaced by the identity check; not worth a second finding. */
    }
  }

  /**
   * The relayer signer must be the account the deployment granted ORACLE_ROLE
   * and PAYER_ROLE to. A different key does not fail at boot — it fails per
   * transaction, on chain, after spending gas and burning a nonce.
   */
  private checkRelayer(chainId: number, findings: DeploymentFinding[]): DeploymentReport["relayer"] {
    const expected = expectedRelayer(chainId);
    const configured = this.rpc.canSign ? this.rpc.signer : null;

    if (!configured) {
      findings.push({
        level: "warning",
        contract: "relayer",
        message:
          expected
            ? `No relayer signer is configured. The deployment granted ORACLE_ROLE and PAYER_ROLE ` +
              `to ${expected}; until that key is available, commission recording and payouts refuse.`
            : `No relayer signer is configured — outbound transactions refuse.`,
      });
      return { configured: null, expected, matches: null };
    }

    if (!expected) return { configured, expected: null, matches: null };

    const matches = configured.toLowerCase() === expected.toLowerCase();
    if (!matches) {
      findings.push({
        level: "error",
        contract: "relayer",
        message:
          `The relayer signer is ${configured} but the deployment granted ORACLE_ROLE to ` +
          `${expected}. Every recordCommission and every payout will revert on the role check ` +
          `after consuming gas and a nonce.`,
      });
    }
    return { configured, expected, matches };
  }

  /**
   * A start block of zero means the first scan begins at genesis. It is not a
   * crash; it is an indexer that never reaches the head.
   */
  private checkIndexerStart(
    record: ReturnType<typeof knownDeployment>,
    findings: DeploymentFinding[],
  ): void {
    if (!this.rpc.indexerEnabled) return;
    const configured = this.rpc.startBlock;

    if (configured === 0) {
      findings.push({
        level: "error",
        contract: "indexer",
        message:
          `INDEXER_START_BLOCK is 0, so a first scan starts at genesis — millions of empty ` +
          `batches before it reaches any of this platform's events.` +
          (record ? ` Set it to ${record.indexerStartBlock}.` : ""),
      });
      return;
    }

    if (record && configured > record.indexerStartBlock) {
      findings.push({
        level: "warning",
        contract: "indexer",
        message:
          `INDEXER_START_BLOCK (${configured}) is after the recorded deployment block ` +
          `(${record.indexerStartBlock}). Setup events — role grants, pool creation, the ` +
          `initial funding — are before the cursor and will never be indexed.`,
      });
    }
  }

  private report(report: DeploymentReport): void {
    const errors = report.findings.filter((f) => f.level === "error");
    const warnings = report.findings.filter((f) => f.level === "warning");

    for (const f of errors) this.log.error(`[${f.contract ?? "chain"}] ${f.message}`);
    for (const f of warnings) this.log.warn(`[${f.contract ?? "chain"}] ${f.message}`);

    if (!report.reachable) {
      this.log.warn(
        "deployment verification was incomplete — the RPC was unreachable for at least one " +
        "check, so a clean result here does not mean the addresses are right",
      );
      return;
    }
    if (errors.length === 0) {
      this.log.log(
        `deployment verified on chain ${report.chainId}` +
        `${report.network ? ` (${report.network})` : ""}: ` +
        `${report.contracts.filter((c) => c.hasCode).length} contract(s) present and settling in ` +
        `the configured MTT` +
        `${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
      );
    } else {
      this.log.error(
        `deployment NOT verified on chain ${report.chainId}: ${errors.length} error(s). ` +
        `Indexed events and chain reads cannot be trusted until these are resolved.`,
      );
    }
  }
}
