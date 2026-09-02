import { UserThrottlerGuard } from "./throttle.guard";

/**
 * The tracker is the whole guard. Which string it returns decides whose
 * allowance a request spends, and getting it wrong is not visible as a bug —
 * it looks either like the app randomly signing people out, or like the rate
 * limits working when they are not there at all.
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

/** A request shaped like one Express would hand the guard. */
const req = (over: Record<string, unknown>) => ({ path: "/api/v1/auth/refresh", ...over });

describe("UserThrottlerGuard tracker", () => {
  it("keys on the authenticated user before anything else", async () => {
    const key = await guard.key(req({ user: { id: "u1" }, cookies: { mt_rt: "t" }, ip: "1.2.3.4" }));
    expect(key).toBe("u:u1");
  });

  it("keys on the session cookie on the refresh route", async () => {
    /* POST /auth/refresh is @Public(), so there is no req.user even though the
     * caller is plainly a known session. Falling through to the IP here is what
     * made an office behind one NAT share a single allowance. */
    const key = await guard.key(req({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" }));
    expect(key.startsWith("s:")).toBe(true);
  });

  it("never puts the token itself in the key", async () => {
    const key = await guard.key(req({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" }));
    expect(key).not.toContain("token-a");
  });

  it("gives two sessions behind one IP separate allowances", async () => {
    const a = await guard.key(req({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" }));
    const b = await guard.key(req({ cookies: { mt_rt: "token-b" }, ip: "1.2.3.4" }));
    expect(a).not.toBe(b);
  });

  /* ------------------------------------------------------------------ *
   * The bypass
   * ------------------------------------------------------------------ */

  it("IGNORES the cookie on credential endpoints", async () => {
    /* This is the defect. The cookie is attacker-controlled and used to be
     * trusted on every route, so a fresh random `mt_rt` per request minted a
     * fresh bucket and nullified every limit on the auth surface — login,
     * register, forgot-password, verify-otp — from a single IP. */
    for (const path of [
      "/api/v1/auth/login",
      "/api/v1/auth/register",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/reset-password",
      "/api/v1/auth/verify-otp",
      "/api/v1/auth/resend-otp",
      "/api/v1/auth/login/2fa",
    ]) {
      const a = await guard.key({ path, cookies: { mt_rt: "rand-1" }, ip: "1.2.3.4" });
      const b = await guard.key({ path, cookies: { mt_rt: "rand-2" }, ip: "1.2.3.4" });
      expect(a).toBe("ip:1.2.3.4");
      expect(b).toBe("ip:1.2.3.4");
    }
  });

  it("binds the cookie key to the IP, so rotating the cookie buys nothing extra", async () => {
    /* Even where the cookie is honoured, it cannot replace the IP: one address
     * rotating cookies gets a bucket per cookie, but they are all reachable
     * from that address anyway, and a different address cannot reuse them. */
    const sameIp = await guard.key(req({ cookies: { mt_rt: "token-a" }, ip: "1.2.3.4" }));
    const otherIp = await guard.key(req({ cookies: { mt_rt: "token-a" }, ip: "9.9.9.9" }));
    expect(sameIp).not.toBe(otherIp);
  });

  it("falls back to the IP for a caller with neither", async () => {
    expect(await guard.key(req({ ip: "1.2.3.4" }))).toBe("ip:1.2.3.4");
    expect(await guard.key(req({ cookies: { mt_rt: "" }, ip: "1.2.3.4" }))).toBe("ip:1.2.3.4");
    expect(await guard.key(req({}))).toBe("ip:unknown");
  });
});
