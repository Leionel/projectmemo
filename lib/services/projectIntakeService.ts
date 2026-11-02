import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { record, type Tx } from "@/lib/conversation/repository";
import type { ConversationActor } from "@/lib/types/conversation";
import type { AgentExecutionResult } from "@/lib/types";
import { admitDirective } from "@/lib/continuity/admission";
import { reserveIntakeCloudCall, settleIntakeCloudCall } from "@/lib/auth/cloudQuota";
import { cloudCapability } from "@/lib/auth/cloudCapability";
import { buildPromptMessages } from "@/lib/agent/promptSpec";
import { chatWithLLMWithMeta } from "@/lib/agent/llmAgent";
import {
  INTAKE_MATERIAL_LIMIT, INTAKE_TTL_MS, INTAKE_TEXT_LIMIT,
  acceptedHashOf, createDraftSchema, materialLabel, materialsHashOf, previewHashOf, textMaterialSchema,
  understandingSchema, type IntakeAcceptedFields, type IntakePreview, type IntakeUnderstanding,
  understandSchema, reviseSchema, confirmSchema,
} from "@/lib/intake/contracts";
import { intakeUnderstandingV1 } from "@/lib/intake/prompt";
import {
  computeFileSha256, deleteAttachmentFile, listProjectAttachmentFiles, readAttachmentFile, saveFileToStorage,
} from "@/lib/storage/attachmentStorage";
import { extractImageText, extractPdfText, inferAndValidateFileType, processAttachmentUpload } from "./attachmentService";
import { processCaptureWithRequest } from "./captureService";
import { createOwnedProjectInTx } from "@/lib/repositories/projects";

/**
 * 项目前材料 → 可纠正理解 → 确认建项 → 材料同步。
 *
 * 这一层只做四件事：
 * 1. 保存受控临时材料（owner/hash/修订/期限/处理状态/清理责任）；
 * 2. 让模型把材料读成「原文 / 推断 / 未知」分开的预览，并逐字核对引用；
 * 3. 沿原 Directive Admission 处理用户的整体纠正（literal 才生效，其余保留候选）；
 * 4. 用原 Project + OWNER + AgentRun 回执事务建项，再把材料交给原 Capture/Attachment 服务。
 *
 * 它不建立第二套目标/记忆/任务队列；预览不是授权，模型建议也不会直接变成项目目标。
 */

const INTAKE_SCOPE_TIMEZONE = "Asia/Shanghai";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function intakeScope(draftId: string) { return { projectId: `intake:${draftId}` }; }

async function assertSession(actor: ConversationActor, tx: Tx = db) {
  if (!await tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } } }))
    throw new AppError("UNAUTHORIZED", "登录状态已变化，请重新登录", 401);
}

async function loadDraft(actor: ConversationActor, draftId: string, tx: Tx = db) {
  const draft = await tx.projectIntakeDraft.findFirst({ where: { id: draftId, ownerUserId: actor.userId } });
  if (!draft) throw new AppError("INTAKE_NOT_FOUND", "材料预览不存在或不可访问", 404);
  return draft;
}

function assertOpen(draft: { status: string; expiresAt: Date; withdrawnAt: Date | null }) {
  if (draft.status === "WITHDRAWN" || draft.withdrawnAt) throw new AppError("INTAKE_WITHDRAWN", "这份材料预览已撤回", 410);
  if (draft.status === "EXPIRED" || +draft.expiresAt <= Date.now()) throw new AppError("INTAKE_EXPIRED", "材料预览已到期，原件已进入清理", 410);
  if (draft.status === "CONFIRMED") throw new AppError("INTAKE_CONFIRMED", "这份预览已建项，请到项目继续", 409);
}

export async function createIntakeDraft(actor: ConversationActor, raw: unknown) {
  const input = createDraftSchema.parse(raw);
  const hash = jsonHash({ scope: "INTAKE", v: 1 });
  return db.$transaction(async tx => {
    await assertSession(actor, tx);
    const existing = await tx.projectIntakeDraft.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: actor.userId, createRequestId: input.requestId } } });
    if (existing) {
      if (existing.createInputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "该请求编号已用于另一份材料预览", 409);
      return { draftId: existing.id, replayed: true, status: existing.status };
    }
    const draft = await tx.projectIntakeDraft.create({ data: { ownerUserId: actor.userId, createRequestId: input.requestId,
      createInputHash: hash, status: "DRAFT", expiresAt: new Date(Date.now() + INTAKE_TTL_MS) } });
    return { draftId: draft.id, replayed: false, status: draft.status };
  });
}

async function withDraftLock<T>(actor: ConversationActor, draftId: string, run: (tx: Tx, draft: Awaited<ReturnType<typeof loadDraft>>) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.projectIntakeDraft.updateMany({ where: { id: draftId, ownerUserId: actor.userId }, data: { revision: { increment: 0 } } });
    await assertSession(actor, tx);
    const draft = await loadDraft(actor, draftId, tx);
    return run(tx, draft);
  });
}

