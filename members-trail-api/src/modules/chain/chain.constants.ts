import { parseAbi } from "viem";

/* ============================================================================
 * Chain layer constants.
 *
 * The ABI fragments here are deliberately MINIMAL — only the events the indexer
 * reads and the functions the relayer calls. A full ABI would invite calling
 * anything the contract exposes from anywhere in the codebase; a narrow one
 * makes the platform's on-chain surface reviewable in a single file.
 * ========================================================================== */

/** Logical contract names, used as the cursor and event namespace. */
export const Contracts = {
  MttToken: "mttToken",
  Staking: "staking",
  ReferralDistributor: "referralDistributor",
} as const;

export type ContractName = (typeof Contracts)[keyof typeof Contracts];

/**
 * Events the indexer watches.
 *
 * Keep the signatures in sync with the deployed contracts: an ABI mismatch does
 * not throw, it silently matches nothing, and a silent indexer is the worst
 * failure mode this layer has. The health endpoint reports cursor lag precisely
 * so that failure becomes visible.
 */
export const STAKING_EVENTS = parseAbi([
  "event Staked(address indexed user, uint256 indexed poolId, uint256 amount, uint256 lockEnd)",
  "event Unstaked(address indexed user, uint256 indexed poolId, uint256 amount, uint256 rewards, uint256 penalty)",
  "event RewardsClaimed(address indexed user, uint256 indexed poolId, uint256 amount)",
  "event RewardPoolFunded(uint256 indexed poolId, uint256 amount)",
  "event PoolCreated(uint256 indexed poolId, uint256 lockDays, uint256 rewardsDurationDays, uint256 earlyPenaltyBps)",
]);

export const REFERRAL_EVENTS = parseAbi([
  "event CommissionRecorded(address indexed recipient, bytes32 indexed sourceEventId, uint8 level, uint256 amount)",
  "event CommissionPoolDeposited(address indexed from, uint256 amount)",
  "event CommissionClaimed(address indexed recipient, uint256 amount)",
]);

export const TOKEN_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** Functions the relayer is allowed to call. Nothing else is reachable. */
export const RELAYER_ABI = parseAbi([
  "function recordCommission(address recipient, bytes32 sourceEventId, uint8 level, uint256 amount)",
  "function fundRewardPool(uint256 poolId, uint256 amount)",
  "function depositCommissionPool(uint256 amount)",
  "function setKycApproved(address user, bool approved)",
  "function clawback(address recipient, uint256 amount, string reason)",
  "function createPool(uint256 lockDays, uint256 rewardsDurationDays, uint256 earlyPenaltyBps)",
  "function setPoolActive(uint256 poolId, bool active)",
  "function transfer(address to, uint256 value)",
]);

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

/** Gas price bump per reprice attempt, in basis points (12.5% — above the
 *  10% most nodes require to replace a pending transaction). */
export const REPRICE_BUMP_BPS = 1_250;

/** After this many reprices a transaction is abandoned for a human to look at. */
export const MAX_REPRICE_ATTEMPTS = 5;
