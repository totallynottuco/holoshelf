import type { CsvPreview } from "../../src/shared/contracts";
import type { ImportApplyCsvRequest, ImportApplyCsvResponse } from "../../src/shared/ipc";
import { parseCsvText } from "../../src/shared/csv";
import { inferHololiveCsvMapping, rowValue } from "../../src/modules/hololive/importer";
import type { DatabaseService } from "./database";

export function createCsvPreview(fileName: string, text: string): CsvPreview {
  const parsed = parseCsvText(text);
  return {
    fileName,
    headers: parsed.headers,
    rows: parsed.rows,
    inferredMapping: inferHololiveCsvMapping(parsed.headers)
  };
}

export function applyCsvImport(database: DatabaseService, request: ImportApplyCsvRequest): ImportApplyCsvResponse {
  if (request.mapping.moduleId !== "hololive" || request.mapping.importerId !== "hololive-csv") {
    throw new Error("Only the Hololive CSV importer is available in this milestone");
  }

  let inserted = 0;
  let skipped = 0;

  database.transaction(() => {
    database.saveCsvMapping(request.mapping.moduleId, request.mapping.importerId, request.mapping.fields);

    for (const row of request.preview.rows) {
      const title = rowValue(row, request.mapping, "songTitle");
      if (!title) {
        skipped += 1;
        continue;
      }

      const result = database.insertHololiveSong({
        title,
        artistName: rowValue(row, request.mapping, "artistName"),
        tier: rowValue(row, request.mapping, "tier"),
        playlistName: rowValue(row, request.mapping, "playlistName"),
        sourceUrl: rowValue(row, request.mapping, "sourceUrl"),
        notes: rowValue(row, request.mapping, "notes")
      });

      if (result === "inserted") {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }
  });

  return { inserted, skipped };
}
