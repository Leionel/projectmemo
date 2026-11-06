import { z } from "zod";
import { jsonHash } from "@/lib/mission/contracts";
import type { IntakeCoverage } from "./coverage";

/**
 * 项目前材料草稿的最小合同。
 *
 * 这里只冻结“用户给了什么材料、Agent 读出了什么、用户接受什么、这份确认绑定到哪一版”，
 * 不建立第二套 Memory/Goal/Mission/账本：确认后仍然走原 `createOwnedProject` 语义
 * （Project + OWNER + AgentRun 回执），材料同步仍走原 Capture/Attachment 服务。
 */

export const intakeStatuses = ["DRAFT", "UNDERSTANDING", "PREVIEW_READY", "CONFIRMED", "WITHDRAWN", "EXPIRED", "FAILED"] as const;
export type IntakeStatus = (typeof intakeStatuses)[number];

/** 材料本地保留上限：超过后由原 Worker 清理，不成为长期记忆。 */
export const INTAKE_TTL_MS = 72 * 60 * 60 * 1000;
/** 单份文本材料上限（字符）。超过时要求用户拆分，不静默截断。 */
export const INTAKE_TEXT_LIMIT = 20000;
/** 一份草稿最多保留的材料数，避免把预览变成不受限的私人资料库。 */
export const INTAKE_MATERIAL_LIMIT = 6;

export const materialKinds = ["TEXT", "FILE"] as const;
export type IntakeMaterialKind = (typeof materialKinds)[number];
export const extractionStatuses = ["PENDING", "SUCCESS", "NEEDS_OCR", "FAILED"] as const;

export const createDraftSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
}).strict();

export const textMaterialSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(INTAKE_TEXT_LIMIT),
}).strict();

export const understandSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  /** 独立的云处理同意；不能被“我已经登录/建过项目”替代。 */
  processingConsent: z.literal(true),
}).strict();

export const reviseSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  /** 用户用自己的话整体纠正理解；按原 Directive Admission 处理。 */
  text: z.string().trim().min(2).max(1000),
  expectedRevision: z.number().int().min(0),
}).strict();

export const acceptedFieldsSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(500),
  goal: z.string().trim().min(2).max(300),
  scenario: z.enum(["COURSE_DESIGN", "RESEARCH", "COMPETITION", "INNOVATION", "LAB_TASK"]),
  deadline: z.iso.date().optional(),
}).strict();

export const confirmSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  /** 用户看到的草稿版本；旧预览不能确认。 */
  expectedRevision: z.number().int().min(0),
  /** 用户看到的预览 hash；服务端重算后必须一致。 */
  previewHash: z.string().trim().min(1).max(128),
  /** 用户最终接受的业务字段，不由模型建议直接持久化。 */
  accepted: acceptedFieldsSchema,
}).strict();

export type IntakeAcceptedFields = z.infer<typeof acceptedFieldsSchema>;

/** 模型理解的结构。quotes 必须逐字出现在引用的材料原文里，服务端重新核对。 */
export const understandingSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  quotes: z.array(z.object({
    materialId: z.string().min(1).max(64),
    quote: z.string().trim().min(1).max(400),
    /** 这条原文对项目意味着什么；与原文分开保存。 */
    meaning: z.string().trim().max(400),
  }).strict()).max(12),
  suggested: z.object({
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(500),
    goal: z.string().trim().min(2).max(300),
    scenario: z.enum(["COURSE_DESIGN", "RESEARCH", "COMPETITION", "INNOVATION", "LAB_TASK"]),
  }).strict(),
  constraints: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    basis: z.enum(["STATED", "INFERRED"]),
    materialId: z.string().max(64).optional(),
  }).strict()).max(8),
  unknowns: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    whyItMatters: z.string().trim().max(300),
  }).strict()).max(8),
  successCriteria: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    basis: z.enum(["STATED", "INFERRED"]),
  }).strict()).max(6),
  nextQuestion: z.object({
    text: z.string().trim().min(1).max(400),
    why: z.string().trim().max(300),
  }).strict(),
}).strict();
export type IntakeUnderstanding = z.infer<typeof understandingSchema>;

