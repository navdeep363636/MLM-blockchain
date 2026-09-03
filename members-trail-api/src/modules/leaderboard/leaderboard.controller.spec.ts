import { Test } from "@nestjs/testing";
import { LeaderboardController } from "./leaderboard.controller";
import { LeaderboardService } from "./leaderboard.service";

/* ============================================================================
 * The controller was previously untested at every layer — no unit spec and no
 * e2e spec — so nothing pinned the query wiring on `board()` or the
 * Promise.all aggregation on `me()`.
 * ========================================================================== */

describe("LeaderboardController", () => {
  let controller: LeaderboardController;
  let service: { board: jest.Mock; rankFor: jest.Mock };
  const user = { id: "u1" } as never;

  beforeEach(async () => {
    service = {
      board: jest.fn(async () => ({
        metric: "points", period: "weekly", periodKey: "2026-W11",
        rows: [], you: null, totalRanked: 0, resetsInSeconds: 0, source: "live",
      })),
      rankFor: jest.fn(async () => null),
    };

    const mod = await Test.createTestingModule({
      controllers: [LeaderboardController],
      providers: [{ provide: LeaderboardService, useValue: service }],
    }).compile();

    controller = mod.get(LeaderboardController);
  });

  describe("board", () => {
    it("forwards the query and the caller's id to the service", async () => {
      const q = { metric: "points" as const, period: "weekly" as const, limit: 25 };
      await controller.board(q, user);
      expect(service.board).toHaveBeenCalledWith(q, "u1");
    });

    it("returns whatever the service resolves", async () => {
      const expected = { rows: [{ rank: 1 }] };
      service.board.mockResolvedValue(expected);
      await expect(controller.board({}, user)).resolves.toBe(expected);
    });
  });

  describe("me", () => {
    it("aggregates points, score and sessions for the weekly board, for the caller", async () => {
      service.rankFor
        .mockResolvedValueOnce({ rank: 4, score: 900 })   // points
        .mockResolvedValueOnce({ rank: 7, score: 300 })   // score
        .mockResolvedValueOnce(null);                     // sessions

      const r = await controller.me(user);

      expect(r).toEqual({
        points: { rank: 4, score: 900 },
        score: { rank: 7, score: 300 },
        sessions: null,
      });
      expect(service.rankFor).toHaveBeenNthCalledWith(1, "u1", "points", "weekly");
      expect(service.rankFor).toHaveBeenNthCalledWith(2, "u1", "score", "weekly");
      expect(service.rankFor).toHaveBeenNthCalledWith(3, "u1", "sessions", "weekly");
    });
  });
});
