// CSV/TSV parsing and writing shared across agent/load-data.ts, shared/cli.ts,
// and server/index.ts. No embedded delimiters/newlines inside a field in any
// of our data (products.csv, notes.csv, or UI uploads of the same shape), so
// a plain split is enough — no need for a full CSV parsing library.

export interface ParsedCsv {
  headers: string[];
  records: Record<string, string>[];
}

// Real data/products.csv and data/notes.csv are tab-delimited, but a file
// uploaded through the UI could be a real Excel/Sheets export instead
// (comma-delimited) — detect from the header line rather than assuming.
function detectDelimiter(headerLine: string): string {
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

export function parseCsv(raw: string): ParsedCsv {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], records: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter);
  const records = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => (row[header] = cells[i] ?? ""));
    return row;
  });

  return { headers, records };
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Generic over T rather than typed as Record<string, unknown> so callers can
// pass a plain interface (e.g. ProductRecord) without it needing an index
// signature — the dynamic header-keyed lookup is inherently untyped either way.
export function stringifyCsv<T extends object>(headers: string[], records: readonly T[]): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...records.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(",")),
  ];
  return lines.join("\n");
}
