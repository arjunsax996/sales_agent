// CLI helpers shared by agent/cli.ts and quote-agent/cli.ts.

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { stringifyCsv } from "./csv";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function writeCsv<T extends object>(path: string, rows: readonly T[]) {
  mkdirSync(dirname(path), { recursive: true });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  writeFileSync(path, stringifyCsv(headers, rows));
}
