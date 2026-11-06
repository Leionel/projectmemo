import { ZodError } from "zod";
import { intactPrefix } from "./textRange";
import { understandingSchema, type IntakeUnderstanding } from "./contracts";

export class IntakeModelOutputError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type Output = { data: string; status?: string; fallbackReason?: string | null };
type Dict = Record<string, unknown>;

const dict = (value: unknown): Dict => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max: number) => typeof value === "string" ? intactPrefix(value.trim(), max) : "";
const basis = (value: unknown) => value === "STATED" ? "STATED" as const : "INFERRED" as const;
const SCENARIOS = ["COURSE_DESIGN", "RESEARCH", "COMPETITION", "INNOVATION", "LAB_TASK"];

/** 模型有时把对象写成一句话，统一成 { 字段: 文字 }。 */
const entry = (value: unknown, key: string): Dict => typeof value === "string" ? { [key]: value } : dict(value);

function withoutFence(raw: string) {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * 把模型输出收敛到 understandingSchema。
 *
 * 超长、多余字段或个别缺项不值得废掉整次理解：裁剪只丢内容，不改变含义；
 * 无法判断依据的约束一律记为 INFERRED。引文是否逐字来自原文仍由调用方核对，这里不放松。
 */
export function normalizeUnderstanding(value: unknown): unknown {
  const raw = dict(value), suggested = dict(raw.suggested);
  const summary = text(raw.summary, 1200);
  const unknowns = list(raw.unknowns).map(item => entry(item, "text"))
    .map(item => ({ text: text(item.text, 300), whyItMatters: text(item.whyItMatters, 300) })).filter(item => item.text).slice(0, 8);
  const description = text(suggested.description, 500);
  const next = entry(raw.nextQuestion, "text");
  return {
    summary,
    quotes: list(raw.quotes).map(dict).map(item => ({ materialId: text(item.materialId, 64), quote: text(item.quote, 400), meaning: text(item.meaning, 400) }))
      .filter(item => item.materialId && item.quote).slice(0, 12),
    suggested: {
      title: text(suggested.title, 80),
      description: description.length >= 10 ? description : intactPrefix(summary, 500),
      goal: text(suggested.goal, 300),
      scenario: SCENARIOS.includes(String(suggested.scenario)) ? suggested.scenario : "COURSE_DESIGN",
    },
    constraints: list(raw.constraints).map(item => entry(item, "text")).map(item => {
      const materialId = text(item.materialId, 64);
      return { text: text(item.text, 300), basis: basis(item.basis), ...(materialId ? { materialId } : {}) };
    }).filter(item => item.text).slice(0, 8),
    unknowns,
    successCriteria: list(raw.successCriteria).map(item => entry(item, "text"))
      .map(item => ({ text: text(item.text, 300), basis: basis(item.basis) })).filter(item => item.text).slice(0, 6),
    nextQuestion: {
      text: text(next.text, 400) || unknowns[0]?.text || "这份理解和你的项目一致吗？",
      why: text(next.why, 300),
    },
  };
}

export function parseUnderstandingOutput(result: Output): IntakeUnderstanding {
  if (result.status === "FAILED") {
    throw new IntakeModelOutputError(result.fallbackReason ?? "MODEL_OUTPUT_INVALID", result.fallbackReason === "MODEL_OUTPUT_TRUNCATED"
      ? "模型输出超过上限被截断，这一版没有保存" : "模型这次没有返回可用内容，可以再读懂一次");
  }
  try {
    return understandingSchema.parse(normalizeUnderstanding(JSON.parse(withoutFence(result.data))));
  } catch (error) {
    if (!(error instanceof ZodError || error instanceof SyntaxError)) throw error;
    console.warn("Intake model output rejected", error instanceof ZodError ? error.issues.map(issue => `${issue.path.join(".")}:${issue.code}`) : "INVALID_JSON");
    throw new IntakeModelOutputError("MODEL_OUTPUT_INVALID", "模型这次返回的内容无法使用，可以再读懂一次");
  }
}
