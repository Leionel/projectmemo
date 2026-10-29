import { createHash } from "node:crypto";
export type JsonFailure = { issue: "UNESCAPED_CONTROL" | "UNTERMINATED_STRING" | "INVALID_ESCAPE" | "TRAILING_CONTENT" | "INCOMPLETE_JSON" | "INVALID_SYNTAX"; offset: number | null; responseHash: string };
/** Escape only literal control characters already inside a quoted string. Never infer JSON structure. */
export function parseDecisionJson(text: string): { value: unknown; escapedControls: number; responseHash: string } {
  const responseHash = createHash("sha256").update(text).digest("hex");
  try { return { value: JSON.parse(text), escapedControls: 0, responseHash }; } catch { /* Inspect encoding only. */ }
  let quoted = false, escaped = false, controls = 0, normalized = "";
  for (const character of text) {
    if (quoted && !escaped && character.charCodeAt(0) < 32) {
      normalized += "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"); controls++; continue;
    }
    normalized += character;
    if (escaped) { escaped = false; continue; }
    if (quoted && character === "\\") { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
  }
  if (controls) {
    try { return { value: JSON.parse(normalized), escapedControls: controls, responseHash }; } catch { /* Still malformed: reject. */ }
  }
  let errorMessage = "";
  try { JSON.parse(text); } catch (error) { errorMessage = error instanceof Error ? error.message : ""; }
  const offset = errorMessage.match(/position (\d+)/i)?.[1];
  const issue: JsonFailure["issue"] = controls ? "UNESCAPED_CONTROL" : quoted ? "UNTERMINATED_STRING"
    : /escap|unicode/i.test(errorMessage) ? "INVALID_ESCAPE" : /after JSON/i.test(errorMessage) ? "TRAILING_CONTENT"
      : /end of JSON|end of input/i.test(errorMessage) ? "INCOMPLETE_JSON" : "INVALID_SYNTAX";
  throw new DecisionJsonError({ issue, offset: offset === undefined ? null : Number(offset), responseHash });
}
export class DecisionJsonError extends Error {
  constructor(public diagnostic: JsonFailure) { super("INVALID_DECISION_JSON"); }
}