function nextRevision(draft: { revision: number }) { return draft.revision + 1; }

export async function addTextMaterial(actor: ConversationActor, draftId: string, raw: unknown) {
  const input = textMaterialSchema.parse(raw);
  return withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    const existing = await tx.projectIntakeMaterial.findUnique({ where: { draftId_requestId: { draftId: draft.id, requestId: input.requestId } } });
    const hash = jsonHash({ text: input.text });
    if (existing) {
      if (existing.requestHash !== hash) throw new AppError("REQUEST_ID_REUSED", "这次材料请求已用于另一份内容", 409);
      return { materialId: existing.id, revision: draft.revision, replayed: true };
    }
    const count = await tx.projectIntakeMaterial.count({ where: { draftId: draft.id } });
    if (count >= INTAKE_MATERIAL_LIMIT) throw new AppError("INTAKE_MATERIAL_LIMIT", `一份预览最多 ${INTAKE_MATERIAL_LIMIT} 份材料，请先整理`, 422);
    const material = await tx.projectIntakeMaterial.create({ data: { draftId: draft.id, ownerUserId: actor.userId, kind: "TEXT",
      ordinal: count + 1, requestId: input.requestId, requestHash: hash, type: "TEXT", size: input.text.length,
      rawText: input.text, extractionStatus: "SUCCESS", sha256: computeFileSha256(Buffer.from(input.text, "utf8")),
      contentHash: jsonHash({ text: input.text }) } });
    const revision = nextRevision(draft);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { revision, status: "DRAFT",
      understandingState: "NONE", understandingJson: Prisma.DbNull, understandingHash: null,
      userRevisionJson: json({}), userRevisionHash: null, acceptedJson: Prisma.DbNull } });
    return { materialId: material.id, revision, replayed: false };
  });
}

/** 图片抽取会用视觉模型：项目前同样必须已有处理同意，并按当前账号计量。 */
export async function addFileMaterial(actor: ConversationActor, draftId: string,
  file: { fileName: string; mimeType: string; buffer: Buffer }, meta: { requestId: string }) {
  if (!meta.requestId.trim()) throw new AppError("INVALID_REQUEST_ID", "缺少材料请求身份", 422);
  if (file.buffer.length === 0) throw new AppError("ATTACHMENT_INVALID", "文件为空", 400);
  if (file.buffer.length > MAX_FILE_BYTES) throw new AppError("ATTACHMENT_TOO_LARGE", "附件不能超过 20MB", 400);
  const type = inferAndValidateFileType(file.fileName, file.mimeType, file.buffer);
  if (type === "CSV" || type === "JSON") throw new AppError("INTAKE_FORMAT_UNSUPPORTED", "项目前材料暂支持文本、PDF 和图片；表格请在项目内作为指标资料上传", 422);

  const draft = await loadDraft(actor, draftId);
  assertOpen(draft);
  if (type === "IMAGE" && record(draft.processingJson).consent !== true)
    throw new AppError("INTAKE_CONSENT_REQUIRED", "图片需要云模型识别；请先同意把材料交给云模型处理", 403);

  const hash = jsonHash({ name: file.fileName, sha: computeFileSha256(file.buffer) });
  const previous = await db.projectIntakeMaterial.findUnique({ where: { draftId_requestId: { draftId: draft.id, requestId: meta.requestId } } });
  if (previous) {
    if (previous.requestHash !== hash) throw new AppError("REQUEST_ID_REUSED", "这次材料请求已用于另一份文件", 409);
    return { materialId: previous.id, revision: draft.revision, replayed: true };
  }

  // 临时原件只进草稿命名空间，不进项目附件目录；到期由原 Worker 清理。
  const stored = await saveFileToStorage(`intake-${draft.id}`, file.fileName, file.buffer);
  let extracted = ""; let status = "SUCCESS"; let error: string | null = null;
  try {
    if (type === "PDF") extracted = await extractPdfText(file.buffer) ?? "";
    else extracted = await extractImageText(file.mimeType, file.buffer, () => reserveIntakeCloudCall({
      userId: actor.userId, sessionId: actor.sessionId, draftId: draft.id, revision: draft.revision,
      requestHash: `intake:vision:${meta.requestId}` })) ?? "";
    if (!extracted) { status = "NEEDS_OCR"; error = type === "PDF" ? "PDF 没有可靠可抽取文本，请提供文本或可识别版本" : "图片需要配置视觉模型后才能识别"; }
  } catch (e) {
    status = "FAILED"; error = e instanceof AppError ? e.message : "抽取失败";
  }

  return withDraftLock(actor, draft.id, async (tx, current) => {
    assertOpen(current);
    const count = await tx.projectIntakeMaterial.count({ where: { draftId: current.id } });
    if (count >= INTAKE_MATERIAL_LIMIT) {
      await deleteAttachmentFile(stored.storageKey).catch(() => undefined);
      throw new AppError("INTAKE_MATERIAL_LIMIT", `一份预览最多 ${INTAKE_MATERIAL_LIMIT} 份材料，请先整理`, 422);
    }
    const material = await tx.projectIntakeMaterial.create({ data: { draftId: current.id, ownerUserId: actor.userId, kind: "FILE",
      ordinal: count + 1, requestId: meta.requestId, requestHash: hash, fileName: file.fileName.slice(0, 200),
      mimeType: file.mimeType.slice(0, 120) || "application/octet-stream", type, size: stored.size, storageKey: stored.storageKey,
      sha256: stored.sha256, rawText: extracted || null, extractionStatus: status, extractionError: error,
      contentHash: jsonHash({ sha: stored.sha256, text: extracted }) } });
    const revision = nextRevision(current);
    await tx.projectIntakeDraft.update({ where: { id: current.id }, data: { revision, status: "DRAFT",
      understandingState: "NONE", understandingJson: Prisma.DbNull, understandingHash: null,
      userRevisionJson: json({}), userRevisionHash: null, acceptedJson: Prisma.DbNull } });
    return { materialId: material.id, revision, replayed: false, extractionStatus: status };
  });
}

