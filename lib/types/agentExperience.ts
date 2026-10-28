import { z } from "zod";
import { researchToolSchemas } from "./conversationResearch";

// R4 wire contracts. These schemas do not grant access or execute business commands.
const id = z.string().trim().min(1).max(160);
const text = z.string().trim().min(1).max(2000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime();
const uniqueIds = z.array(id).max(32).refine(v => new Set(v).size === v.length, "对象引用不能重复");
export const entityRefSchema = z.object({
  kind: z.enum(["PROJECT", "MISSION", "ACTION", "SOURCE", "PROPOSAL", "QUESTION", "RECEIPT", "REVIEW", "EVENT", "ANCHOR"]),
  id, projectId: id, revision: id,
}).strict();
export type ExperienceEntityRef = z.infer<typeof entityRefSchema>;

export const evidenceLinkSchema = z.object({
  source: entityRefSchema.refine(v => v.kind === "SOURCE", "需要原来源对象"),
  excerptHash: hash, quote: z.string().min(1).max(1000), observedAt: time,
  readScope: z.enum(["SUMMARY", "EXCERPT", "STRUCTURED"]),
  applicability: z.enum(["DIRECT", "CONDITIONAL", "NOT_APPLICABLE", "UNKNOWN"]),
  claim: text, relation: z.enum(["SUPPORTS", "CONTRADICTS", "UNDETERMINED"]),
  verification: z.enum(["REPORTED", "CHECKED"]), reason: text,
}).strict();
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;

export const goalGapSchema = z.object({
  schemaVersion: z.literal(1), id, projectId: id,
  goalRef: entityRefSchema.refine(v => ["PROJECT", "MISSION"].includes(v.kind), "目标来自原项目或委托"),
  goalQuote: text,
  workingObjective: text.nullable().optional(),
  intentHash: z.string().optional(),
  criteria: z.array(z.object({
    id, requirement: text, state: z.enum(["VERIFIED", "REPORTED", "UNKNOWN", "BLOCKED", "NOT_APPLICABLE"]),
    explanation: text, evidence: z.array(evidenceLinkSchema).max(8),
  }).strict()).min(1).max(20),
  blockers: z.array(text).max(8), keyUnknowns: z.array(text).max(8),
  nextInformationNeed: text.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.goalRef.projectId !== v.projectId || v.criteria.some(c => c.evidence.some(e => e.source.projectId !== v.projectId)))
    ctx.addIssue({ code: "custom", message: "目标及其证据必须属于同一项目" });
  if (new Set(v.criteria.map(c => c.id)).size !== v.criteria.length)
    ctx.addIssue({ code: "custom", message: "目标条件编号不能重复" });
  for (const c of v.criteria) {
    if (c.state === "VERIFIED" && !c.evidence.some(e => e.applicability === "DIRECT" && e.verification === "CHECKED" &&
      e.relation === "SUPPORTS" && e.claim === c.requirement))
      ctx.addIssue({ code: "custom", message: "已核验条件需要直接适用且已核对的证据" });
    if (c.state === "NOT_APPLICABLE" && !c.evidence.some(e => e.verification === "CHECKED"))
      ctx.addIssue({ code: "custom", message: "不适用条件需要可追溯的核对依据" });
  }
});
export type GoalGap = z.infer<typeof goalGapSchema>;

export const internalInvestigationToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("inspect_project"), projectId: id, afterId: id.optional() }).strict(),
  z.object({ tool: z.literal("search_memory"), projectId: id, query: z.string().trim().min(1).max(256), afterId: id.optional() }).strict(),
  z.object({ tool: z.literal("read_project_material"), projectId: id, sourceId: id, revision: id }).strict(),
  z.object({ tool: z.literal("inspect_action"), projectId: id, actionId: id, revision: id }).strict(),
]);
export const investigationToolCallSchema = z.discriminatedUnion("tool", [...internalInvestigationToolCallSchema.options, ...researchToolSchemas]);
export const investigationDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("READ_EXISTING"), informationNeed: text, expectedObservation: text, call: investigationToolCallSchema }).strict(),
  z.object({ decision: z.literal("ANSWER_NOW"), reason: text }).strict(),
  z.object({ decision: z.literal("ASK_USER"), question: text, informationNeed: text }).strict(),
  z.object({ decision: z.literal("HANDOFF_MISSION"), mission: entityRefSchema.refine(v => v.kind === "MISSION"), reason: text }).strict(),
  z.object({ decision: z.literal("STOP"), reason: z.enum(["KEEP_PLAN", "NO_ACTION", "BUDGET_EXHAUSTED", "NO_GAIN", "NO_TOOL", "SOURCE_CHANGED", "PERMISSION_REVOKED", "UNKNOWN"]), explanation: text }).strict(),
]);
export type InvestigationDecision = z.infer<typeof investigationDecisionSchema>;
export const internalInvestigationDecisionSchema = z.discriminatedUnion("decision", [
  investigationDecisionSchema.options[0].extend({ call: internalInvestigationToolCallSchema }),
  ...investigationDecisionSchema.options.slice(1) as [typeof investigationDecisionSchema.options[1], typeof investigationDecisionSchema.options[2], typeof investigationDecisionSchema.options[3], typeof investigationDecisionSchema.options[4]],
]);

