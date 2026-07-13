import { describe, expect, test } from "vitest";
import {
  createHololiveDoubleEliminationState,
  listHololiveDoubleEliminationMatches,
  pickHololiveDoubleEliminationWinner,
  undoHololiveDoubleEliminationMatch
} from "./hololiveBracketEngine";

describe("Hololive double-elimination engine", () => {
  test.each([16, 32, 64, 128, 256])("creates the complete %i-song topology", async (size) => {
    const state = await createHololiveDoubleEliminationState(
      Array.from({ length: size }, (_, index) => `entry-${index}`)
    );
    const matches = listHololiveDoubleEliminationMatches(state);

    expect(matches).toHaveLength(size * 2 - 2);
    expect(matches.filter((match) => match.stage === "winners")).toHaveLength(size - 1);
    expect(matches.filter((match) => match.stage === "losers")).toHaveLength(size - 2);
    expect(matches.filter((match) => match.stage === "grand_final")).toHaveLength(1);
    expect(matches.filter((match) => match.ready)).toHaveLength(size / 2);
  });

  test("routes first losses into Losers and completes with one Grand Final", async () => {
    let state = await createHololiveDoubleEliminationState(
      Array.from({ length: 16 }, (_, index) => `entry-${index}`)
    );
    const first = listHololiveDoubleEliminationMatches(state).find((match) => match.ready);
    expect(first?.entryAId).toBe("entry-0");
    expect(first?.entryBId).toBe("entry-1");

    state = await pickHololiveDoubleEliminationWinner(
      state,
      first!.engineMatchId,
      first!.entryAId!,
      "2026-01-01T00:00:00.000Z"
    );
    expect(
      listHololiveDoubleEliminationMatches(state).some(
        (match) => match.stage === "losers" && (match.entryAId === "entry-1" || match.entryBId === "entry-1")
      )
    ).toBe(true);

    let picks = 1;
    while (!state.standings) {
      const next = listHololiveDoubleEliminationMatches(state).find((match) => match.ready && !match.complete);
      expect(next, `missing ready match after ${picks} picks`).toBeTruthy();
      state = await pickHololiveDoubleEliminationWinner(
        state,
        next!.engineMatchId,
        next!.entryAId!,
        new Date(Date.UTC(2026, 0, 1, 0, picks)).toISOString()
      );
      picks += 1;
    }

    expect(picks).toBe(30);
    expect(state.standings).toHaveLength(16);
    expect(state.standings?.[0]?.rank).toBe(1);
    expect(state.standings?.[1]?.rank).toBe(2);
    expect(state.standings?.some((standing) => standing.rank === 3)).toBe(true);
  });

  test("undo clears a result and restores its matchup", async () => {
    let state = await createHololiveDoubleEliminationState(
      Array.from({ length: 16 }, (_, index) => `entry-${index}`)
    );
    const first = listHololiveDoubleEliminationMatches(state).find((match) => match.ready)!;
    state = await pickHololiveDoubleEliminationWinner(
      state,
      first.engineMatchId,
      first.entryAId!,
      "2026-01-01T00:00:00.000Z"
    );
    state = await undoHololiveDoubleEliminationMatch(state, first.engineMatchId);

    const restored = listHololiveDoubleEliminationMatches(state).find(
      (match) => match.engineMatchId === first.engineMatchId
    );
    expect(restored?.ready).toBe(true);
    expect(restored?.winnerEntryId).toBeNull();
    expect(state.completedAtByMatchId).toEqual({});
  });

  test("the Losers-bracket finalist can win the single decisive Grand Final", async () => {
    let state = await createHololiveDoubleEliminationState(
      Array.from({ length: 16 }, (_, index) => `entry-${index}`)
    );
    let grandFinalWinner: string | null = null;
    let picks = 0;
    while (!state.standings) {
      const next = listHololiveDoubleEliminationMatches(state).find((match) => match.ready && !match.complete);
      expect(next).toBeTruthy();
      const winner = next!.stage === "grand_final" ? next!.entryBId : next!.entryAId;
      expect(winner).toBeTruthy();
      if (next!.stage === "grand_final") {
        grandFinalWinner = winner;
      }
      state = await pickHololiveDoubleEliminationWinner(
        state,
        next!.engineMatchId,
        winner!,
        new Date(Date.UTC(2026, 0, 2, 0, picks)).toISOString()
      );
      picks += 1;
    }

    expect(picks).toBe(30);
    expect(state.standings?.find((standing) => standing.rank === 1)?.entryId).toBe(grandFinalWinner);
  });
});