export async function recordProcessingConsent(actor: ConversationActor, draftId: string) {
  return withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    const processing = record(draft.processingJson);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { processingJson: json({ ...processing,
      consent: true, consentedAt: processing.consentedAt ?? new Date().toISOString(), consentScope: "INTAKE_PREVIEW_REMOTE_UNDERSTANDING" }) } });
    return { consent: true as const };
  });
}

/** 材料正文只用于这一版预览；超过容量按顺序截取，并在草稿里保持完整原件供用户核对。 */
function materialTextFor(draftId: string, materials: Array<{ id: string; rawText: string | null; kind: string; type: string | null }>) {
  const budget = 24000; let used = 0;
  return materials.flatMap(m => {
    const text = (m.rawText ?? "").trim();
    if (!text) return [];
    const room = Math.max(0, budget - used);
    if (room <= 0) return [];
    const slice = text.slice(0, Math.min(room, INTAKE_TEXT_LIMIT));
    used += slice.length;
    return [{ materialId: m.id, label: materialLabel({ kind: m.kind, fileName: null, ordinal: 0 }), type: m.type ?? "TEXT", text: slice }];
  });
}

function quoteIsVerbatim(quote: string, material: { rawText: string | null }) {
  const text = (material.rawText ?? "").replace(/\s+/g, "");
  return text.includes(quote.replace(/\s+/g, ""));
}

/**
 * 生成/重算理解。模型不可用时保持「只展示原文」的诚实状态，不伪造理解，
 * 也不把材料摘录当成模型建议的目标。
 */
