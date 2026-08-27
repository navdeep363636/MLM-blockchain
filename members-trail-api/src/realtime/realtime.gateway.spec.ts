import { Logger } from "@nestjs/common";
import { Events, type DomainEvent } from "@/events";
import { RealtimeGateway } from "./realtime.gateway";

/* ============================================================================
 * A socket that receives another member's financial events is a data breach, so
 * the tests here are about authority and addressing:
 *
 *   - an unauthenticated or revoked handshake is DISCONNECTED, not tolerated;
 *   - the room a socket joins comes from the verified token, never from the
 *     client;
 *   - an event with no recipient is dropped rather than broadcast.
 * ========================================================================== */

function socketDouble(over: Record<string, unknown> = {}) {
  return {
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: "tok" }, headers: {} },
    join: jest.fn(async () => undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...over,
  };
}

/**
 * The envelope `EventBusService.publish` puts on the wire.
 *
 * The spec used to call handlers with the bare payload, which is exactly why a
 * real defect survived: every handler read `payload.userId` from an envelope that
 * had no such field, emitted to `user:undefined`, and no test noticed because the
 * tests were passing the shape the handlers wrongly expected. A test double that
 * disagrees with the producer is worse than no test.
 */
function envelope<T>(payload: T): DomainEvent<T> {
  return {
    id: "evt-1",
    name: Events.PointsCredited,
    occurredAt: "2026-08-24T00:00:00.000Z",
    correlationId: undefined,
    actorId: undefined,
    payload,
  };
}

