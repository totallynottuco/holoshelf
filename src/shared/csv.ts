import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvText(text: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim()
  });

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse failed at row ${first.row ?? "unknown"}: ${first.message}`);
  }

  const headers = parsed.meta.fields?.filter(Boolean) ?? [];
  const rows = parsed.data
    .map((row) =>
      Object.fromEntries(headers.map((header) => [header, String(row[header] ?? "").trim()]))
    )
    .filter((row) => Object.values(row).some((value) => value.length > 0));
  return { headers, rows };
}