export async function understandIntake(actor: ConversationActor, draftId: string, raw: unknown,
  dependencies: { runModel?: (messages: ReturnType<typeof buildPromptMessages>) => Promise<AgentExecutionResult<string>> } = {}) {
  const input = understandSchema.parse(raw);
  const draft = await loadDraft(actor, draftId);
  assertOpen(draft);
  if (record(draft.processingJson).consent !== true)
    throw new AppError("INTAKE_CONSENT_REQUIRED", "需要先同意把材料交给云模型处理", 403);
  const materials = await db.projectIntakeMaterial.findMany({ where: { draftId: draft.id }, orderBy: { ordinal: "asc" } });
  if (!materials.length) throw new AppError("INTAKE_MATERIALS_REQUIRED", "请先加入至少一份材料", 422);
  if (draft.understandingState === "READY" && draft.understandingJson) return readIntake(actor, draft.id);

  const usable = materials.filter(m => (m.rawText ?? "").trim().length > 0);
  if (!usable.length) {
    await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { understandingState: "MATERIAL_ONLY", status: "DRAFT",
      previewJson: json({ note: "文件尚无可读文本，保持原文状态" }) } });
    return readIntake(actor, draft.id);
  }

  const requestHash = jsonHash({ draftId: draft.id, revision: draft.revision, requestId: input.requestId });
  // 先看资格，再预占：没有配置或没有额度时不应该先扣一次额度。
  // 注入模型替身时跳过（测试夹具不是真实云端资格）。
  if (!dependencies.runModel) {
    const capability = await cloudCapability(actor.userId);
    if (!capability.available) throw new AppError(
      capability.reason === "DAILY_QUOTA_EXHAUSTED" ? "CLOUD_QUOTA_EXHAUSTED" : "MODEL_NOT_CONFIGURED",
      capability.reason === "RULE_MODE" ? "当前运行在规则模式，未启用云模型；材料已保存，可手工填写目标" : "当前账号还不能使用云模型处理材料", 503);
  }
  let result: AgentExecutionResult<string> | null = null;
  let understanding: IntakeUnderstanding;
  try {
    await reserveIntakeCloudCall({ userId: actor.userId, sessionId: actor.sessionId, draftId: draft.id,
      revision: draft.revision, requestHash });
    const messages = buildPromptMessages(intakeUnderstandingV1, { draftId: draft.id, materials: materialTextFor(draft.id, usable) });
    result = await (dependencies.runModel ?? ((prompt: ReturnType<typeof buildPromptMessages>) =>
      chatWithLLMWithMeta(prompt, undefined, undefined, undefined,
        { outputTokens: intakeUnderstandingV1.maxOutputTokens, jsonOutput: true },
        { userId: actor.userId, sessionId: actor.sessionId, draftId: draft.id, revision: draft.revision, requestHash })))(messages);
    understanding = understandingSchema.parse(JSON.parse(result.data));
  } catch (error) {
    const code = error instanceof AppError ? error.code : "MODEL_OUTPUT_INVALID";
    await settleIntakeCloudCall({ draftId: draft.id, requestHash, state: code === "CALL_ALREADY_RESERVED" ? "UNKNOWN" : "FAILED",
      usage: undefined, provider: result?.provider ?? null }).catch(() => undefined);
    await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { understandingState: "FAILED", status: "DRAFT",
      previewJson: json({ failureCode: code, failureAt: new Date().toISOString(),
        note: "这一版没有形成模型理解；原件仍是用户材料，不是项目事实" }) } }).catch(() => undefined);
    throw error;
  }
  await settleIntakeCloudCall({ draftId: draft.id, requestHash, state: "SETTLED",
    usage: result.usage ?? { inputTokens: null, outputTokens: null }, provider: result.provider }).catch(() => undefined);

  // 原文核对：模型引用的引文必须逐字出现在它指的那份材料里，否则这一版不成立。
  const byId = new Map(materials.map(m => [m.id, m]));
  for (const quote of understanding.quotes) {
    const material = byId.get(quote.materialId);
    if (!material || !quoteIsVerbatim(quote.quote, material)) {
      await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { understandingState: "FAILED", status: "DRAFT",
        previewJson: json({ failureCode: "UNSUPPORTED_QUOTE", failureAt: new Date().toISOString(),
          note: "模型引用的原文摘录未通过核对，这一版没有保存；材料本身未变" }) } }).catch(() => undefined);
      throw new AppError("UNSUPPORTED_QUOTE", "模型引用的原文摘录未通过核对，这一版没有保存", 409);
    }
  }
  await db.projectIntakeDraft.update({ where: { id: draft.id }, data: {
    understandingJson: json(understanding), understandingHash: jsonHash(understanding),
    understandingState: "READY", status: "PREVIEW_READY", understoodAt: new Date() } });
  await db.agentRun.create({ data: { provider: result.provider, runType: "ACTION", status: "SUCCESS",
    externalRequestId: `intake-understanding:${draft.id}:${draft.revision}:${input.requestId}`.slice(0, 180),
    trace: json({ purpose: "INTAKE_UNDERSTANDING", draftId: draft.id, revision: draft.revision,
      promptId: intakeUnderstandingV1.id, promptVersion: intakeUnderstandingV1.version,
      outputSchemaVersion: intakeUnderstandingV1.outputSchemaVersion, usage: result.usage, usageUnknown: result.usageUnknown,
      requestIdentity: result.requestIdentity, quoteCount: understanding.quotes.length,
      materialsHash: materialsHashOf(materials) }) } }).catch(() => undefined);
  return readIntake(actor, draft.id);
}

