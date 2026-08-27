import type { Abi } from "viem";
import {
  mttPayoutAbi, mttReferralDistributorAbi, mttStakingAbi, mttTokenAbi, mttVestingAbi,
} from "./abis.generated";

/* ============================================================================
 * Chain layer constants.
 *
 * WHAT CHANGED HERE, AND WHY IT MATTERED
 * --------------------------------------
 * This file used to hold hand-written `parseAbi([...])` fragments, on the
 * reasoning that a narrow ABI keeps the platform's on-chain surface reviewable.
 * The reasoning was sound. The execution was not: when the fragments were
 * finally checked against the compiled contracts, SEVEN OF EIGHT event
 * signatures and THREE OF EIGHT function signatures were wrong.
 *
 *   Staked(address,uint256,uint256,uint256)   → Staked(uint256,address,uint256,uint64)
 *   Unstaked(address,uint256,...,uint256)     → Unstaked(uint256,address,uint256,uint256,bool)
 *   RewardsClaimed(...)                       → RewardClaimed(...)        (name)
 *   RewardPoolFunded(...)                     → PoolFunded(...)           (name)
 *   PoolCreated(uint256,uint256,uint256,...)  → PoolCreated(uint256,uint64,uint64,uint16)
 *   CommissionRecorded(addr,bytes32,u8,u256)  → CommissionRecorded(addr,u8,u256,bytes32,bytes32)
 *   CommissionPoolDeposited(...)              → CommissionPoolFunded(...) (name)
 *   recordCommission(addr,bytes32,u8,u256)    → recordCommission(addr,u8,u256,bytes32)
 *   clawback(addr,u256,string)                → clawback(addr,u256,bytes32,string)
 *
 * The asymmetry in how those two kinds of error fail is the whole lesson. A
 * wrong FUNCTION signature is a different selector: the call reverts, loudly,
 * and someone investigates. A wrong EVENT signature is a different topic0:
 * `getLogs` matches nothing and returns an empty array. It does not throw. The
 * indexer would have run in production, reported itself healthy, advanced its
 * cursor to the head, and indexed exactly zero events — while members' stakes
 * silently failed to appear.
 *
 * So the ABIs are now GENERATED from the compiled artifacts (`abis.generated.ts`,
 * produced by `npm run abi` in MLM-contracts) and the narrowing that the old
 * fragments were trying to achieve lives in `callable` below: an explicit
 * allowlist of function NAMES, validated against the real ABI at startup. Same
 * review property, no re-typed interface to drift.
 * ========================================================================== */

/** Logical contract names, used as the cursor key and event namespace. */
export const Contracts = {
  MttToken: "mttToken",
  Staking: "staking",
  ReferralDistributor: "referralDistributor",
  Payout: "payout",
  TeamVesting: "teamVesting",
  AdvisorsVesting: "advisorsVesting",
} as const;

export type ContractName = (typeof Contracts)[keyof typeof Contracts];

/** Config key under `chain.contracts` for each logical contract. */
export type ContractConfigKey =
  | "mttToken" | "staking" | "referralDistributor" | "payout"
  | "teamVesting" | "advisorsVesting";

export interface ContractSpec {
  name: ContractName;
  configKey: ContractConfigKey;
  abi: Abi;
  /**
   * Events the indexer watches on this contract.
   *
   * Empty means "index nothing" — the contract is still readable and callable.
   * `undefined` would have meant "watch everything", which on the token would be
   * every Transfer on BSC touching MTT: millions of rows nobody reads.
   */
  watch: readonly string[];
  /** Functions the relayer is permitted to call. Everything else is refused. */
  callable: readonly string[];
}

/* ============================================================================
 * The registry. Adding a contract is adding one entry.
 * ========================================================================== */

