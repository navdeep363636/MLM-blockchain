import { UserThrottlerGuard } from "./throttle.guard";

/**
 * The tracker is the whole guard. Which string it returns decides whose
 * allowance a request spends, and getting it wrong is not visible as a bug —
 * it looks like the app randomly signing people out.
 */
class Probe extends UserThrottlerGuard {
  key(req: unknown): Promise<string> {
    return (this as unknown as {
      getTracker(r: unknown): Promise<string>;
    }).getTracker(req);
  }
}

const guard = new Probe(
  {} as never,
  {} as never,
  {} as never,
);

describe("UserThrottlerGuard tracker", () => {
  it("keys on the authenticated user before anything else", async () => {
    const key = await guard.key({ user: { id: "u1" }, cookies: { mt_rt: "t" }, ip: "1.2.3.4" });
    expect(key).toBe("u:u1");
  });

  it("keys on the session cookie when the route is public", async () => {
    /* POST /auth/refresh is @Public(), so there is no req.user even though the
     * caller is plainly a known session. Falling through to the IP here is what
     * made an office share one allowance. */
    const key = await guard.key({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" });
    expect(key.startsWith("s:")).toBe(true);
  });

  it("never puts the token itself in the key", async () => {
    const key = await guard.key({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" });
    expect(key).not.toContain("token-a");
  });

  it("gives two sessions behind one IP separate allowances", async () => {
    const a = await guard.key({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" });
    const b = await guard.key({ cookies: { mt_rt: "token-b" }, ip: "1.2.3.4" });
    expect(a).not.toBe(b);
  });

  it("is stable for the same session", async () => {
    const a = await guard.key({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" });
    const b = await guard.key({ cookies: { mt_rt: "token-a" }, ip: "9.9.9.9" });
    expect(a).toBe(b);
  });

  it("falls back to the IP for a caller with neither", async () => {
    expect(await guard.key({ ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
    expect(await guard.key({ cookies: { mt_rt: "" }, ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
    expect(await guard.key({})).toBe("ip:unknown");
  });
});