export const investigationBudgetSchema = z.object({
  mode: z.enum(["QUICK", "STANDARD", "DEEP"]), deepApproved: z.boolean(),
  maxModelCalls: z.number().int().min(1).max(32), maxToolReads: z.number().int().min(0).max(32),
  maxInputTokens: z.number().int().positive().max(200000), maxOutputTokens: z.number().int().positive().max(32000),
  maxElapsedMs: z.number().int().positive().max(600000), maxProjects: z.number().int().min(1).max(3),
}).strict().refine(v => v.mode !== "DEEP" || v.deepApproved, "深度调查需要用户明确选择");
export type InvestigationBudget = z.infer<typeof investigationBudgetSchema>;
export const investigationStepSchema = z.object({
  schemaVersion: z.literal(1), id, turnId: id, seq: z.number().int().positive(),
  decision: investigationDecisionSchema, inputHash: hash, readSetHash: hash,
  status: z.enum(["STARTED", "SUCCEEDED", "FAILED", "UNKNOWN", "STOPPED"]),
  startedAt: time, finishedAt: time.nullable(), observationHash: hash.nullable(),
  sources: z.array(entityRefSchema).max(32),
  coverage: z.object({ complete: z.boolean(), description: text }).strict(),
  reservationId: id.nullable(), provider: id.nullable(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable() }).strict(),
  failureReason: text.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.status === "STARTED" ? v.finishedAt !== null : v.finishedAt === null)
    ctx.addIssue({ code: "custom", message: "调查步骤完成时间与状态不一致" });
  if (v.finishedAt && Date.parse(v.finishedAt) < Date.parse(v.startedAt))
    ctx.addIssue({ code: "custom", message: "调查完成时间早于开始时间" });
  if (v.status === "SUCCEEDED" && !v.observationHash)
    ctx.addIssue({ code: "custom", message: "成功观察需要真实结果哈希" });
  if (["FAILED", "UNKNOWN"].includes(v.status) && !v.failureReason)
    ctx.addIssue({ code: "custom", message: "未取得结果时必须保留原因" });
});
export type InvestigationStep = z.infer<typeof investigationStepSchema>;

const inlineSchema = z.object({ kind: z.enum(["text", "strong", "emphasis", "code"]), text: z.string().min(1).max(2000) }).strict();
export const richTextNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), spans: z.array(inlineSchema).min(1).max(32) }).strict(),
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), spans: z.array(inlineSchema).min(1).max(16) }).strict(),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.array(inlineSchema).min(1).max(16)).min(1).max(16) }).strict(),
  z.object({ type: z.literal("code"), language: z.string().max(32), text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal("table"), headers: z.array(text).min(1).max(6), rows: z.array(z.array(text).min(1).max(6)).min(1).max(12) }).strict()
    .refine(v => v.rows.every(row => row.length === v.headers.length), "表格列数不一致"),
]);
export type RichTextNode = z.infer<typeof richTextNodeSchema>;
export const semanticTypes = ["prose", "evidence", "goal_gap", "comparison", "investigation", "change", "question", "approval", "receipt", "timeline"] as const;
const blockBase = {
  blockKey: id, emphasis: z.enum(["primary", "supporting", "optional"]),
};
export const presentationPlanSchema = z.object({
  schemaVersion: z.literal(2), intent: z.enum(["EXPLAIN", "COMPARE", "INVESTIGATE", "DECIDE", "RECORD_RESULT", "CLARIFY"]),
  composition: z.array(z.object({ ...blockBase, semanticType: z.enum(semanticTypes),
    dataRefs: z.array(entityRefSchema).max(16), text: text.optional(), content: z.array(richTextNodeSchema).min(1).max(24).optional(),
  }).strict()).min(1).max(16),
  primaryIntent: z.enum(["EXPLAIN", "READ_MORE", "COMPARE", "CONSIDER_ACTION", "NONE"]),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.composition.map(b => b.blockKey)).size !== v.composition.length)
    ctx.addIssue({ code: "custom", message: "展示块编号不能重复" });
  for (const block of v.composition) {
    if (block.semanticType === "prose" && (block.text === undefined) === (block.content === undefined))
      ctx.addIssue({ code: "custom", message: "正文必须提供文字或受限富文本中的一种" });
    if (block.semanticType !== "prose" && block.content !== undefined)
      ctx.addIssue({ code: "custom", message: "富文本只能用于正文块" });
  }
  if (JSON.stringify(v).length > 24000) ctx.addIssue({ code: "custom", message: "展示计划超出长度限制" });
});
export type PresentationPlan = z.infer<typeof presentationPlanSchema>;