export const CONTRACT_SPECS: readonly ContractSpec[] = [
  {
    name: Contracts.Staking,
    configKey: "staking",
    abi: mttStakingAbi,
    watch: ["Staked", "Unstaked", "RewardClaimed", "PoolFunded", "PoolCreated", "PenaltyReceiverUpdated"],
    callable: ["createPool", "setPoolActive", "setPenaltyReceiver", "fundRewardPool"],
  },
  {
    name: Contracts.ReferralDistributor,
    configKey: "referralDistributor",
    abi: mttReferralDistributorAbi,
    watch: [
      "CommissionPoolFunded", "CommissionRecorded", "CommissionClaimed",
      "CommissionClawedBack", "KycStatusUpdated",
    ],
    callable: [
      "depositCommissionPool", "recordCommission", "recordCommissionBatch",
      "clawback", "setKycApproved", "setKycApprovedBatch",
    ],
  },
  {
    name: Contracts.Payout,
    configKey: "payout",
    abi: mttPayoutAbi,
    watch: ["PayoutSent", "Funded", "Swept", "DailyLimitUpdated", "Paused", "Unpaused"],
    /*
     * `fund` and `sweep` are TREASURY_ROLE and `pause` is GUARDIAN_ROLE — the
     * relayer key holds neither, so those calls revert on chain regardless of
     * this list. They are permitted here because the same submitter serves the
     * admin routes; the on-chain role check remains the real boundary.
     */
    callable: ["payout", "payoutBatch", "fund", "sweep", "pause", "unpause", "setDailyLimit"],
  },
  {
    name: Contracts.MttToken,
    configKey: "mttToken",
    abi: mttTokenAbi,
    /*
     * Deliberately watches NOTHING.
     *
     * The only event of interest is `Transfer`, and indexing every MTT transfer
     * on BSC would mean millions of rows the platform never reads — while the
     * transfers that matter (a stake, a payout, a claim) are already indexed from
     * the contract that caused them, with the domain context attached.
     */
    watch: [],
    callable: ["transfer", "approve", "pause", "unpause", "adminBurn"],
  },
  {
    name: Contracts.TeamVesting,
    configKey: "teamVesting",
    abi: mttVestingAbi,
    watch: ["TokensReleased"],
    /* `release()` pays the beneficiary, whoever calls it. The platform reads this
     * contract for the public tokenomics page and never calls it. */
    callable: [],
  },
  {
    name: Contracts.AdvisorsVesting,
    configKey: "advisorsVesting",
    abi: mttVestingAbi,
    watch: ["TokensReleased"],
    callable: [],
  },
] as const;

const SPEC_BY_NAME = new Map<ContractName, ContractSpec>(
  CONTRACT_SPECS.map((s) => [s.name, s]),
);

export function specFor(name: ContractName): ContractSpec {
  const spec = SPEC_BY_NAME.get(name);
  if (!spec) throw new Error(`No contract spec for ${name}`);
  return spec;
}

/** Contracts the indexer polls — those with at least one watched event. */
export const INDEXED_SPECS = CONTRACT_SPECS.filter((s) => s.watch.length > 0);

/**
 * The ABI subset for a contract's watched events, for `getLogs({ events })`.
 *
 * Filtered from the generated ABI rather than re-declared, so the signature
 * viem builds a topic0 from is byte-for-byte the compiler's. This function is
 * the reason the indexer can no longer silently match nothing.
 */
export function watchedEventAbi(spec: ContractSpec): Abi {
  const wanted = new Set(spec.watch);
  return spec.abi.filter(
    (e) => e.type === "event" && wanted.has((e as { name: string }).name),
  );
}

/** Every function name the codebase may call, across all contracts. */
export function allCallable(): { contract: ContractName; functionName: string }[] {
  return CONTRACT_SPECS.flatMap((s) =>
    s.callable.map((functionName) => ({ contract: s.name, functionName })),
  );
}

/**
 * Which contract declares this function as callable.
 *
 * Returns null when zero or more than one does. `pause` exists on both the token
 * and the payout rail, so the caller must resolve by ADDRESS first and use this
 * only as a fallback — an ambiguous name must never be guessed, because guessing
 * wrong means sending a privileged call to the wrong contract.
 */
export function specForCallable(functionName: string): ContractSpec | null {
  const matches = CONTRACT_SPECS.filter((s) => s.callable.includes(functionName));
  return matches.length === 1 ? matches[0] : null;
}

/* ============================================================================
 * Startup validation.
 *
 * The generated ABI cannot drift from the contract, but a NAME in `watch` or
 * `callable` is still hand-written here — and a typo in `watch` reproduces
 * exactly the silent failure this whole file exists to prevent. So the names are
 * checked against the ABI on boot, and a mismatch refuses to start.
 *
 * Failing at startup is the point. The alternative is an indexer that starts
 * cleanly and quietly matches nothing.
 * ========================================================================== */

export interface SpecValidationError {
  contract: ContractName;
  kind: "event" | "function";
  name: string;
  available: string[];
}