/** 用户的整体纠正：literal 生效；解释候选只保留；需要澄清时只问一个问题。 */
export async function reviseIntake(actor: ConversationActor, draftId: string, raw: unknown) {
  const input = reviseSchema.parse(raw);
  return withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    if (draft.revision !== input.expectedRevision)
      throw new AppError("INTAKE_CHANGED", "预览已变化，请按当前版本重新核对", 409);
    const admission = admitDirective({ commandId: input.requestId, expectedSeq: 0, operation: "SET",
      scope: intakeScope(draft.id), quote: input.text, admission: "LITERAL", timezone: INTAKE_SCOPE_TIMEZONE });
    const previous = record(draft.userRevisionJson);
    const candidates = Array.isArray(previous.candidates) ? previous.candidates as Array<Record<string, unknown>> : [];
    let appliedObjective = typeof previous.appliedObjective === "string" ? previous.appliedObjective : null;
    let constraints = Array.isArray(previous.constraints) ? previous.constraints as string[] : [];
    let until = typeof previous.until === "string" ? previous.until : null;
    let clarify: Record<string, unknown> | null = null;
    if (admission.status === "DIRECT_APPLIED" && admission.kind === "WORKING_OBJECTIVE") {
      appliedObjective = input.text; until = admission.until ?? null;
      constraints = [...new Set([...constraints, ...(admission.constraints ?? [])])];
    } else if (admission.status === "DIRECT_APPLIED" && admission.kind === "CONSTRAINT") {
      constraints = [...new Set([...constraints, ...((admission.constraints?.length ? admission.constraints : [input.text]))])];
      until = admission.until ?? until;
    } else if (admission.status === "DIRECT_APPLIED" && admission.kind === "STOP") {
      // 项目还没有建立：停止要作用在哪一项必须先说清，不能悄悄变成永久限制。
      clarify = { question: "项目还没有建立，这条停止要作用在哪一项工作？", reason: "STOP_WITHOUT_TARGET" };
    } else if (admission.status === "NEEDS_CLARIFICATION") {
      clarify = { question: admission.question ?? "这条要求具体作用在哪一项工作？", reason: admission.reason };
    } else {
      candidates.push({ quote: input.text, interpretation: input.text,
        reason: admission.reason, status: "INTERPRETATION_CANDIDATE", at: new Date().toISOString() });
    }
    const revisionJson = { appliedObjective, constraints, until, candidates: candidates.slice(-8), clarify,
      admittedAt: new Date().toISOString(), admissionStatus: admission.status, admissionReason: admission.reason };
    const revision = nextRevision(draft);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { revision, userRevisionJson: json(revisionJson),
      userRevisionHash: jsonHash(revisionJson), status: draft.understandingState === "READY" ? "PREVIEW_READY" : draft.status } });
    return { admission, clarify, appliedObjective, constraints, until, revision, preview: await buildPreviewFrom(draft.id, tx) };
  });
}

/** 用户接受并提交的业务字段（编辑后的建议）。存进项目的只有这一份。 */
export async function acceptIntakeFields(actor: ConversationActor, draftId: string, raw: unknown) {
  const shape = raw as { requestId?: string; expectedRevision?: number; accepted?: unknown };
  const parsed = confirmSchema.omit({ previewHash: true }).parse(shape);
  return withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    if (draft.revision !== parsed.expectedRevision) throw new AppError("INTAKE_CHANGED", "预览已变化，请按当前版本重新核对", 409);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { acceptedJson: json(parsed.accepted) } });
    return { accepted: parsed.accepted, preview: await buildPreviewFrom(draft.id, tx) };
  });
}

async function buildPreviewFrom(draftId: string, tx: Tx = db): Promise<IntakePreview> {
  const draft = await tx.projectIntakeDraft.findUniqueOrThrow({ where: { id: draftId } });
  const materials = await tx.projectIntakeMaterial.findMany({ where: { draftId }, orderBy: { ordinal: "asc" } });
  const understanding = draft.understandingJson ? understandingSchema.safeParse(draft.understandingJson) : null;
  const ready = draft.understandingState === "READY" && understanding?.success === true;
  const revision = record(draft.userRevisionJson);
  const accepted = draft.acceptedJson ? { ...record(draft.acceptedJson) } as unknown as IntakeAcceptedFields : null;
  const understandingHash = typeof draft.understandingHash === "string" ? draft.understandingHash : null;
  const userRevisionHash = typeof draft.userRevisionHash === "string" ? draft.userRevisionHash : null;
  const acceptedHash = accepted ? acceptedHashOf(accepted) : null;
  const materialsHash = materialsHashOf(materials.map(m => ({ id: m.id, revision: m.revision, contentHash: m.contentHash })));
  const previewHash = previewHashOf({ draftId: draft.id, revision: draft.revision, materialsHash, understandingHash, userRevisionHash, acceptedHash });
  const labels = new Map(materials.map(m => [m.id, materialLabel({ kind: m.kind, fileName: m.fileName, ordinal: m.ordinal })]));
  const statements = ready ? understanding!.data.quotes.map(q => ({ materialId: q.materialId, materialLabel: labels.get(q.materialId) ?? "材料",
    quote: q.quote, meaning: q.meaning })) : materials.filter(m => (m.rawText ?? "").trim()).slice(0, 3).map(m => ({
      materialId: m.id, materialLabel: labels.get(m.id) ?? "材料", quote: (m.rawText ?? "").trim().slice(0, 240),
      meaning: "尚未生成模型理解；这是材料原文片段。" }));
  return {
    schemaVersion: 1, draftId: draft.id, revision: draft.revision,
    status: draft.status as IntakePreview["status"], materialsHash,
    understandingState: draft.understandingState as IntakePreview["understandingState"],
    model: { used: ready, provider: ready ? "configured" : null,
      reason: ready ? null : typeof record(draft.previewJson).failureCode === "string" ? String(record(draft.previewJson).failureCode) : draft.understandingState === "NONE" ? "NOT_RUN" : null,
      usageUnknown: ready ? true : true },
    summary: ready ? understanding!.data.summary : null,
    statements,
    suggested: ready ? { ...understanding!.data.suggested } as IntakeAcceptedFields : null,
    constraints: ready ? understanding!.data.constraints.map(c => ({ text: c.text, basis: c.basis, materialId: c.materialId ?? null }))
      : (Array.isArray(revision.constraints) ? revision.constraints as string[] : []).map(text => ({ text, basis: "STATED" as const, materialId: null })),
    unknowns: ready ? understanding!.data.unknowns : [],
    successCriteria: ready ? understanding!.data.successCriteria : [],
    nextQuestion: ready ? understanding!.data.nextQuestion : null,
    correction: {
      appliedObjective: typeof revision.appliedObjective === "string" ? revision.appliedObjective : null,
      constraints: Array.isArray(revision.constraints) ? revision.constraints as string[] : [],
      until: typeof revision.until === "string" ? revision.until : null,
      candidates: Array.isArray(revision.candidates) ? (revision.candidates as Array<Record<string, unknown>>)
        .filter(c => c.status === "INTERPRETATION_CANDIDATE")
        .map(c => ({ quote: String(c.quote ?? ""), interpretation: String(c.interpretation ?? ""), reason: String(c.reason ?? "") })) : [],
      clarify: revision.clarify && typeof revision.clarify === "object"
        ? { question: String(record(revision.clarify).question ?? "这条要求具体作用在哪一项工作？"), reason: String(record(revision.clarify).reason ?? "") } : null,
      admittedAt: typeof revision.admittedAt === "string" ? revision.admittedAt : null,
    },
    accepted,
    materials: materials.map(m => ({ id: m.id, label: labels.get(m.id) ?? "材料", kind: m.kind as "TEXT" | "FILE",
      type: m.type, fileName: m.fileName, size: m.size, sha256: m.sha256, extractionStatus: m.extractionStatus,
      extractionError: m.extractionError, revision: m.revision, contentHash: m.contentHash,
      sync: { state: String(record(m.syncJson).state ?? "PENDING"),
        ...(typeof record(m.syncJson).captureId === "string" ? { captureId: String(record(m.syncJson).captureId) } : {}),
        ...(typeof record(m.syncJson).attachmentId === "string" ? { attachmentId: String(record(m.syncJson).attachmentId) } : {}),
        ...(typeof record(m.syncJson).error === "string" ? { error: String(record(m.syncJson).error) } : {}) } })),
    expiresAt: draft.expiresAt.toISOString(), previewHash,
  };
}

