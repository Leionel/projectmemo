import { z } from "zod";
import { artifactTypes, cardRelationTypes, knowledgeTypes } from "@/lib/types";

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const deadlineSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value), "截止日期必须是有效的 YYYY-MM-DD 日期")
  .optional()
  .nullable()
  .transform((value) => value || null);

const projectFields = {
  title: z.string().trim().min(2, "项目名称至少 2 个字").max(80),
  description: z.string().trim().min(10, "项目描述至少 10 个字").max(500),
  goal: z.string().trim().min(2, "请填写项目目标").max(300),
  scenario: z.enum(["COURSE_DESIGN", "RESEARCH", "COMPETITION", "INNOVATION", "LAB_TASK"]),
  deadline: deadlineSchema,
};

export const projectCreateSchema = z.object(projectFields);

export const projectUpdateSchema = z
  .object(projectFields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, "请至少提交一个需要更新的字段");

export const captureCreateSchema = z.object({
  rawText: z.string().trim().min(5, "碎片内容至少 5 个字").max(5000),
  sourceType: z.string().trim().max(40).optional().nullable(),
});

export const artifactContentSchema = z
  .string()
  .trim()
  .min(1, "成果内容不能为空")
  .max(50000, "成果内容不能超过 50000 个字符");

export const artifactCreateSchema = z.object({
  artifactType: z.enum(artifactTypes),
  content: artifactContentSchema.optional(),
});

export const knowledgeCardDraftSchema = z.object({
  type: z.enum(knowledgeTypes),
  title: z.string().trim().min(2).max(60),
  summary: z.string().trim().min(5).max(300),
  keywords: z.array(z.string().trim().min(1).max(30)).min(1).max(8),
  relatedTasks: z.array(z.string().trim().min(1).max(100)).max(6),
  nextActions: z.array(z.string().trim().min(1).max(120)).min(1).max(6),
  importance: z.number().int().min(1).max(5),
});

export const knowledgeCardUpdateSchema = knowledgeCardDraftSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "请至少提交一个需要更新的字段");

export const interventionUpdateSchema = z
  .object({
    status: z.enum(["ACCEPTED", "SNOOZED", "DISMISSED", "RESOLVED"]),
    snoozedUntil: z.string().datetime().optional().nullable(),
    dismissReason: z.string().trim().max(200).optional().nullable(),
    actionIndex: z.number().int().min(0).max(10).optional(),
  })
  .refine((input) => input.status !== "SNOOZED" || Boolean(input.snoozedUntil), {
    message: "稍后提醒需要提供时间",
    path: ["snoozedUntil"],
  });

export const actionCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional().nullable(),
  priority: z.number().int().min(1).max(5).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  sourceInterventionId: z.string().trim().min(1).optional().nullable(),
  sourceCardId: z.string().trim().min(1).optional().nullable(),
  isSimulated: z.boolean().optional(),
});

export const actionUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    priority: z.number().int().min(1).max(5).optional(),
    status: z.enum(["TODO", "DOING", "DONE", "CANCELLED"]).optional(),
    dueAt: z.string().datetime().optional().nullable(),
    resultText: z.string().trim().min(5).max(2000).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "请至少提交一个需要更新的字段");

export const evaluateContextSchema = z.object({
  scenario: z.enum(["deadline_48h", "stale_72h", "risk_cluster"]).optional().nullable(),
  clearSimulation: z.boolean().optional(),
});

export const agentChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const agentToolConfirmSchema = z.object({
  tool: z.enum(["create_action", "generate_artifact"]),
  confirmed: z.boolean(),
  payload: z.record(z.string(), z.unknown()).default({}),
  sourceRunId: z.string().trim().min(1).optional(),
});

export const cardSearchInputSchema = z.object({
  query: z.string().trim().min(1, "请输入要检索的记忆问题").max(500),
  topK: z.number().int().min(1).max(50).optional().default(8),
  type: z.enum([...knowledgeTypes, "all"] as [string, ...string[]]).optional().default("all"),
}).strict();

export const milestoneCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  targetDate: z.string().datetime().optional().nullable(),
  deliverables: z.array(z.object({
    title: z.string().trim().min(2).max(160),
    expectedEvidence: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  }).strict()).max(20).optional().default([]),
}).strict();

export const deliverableEvidenceInputSchema = z.object({
  evidenceType: z.string().trim().min(1).max(60),
  cardId: z.string().trim().min(1).nullable().optional(),
  attachmentId: z.string().trim().min(1).nullable().optional(),
  confirmed: z.boolean(),
}).strict().refine((input) => Boolean(input.cardId) !== Boolean(input.attachmentId), {
  message: "一次只能关联一张卡片或一个附件",
});

export const temporalRelationProposalSchema = z.object({
  relatedCardId: z.string().trim().min(1),
  relationType: z.enum(cardRelationTypes),
  reason: z.string().trim().min(2, "请说明关系理由").max(500),
  confidence: z.number().min(0).max(1).optional().nullable(),
  validFrom: z.string().datetime().optional().nullable(),
  validTo: z.string().datetime().optional().nullable(),
}).strict().refine((input) => {
  if (!input.validFrom || !input.validTo) return true;
  return new Date(input.validFrom).getTime() < new Date(input.validTo).getTime();
}, {
  message: "有效期结束时间必须晚于开始时间",
  path: ["validTo"],
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type KnowledgeCardUpdateInput = z.infer<typeof knowledgeCardUpdateSchema>;
export type InterventionUpdateInput = z.infer<typeof interventionUpdateSchema>;
export type ActionCreateInput = z.infer<typeof actionCreateSchema>;
export type ActionUpdateInput = z.infer<typeof actionUpdateSchema>;
export type EvaluateContextInput = z.infer<typeof evaluateContextSchema>;
export type AgentChatInput = z.infer<typeof agentChatSchema>;
export type AgentToolConfirmInput = z.infer<typeof agentToolConfirmSchema>;
export type CardSearchInput = z.infer<typeof cardSearchInputSchema>;
export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;
export type DeliverableEvidenceInput = z.infer<typeof deliverableEvidenceInputSchema>;
export const lifecycleActionSchema = z.object({
  action: z.enum(["CONFIRM", "ARCHIVE", "RESTORE"]),
  reason: z.string().trim().max(200).optional(),
}).strict();

export type TemporalRelationProposalInput = z.infer<typeof temporalRelationProposalSchema>;
export const projectStateCheckInSchema = z.object({
  displayedSnapshotId: z.string().trim().min(1),
  consumerKey: z.string().trim().min(1).max(100),
}).strict();

export type LifecycleActionInput = z.infer<typeof lifecycleActionSchema>;
export const actionFeasibilitySchema = z.object({
  actionId: z.string().trim().min(1),
  addRequirements: z.array(z.object({
    targetKind: z.enum(["action", "card", "deliverable"]),
    targetId: z.string().trim().min(1),
    hard: z.boolean().optional().default(true),
    note: z.string().trim().max(200).optional(),
  })).max(20).optional(),
  removeRequirementIds: z.array(z.string().trim().min(1)).max(50).optional(),
  estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(),
}).strict();

export type ProjectStateCheckInInput = z.infer<typeof projectStateCheckInSchema>;
export type ActionFeasibilityInput = z.infer<typeof actionFeasibilitySchema>;
