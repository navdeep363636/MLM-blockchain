/**
 * Proves the chain layer decodes what the contracts actually emit.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/verify-chain-wiring.ts
 *
 * Reads MLM-contracts/deployments/<network>.exercised.json, scans the block
 * range that `exercise-all.js` produced, and decodes every log using the SAME
 * `CONTRACT_SPECS` and `watchedEventAbi` the production indexer uses.
 *
 * WHY THIS EXISTS AND UNIT TESTS DID NOT CATCH IT
 * -----------------------------------------------
 * The previous chain layer had sixteen passing unit tests for its event
 * handlers. Every one of them constructed the event payload from the same
 * assumption the handler made, so all sixteen agreed with each other and all
 * sixteen were wrong about the contract. Seven of the eight watched signatures
 * did not exist on the deployed bytecode.
 *
 * The failure mode is what makes it worth a dedicated script: a wrong event
 * signature is a wrong topic0, so `getLogs` returns an empty array. Nothing
 * throws. The indexer advances its cursor, the health endpoint reports green,
 * and zero events are indexed. The only observable symptom is that members'
 * stakes never appear.
 *
 * So this asserts on COUNTS — every watched event must be found at least once —
 * and on the argument NAMES the dispatcher reads, because a correct topic0 with
 * a misread field is the same silent wrongness one layer further in.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, encodePacked, http, keccak256, toHex, type Abi, type Address,
} from "viem";
import {
  CONTRACT_SPECS, validateSpecs, watchedEventAbi, type ContractName,
} from "../src/modules/chain/chain.constants";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const NETWORK = process.env.CONTRACT_NETWORK ?? "localhost";
/* Defaults to the sibling checkout, which is the layout the repo ships in.
 * This used to be an absolute path from the machine the script was written on,
 * so it failed on every other machine with ENOENT on the deployment record. */
const CONTRACTS_DIR = process.env.CONTRACTS_DIR ?? join(__dirname, "..", "..", "MLM-contracts");

/** Which deployment-record key holds each logical contract's address. */
const ADDRESS_KEY: Record<ContractName, string> = {
  mttToken: "MTTToken",
  staking: "MTTStaking",
  referralDistributor: "MTTReferralDistributor",
  payout: "MTTPayout",
  teamVesting: "TeamVesting",
  advisorsVesting: "AdvisorsVesting",
};

/**
 * The argument names each handler in event-dispatcher.service.ts reads.
 *
 * Listed explicitly because this is the second half of the original bug: the
 * dispatcher read `args.rewards` and `args.penalty` off `Unstaked`, and the
 * contract emits `forfeitedRewards` and `early`. Both resolved to undefined, so
 * the penalty was silently dropped from the ledger — with a correct topic0 and
 * a successfully decoded log.
 */
const REQUIRED_ARGS: Record<string, string[]> = {
  Staked: ["poolId", "user", "amount", "lockEnd"],
  Unstaked: ["poolId", "user", "amount", "forfeitedRewards", "early"],
  RewardClaimed: ["poolId", "user", "amount"],
  PoolFunded: ["poolId", "amount"],
  PoolCreated: ["poolId", "lockDuration", "rewardsDuration", "earlyUnstakePenaltyBps"],
  CommissionPoolFunded: ["amount", "newTotalDeposited"],
  CommissionRecorded: ["recipient", "level", "amount", "sourceEventId"],
  CommissionClaimed: ["recipient", "amount"],
  CommissionClawedBack: ["recipient", "amount", "sourceEventId", "reason"],
  KycStatusUpdated: ["user", "approved"],
  PayoutSent: ["to", "amount", "withdrawalRef"],
  DailyLimitUpdated: ["previous", "next"],
  TokensReleased: ["amount"],
};

interface Exercised {
  fromBlock: number;
  toBlock: number;
  addresses: Record<string, string>;
  emitted: Record<string, number>;
  fixtures: Record<string, string>;
}

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

