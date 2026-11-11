import type { HololiveBracketYearPopularity } from "./contracts";
import { isCalendarDate } from "./musicReleaseDates";

type SongStats = { releaseDate?: string | null; publishedAt?: string | null; viewCount?: number | null };

export function bracketReleaseYear(song: SongStats): number | null {
  const date = [song.releaseDate, song.publishedAt?.slice(0, 10)].find(value => value && isCalendarDate(value));
  return date ? Number(date.slice(0, 4)) : null;
}

export function indexBracketYearPopularity<T extends SongStats>(catalog: readonly T[], keyOf: (song: T) => string) {
  const recordings = new Map<string, { year: number; views: number }>();
  for (const song of catalog) {
    const year = bracketReleaseYear(song);
    const views = song.viewCount;
    if (year === null || views == null || !Number.isFinite(views) || views < 0) continue;
    const key = keyOf(song);
    if (!recordings.has(key)) recordings.set(key, { year, views });
  }

  const years = new Map<number, Array<{ key: string; views: number }>>();
  for (const [key, { year, views }] of recordings) {
    const group = years.get(year) ?? [];
    group.push({ key, views });
    years.set(year, group);
  }
  const index = new Map<string, { rank: number; total: number }>();
  for (const group of years.values()) {
    group.sort((a, b) => b.views - a.views);
    let rank = 0;
    group.forEach(({ key, views }, position) => {
      if (position > 0 && views !== group[position - 1].views) rank = position;
      index.set(key, { rank, total: group.length });
    });
  }
  return index;
}

export function matchesBracketYearPopularity(
  band: HololiveBracketYearPopularity,
  position: { rank: number; total: number } | undefined
): boolean {
  if (!position) return false;
  const { rank, total } = position;
  switch (band) {
    case "top10": return rank < Math.ceil(total / 10);
    case "top25": return rank < Math.ceil(total / 4);
    case "outsideTop25": return rank >= Math.ceil(total / 4);
    case "middle50": return rank >= Math.ceil(total / 4) && rank < Math.ceil(total * 3 / 4);
    case "bottom50": return rank >= Math.ceil(total / 2);
  }
}

export function evenBracketSlotCounts(size: number, groups: number): number[] {
  return Array.from({ length: groups }, (_, index) => Math.floor(size / groups) + Number(index < size % groups));
}

type SlotGroup<T> = { requested: number; songs: readonly T[] };
type Edge = { to: number; reverse: number; capacity: number };

/** Finds a full draw when overlapping pools can share unique recordings within the talent cap. */
export function allocateBracketSlots<T>(
  groups: readonly SlotGroup<T>[],
  keyOf: (song: T) => string,
  talentOf: (song: T) => string,
  talentCap: number
): T[][] {
  const graph: Edge[][] = [[], []];
  const source = 0, sink = 1;
  const newNode = () => graph.push([]) - 1;
  function connect(from: number, to: number, capacity: number) {
    const edge = { to, reverse: graph[to].length, capacity };
    graph[to].push({ to: from, reverse: graph[from].length, capacity: 0 });
    graph[from].push(edge);
    return edge;
  }
  const songNodes = new Map<string, number>();
  const talentNodes = new Map<string, number>();
  const groupNodes = groups.map(group => {
    const node = newNode();
    connect(source, node, group.requested);
    return node;
  });
  const choices = groups.map((group, index) => {
    const edges = new Map<string, { song: T; edge: Edge }>();
    for (const song of group.songs) {
      const key = keyOf(song);
      if (edges.has(key)) continue;
      let songNode = songNodes.get(key);
      if (songNode === undefined) {
        songNode = newNode();
        songNodes.set(key, songNode);
        const talent = talentOf(song);
        let talentNode = talentNodes.get(talent);
        if (talentNode === undefined) {
          talentNode = newNode();
          talentNodes.set(talent, talentNode);
          connect(talentNode, sink, talentCap);
        }
        connect(songNode, talentNode, 1);
      }
      edges.set(key, { song, edge: connect(groupNodes[index], songNode, 1) });
    }
    return edges;
  });

  const parents = new Int32Array(graph.length);
  const incoming = new Int32Array(graph.length);
  const queue = new Int32Array(graph.length);
  const requested = groups.reduce((sum, group) => sum + group.requested, 0);
  for (let filled = 0; filled < requested; filled++) {
    parents.fill(-1);
    parents[source] = source;
    queue[0] = source;
    let tail = 1;
    for (let head = 0; head < tail && parents[sink] === -1; head++) {
      const node = queue[head];
      for (let index = 0; index < graph[node].length; index++) {
        const edge = graph[node][index];
        if (edge.capacity === 0 || parents[edge.to] !== -1) continue;
        parents[edge.to] = node;
        incoming[edge.to] = index;
        if (edge.to === sink) break;
        queue[tail++] = edge.to;
      }
    }
    if (parents[sink] === -1) break;
    // Reverse edges can move a shared recording to a different pool to make room.
    for (let node = sink; node !== source; node = parents[node]) {
      const edge = graph[parents[node]][incoming[node]];
      edge.capacity--;
      graph[node][edge.reverse].capacity++;
    }
  }
  return choices.map(edges => [...edges.values()].filter(({ edge }) => edge.capacity === 0).map(({ song }) => song));
}
