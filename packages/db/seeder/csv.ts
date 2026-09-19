import { readFileSync } from "fs";

/**
 * Parseur CSV minimal. Les jeux de données de ce projet ne contiennent
 * aucun champ contenant une virgule ou des guillemets (vérifié) : un split
 * simple est donc fiable et évite une dépendance supplémentaire.
 */
export function parseCsv(path: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}