export async function readIntake(actor: ConversationActor, draftId: string) {
  await assertSession(actor);
  const draft = await loadDraft(actor, draftId);
  if (draft.status === "WITHDRAWN" || draft.withdrawnAt) throw new AppError("INTAKE_WITHDRAWN", "这份材料预览已撤回", 410);
  if (draft.status === "EXPIRED" || (draft.status !== "CONFIRMED" && +draft.expiresAt <= Date.now()))
    throw new AppError("INTAKE_EXPIRED", "材料预览已到期，原件已进入清理", 410);
  return { preview: await buildPreviewFrom(draft.id), confirmedProjectId: draft.projectId,
    expiresAt: draft.expiresAt.toISOString(), canConfirm: ["DRAFT", "PREVIEW_READY", "FAILED", "UNDERSTANDING"].includes(draft.status) && +draft.expiresAt > Date.now() };
}

/**
 * 确认建项。服务端重新核对归属、会话、草稿修订、材料 hash、预览 hash 与接受字段；
 * 前端按钮状态不是凭据。响应丢失后同 requestId 重放返回同一个项目。
 */
export async function confirmIntake(actor: ConversationActor, draftId: string, raw: unknown) {
  const input = confirmSchema.parse(raw);
  const draft = await loadDraft(actor, draftId);
  // 已建项的同请求重放返回原项目；换请求再确认拒绝，不制造第二个项目。
  if (draft.status === "CONFIRMED") {
    const saved = record(draft.confirmRequestJson);
    if (draft.projectId && saved.requestId === input.requestId) {
      if (saved.acceptedHash !== acceptedHashOf(input.accepted))
        throw new AppError("IDEMPOTENCY_CONFLICT", "同一建项请求的内容已变化，请重新提交", 409);
      return { projectId: draft.projectId, replayed: true, preview: await buildPreviewFrom(draft.id) };
    }
    throw new AppError("INTAKE_CONFIRMED", "这份预览已建项，请到项目继续", 409);
  }
  assertOpen(draft);
  const preview = await buildPreviewFrom(draft.id);
  if (preview.revision !== input.expectedRevision)
    throw new AppError("INTAKE_CHANGED", "预览已更新，请按当前版本重新核对", 409);
  if (preview.previewHash !== input.previewHash)
    throw new AppError("INTAKE_PREVIEW_STALE", "你确认的理解与当前材料不一致，请重新核对这一版", 409);
  if (!preview.materials.length) throw new AppError("INTAKE_MATERIALS_REQUIRED", "确认建项前至少要有一份材料", 422);
  const acceptedHash = acceptedHashOf(input.accepted);
  const intakeHash = jsonHash({ draftId: draft.id, revision: preview.revision, materialsHash: preview.materialsHash,
    previewHash: preview.previewHash, acceptedHash });
  const result = await db.$transaction(async tx => {
    const locked = await tx.projectIntakeDraft.updateMany({ where: { id: draft.id, ownerUserId: actor.userId }, data: { revision: { increment: 0 } } });
    if (!locked.count) throw new AppError("INTAKE_NOT_FOUND", "材料预览不存在或不可访问", 404);
    const current = await tx.projectIntakeDraft.findUniqueOrThrow({ where: { id: draft.id } });
    if (current.status === "CONFIRMED") {
      // 并发确认：输的一方不建第二个项目，读回原回执。
      const saved = record(current.confirmRequestJson);
      if (saved.requestId === input.requestId && saved.acceptedHash === acceptedHash && current.projectId)
        return { projectId: current.projectId, replayed: true };
      throw new AppError("INTAKE_CONFIRMED", "这份预览已建项，请到项目继续", 409);
    }
    assertOpen(current);
    if (current.revision !== input.expectedRevision) throw new AppError("INTAKE_CHANGED", "预览已更新，请按当前版本重新核对", 409);
    const created = await createOwnedProjectInTx(tx, { ...input.accepted, deadline: input.accepted.deadline ?? null,
      requestId: input.requestId }, actor.userId, input.requestId, {
      sessionId: actor.sessionId, provider: "project-intake-confirm-v1",
      hashExtra: { draftId: current.id, revision: preview.revision, materialsHash: preview.materialsHash,
        previewHash: preview.previewHash, acceptedHash },
      resultExtra: { draftId: current.id }, traceExtra: { purpose: "INTAKE_CONFIRM", draftId: current.id,
        materialsHash: preview.materialsHash, previewHash: preview.previewHash, acceptedHash } });
    await tx.projectIntakeDraft.update({ where: { id: current.id }, data: { status: "CONFIRMED", projectId: created.project.id,
      acceptedJson: json(input.accepted), confirmedAt: current.confirmedAt ?? new Date(),
      confirmRequestJson: json({ requestId: input.requestId, intakeHash, acceptedHash, previewHash: preview.previewHash,
        revision: preview.revision, materialsHash: preview.materialsHash }) } });
    return { projectId: created.project.id, replayed: created.replayed };
  });
  return { ...result, preview: await buildPreviewFrom(draft.id) };
}

