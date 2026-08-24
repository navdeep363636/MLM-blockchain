import { ALL_QUEUES, QueueDefaults, Jobs, jobKey } from "./queue.constants";

/* ============================================================================
 * The registry is data, but two properties of it are load-bearing enough to
 * assert: every queue has options (a missing entry means silent BullMQ defaults
 * — one attempt, no backoff, on a money queue), and job ids survive BullMQ's
 * own validation. The second one shipped broken: BullMQ rejects a custom id
 * containing ":", which is exactly how every idempotency key in this codebase
 * is written.
 * ========================================================================== */

describe("queue registry", () => {
  it("has job options for every registered queue", () => {
    for (const name of ALL_QUEUES) {
      expect(QueueDefaults[name]).toBeDefined();
      expect(QueueDefaults[name].attempts).toBeGreaterThan(0);
    }
  });

  it("keeps queue and job names free of the characters BullMQ reserves", () => {
    for (const name of ALL_QUEUES) expect(name).toMatch(/^[a-z0-9-]+$/);
    for (const job of Object.values(Jobs)) expect(job).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("jobKey", () => {
  it("strips the colons BullMQ refuses in a custom job id", () => {
    expect(jobKey("payout:w1")).toBe("payout-w1");
    expect(jobKey("outbound-webhook:abc:retry:12345")).toBe("outbound-webhook-abc-retry-12345");
  });

  it("keeps the characters that are safe, so ids stay readable in the UI", () => {
    expect(jobKey("settle-conversion-01HZ.4_x")).toBe("settle-conversion-01HZ.4_x");
  });

  it("collapses anything that could shape a Redis key", () => {
    /* A fragment that reached here from user input must not be able to add
     * structure to the key. */
    expect(jobKey("notify:{evil}\n*[1]")).toBe("notify-evil-1");
  });

  it("refuses a key that sanitises to nothing rather than losing deduplication", () => {
    /* An empty custom id makes BullMQ assign a sequential one, which would
     * silently turn a deduplicated enqueue into a duplicate. */
    expect(() => jobKey(":::")).toThrow(/empty job id/);
  });

  it("produces ids that pass BullMQ's own validation", () => {
    const samples = [
      "payout:w1", "deposit:01HZ", "commission:rev-1", "validate:sess-1",
      "otp:9f8c", "stake-intent:ref-1", "watch:tx-1:29123456", "index-range:current",
    ];
    /* BullMQ's rule, from Job.validateOptions. */
    for (const s of samples) expect(jobKey(s)).not.toContain(":");
  });
});