export const allowedActionSchema = z.object({
  bindingId: id, conversationId: id, actionKind: z.enum(["OPEN", "ASK", "PREVIEW", "CONFIRM", "DECLINE", "REFRESH"]),
  expectedConversationVersion: z.number().int().positive(),
  label: z.string().trim().min(1).max(80), target: entityRefSchema,
  enabled: z.boolean(), disabledReason: text.nullable(),
  frozen: z.object({ executionId: id.nullable(), candidateId: id.nullable(), proposalHash: hash, expiresAt: time }).strict().nullable(),
}).strict().superRefine((v, ctx) => {
  if (!v.enabled && !v.disabledReason) ctx.addIssue({ code: "custom", message: "不可用操作需要说明原因" });
  if (v.enabled && v.disabledReason) ctx.addIssue({ code: "custom", message: "可用操作不能带禁用原因" });
  if (["PREVIEW", "CONFIRM", "DECLINE"].includes(v.actionKind) && (!v.frozen || v.target.kind !== "PROPOSAL"))
    ctx.addIssue({ code: "custom", message: "提案操作必须绑定原冻结提案" });
  if (v.actionKind === "CONFIRM" && !v.frozen?.executionId)
    ctx.addIssue({ code: "custom", message: "确认操作必须绑定已预览的执行对象" });
});
export type AllowedAction = z.infer<typeof allowedActionSchema>;

const hydratedBase = { ...blockBase, fallbackText: z.string().trim().min(1).max(24000), refs: z.array(entityRefSchema).max(32), actionBindingIds: uniqueIds };
export const hydratedBlockSchema = z.discriminatedUnion("semanticType", [
  z.object({ ...hydratedBase, semanticType: z.literal("prose"), content: z.array(richTextNodeSchema).min(1).max(24) }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("evidence"), state: z.enum(["SUPPORTED", "UNKNOWN", "CONTESTED"]), evidence: z.array(evidenceLinkSchema).min(1).max(12) }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("goal_gap"), goalGap: goalGapSchema }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("comparison"), proposalHash: hash,
    candidates: z.array(z.object({ id, title: text, tradeoff: text, feasibility: z.enum(["READY", "BLOCKED", "UNKNOWN"]),
      expectedObservation: text.nullable(), branches: z.array(z.object({ observation: text, consequence: text }).strict()).max(4), stopCondition: text,
    }).strict()).min(1).max(8),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("investigation"), investigationId: id,
    state: z.enum(["OBSERVING", "WAITING_USER", "CONCLUDED", "FAILED", "UNKNOWN"]), steps: z.array(investigationStepSchema).max(32),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("change"), disposition: z.enum(["ATTEND", "KEEP_PLAN", "UNKNOWN"]),
    goalQuote: text, changeKind: text, relevance: text, unknowns: z.array(text).max(8),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("question"), draftKey: id, question: text,
    inputKind: z.enum(["TEXT", "SINGLE_CHOICE", "SOURCE_SELECTION"]), required: z.boolean(),
    choices: z.array(z.object({ id, label: text }).strict()).max(16),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("approval"), executionId: id, proposalHash: hash, expiresAt: time,
    state: z.enum(["PENDING", "COMMITTED", "DECLINED", "STALE", "EXPIRED", "UNKNOWN"]),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("receipt"),
    state: z.enum(["CREATED", "SUBMITTED", "RUNNING", "WAITING_USER", "SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"]),
    verification: z.enum(["REPORTED", "VERIFIED", "NOT_CHECKED"]), evidence: z.array(evidenceLinkSchema).max(8),
  }).strict(),
  z.object({ ...hydratedBase, semanticType: z.literal("timeline"),
    events: z.array(z.object({ ref: entityRefSchema.refine(v => v.kind === "EVENT"), occurredAt: time, summary: text }).strict()).min(1).max(20),
  }).strict(),
]);
export type HydratedBlock = z.infer<typeof hydratedBlockSchema>;
export const agentPresentationSchema = z.object({
  schemaVersion: z.literal(1), blocks: z.array(hydratedBlockSchema).min(1).max(16),
  allowedActions: z.array(allowedActionSchema).max(32),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.blocks.map(b => b.blockKey)).size !== v.blocks.length || new Set(v.allowedActions.map(a => a.bindingId)).size !== v.allowedActions.length)
    ctx.addIssue({ code: "custom", message: "展示或操作编号不能重复" });
  if (JSON.stringify(v).length > 96000) ctx.addIssue({ code: "custom", message: "展示内容超出长度限制" });
});
export type AgentPresentation = z.infer<typeof agentPresentationSchema>;
