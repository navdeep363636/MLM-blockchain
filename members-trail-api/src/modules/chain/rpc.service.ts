import { Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import {
  createPublicClient, createWalletClient, fallback, http,
  type Abi, type Address, type Block, type GetLogsReturnType, type Hex,
  type PublicClient, type TransactionReceipt, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { chainConfig, type ChainConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { MAX_BATCH_BLOCKS } from "./chain.constants";

/* ============================================================================
 * The RPC boundary.
 *
 * Every call to the chain goes through here, for three reasons:
 *
 *  1. FAILOVER. viem's `fallback` transport rotates across the configured RPC
 *     URLs, so one provider rate-limiting or 500-ing does not stop the indexer.
 *     A single hard-coded endpoint is the most common way a chain integration
 *     dies in production.
 *
 *  2. ONE PLACE THAT KNOWS THE KEY EXISTS. The signing account is constructed
 *     here and nowhere else. If `ORACLE_PRIVATE_KEY` is absent — which is the
 *     correct production configuration, where a KMS signs instead — every
 *     submission path refuses with an explicit error rather than silently
 *     falling back to an unsigned or default account.
 *
 *  3. BOUNDED READS. getLogs ranges are clamped, because an unbounded range is
 *     how you get a provider to time out and an indexer to make no progress
 *     forever.
 * ========================================================================== */

@Injectable()
export class RpcService implements OnModuleInit {
  private readonly log = new Logger(RpcService.name);

  private client!: PublicClient;
  private wallet: WalletClient | null = null;
  private signerAddress: Address | null = null;

  constructor(
    @Inject(chainConfig.KEY) private readonly cfg: ChainConfig,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    const chain = this.cfg.chainId === 56 ? bsc : bscTestnet;
    const urls = this.cfg.rpcUrls.filter((u) => u.trim().length > 0);

    if (urls.length === 0) {
      this.log.error("no RPC URLs configured — every chain read and write will refuse");
    }

    this.client = createPublicClient({
      chain,
      /* Rotates on failure and prefers the fastest responder. */
      transport: fallback(urls.map((url) => http(url, { timeout: 15_000, retryCount: 2 }))),
    });

    const key = this.cfg.oracle.privateKey?.trim();
    if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
      const account = privateKeyToAccount(key as Hex);
      this.signerAddress = account.address;
      this.wallet = createWalletClient({
        account,
        chain,
        transport: fallback(urls.map((url) => http(url, { timeout: 15_000 }))),
      });
      this.log.log(`relayer signer ready: ${account.address} on chain ${this.cfg.chainId}`);
    } else if (this.cfg.oracle.kmsKeyId) {
      /* The correct production setup. Submission refuses until a KMS signer is
       * wired in, which is safer than signing with something unexpected. */
      this.log.warn(
        "ORACLE_KMS_KEY_ID is set but no local signer is available — outbound transactions will refuse",
      );
    } else {
      this.log.warn("no relayer signer configured — outbound transactions will refuse");
    }
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  get chainId(): number {
    return this.cfg.chainId;
  }

  get explorerBase(): string {
    return this.cfg.explorerBase;
  }

  get confirmations(): number {
    return this.cfg.indexer.confirmations;
  }

  get batchBlocks(): number {
    return Math.min(this.cfg.indexer.batchBlocks, MAX_BATCH_BLOCKS);
  }

  /** Deployment block the indexer starts from on first boot. */
  get startBlock(): number {
    return this.cfg.indexer.startBlock;
  }

  get indexerEnabled(): boolean {
    return this.cfg.indexer.enabled;
  }

  get pollMs(): number {
    return this.cfg.indexer.pollMs;
  }

  /** Current head. Cached for a couple of seconds — every worker asks for it. */
  async blockNumber(): Promise<number> {
    const cached = await this.redis.get<number>(CacheKeys.chainRead("blockNumber", "head"));
    if (cached !== null) return cached;

    const head = Number(await this.client.getBlockNumber());
    await this.redis.set(CacheKeys.chainRead("blockNumber", "head"), head, 3);
    return head;
  }

  async block(blockNumber: number): Promise<Block> {
    return this.client.getBlock({ blockNumber: BigInt(blockNumber) });
  }

  /**
   * Logs for one contract over a bounded range.
   *
   * The range is clamped rather than rejected: a caller asking for too much gets
   * the first `batchBlocks` worth and can ask again, which keeps the indexer
   * making progress instead of failing repeatedly on the same wide window.
   */
  async logs(params: {
    address: Address;
    events: Abi;
    fromBlock: number;
    toBlock: number;
  }): Promise<GetLogsReturnType> {
    const to = Math.min(params.toBlock, params.fromBlock + this.batchBlocks - 1);
    try {
      return (await this.client.getLogs({
        address: params.address,
        events: params.events as never,
        fromBlock: BigInt(params.fromBlock),
        toBlock: BigInt(to),
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException({
        code: "RPC_GETLOGS_FAILED",
        message: `getLogs ${params.fromBlock}–${to} failed: ${message}`,
      });
    }
  }

  async receipt(txHash: string): Promise<TransactionReceipt | null> {
    try {
      return await this.client.getTransactionReceipt({ hash: txHash as Hex });
    } catch {
      /* Not an error: an unmined transaction has no receipt yet. */
      return null;
    }
  }

  /** Reads a view function. Cached briefly — chain reads are the slow path. */
  async read<T>(params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: unknown[];
    cacheSeconds?: number;
  }): Promise<T> {
    const cacheKey = CacheKeys.chainRead(
      params.functionName,
      `${params.address}:${JSON.stringify(params.args ?? [])}`,
    );
    const ttl = params.cacheSeconds ?? Ttl.chainRead;

    if (ttl > 0) {
      const cached = await this.redis.get<T>(cacheKey);
      if (cached !== null) return cached;
    }

    const value = (await this.client.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args ?? [],
    })) as T;

    if (ttl > 0) await this.redis.set(cacheKey, value, ttl);
    return value;
  }

  /**
   * Whether an address is a contract on this chain.
   *
   * The first thing to ask about a configured address: an EOA, or a nothing, has
   * no code, and every read against it reverts while every getLogs against it
   * matches nothing. Never cached — it is asked once at boot.
   */
  async hasCode(address: Address): Promise<boolean> {
    const code = await this.client.getCode({ address });
    return code !== undefined && code !== "0x";
  }

  /** Pending nonce for an address, straight from the node. Never cached. */
  async pendingNonce(address: Address): Promise<number> {
    return this.client.getTransactionCount({ address, blockTag: "pending" });
  }

  async gasPrice(): Promise<bigint> {
    return this.client.getGasPrice();
  }

  /* ==================================================================== *
   * Writes
   * ==================================================================== */

  get signer(): Address {
    if (!this.signerAddress) {
      throw new ServiceUnavailableException({
        code: "NO_SIGNER",
        message:
          "No relayer signer is configured. Outbound transactions are refused rather than " +
          "signed with an unexpected account.",
      });
    }
    return this.signerAddress;
  }

  get canSign(): boolean {
    return this.wallet !== null;
  }

  /**
   * Signs and submits one transaction with an EXPLICIT nonce and gas price.
   *
   * Both are passed in rather than left to the node: the nonce is managed by the
   * submitter so two concurrent sends cannot collide, and the gas price is
   * managed so a stuck transaction can be repriced on the same nonce instead of
   * being duplicated on a new one.
   */
  async send(params: {
    to: Address;
    abi: Abi;
    functionName: string;
    args: unknown[];
    nonce: number;
    gasPriceWei: bigint;
  }): Promise<string> {
    if (!this.wallet) {
      throw new ServiceUnavailableException({
        code: "NO_SIGNER",
        message: "No relayer signer is configured — refusing to submit",
      });
    }

    const ceiling = BigInt(this.cfg.tx.maxGasGwei) * 1_000_000_000n;
    if (params.gasPriceWei > ceiling) {
      /* A runaway reprice loop must not be able to spend the treasury on gas. */
      throw new ServiceUnavailableException({
        code: "GAS_CEILING_EXCEEDED",
        message:
          `Refusing to submit at ${params.gasPriceWei} wei: the configured ceiling is ` +
          `${this.cfg.tx.maxGasGwei} gwei. Raise TX_MAX_GAS_GWEI deliberately, not by retrying.`,
      });
    }

    const hash = await this.wallet.writeContract({
      address: params.to,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      nonce: params.nonce,
      gasPrice: params.gasPriceWei,
      chain: this.wallet.chain,
      account: this.wallet.account ?? null,
    });

    return hash;
  }

  /** Contract addresses from configuration, as checksummed addresses. */
  address(name: keyof ChainConfig["contracts"]): Address {
    const value = this.cfg.contracts[name];
    if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new ServiceUnavailableException({
        code: "CONTRACT_ADDRESS_UNSET",
        message: `No valid address configured for ${String(name)}`,
      });
    }
    return value as Address;
  }

  /** True when an address is configured at all — used to skip unused contracts. */
  hasAddress(name: keyof ChainConfig["contracts"]): boolean {
    const value = this.cfg.contracts[name];
    return Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));
  }

  explorerTx(txHash: string): string {
    return `${this.cfg.explorerBase}/tx/${txHash}`;
  }
}
