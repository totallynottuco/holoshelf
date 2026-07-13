import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import { Status, type Database, type Match, type Participant, type Round } from "brackets-model";
import type { HololiveBracketStage } from "../../src/shared/contracts";

export interface HololiveDoubleEliminationEngineState {
  database: Database;
  stageId: number;
  completedAtByMatchId: Record<string, string>;
  standings?: HololiveDoubleEliminationStanding[];
}

export interface HololiveDoubleEliminationMatchState {
  engineMatchId: number;
  globalRoundIndex: number;
  stage: HololiveBracketStage;
  stageRoundIndex: number;
  matchIndex: number;
  playOrder: number;
  entryAId: string | null;
  entryBId: string | null;
  winnerEntryId: string | null;
  loserEntryId: string | null;
  ready: boolean;
  complete: boolean;
  lateRoundWeight: number;
  completedAt: string | null;
}

export interface HololiveDoubleEliminationStanding {
  entryId: string;
  rank: number;
}

interface LoadedEngine {
  manager: BracketsManager;
}

function createManager(database?: Database): LoadedEngine {
  const storage = new InMemoryDatabase();
  if (database) {
    storage.setData(structuredClone(database));
  }
  return { manager: new BracketsManager(storage) };
}

function numericId(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Unsupported bracket engine id: ${String(value)}`);
  }
  return parsed;
}

function participantEntryMap(database: Database): Map<number, string> {
  return new Map(
    database.participant.map((participant: Participant) => [numericId(participant.id), participant.name])
  );
}

function stageForGroupNumber(groupNumber: number): HololiveBracketStage {
  if (groupNumber === 1) {
    return "winners";
  }
  if (groupNumber === 2) {
    return "losers";
  }
  return "grand_final";
}

function buildRoundSchedule(database: Database): Map<number, number> {
  const groupsById = new Map(database.group.map((group) => [numericId(group.id), group]));
  const winnerRounds = database.round
    .filter((round) => groupsById.get(numericId(round.group_id))?.number === 1)
    .sort((left, right) => left.number - right.number);
  const loserRounds = database.round
    .filter((round) => groupsById.get(numericId(round.group_id))?.number === 2)
    .sort((left, right) => left.number - right.number);
  const finalRounds = database.round
    .filter((round) => groupsById.get(numericId(round.group_id))?.number === 3)
    .sort((left, right) => left.number - right.number);
  const scheduled: Round[] = [];
  const add = (round: Round | undefined) => {
    if (round && !scheduled.some((item) => item.id === round.id)) {
      scheduled.push(round);
    }
  };

  add(winnerRounds[0]);
  add(loserRounds[0]);
  let loserIndex = 1;
  for (let winnerIndex = 1; winnerIndex < winnerRounds.length; winnerIndex += 1) {
    add(winnerRounds[winnerIndex]);
    const remainingWinnerRounds = winnerRounds.length - winnerIndex - 1;
    const loserRoundsToAdd = remainingWinnerRounds === 0 ? 1 : 2;
    for (let index = 0; index < loserRoundsToAdd; index += 1) {
      add(loserRounds[loserIndex]);
      loserIndex += 1;
    }
  }
  while (loserIndex < loserRounds.length) {
    add(loserRounds[loserIndex]);
    loserIndex += 1;
  }
  for (const round of finalRounds) {
    add(round);
  }

  return new Map(scheduled.map((round, index) => [numericId(round.id), index]));
}

function lateRoundWeight(stage: HololiveBracketStage, roundIndex: number, roundCount: number): number {
  if (stage === "grand_final") {
    return 1.5;
  }
  if (stage === "winners") {
    const roundsFromFinal = roundCount - roundIndex - 1;
    if (roundsFromFinal === 0) return 1.5;
    if (roundsFromFinal === 1) return 1.25;
    if (roundsFromFinal === 2) return 1;
    return 0;
  }
  if (stage === "losers") {
    const roundsFromFinal = roundCount - roundIndex - 1;
    if (roundsFromFinal === 0) return 1.5;
    if (roundsFromFinal <= 2) return 1.25;
    if (roundsFromFinal <= 4) return 1;
  }
  return 0;
}

function resultEntryId(
  match: Match,
  participants: Map<number, string>,
  result: "win" | "loss"
): string | null {
  const opponent = [match.opponent1, match.opponent2].find((slot) => slot?.result === result);
  if (opponent?.id == null) {
    return null;
  }
  return participants.get(numericId(opponent.id)) ?? null;
}

export async function createHololiveDoubleEliminationState(
  entryIds: string[]
): Promise<HololiveDoubleEliminationEngineState> {
  const { manager } = createManager();
  const stage = await manager.create.stage({
    tournamentId: 1,
    name: "Holoshelf Double Elimination",
    type: "double_elimination",
    seeding: entryIds,
    settings: {
      grandFinal: "simple",
      seedOrdering: ["natural"]
    }
  });
  return {
    database: await manager.export(),
    stageId: numericId(stage.id),
    completedAtByMatchId: {}
  };
}

export function listHololiveDoubleEliminationMatches(
  state: HololiveDoubleEliminationEngineState
): HololiveDoubleEliminationMatchState[] {
  const database = state.database;
  const groupsById = new Map(database.group.map((group) => [numericId(group.id), group]));
  const roundsById = new Map(database.round.map((round) => [numericId(round.id), round]));
  const roundSchedule = buildRoundSchedule(database);
  const participants = participantEntryMap(database);
  const roundCounts = new Map<HololiveBracketStage, number>();
  for (const round of database.round) {
    const group = groupsById.get(numericId(round.group_id));
    if (!group) continue;
    const stage = stageForGroupNumber(group.number);
    roundCounts.set(stage, Math.max(roundCounts.get(stage) ?? 0, round.number));
  }

  const ordered = [...database.match].sort((left, right) => {
    const leftRound = roundSchedule.get(numericId(left.round_id)) ?? Number.MAX_SAFE_INTEGER;
    const rightRound = roundSchedule.get(numericId(right.round_id)) ?? Number.MAX_SAFE_INTEGER;
    return leftRound - rightRound || left.number - right.number;
  });
  let playOrder = 0;
  return ordered.map((match) => {
    const round = roundsById.get(numericId(match.round_id));
    const group = groupsById.get(numericId(match.group_id));
    if (!round || !group) {
      throw new Error(`Incomplete bracket engine topology for match ${String(match.id)}`);
    }
    const stage = stageForGroupNumber(group.number);
    const opponentEntryId = (slot: Match["opponent1"]): string | null =>
      slot?.id == null ? null : participants.get(numericId(slot.id)) ?? null;
    const engineMatchId = numericId(match.id);
    return {
      engineMatchId,
      globalRoundIndex: roundSchedule.get(numericId(round.id)) ?? 0,
      stage,
      stageRoundIndex: round.number - 1,
      matchIndex: match.number - 1,
      playOrder: playOrder++,
      entryAId: opponentEntryId(match.opponent1),
      entryBId: opponentEntryId(match.opponent2),
      winnerEntryId: resultEntryId(match, participants, "win"),
      loserEntryId: resultEntryId(match, participants, "loss"),
      ready: match.status === Status.Ready || match.status === Status.Running,
      complete: match.status === Status.Completed || match.status === Status.Archived,
      lateRoundWeight: lateRoundWeight(stage, round.number - 1, roundCounts.get(stage) ?? round.number),
      completedAt: state.completedAtByMatchId[String(engineMatchId)] ?? null
    };
  });
}

export async function pickHololiveDoubleEliminationWinner(
  state: HololiveDoubleEliminationEngineState,
  engineMatchId: number,
  winnerEntryId: string,
  completedAt: string
): Promise<HololiveDoubleEliminationEngineState> {
  const { manager } = createManager(state.database);
  const match = state.database.match.find((item) => numericId(item.id) === engineMatchId);
  if (!match) {
    throw new Error(`Unknown double-elimination match: ${engineMatchId}`);
  }
  const participants = participantEntryMap(state.database);
  const opponent1EntryId = match.opponent1?.id == null ? null : participants.get(numericId(match.opponent1.id));
  const opponent2EntryId = match.opponent2?.id == null ? null : participants.get(numericId(match.opponent2.id));
  if (winnerEntryId !== opponent1EntryId && winnerEntryId !== opponent2EntryId) {
    throw new Error("The selected winner is not in this matchup");
  }
  const opponent1Won = winnerEntryId === opponent1EntryId;
  await manager.update.match({
    id: engineMatchId,
    opponent1: { result: opponent1Won ? "win" : "loss" },
    opponent2: { result: opponent1Won ? "loss" : "win" }
  });
  const database = await manager.export();
  const finalGroupIds = new Set(
    database.group.filter((group) => group.number === 3).map((group) => numericId(group.id))
  );
  const finalComplete = database.match.some(
    (item) => finalGroupIds.has(numericId(item.group_id)) && item.status === Status.Completed
  );
  const participantEntries = participantEntryMap(database);
  const standings = finalComplete
    ? (await manager.get.finalStandings(state.stageId))
        .map((standing) => ({
          entryId: participantEntries.get(numericId(standing.id)) ?? "",
          rank: standing.rank
        }))
        .filter((standing) => standing.entryId)
    : undefined;
  return {
    database,
    stageId: state.stageId,
    completedAtByMatchId: {
      ...state.completedAtByMatchId,
      [String(engineMatchId)]: completedAt
    },
    standings
  };
}

export async function undoHololiveDoubleEliminationMatch(
  state: HololiveDoubleEliminationEngineState,
  engineMatchId: number
): Promise<HololiveDoubleEliminationEngineState> {
  const { manager } = createManager(state.database);
  await manager.reset.matchResults(engineMatchId);
  const database = await manager.export();
  const completedIds = new Set(
    database.match
      .filter((match) => match.status === Status.Completed || match.status === Status.Archived)
      .map((match) => String(match.id))
  );
  return {
    database,
    stageId: state.stageId,
    completedAtByMatchId: Object.fromEntries(
      Object.entries(state.completedAtByMatchId).filter(([matchId]) => completedIds.has(matchId))
    ),
    standings: undefined
  };
}

export async function getHololiveDoubleEliminationStandings(
  state: HololiveDoubleEliminationEngineState
): Promise<HololiveDoubleEliminationStanding[]> {
  const { manager } = createManager(state.database);
  const participants = participantEntryMap(state.database);
  const standings = await manager.get.finalStandings(state.stageId);
  return standings
    .map((standing) => ({
      entryId: participants.get(numericId(standing.id)) ?? "",
      rank: standing.rank
    }))
    .filter((standing) => standing.entryId);
}
