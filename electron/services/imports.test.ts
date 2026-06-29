import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CsvImportMapping } from "../../src/shared/contracts";
import { DatabaseService } from "./database";
import { applyCsvImport, createCsvPreview } from "./imports";

async function createTempDatabase(): Promise<DatabaseService> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-import-"));
  const database = new DatabaseService(path.join(dir, "test.sqlite"));
  await database.init();
  return database;
}

describe("CSV import services", () => {
  it("keeps all parsed rows for import while the UI can still render a slice", () => {
    const rows = Array.from({ length: 250 }, (_value, index) => `Song ${index + 1},Artist ${index + 1}`);
    const preview = createCsvPreview("songs.csv", ["Song,Artist", ...rows].join("\n"));

    expect(preview.rows).toHaveLength(250);
  });

  it("imports beyond the first 200 preview rows", async () => {
    const database = await createTempDatabase();
    const rows = Array.from({ length: 250 }, (_value, index) => `Song ${index + 1},Artist ${index + 1}`);
    const preview = createCsvPreview("songs.csv", ["Song,Artist", ...rows].join("\n"));
    const mapping: CsvImportMapping = {
      importerId: "hololive-csv",
      moduleId: "hololive",
      fields: {
        songTitle: "Song",
        artistName: "Artist"
      }
    };

    const result = applyCsvImport(database, { preview, mapping });

    expect(result.inserted).toBe(250);
    expect(result.skipped).toBe(0);
    expect(database.listCatalog({ moduleId: "hololive", limit: 500 })).toHaveLength(250);
  });
});
