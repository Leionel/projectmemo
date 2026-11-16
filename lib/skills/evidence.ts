import type { Source } from "@/lib/mission/contracts";

/**
 * Deterministic evidence bookkeeping for the four Skill methods.
 * It records what the current material can and cannot support; it never turns
 * an unknown into a fact and never treats source existence as support for a claim.
 */

export type EvidenceAnomaly = {
  kind: "UNIT_MISSING";
  sourceId: string;
  sourceHash: string;
  column: string;
  sampleValues: string[];
};

export type EvidencePack = {
  schemaVersion: 1;
  sources: Source[];
  contextVersion: number;
  coverage: { sources: number; numericFields: number; unitlessNumericFields: number };
  unknowns: EvidenceAnomaly[];
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

const UNIT_IN_HEADER = /[（(]\s*(?:单位|%|‰|[a-zA-Z]{1,6}|分|秒|毫秒|小时|分钟|天|个|次|元|人|页)\s*[)）]|单位[:：]?|%|‰|\b(?:ms|s|kb|mb|gb|tb|kg|km|cm|mm|ml|l|hz|dpi|px|fps)\b/i;
const NUMERIC_CELL = /^[-+]?\d+(?:\.\d+)?$/;

function columnUnitAnomalies(source: Source): EvidenceAnomaly[] {
  const lines = source.text.split(/\r?\n/).slice(0, 80);
  const rows = lines.map(line => line.split(/[,\t]/).map(cell => cell.trim())).filter(cells => cells.length >= 2);
  if (rows.length < 2) return [];
  const width = Math.min(...rows.map(row => row.length));
  const header = rows[0];
  if (!header || header.every(cell => NUMERIC_CELL.test(cell.replace(/%$/, "")))) return [];
  const columns = new Map<number, string[]>();
  for (let index = 0; index < width; index++) {
    if (NUMERIC_CELL.test(header[index]?.replace(/%$/, "") ?? "")) continue;
    const values = rows.slice(1).map(row => row[index]).filter(value => !!value && NUMERIC_CELL.test(value.replace(/%$/, "")));
    if (values.length >= 2 && values.some(value => !/%$/.test(value))) columns.set(index, values.slice(0, 3));
  }
  const anomalies: EvidenceAnomaly[] = [];
  for (const [index, values] of columns) {
    const name = header[index] || "第" + (index + 1) + "列";
    if (!UNIT_IN_HEADER.test(name)) {
      anomalies.push({ kind: "UNIT_MISSING", sourceId: source.id, sourceHash: source.hash, column: name, sampleValues: values });
    }
  }
  return anomalies;
}

export function analyzeEvidence(sources: Source[], contextVersion: number): EvidencePack {
  const anomalies = sources.flatMap(columnUnitAnomalies);
  let numericFields = 0, unitlessNumericFields = 0;
  for (const source of sources) {
    for (const line of source.text.split(/\r?\n/).slice(0, 200)) {
      for (const cell of line.split(/[,\t]/).map(value => value.trim())) {
        if (!NUMERIC_CELL.test(cell.replace(/%$/, ""))) continue;
        numericFields++;
        if (!/%$/.test(cell)) unitlessNumericFields++;
      }
    }
  }
  const readable = sources.filter(source => source.text.trim().length > 0).length;
  return {
    schemaVersion: 1, sources, contextVersion,
    coverage: { sources: sources.length, numericFields, unitlessNumericFields },
    unknowns: anomalies,
    checks: [
      { name: "SOURCES_READABLE", passed: readable > 0, detail: `${readable}/${sources.length} 份材料可读` },
      { name: "NUMERIC_UNITS_EXPLICIT", passed: anomalies.length === 0, detail: anomalies.length ? `有 ${anomalies.length} 列数值没有单位，按未知保留` : "数值列均有单位或为纯文本" },
    ],
  };
}

/** Only source excerpts that were actually read can enter the pack; model text is never a source. */
export function mergeEvidencePack(previous: EvidencePack | undefined, sources: Source[], contextVersion: number): EvidencePack {
  const byKey = new Map<string, Source>();
  for (const source of previous?.sources ?? []) byKey.set(source.id + "@" + source.hash, source);
  for (const source of sources) {
    // A re-read of the same source replaces the older revision; stale hashes must not be quoted.
    for (const key of byKey.keys()) if (key.slice(0, key.indexOf("@")) === source.id) byKey.delete(key);
    byKey.set(source.id + "@" + source.hash, { ...source, text: source.text.slice(0, 4000) });
  }
  return analyzeEvidence([...byKey.values()].slice(-24), contextVersion);
}