export function validateSpecs(): SpecValidationError[] {
  const problems: SpecValidationError[] = [];

  for (const spec of CONTRACT_SPECS) {
    const events = new Set(
      spec.abi.filter((e) => e.type === "event").map((e) => (e as { name: string }).name),
    );
    const functions = new Set(
      spec.abi.filter((e) => e.type === "function").map((e) => (e as { name: string }).name),
    );

    for (const name of spec.watch) {
      if (!events.has(name)) {
        problems.push({ contract: spec.name, kind: "event", name, available: [...events].sort() });
      }
    }
    for (const name of spec.callable) {
      if (!functions.has(name)) {
        problems.push({ contract: spec.name, kind: "function", name, available: [...functions].sort() });
      }
    }
  }

  return problems;
}

/** Throws with an actionable message if any spec name is not in its ABI. */
export function assertSpecsValid(): void {
  const problems = validateSpecs();
  if (problems.length === 0) return;

  const lines = problems.map(
    (p) =>
      `  ${p.contract}: ${p.kind} "${p.name}" does not exist on the contract.\n` +
      `    available ${p.kind}s: ${p.available.join(", ")}`,
  );

  throw new Error(
    `Chain layer misconfigured — ${problems.length} name(s) in CONTRACT_SPECS do not ` +
    `match the generated ABI:\n${lines.join("\n")}\n\n` +
    `A wrong event name is precisely the failure this check exists to catch: getLogs ` +
    `would match nothing and the indexer would report healthy while indexing zero ` +
    `events. Run \`npm run abi\` in MLM-contracts if the contracts changed.`,
  );
}

/**
 * Refuses a call that is not on the allowlist.
 *
 * Checked at enqueue time, before a nonce is consumed. A call that reverts on
 * chain still costs gas and still burns a nonce that everything queued behind it
 * has to wait for.
 */
export function assertCallable(name: ContractName, functionName: string): void {
  const spec = specFor(name);
  if (!spec.callable.includes(functionName)) {
    throw new Error(
      `${functionName} is not in the callable allowlist for ${name}. ` +
      `Permitted: ${spec.callable.join(", ") || "(none)"}`,
    );
  }
}

/* ============================================================================
 * Tuning. Unchanged from the original — these were all correct.
 * ========================================================================== */

/**
 * How far behind the head the indexer stays.
 *
 * A block that is only one deep can still be reorganised away. Indexing it and
 * crediting a reward from it would mean paying for a transaction that never
 * happened on the canonical chain. The env default is authoritative; this is the
 * floor a misconfiguration cannot go below.
 */
export const MIN_CONFIRMATIONS = 3;

/**
 * How far the indexer rewinds when it detects a reorg.
 *
 * Deeper than the confirmation depth on purpose: the reorg may have started
 * before the block we noticed it at, and re-indexing an already-indexed block is
 * free (the unique index dedupes) while missing one is not.
 */
export const REORG_REWIND_BLOCKS = 24;

/** Maximum blocks in one getLogs call. Providers cap this; so do we. */
export const MAX_BATCH_BLOCKS = 2_000;

/**
 * Blocks of cursor lag that count as unhealthy.
 *
 * At three-second BSC blocks this is roughly ten minutes — long enough to ride
 * out a slow provider, short enough that a genuinely stalled indexer is caught
 * before a member notices their stake has not appeared.
 */
export const HEALTHY_LAG_BLOCKS = 200;

/** Confirmations before an outbound transaction is considered settled. */
export const MIN_TX_CONFIRMATIONS = 2;

/**
 * How long a submitted transaction may sit unconfirmed before it is repriced.
 *
 * Repricing REUSES THE NONCE. Sending a new nonce instead would leave the
 * original transaction live, and both could land.
 */
export const STUCK_TX_MS = 3 * 60_000;

/**
 * Gas price bump per reprice attempt, in basis points (12.5% — above the 10%
 * most nodes require to replace a pending transaction).
 */
export const REPRICE_BUMP_BPS = 1_250;

/** After this many reprices a transaction is abandoned for a human to look at. */
export const MAX_REPRICE_ATTEMPTS = 5;

/** Seconds a contract read is cached. Chain reads are the slow path. */
export const READ_CACHE_SECONDS = 15;

/** Longer cache for values that change only by a governance action. */
export const READ_CACHE_SECONDS_SLOW = 120;
