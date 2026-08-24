import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";
import { RequirePermissions, StaffOnly } from "@/common/decorators";
import type { OutboundTransaction } from "@/database/entities";
import { EventDispatcherService, type DispatchResult } from "./event-dispatcher.service";
import { IndexerService, type IndexRunResult, type IndexerStatus } from "./indexer.service";
import { TxSubmitterService, type SubmitOutcome } from "./tx-submitter.service";

/* ============================================================================
 * Chain operations (FRD AD-12).
 *
 * These routes exist because the chain layer's failure modes are operational, not
 * exceptional: a provider stalls, a handler has a bug, a transaction sticks in the
 * mempool. Each has a deliberate, audited recovery here — rewind the cursor,
 * replay a range, requeue a transaction — rather than a database edit.
 * ========================================================================== */

class RewindRequest {
  @IsInt() @Min(0) @Type(() => Number)
  blockNumber!: number;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class ReplayRequest {
  @IsInt() @Min(0) @Type(() => Number)
  fromBlock!: number;

  @IsInt() @Min(0) @Type(() => Number)
  toBlock!: number;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class RequeueRequest {
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

@ApiTags("admin: chain")
@StaffOnly("super_admin")
@Controller("admin/chain")
export class ChainAdminController {
  constructor(
    private readonly indexer: IndexerService,
    private readonly dispatcher: EventDispatcherService,
    private readonly submitter: TxSubmitterService,
  ) {}

  /* -------------------------------- indexer ------------------------------- */

  @Get("indexer/status")
  @ApiOperation({
    summary: "Indexer health: head, cursors, lag and reorg counts",
    description:
      "Cursor lag is the metric that matters — a stalled indexer looks exactly like a quiet " +
      "chain, and the difference is whether members' stakes are appearing.",
  })
  status(): Promise<IndexerStatus> {
    return this.indexer.status();
  }

  @Post("indexer/run")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Run one indexing pass now",
    description: "Normally driven by the cron; exposed for a manual catch-up after an outage.",
  })
  run(): Promise<IndexRunResult[]> {
    return this.indexer.runAll();
  }

  @Post("indexer/:cursorKey/rewind")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Rewind a cursor to re-index a range",
    description:
      "Safe by construction: UNIQUE(txHash, logIndex) means re-scanning is a no-op for events " +
      "already stored. This is the recovery a subscription-based indexer cannot offer.",
  })
  rewind(@Param("cursorKey") cursorKey: string, @Body() dto: RewindRequest) {
    return this.indexer.rewindTo(cursorKey, dto.blockNumber, dto.reason);
  }

  /* ------------------------------- dispatcher ------------------------------ */

  @Post("dispatch")
  @RequirePermissions("chain:operate")
  @ApiOperation({ summary: "Apply stored-but-unprocessed chain events to domain state" })
  dispatch(): Promise<DispatchResult> {
    return this.dispatcher.dispatch();
  }

  @Post("dispatch/replay")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Re-apply already-stored events for a block range",
    description:
      "Touches no RPC: the events are already in the database. This is how a fixed handler is " +
      "applied to history.",
  })
  replay(@Body() dto: ReplayRequest): Promise<number> {
    return this.dispatcher.replayRange(dto.fromBlock, dto.toBlock, dto.reason);
  }

  /* -------------------------------- relayer -------------------------------- */

  @Get("relayer/status")
  @ApiOperation({
    summary: "Relayer health: signer, queue depth, next nonce and gas price",
    description: "Any abandoned transaction makes the relayer unhealthy — it always needs a human.",
  })
  relayerStatus() {
    return this.submitter.status();
  }

  @Get("relayer/queue")
  @ApiOperation({ summary: "Queued outbound transactions" })
  queue(@Query("limit") limit?: string): Promise<OutboundTransaction[]> {
    return this.submitter.pending(limit ? Number(limit) : 50);
  }

  @Get("relayer/in-flight")
  @ApiOperation({ summary: "Submitted transactions still awaiting a receipt" })
  inFlight(): Promise<OutboundTransaction[]> {
    return this.submitter.inFlight();
  }

  @Post("relayer/:id/submit")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Submit one queued transaction now",
    description: "Nonce assignment is serialised, so this is safe alongside the worker.",
  })
  submit(@Param("id", ParseUUIDPipe) id: string): Promise<SubmitOutcome> {
    return this.submitter.submit(id);
  }

  @Post("relayer/:id/watch")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Check a submitted transaction for its receipt",
    description: "Reprices on the SAME nonce if it has been pending too long — never on a new one.",
  })
  watch(@Param("id", ParseUUIDPipe) id: string): Promise<SubmitOutcome> {
    return this.submitter.watch(id);
  }

  @Post("relayer/:id/requeue")
  @RequirePermissions("chain:operate")
  @ApiOperation({
    summary: "Requeue an abandoned or failed transaction",
    description: "Clears the nonce: reusing one that may already be consumed on chain would just be rejected.",
  })
  requeue(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RequeueRequest,
  ): Promise<SubmitOutcome> {
    return this.submitter.requeue(id, dto.reason);
  }
}