describe("RealtimeGateway", () => {
  let jwt: { verifyAsync: jest.Mock };
  let redis: { get: jest.Mock };
  let gateway: RealtimeGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

    jwt = { verifyAsync: jest.fn(async () => ({ sub: "u1", jti: "j1" })) };
    redis = { get: jest.fn(async () => ({ userId: "u1" })) };
    gateway = new RealtimeGateway(jwt as never, redis as never);

    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    (gateway as unknown as { server: unknown }).server = { to, sockets: { sockets: new Map() } };
  });

  afterEach(() => jest.restoreAllMocks());

  describe("handshake", () => {
    it("joins the socket to its OWN room, named from the verified token", async () => {
      const client = socketDouble();
      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith("user:u1");
      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.userId).toBe("u1");
    });

    it("disconnects a socket with no token", async () => {
      const client = socketDouble({ handshake: { auth: {}, headers: {} } });
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("disconnects when the JWT does not verify", async () => {
      jwt.verifyAsync.mockRejectedValue(new Error("jwt expired"));
      const client = socketDouble();
      await gateway.handleConnection(client as never);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it("disconnects a REVOKED session even though its JWT is still valid", async () => {
      /* This is the whole reason the Redis check exists: a logged-out member's
       * token stays cryptographically valid until it expires. */
      redis.get.mockResolvedValue(null);
      const client = socketDouble();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it("tells a rejected client nothing useful about why", async () => {
      jwt.verifyAsync.mockRejectedValue(new Error("jwt malformed at position 12"));
      const client = socketDouble();
      await gateway.handleConnection(client as never);

      const [event, body] = client.emit.mock.calls[0] as [string, { message: string }];
      expect(event).toBe("unauthorized");
      expect(body.message).toBe("Authentication required");
    });

    it("also accepts the token from the Authorization header, Bearer-stripped", async () => {
      const client = socketDouble({ handshake: { auth: {}, headers: { authorization: "Bearer tok123" } } });
      await gateway.handleConnection(client as never);
      expect(jwt.verifyAsync).toHaveBeenCalledWith("tok123");
    });

    /**
     * The claim is `staff`, which is what SessionService.signAccessToken issues
     * and what JwtAuthGuard reads.
     *
     * This test used to mock `isStaff: true` — a claim no part of this API emits
     * — and passed against a gateway that read the same invented name. Both
     * sides agreed on a fiction, so the staff room was never joined in
     * production and the suite was green throughout. Mocking the real claim name
     * is what makes this test able to fail.
     */
    it("puts staff in the ops room IN ADDITION to their own", async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: "s1", jti: "j2", staff: true });
      const client = socketDouble();
      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith("user:s1");
      expect(client.join).toHaveBeenCalledWith("staff:ops");
    });

    it("does not put a member in the staff room", async () => {
      const client = socketDouble();
      await gateway.handleConnection(client as never);
      expect(client.join).not.toHaveBeenCalledWith("staff:ops");
    });

    /** Guards the exact regression: a token whose staff flag is under any other
     *  name must not grant the staff room. */
    it("ignores an `isStaff` claim — that is not the name the API issues", async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: "s2", jti: "j3", isStaff: true });
      const client = socketDouble();
      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith("user:s2");
      expect(client.join).not.toHaveBeenCalledWith("staff:ops");
    });
  });

  describe("addressing", () => {
    it("sends a member's event only to their room", () => {
      gateway.onPointsCredited(envelope({ userId: "u1", amount: 40, source: "game", runningBalance: 140 }));
      expect(to).toHaveBeenCalledWith("user:u1");
      expect(emit).toHaveBeenCalledWith("points.credited", expect.objectContaining({ balance: 140 }));
    });

    it("REFUSES to emit an event that has no recipient, rather than broadcasting it", () => {
      /* A fallback broadcast here is how one member's balance appears on
       * another's screen. */
      gateway.onPointsCredited(envelope({ userId: undefined as unknown as string, amount: 40, source: "x", runningBalance: 1 }));
      expect(to).not.toHaveBeenCalled();
    });

    it("routes a tournament settlement to STAFF, not to the winners' rooms", () => {
      gateway.onTournamentSettled(envelope({ ref: "TRN-1", paidEntries: 3, totalPaid: "300" }));
      expect(to).toHaveBeenCalledWith("staff:ops");
    });

    it("routes fraud alerts and reorgs to staff only", () => {
      gateway.onFraudAlert(envelope({ kind: "velocity", severity: "high" }));
      gateway.onReorg(envelope({ contract: "staking", rewoundTo: 100, orphanedProcessed: 2 }));
      for (const call of to.mock.calls) expect(call[0]).toBe("staff:ops");
    });

    it("repeats penaltyAppliedTo on the wire so no UI shows a cut to principal", () => {
      gateway.onUnstakeRecorded(envelope({
        userId: "u1", poolId: 1, principalMtt: "100", rewardsPaidMtt: "5", penaltyMtt: "2",
      }));
      expect(emit).toHaveBeenCalledWith(
        "staking.unstaked",
        expect.objectContaining({ penaltyAppliedTo: "unclaimed_rewards" }),
      );
    });

    it("stamps every push with a server timestamp", () => {
      gateway.onKycApproved(envelope({ userId: "u1", tier: 2 }));
      const [, body] = emit.mock.calls[0] as [string, { at: string }];
      expect(Date.parse(body.at)).not.toBeNaN();
    });

    it("survives an event arriving before the server is bound", () => {
      const early = new RealtimeGateway(jwt as never, redis as never);
      expect(() => early.onKycApproved(envelope({ userId: "u1", tier: 1 }))).not.toThrow();
      expect(early.connectionCount()).toBe(0);
    });
  });

  describe("client messages", () => {
    it("answers ping and offers no other client-driven message", () => {
      /* There is deliberately no `subscribe`: a client that could name its own
       * room could name someone else's. */
      const result = gateway.handlePing(socketDouble() as never, {});
      expect(typeof result.pong).toBe("number");

      const messages = Object.getOwnPropertyNames(Object.getPrototypeOf(gateway))
        .filter((m) => m.startsWith("handle") && m !== "handleConnection" && m !== "handleDisconnect");
      expect(messages).toEqual(["handlePing"]);
    });
  });
});