/**
 * 预览是服务端重算的只读投影。`sources` 区分 STATED/INFERRED/UNKNOWN，
 * `suggested` 永远不是已生效目标——只有用户确认的 accepted 才会写进 Project。
 */
export type IntakePreview = {
  schemaVersion: 1;
  draftId: string;
  revision: number;
  status: IntakeStatus;
  materialsHash: string;
  understandingState: "NONE" | "READY" | "FAILED" | "UNKNOWN" | "MATERIAL_ONLY";
  /** droppedQuotes：模型给出但没对上原文、已从这一版移除的摘录数。 */
  model: { used: boolean; provider: string | null; reason: string | null; usageUnknown: boolean; droppedQuotes: number };
  summary: string | null;
  statements: Array<{ materialId: string; materialLabel: string; quote: string; meaning: string }>;
  suggested: IntakeAcceptedFields | null;
  constraints: Array<{ text: string; basis: "STATED" | "INFERRED"; materialId: string | null }>;
  unknowns: Array<{ text: string; whyItMatters: string }>;
  successCriteria: Array<{ text: string; basis: "STATED" | "INFERRED" }>;
  nextQuestion: { text: string; why: string } | null;
  /** 用户整体纠正后真正生效的范围内容；解释候选不生效。 */
  correction: {
    appliedObjective: string | null;
    constraints: string[];
    until: string | null;
    candidates: Array<{ quote: string; interpretation: string; reason: string }>;
    clarify: { question: string; reason: string } | null;
    admittedAt: string | null;
  };
  accepted: IntakeAcceptedFields | null;
  /** 实际送入模型的正文字符范围；上传总量不等于已读量。 */
  coverage: IntakeCoverage;
  materials: Array<{
    id: string; label: string; kind: IntakeMaterialKind; type: string | null; fileName: string | null; mimeType: string | null;
    size: number; sha256: string | null; extractionStatus: string; extractionError: string | null;
    revision: number; contentHash: string;
    sync: { state: string; captureId?: string; attachmentId?: string; error?: string };
  }>;
  expiresAt: string;
  /** 预览自身的绑定 hash；确认时必须原样带回。 */
  previewHash: string;
};

/** 材料身份 hash：任何材料新增/修订都会改变它，使旧预览与旧确认一起失效。 */
export function materialsHashOf(materials: Array<{ id: string; revision: number; contentHash: string }>) {
  return jsonHash(materials.map(m => [m.id, m.revision, m.contentHash]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

/** 预览 hash 绑定草稿版本、材料、理解、用户纠正与用户接受的业务字段。 */
export function previewHashOf(input: {
  draftId: string; revision: number; materialsHash: string;
  understandingHash: string | null; userRevisionHash: string | null; acceptedHash: string | null;
}) {
  return jsonHash({ schema: "intake-preview-v1", ...input });
}

export function acceptedHashOf(accepted: IntakeAcceptedFields) {
  return jsonHash(accepted);
}

/** 同一份指引跨过期限也产生新有效视图，不依赖用户再发一条事件。 */
export function intakeDirectiveEpoch(value: unknown, now = Date.now()) {
  const review = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const effective = Array.isArray(review.admittedDirectives) ? review.admittedDirectives.map(value => {
    const directive = value as Record<string, unknown>;
    return !directive.validUntil || Date.parse(String(directive.validUntil)) > now;
  }) : typeof review.until !== "string" || Date.parse(review.until) > now;
  return jsonHash({ review, effective });
}

/** 材料标签只用于用户区分来源，不使用原始文件名全文。 */
export function materialLabel(material: { kind: string; fileName: string | null; ordinal: number }) {
  if (material.kind === "FILE" && material.fileName) {
    const name = material.fileName.replace(/[\\/\r\n\t]/g, "_").slice(0, 60);
    return `文件 ${material.ordinal}：${name}`;
  }
  return `文本 ${material.ordinal}`;
}