/**
 * 材料同步：每一份材料单独记录真实状态。
 *
 * 这是数据库提交之后的第二阶段。附件写盘与数据库从来不是一个原子操作，
 * 所以失败时保留已建项目、已同步部分和可恢复入口——绝不重复建项。
 */
export async function syncIntakeMaterials(actor: ConversationActor, draftId: string) {
  const draft = await loadDraft(actor, draftId);
  if (draft.status !== "CONFIRMED" || !draft.projectId)
    throw new AppError("INTAKE_NOT_CONFIRMED", "材料还没有对应的项目", 409);
  const member = await db.projectMembership.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId: draft.projectId } } });
  if (member?.role !== "OWNER") throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化", 404);
  const materials = await db.projectIntakeMaterial.findMany({ where: { draftId: draft.id }, orderBy: { ordinal: "asc" } });
  const results: Array<{ materialId: string; state: string; captureId?: string; attachmentId?: string; error?: string }> = [];
  for (const m of materials) {
    const sync = record(m.syncJson);
    if (sync.state === "SYNCED") { results.push({ materialId: m.id, state: "SYNCED", ...(typeof sync.captureId === "string" ? { captureId: sync.captureId } : {}),
      ...(typeof sync.attachmentId === "string" ? { attachmentId: sync.attachmentId } : {}) }); continue; }
    try {
      if (m.kind === "TEXT") {
        if (!m.rawText) throw new AppError("INTAKE_MATERIAL_LOST", "这份文本材料已清理，无法再同步", 410);
        const capture = await processCaptureWithRequest(draft.projectId, m.rawText, "项目材料",
          { requestId: `intake:${draft.id}:${m.id}:${m.revision}` });
        await db.projectIntakeMaterial.update({ where: { id: m.id }, data: { syncJson: json({ state: "SYNCED",
          captureId: capture.card?.id ?? null, at: new Date().toISOString() }), rawText: null, cleanupState: "PURGED", cleanedAt: new Date() } });
        results.push({ materialId: m.id, state: "SYNCED", ...(capture.card?.id ? { captureId: capture.card.id } : {}) });
      } else {
        if (!m.storageKey) throw new AppError("INTAKE_MATERIAL_LOST", "原件已清理，无法再同步", 410);
        const buffer = await readAttachmentFile(m.storageKey);
        const uploaded = await processAttachmentUpload({ projectId: draft.projectId, fileName: m.fileName ?? "材料",
          mimeType: m.mimeType ?? "application/octet-stream", buffer });
        await deleteAttachmentFile(m.storageKey).catch(() => undefined);
        await db.projectIntakeMaterial.update({ where: { id: m.id }, data: { syncJson: json({ state: "SYNCED",
          attachmentId: uploaded.attachment.id, at: new Date().toISOString() }), rawText: null, storageKey: null,
          cleanupState: "DELETED", cleanedAt: new Date() } });
        results.push({ materialId: m.id, state: "SYNCED", attachmentId: uploaded.attachment.id });
      }
    } catch (error) {
      const message = error instanceof AppError ? error.message : "材料同步中断";
      const code = error instanceof AppError ? error.code : "SYNC_FAILED";
      await db.projectIntakeMaterial.update({ where: { id: m.id }, data: { syncJson: json({ state: "FAILED", error: message,
        code, attempts: (Number(record(m.syncJson).attempts) || 0) + 1, at: new Date().toISOString() }) } }).catch(() => undefined);
      results.push({ materialId: m.id, state: "FAILED", error: message });
    }
  }
  return { projectId: draft.projectId, materials: results,
    pending: results.filter(r => r.state !== "SYNCED").length, preview: await buildPreviewFrom(draft.id) };
}

