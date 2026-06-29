import type { CsvImportMapping } from "../../shared/contracts";

const FIELD_ALIASES: Record<string, string[]> = {
  songTitle: ["song", "title", "track", "曲", "name"],
  artistName: ["artist", "singer", "idol", "member", "performer", "talent"],
  tier: ["tier", "rank", "rating", "score"],
  playlistName: ["playlist", "list", "collection"],
  sourceUrl: ["url", "link", "youtube", "source"],
  notes: ["notes", "note", "comment", "remarks"]
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ");
}

export function inferHololiveCsvMapping(headers: string[]): CsvImportMapping {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header)
  }));
  const fields: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const match = normalizedHeaders.find((header) =>
      aliases.some((alias) => header.normalized.split(" ").includes(alias))
    );

    if (match) {
      fields[field] = match.original;
    }
  }

  return {
    importerId: "hololive-csv",
    moduleId: "hololive",
    fields
  };
}

export function rowValue(row: Record<string, string>, mapping: CsvImportMapping, field: string): string {
  const column = mapping.fields[field];
  return column ? row[column]?.trim() ?? "" : "";
}
