// Pack sizes and requested quantities mix volume (mL/L/Gal) and weight
// (g/kg/lb) units. This normalizes both sides to one of two canonical bases
// (mL for volume, g for weight) so they can be compared/converted.

type UnitFamily = "volume" | "weight";

const UNIT_TO_ML: Record<string, number> = { ml: 1, l: 1000, gal: 3785.411784 };
const UNIT_TO_G: Record<string, number> = { g: 1, kg: 1000, lb: 453.59237 };

function normalizeUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/s$/, ""); // "gals" -> "gal"
}

export function unitFamily(unit: string): UnitFamily | null {
  const u = normalizeUnit(unit);
  if (u in UNIT_TO_ML) return "volume";
  if (u in UNIT_TO_G) return "weight";
  return null;
}

export function toCanonical(quantity: number, unit: string): number | null {
  const u = normalizeUnit(unit);
  if (u in UNIT_TO_ML) return quantity * UNIT_TO_ML[u];
  if (u in UNIT_TO_G) return quantity * UNIT_TO_G[u];
  return null;
}

// "55 Gal Drum" -> { quantity: 55, unit: "gal" }; "2.5 kg" -> { quantity: 2.5, unit: "kg" }
const PACK_SIZE_QTY_RE = /^(\d+(?:\.\d+)?)\s*(mL|L|Gal|kg|g|lb)\b/i;

export function parsePackSize(packSize: string): { quantity: number; unit: string } | null {
  const match = PACK_SIZE_QTY_RE.exec(packSize);
  if (!match) return null;
  return { quantity: Number(match[1]), unit: normalizeUnit(match[2]) };
}