export async function withdrawIntake(actor: ConversationActor, draftId: string) {
  const result = await withDraftLock(actor, draftId, async (tx, draft) => {
    if (draft.status === "CONFIRMED") throw new AppError("INTAKE_CONFIRMED", "已建项的材料请到项目内处理", 409);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { status: "WITHDRAWN", withdrawnAt: draft.withdrawnAt ?? new Date() } });
    return { draftId: draft.id };
  });
  await cleanupIntakeDraftFiles(result.draftId, actor.userId).catch(() => undefined);
  return result;
}

/** 清理一稿的临时原件；失败保留原清理身份，由原 Worker 重试。 */
export async function cleanupIntakeDraftFiles(draftId: string, ownerUserId: string) {
  const draft = await db.projectIntakeDraft.findFirst({ where: { id: draftId, ownerUserId } });
  if (!draft) return { cleaned: 0, failed: 0 };
  let cleaned = 0, failed = 0;
  const files = await listProjectAttachmentFiles(`intake-${draft.id}`).catch(() => [] as string[]);
  for (const key of files) {
    try { await deleteAttachmentFile(key); cleaned++; } catch { failed++; }
  }
  for (const m of await db.projectIntakeMaterial.findMany({ where: { draftId: draft.id, cleanupState: { in: ["PENDING", "FAILED"] } } })) {
    if (m.cleanupState === "PENDING" && m.storageKey && files.includes(m.storageKey)) {
      await db.projectIntakeMaterial.update({ where: { id: m.id }, data: { cleanupState: "DELETED", cleanedAt: new Date(), storageKey: null } }).catch(() => undefined);
    }
    await db.projectIntakeMaterial.update({ where: { id: m.id }, data: { rawText: null,
      cleanupState: files.length || m.kind === "TEXT" ? "DELETED" : m.cleanupState, cleanedAt: new Date() } }).catch(() => undefined);
  }
  await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { processingJson: json({ ...record(draft.processingJson),
    cleanup: { at: new Date().toISOString(), files: files.length, cleaned, failed } }) } });
  return { cleaned, failed };
}

/**
 * 到期清理：没有新事件也会发生。批处理保留失败身份，不删掉本应重试的清理责任。
 */
export async function expireIntakeDrafts(now = new Date(), limit = 5) {
  const expired = await db.projectIntakeDraft.findMany({
    where: { OR: [{ status: { in: ["DRAFT", "PREVIEW_READY", "FAILED", "UNDERSTANDING"] }, expiresAt: { lte: now } },
      { status: "WITHDRAWN" }],
      cleanupAttempts: { lt: 5 } },
    orderBy: { expiresAt: "asc" }, take: limit,
  });
  const results: Array<{ draftId: string; state: string; error?: string }> = [];
  for (const draft of expired) {
    try {
      if (draft.status !== "WITHDRAWN") await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { status: "EXPIRED" } });
      const { failed } = await cleanupIntakeDraftFiles(draft.id, draft.ownerUserId);
      await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { cleanupAttempts: { increment: 1 } } });
      results.push({ draftId: draft.id, state: failed ? "PARTIAL" : "CLEANED" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "清理失败";
      await db.projectIntakeDraft.update({ where: { id: draft.id }, data: { cleanupAttempts: { increment: 1 } } }).catch(() => undefined);
      results.push({ draftId: draft.id, state: "FAILED", error: message });
    }
  }
  return results;
}

/** 旧预览/旧确认的版本化读取：客户端只能拿到当前 revision 与预览 hash。 */
export async function readIntakeForClient(actor: ConversationActor, draftId: string) {
  return readIntake(actor, draftId);
}

export const intakeTesting = { intakeScope, materialTextFor, quoteIsVerbatim };