async function main(): Promise<void> {
  let passed = 0;
  const failures: string[] = [];
  const check = (ok: boolean, label: string, detail = "") => {
    if (ok) { passed += 1; console.log(`  ${green("PASS")} ${label}`); }
    else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ${red("FAIL")} ${label}${detail ? ` — ${detail}` : ""}`); }
  };

  console.log("=".repeat(72));
  console.log("Chain wiring verification — production constants against a live chain");
  console.log("=".repeat(72));

  /* ---------------------------------------------------------------- */
  console.log("\n[1] Spec names resolve against the generated ABIs");
  const problems = validateSpecs();
  check(problems.length === 0, "every watched event and callable function exists",
    problems.map((p) => `${p.contract}.${p.name}`).join(", "));

  /* ---------------------------------------------------------------- */
  const recordPath = join(CONTRACTS_DIR, "deployments", `${NETWORK}.exercised.json`);
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as Exercised;

  const client = createPublicClient({ transport: http(RPC, { timeout: 20_000 }) });
  const head = Number(await client.getBlockNumber());
  console.log(`\n[2] Chain reachable at ${RPC} (head ${head}), scanning ${record.fromBlock}-${record.toBlock}`);
  check(head >= record.toBlock, "chain has the exercised blocks");

  /* ---------------------------------------------------------------- */
  console.log("\n[3] getLogs decodes every watched event");

  const seen = new Map<string, Record<string, unknown>>();

  for (const spec of CONTRACT_SPECS) {
    if (spec.watch.length === 0) continue;

    const address = record.addresses[ADDRESS_KEY[spec.name]] as Address | undefined;
    if (!address) {
      check(false, `${spec.name}: address present in the deployment record`);
      continue;
    }

    const logs = await client.getLogs({
      address,
      events: watchedEventAbi(spec) as Abi as never,
      fromBlock: BigInt(record.fromBlock),
      toBlock: BigInt(record.toBlock),
    });

    for (const log of logs as unknown as { eventName?: string; args?: Record<string, unknown> }[]) {
      if (log.eventName) seen.set(log.eventName, log.args ?? {});
    }

    /*
     * The assertion that would have failed before this rewrite, for every
     * contract: zero logs, no error.
     */
    check(logs.length > 0, `${spec.name}: getLogs returned ${logs.length} decoded logs`,
      logs.length === 0 ? "ZERO — this is the silent failure mode" : "");
  }

  for (const spec of CONTRACT_SPECS) {
    for (const eventName of spec.watch) {
      /* Vesting emits only on the team contract in the fixture, and the payout
       * rail's Paused/Unpaused are exercised; anything genuinely not emitted by
       * exercise-all.js is reported rather than silently skipped. */
      const found = seen.has(eventName);
      check(found, `${spec.name}.${eventName} observed on chain`,
        found ? "" : "not emitted by the fixture, or the signature does not match");
    }
  }

  /* ---------------------------------------------------------------- */
  console.log("\n[4] Decoded argument names match what the dispatcher reads");

  for (const [eventName, required] of Object.entries(REQUIRED_ARGS)) {
    const args = seen.get(eventName);
    if (!args) continue; // already reported above
    const missing = required.filter((k) => !(k in args));
    check(missing.length === 0, `${eventName}(${required.join(", ")})`,
      missing.length ? `missing ${missing.join(", ")}` : "");
  }

  /* ---------------------------------------------------------------- */
  console.log("\n[5] Values survive decoding intact");

  const staked = seen.get("Staked");
  check(
    typeof staked?.amount === "bigint" && (staked.amount as bigint) === 2_000n * 10n ** 18n,
    "Staked.amount is the exact 18-decimal bigint (2000 MTT)",
    staked ? `got ${String(staked.amount)}` : "",
  );
  check(
    typeof staked?.poolId === "bigint" && (staked.poolId as bigint) === 0n,
    "Staked.poolId decodes as pool 0, not as an address",
  );

  const unstaked = seen.get("Unstaked");
  check(
    typeof unstaked?.forfeitedRewards === "bigint",
    "Unstaked.forfeitedRewards is present — the penalty the old code dropped",
    unstaked ? `got ${String(unstaked.forfeitedRewards)}` : "",
  );
  check(typeof unstaked?.early === "boolean", "Unstaked.early is a bool, not an amount");

  const clawed = seen.get("CommissionClawedBack");
  check(
    typeof clawed?.reason === "string" && (clawed.reason as string).length > 0,
    "CommissionClawedBack.reason is readable text",
    clawed ? `got ${JSON.stringify(clawed.reason)}` : "",
  );

  const payoutSent = seen.get("PayoutSent");
  check(
    typeof payoutSent?.withdrawalRef === "string" && (payoutSent.withdrawalRef as string).startsWith("0x"),
    "PayoutSent carries the withdrawal reference on chain",
  );
  check(
    typeof payoutSent?.amount === "bigint" &&
      (payoutSent.amount as bigint) === 1_250_500_000_000_000_000_000n,
    "PayoutSent.amount is exactly 1250.5 MTT — no float rounding anywhere in the path",
    payoutSent ? `got ${String(payoutSent.amount)}` : "",
  );

  /* The token allocation event, which used to be undecodable. */
  console.log("\n[6] The token's allocation table is readable from chain data");
  const tokenSpec = CONTRACT_SPECS.find((s) => s.name === "mttToken")!;
  const allocationAbi = tokenSpec.abi.filter(
    (e) => e.type === "event" && (e as { name: string }).name === "AllocationMinted",
  ) as Abi;
  const allocLogs = await client.getLogs({
    address: record.addresses.MTTToken as Address,
    events: allocationAbi as never,
    fromBlock: 0n,
    toBlock: BigInt(record.toBlock),
  });
  const buckets = (allocLogs as unknown as { args?: { bucket?: string } }[])
    .map((l) => l.args?.bucket)
    .filter(Boolean);
  check(
    buckets.includes("REWARDS_POOL") && buckets.length === 6,
    "AllocationMinted.bucket decodes to the bucket NAME, not a keccak hash",
    `got ${JSON.stringify(buckets)}`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\n[7] The aggregate views ChainReadService depends on decode by NAME");

  const specOf = (n: ContractName) => CONTRACT_SPECS.find((s) => s.name === n)!;
  const readView = <T>(n: ContractName, functionName: string, args: unknown[] = []) =>
    client.readContract({
      address: record.addresses[ADDRESS_KEY[n]] as Address,
      abi: specOf(n).abi,
      functionName,
      args,
    }) as Promise<T>;

  /* getPools — the call that replaced N positional `pools(i)` tuple reads. */
  const pools = await readView<readonly Record<string, unknown>[]>("staking", "getPools");
  check(Array.isArray(pools) && pools.length >= 4, `getPools returned ${pools.length} pools`);
  check(
    pools[0] !== undefined && "earlyUnstakePenaltyBps" in pools[0] && "totalStaked" in pools[0],
    "pool struct decodes by field name, not by tuple position",
    pools[0] ? `keys: ${Object.keys(pools[0]).join(", ")}` : "",
  );

  /* getPositions — replaced userInfo + earned, which could disagree. */
  const positions = await readView<readonly Record<string, unknown>[]>(
    "staking", "getPositions", [record.fixtures.member as Address],
  );
  check(positions.length === pools.length, "getPositions returns one row per pool");
  check(
    positions[0] !== undefined && "pendingRewards" in positions[0] && "locked" in positions[0],
    "position exposes amount, lockEnd, pendingRewards and locked together",
  );

  /* Solvency — answerable on chain because the contract now tracks principal. */
  const solvent = await readView<boolean>("staking", "isSolvent");
  const principal = await readView<bigint>("staking", "totalStakedAllPools");
  const float = await readView<bigint>("staking", "rewardFloat");
  check(solvent === true, "staking reports itself solvent");
  check(principal === 1_000n * 10n ** 18n,
    "totalStakedAllPools tracks the 1000 MTT still staked after the partial unstake",
    `got ${String(principal)}`);
  check(float > 0n, "rewardFloat is the balance above staker principal", `got ${String(float)}`);

  /* getAccount — one read for balance + kyc + claimability. */
  const account = await readView<readonly [bigint, boolean, boolean]>(
    "referralDistributor", "getAccount", [record.fixtures.member as Address],
  );
  check(account[1] === true, "getAccount reports the member KYC-approved");
  check(account[0] === 0n, "getAccount shows a zero balance after the claim", `got ${String(account[0])}`);

  /* The contract's own dedupe key must equal what an off-chain encoder produces. */
  const onChainKey = await readView<string>("referralDistributor", "dedupeKeyFor", [
    record.fixtures.member as Address, 1,
    keccak256(toHex(record.fixtures.sourceEventRef)),
  ]);
  const offChainKey = keccak256(
    encodePacked(["address", "uint8", "bytes32"], [
      record.fixtures.member as Address, 1,
      keccak256(toHex(record.fixtures.sourceEventRef)),
    ]),
  );
  check(onChainKey === offChainKey,
    "the contract's dedupe key matches viem's encodePacked — a mismatch reads as 'not recorded'",
    `chain ${onChainKey} vs local ${offChainKey}`);
  check(
    await readView<boolean>("referralDistributor", "isRecorded", [
      record.fixtures.member as Address, 1, keccak256(toHex(record.fixtures.sourceEventRef)),
    ]),
    "isRecorded confirms the batched commission was stored",
  );

  /* settlement — the payout replay guard the withdrawal path relies on. */
  const settlement = await readView<readonly [boolean, bigint]>(
    "payout", "settlement", [keccak256(toHex(record.fixtures.withdrawalRef))],
  );
  check(settlement[0] === true, "settlement() confirms the withdrawal settled on chain");
  check(settlement[1] === 1_250_500_000_000_000_000_000n,
    "settlement() returns the exact amount paid, so the ledger can be reconciled",
    `got ${String(settlement[1])}`);

  /* schedule — added so a UI never has to guess the chain's clock. */
  const schedule = await readView<Record<string, unknown>>("teamVesting", "schedule");
  check(
    ["beneficiary", "start", "cliffEnd", "vestingEnd", "total", "released", "releasable"]
      .every((k) => k in schedule),
    "vesting schedule() returns the whole schedule by field name",
    `keys: ${Object.keys(schedule).join(", ")}`,
  );
  check((schedule.released as bigint) > 0n, "vesting reports the released amount after release()");

  /* ---------------------------------------------------------------- */
  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log(green(`ALL ${passed} CHECKS PASSED`));
    console.log("=".repeat(72));
    return;
  }
  console.log(red(`${failures.length} FAILED, ${passed} passed`));
  failures.forEach((f) => console.log(red(`  · ${f}`)));
  console.log("=".repeat(72));
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(red(`verification could not run: ${e instanceof Error ? e.message : String(e)}`));
  process.exitCode = 1;
});
