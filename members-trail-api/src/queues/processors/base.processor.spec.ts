import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { BaseProcessor } from "./base.processor";

/* ============================================================================
 * The base processor decides what happens to every job in the system, so its
 * two rules are worth pinning: an unknown job name is discarded rather than
 * retried forever, and a failing job is logged with its identity before the
 * throw that BullMQ needs.
 * ========================================================================== */

class TestProcessor extends BaseProcessor {
  protected readonly log = new Logger("TestProcessor");
  public calls: unknown[] = [];

  protected handlers() {
    return {
      "good-job": async (data: never) => {
        this.calls.push(data);
        return { ok: true };
      },
      "bad-job": async () => {
        throw new Error("handler exploded");
      },
    };
  }
}

function job(name: string, data: unknown = {}, opts: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name,
    data,
    queueName: "test-queue",
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...opts,
  } as unknown as Job;
}

describe("BaseProcessor", () => {
  let processor: TestProcessor;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    processor = new TestProcessor();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("dispatches a known job name to its handler", async () => {
    await expect(processor.process(job("good-job", { a: 1 }))).resolves.toEqual({ ok: true });
    expect(processor.calls).toEqual([{ a: 1 }]);
  });

  it("DISCARDS an unknown job name instead of throwing", async () => {
    /* Throwing would retry a job that no handler will ever accept, filling the
     * failed set and hiding real failures. */
    await expect(processor.process(job("mystery-job"))).resolves.toEqual({
      skipped: "NO_HANDLER",
      jobName: "mystery-job",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no handler"));
  });

  it("rethrows a handler failure so BullMQ can schedule the retry", async () => {
    await expect(processor.process(job("bad-job"))).rejects.toThrow("handler exploded");
  });

  it("logs a non-final failure as a warning, naming the queue, job and attempt", async () => {
    await expect(processor.process(job("bad-job"))).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/test-queue\/bad-job job j1 failed \(attempt 1\/3\)/),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("escalates the LAST attempt to error and marks it FINAL", async () => {
    /* A job that will try again in ten seconds and one that has given up are
     * different operational events; the log has to distinguish them. */
    await expect(
      processor.process(job("bad-job", {}, { attemptsMade: 2 } as Partial<Job>)),
    ).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("FINAL"));
  });

  it("treats a job with no declared attempts as single-attempt, so it is FINAL at once", async () => {
    await expect(
      processor.process(job("bad-job", {}, { opts: {} } as Partial<Job>)),
    ).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("attempt 1/1, FINAL"));
  });
});
