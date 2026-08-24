import { Logger } from "@nestjs/common";
import { WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";

/* ============================================================================
 * Shared processor behaviour.
 *
 * Every processor in this folder extends this, so three things are true of all
 * of them without each one remembering:
 *
 *  1. THE JOB NAME IS DISPATCHED EXPLICITLY. A queue carries several job names;
 *     an unrecognised one is logged and DISCARDED rather than throwing, because
 *     throwing would retry it forever against a handler that will never exist.
 *
 *  2. FAILURES ARE LOGGED WITH THE JOB'S IDENTITY BEFORE BEING RETHROWN. BullMQ
 *     needs the throw to schedule the retry; an operator needs to know which job
 *     failed and why, and "Error: undefined" in a worker log is neither.
 *
 *  3. THE LAST ATTEMPT SAYS SO. A job that has exhausted its attempts is a
 *     different operational event from one that will try again in ten seconds,
 *     and the log line distinguishes them.
 * ========================================================================== */

export abstract class BaseProcessor extends WorkerHost {
  protected abstract readonly log: Logger;

  /** Handlers this processor implements, keyed by job name. */
  protected abstract handlers(): Record<string, (data: never) => Promise<unknown>>;

  async process(job: Job): Promise<unknown> {
    const handler = this.handlers()[job.name];

    if (!handler) {
      /* Rule 1: discard, do not throw. A job with no handler will never succeed,
       * and retrying it just fills the failed set with noise. */
      this.log.warn(`no handler for job "${job.name}" on ${job.queueName} — discarding job ${job.id}`);
      return { skipped: "NO_HANDLER", jobName: job.name };
    }

    try {
      return await handler(job.data as never);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const attempts = job.opts.attempts ?? 1;
      const isLast = job.attemptsMade + 1 >= attempts;

      /* Rule 2 and 3. */
      this.log[isLast ? "error" : "warn"](
        `${job.queueName}/${job.name} job ${job.id} failed ` +
        `(attempt ${job.attemptsMade + 1}/${attempts}${isLast ? ", FINAL" : ""}): ${message}`,
      );

      /* Rethrown so BullMQ schedules the retry or moves it to failed. */
      throw e;
    }
  }
}
