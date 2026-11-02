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
import { createConversationInTx } from "@/lib/conversation/service";
import { admitDirectiveInTx, effectiveContinuity } from "@/lib/continuity/directiveService";

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

async function publishUnderstanding(actor: ConversationActor, draftId: string, revision: number, data: Prisma.ProjectIntakeDraftUpdateInput, advance = false) {
  return withDraftLock(actor, draftId, async (tx, current) => {
    assertOpen(current);
    if (current.revision !== revision) throw new AppError("INTAKE_CHANGED", "材料或用户要求已变化，未发布旧模型结果", 409);
    await tx.projectIntakeDraft.update({ where: { id: draftId }, data: { ...data, ...(advance ? { revision: nextRevision(current) } : {}) } });
  });
}

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
      acceptedJson: Prisma.DbNull } });
    return { materialId: material.id, revision, replayed: false };
  });
}

/** 图片抽取会用视觉模型：项目前同样必须已有处理同意，并按当前账号计量。 */
export async function addFileMaterial(actor: ConversationActor, draftId: string,
  file: { fileName: string; mimeType: string; buffer: Buffer }, meta: { requestId: string },
  dependencies: { extractPdf?: typeof extractPdfText } = {}) {
  if (!meta.requestId.trim() || meta.requestId.length > 128) throw new AppError("INVALID_REQUEST_ID", "缺少或过长的材料请求身份", 422);
  if (!file.buffer.length || file.buffer.length > MAX_FILE_BYTES) throw new AppError("ATTACHMENT_INVALID", "文件为空或超过 20MB", 400);
  const type = inferAndValidateFileType(file.fileName, file.mimeType, file.buffer);
  if (type === "CSV" || type === "JSON") throw new AppError("INTAKE_FORMAT_UNSUPPORTED", "项目前材料暂支持文本、PDF 和图片", 422);
  const hash = jsonHash({ name: file.fileName, sha: computeFileSha256(file.buffer) });
  // 在抽取/云调用前持久登记；撤回、清理和重复请求都能看到同一身份。
  const prepared = await withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    const existing = await tx.projectIntakeMaterial.findUnique({ where: { draftId_requestId: { draftId, requestId: meta.requestId } } });
    if (existing) {
      if (existing.requestHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求已用于另一份文件", 409);
      return { material: existing, revision: draft.revision, replayed: true };
    }
    if (type === "IMAGE" && record(draft.processingJson).consent !== true) throw new AppError("INTAKE_CONSENT_REQUIRED", "图片识别需要云处理同意", 403);
    const count = await tx.projectIntakeMaterial.count({ where: { draftId } });
    if (count >= INTAKE_MATERIAL_LIMIT) throw new AppError("INTAKE_MATERIAL_LIMIT", "材料数量已达上限", 422);
    const stored = await saveFileToStorage(`intake-${draftId}`, file.fileName, file.buffer);
    const material = await tx.projectIntakeMaterial.create({ data: { draftId, ownerUserId: actor.userId, kind: "FILE", ordinal: count+1,
      requestId: meta.requestId, requestHash: hash, fileName: file.fileName.slice(0,200), mimeType: file.mimeType.slice(0,120), type,
      size: stored.size, storageKey: stored.storageKey, sha256: stored.sha256, extractionStatus: "PENDING", contentHash: jsonHash({ sha: stored.sha256, text: "" }) } });
    const revision = nextRevision(draft);
    await tx.projectIntakeDraft.update({ where: { id: draftId }, data: { revision, status: "DRAFT", understandingState: "NONE",
      understandingJson: Prisma.DbNull, understandingHash: null, acceptedJson: Prisma.DbNull } });
    return { material, revision, replayed: false };
  });
  if (prepared.replayed) return { materialId: prepared.material.id, revision: prepared.revision, replayed: true, extractionStatus: prepared.material.extractionStatus };
  let extracted = "", status = "SUCCESS", error: string | null = null;
  try {
    extracted = type === "PDF" ? await (dependencies.extractPdf ?? extractPdfText)(file.buffer) ?? ""
      : await extractImageText(file.mimeType, file.buffer, () => reserveIntakeCloudCall({ userId: actor.userId, sessionId: actor.sessionId,
          draftId, revision: prepared.revision, requestHash: `intake:vision:${meta.requestId}` })) ?? "";
    if (!extracted) { status = "NEEDS_OCR"; error = "原件已保存，但目前没有可靠的可读文本"; }
  } catch (e) { status = "FAILED"; error = e instanceof AppError ? e.message : "抽取失败"; }
  return withDraftLock(actor, draftId, async (tx, current) => {
    assertOpen(current);
    const revision = nextRevision(current);
    await tx.projectIntakeMaterial.update({ where: { id: prepared.material.id }, data: { rawText: extracted || null,
      extractionStatus: status, extractionError: error, revision: { increment: 1 }, contentHash: jsonHash({ sha: prepared.material.sha256, text: extracted }) } });
    await tx.projectIntakeDraft.update({ where: { id: draftId }, data: { revision, status: "DRAFT", understandingState: "NONE",
      understandingJson: Prisma.DbNull, understandingHash: null, acceptedJson: Prisma.DbNull } });
    return { materialId: prepared.material.id, revision, replayed: false, extractionStatus: status };
  });
}

export async function recordProcessingConsent(actor: ConversationActor, draftId: string, consent = true) {
  return withDraftLock(actor, draftId, async (tx, draft) => {
    assertOpen(draft);
    const processing = record(draft.processingJson);
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { processingJson: json({ ...processing,
      consent, consentedAt: consent ? processing.consentedAt ?? new Date().toISOString() : null, consentScope: "INTAKE_PREVIEW_REMOTE_UNDERSTANDING" }),
      ...(!consent ? { revision: nextRevision(draft) } : {}) } });
    return { consent };
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
  await assertSession(actor);
  const draft = await loadDraft(actor, draftId);
  assertOpen(draft);
  if (record(draft.processingJson).consent !== true)
    throw new AppError("INTAKE_CONSENT_REQUIRED", "需要先同意把材料交给云模型处理", 403);
  const materials = await db.projectIntakeMaterial.findMany({ where: { draftId: draft.id }, orderBy: { ordinal: "asc" } });
  if (!materials.length) throw new AppError("INTAKE_MATERIALS_REQUIRED", "请先加入至少一份材料", 422);
  const requestHash = jsonHash({ draftId: draft.id, requestId: input.requestId });
  const dispatches = record(draft.processingJson).dispatches;
  if (Array.isArray(dispatches) && dispatches.some(d => record(d).requestHash === requestHash)) {
    if (draft.understandingState === "READY" && record(draft.previewJson).requestHash === requestHash) return readIntake(actor, draft.id);
    throw new AppError("CALL_ALREADY_RESERVED", "原理解请求已经派发，请核对原结果，未知请求不重复发送", 409);
  }

  const usable = materials.filter(m => (m.rawText ?? "").trim().length > 0);
  if (!usable.length) {
    await publishUnderstanding(actor, draft.id, draft.revision, { understandingState: "MATERIAL_ONLY", status: "DRAFT",
      previewJson: json({ note: "文件尚无可读文本，保持原文状态" }) });
    return readIntake(actor, draft.id);
  }

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
    // 实际 provider 适配器负责紧邻 HTTP 派发的唯一预占；注入替身也走同一守卫。
    if (dependencies.runModel) await reserveIntakeCloudCall({ userId: actor.userId, sessionId: actor.sessionId, draftId: draft.id,
      revision: draft.revision, requestHash });
    const controls = record(draft.userRevisionJson);
    const admitted = Array.isArray(controls.admittedDirectives) ? controls.admittedDirectives.map(record)
      .filter(d => !d.validUntil || Date.parse(String(d.validUntil)) > Date.now()) : [];
    const candidates = Array.isArray(controls.candidates) ? controls.candidates.map(record) : [];
    const messages = buildPromptMessages(intakeUnderstandingV1, { draftId: draft.id, materials: materialTextFor(draft.id, usable),
      userReview: [...admitted.map(d => ({ quote: String(d.quote), kind: "ADMITTED_GUIDANCE" as const })),
        ...candidates.map(d => ({ quote: String(d.quote), kind: "INTERPRETATION_CANDIDATE" as const }))] });
    result = await (dependencies.runModel ?? ((prompt: ReturnType<typeof buildPromptMessages>) =>
      chatWithLLMWithMeta(prompt, undefined, undefined, undefined,
        { outputTokens: intakeUnderstandingV1.maxOutputTokens, jsonOutput: true },
        { userId: actor.userId, sessionId: actor.sessionId, draftId: draft.id, revision: draft.revision, requestHash })))(messages);
    understanding = understandingSchema.parse(JSON.parse(result.data));
  } catch (error) {
    const code = error instanceof AppError ? error.code : "MODEL_OUTPUT_INVALID";
    if (code !== "CALL_ALREADY_RESERVED") await settleIntakeCloudCall({ draftId: draft.id, requestHash, state: result ? "SETTLED" : "UNKNOWN",
      usage: result?.usage, provider: result?.provider ?? null }).catch(() => undefined);
    if (code !== "CALL_ALREADY_RESERVED") await publishUnderstanding(actor, draft.id, draft.revision, { understandingState: "FAILED", status: "DRAFT",
      previewJson: json({ failureCode: code, failureAt: new Date().toISOString(),
        note: "这一版没有形成模型理解；原件仍是用户材料，不是项目事实" }) }).catch(() => undefined);
    throw error;
  }
  await settleIntakeCloudCall({ draftId: draft.id, requestHash, state: "SETTLED",
    usage: result.usage ?? { inputTokens: null, outputTokens: null }, provider: result.provider }).catch(() => undefined);

  // 原文核对：模型引用的引文必须逐字出现在它指的那份材料里，否则这一版不成立。
  const byId = new Map(materials.map(m => [m.id, m]));
  for (const quote of understanding.quotes) {
    const material = byId.get(quote.materialId);
    if (!material || !quoteIsVerbatim(quote.quote, material)) {
      await publishUnderstanding(actor, draft.id, draft.revision, { understandingState: "FAILED", status: "DRAFT",
        previewJson: json({ failureCode: "UNSUPPORTED_QUOTE", failureAt: new Date().toISOString(),
          note: "模型引用的原文摘录未通过核对，这一版没有保存；材料本身未变" }) }).catch(() => undefined);
      throw new AppError("UNSUPPORTED_QUOTE", "模型引用的原文摘录未通过核对，这一版没有保存", 409);
    }
  }
  await publishUnderstanding(actor, draft.id, draft.revision, {
    understandingJson: json(understanding), understandingHash: jsonHash(understanding),
    previewJson: json({ requestHash, provider: result.provider, usageUnknown: result.usageUnknown ?? (result.usage?.inputTokens == null || result.usage?.outputTokens == null) }),
    understandingState: "READY", status: "PREVIEW_READY", understoodAt: new Date() }, true);
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
    let admittedDirectives = Array.isArray(previous.admittedDirectives) ? previous.admittedDirectives.map(record) : [];
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
    if (admission.status === "DIRECT_APPLIED" && ["WORKING_OBJECTIVE", "CONSTRAINT"].includes(admission.kind ?? "")) {
      admittedDirectives = admittedDirectives.filter(d => admission.kind === "WORKING_OBJECTIVE" ? d.kind !== "WORKING_OBJECTIVE" : d.quote !== input.text);
      admittedDirectives.push({ quote: input.text, kind: admission.kind, validUntil: admission.until ?? null,
        constraints: admission.constraints ?? [], admittedAt: new Date().toISOString(), commandId: input.requestId });
    }
    const revisionJson = { appliedObjective, constraints, until, candidates: candidates.slice(-8), clarify,
      admittedDirectives, admittedAt: new Date().toISOString(), admissionStatus: admission.status, admissionReason: admission.reason };
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
    await tx.projectIntakeDraft.update({ where: { id: draft.id }, data: { acceptedJson: json(parsed.accepted), revision: nextRevision(draft) } });
    return { accepted: parsed.accepted, preview: await buildPreviewFrom(draft.id, tx) };
  });
}

async function buildPreviewFrom(draftId: string, tx: Tx = db): Promise<IntakePreview> {
  const draft = await tx.projectIntakeDraft.findUniqueOrThrow({ where: { id: draftId } });
  const materials = await tx.projectIntakeMaterial.findMany({ where: { draftId }, orderBy: { ordinal: "asc" } });
  const understanding = draft.understandingJson ? understandingSchema.safeParse(draft.understandingJson) : null;
  const ready = draft.understandingState === "READY" && understanding?.success === true;
  const revision = record(draft.userRevisionJson);
  const admitted = Array.isArray(revision.admittedDirectives) ? revision.admittedDirectives.map(record) : null;
  const active = admitted?.filter(d => !d.validUntil || Date.parse(String(d.validUntil)) > Date.now());
  const activeObjective = active?.filter(d => d.kind === "WORKING_OBJECTIVE").at(-1);
  const activeConstraints = active?.flatMap(d => d.kind === "CONSTRAINT" ? [String(d.quote)] : Array.isArray(d.constraints) ? d.constraints.map(String) : []);
  const correctionActive = typeof revision.until !== "string" || Date.parse(revision.until) > Date.now();
  const accepted = draft.acceptedJson ? { ...record(draft.acceptedJson) } as unknown as IntakeAcceptedFields : null;
  const understandingHash = typeof draft.understandingHash === "string" ? draft.understandingHash : null;
  const userRevisionHash = typeof draft.userRevisionHash === "string" ? jsonHash({ hash: draft.userRevisionHash,
    effective: admitted ? admitted.map(d => ({ commandId: d.commandId, active: !d.validUntil || Date.parse(String(d.validUntil)) > Date.now() })) : correctionActive }) : null;
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
    model: { used: ready, provider: ready ? String(record(draft.previewJson).provider ?? "UNKNOWN") : null,
      reason: ready ? null : typeof record(draft.previewJson).failureCode === "string" ? String(record(draft.previewJson).failureCode) : draft.understandingState === "NONE" ? "NOT_RUN" : null,
      usageUnknown: ready ? record(draft.previewJson).usageUnknown !== false : true },
    summary: ready ? understanding!.data.summary : null,
    statements,
    suggested: ready ? { ...understanding!.data.suggested } as IntakeAcceptedFields : null,
    constraints: ready ? understanding!.data.constraints.map(c => ({ text: c.text, basis: c.basis, materialId: c.materialId ?? null }))
      : (correctionActive && Array.isArray(revision.constraints) ? revision.constraints as string[] : []).map(text => ({ text, basis: "STATED" as const, materialId: null })),
    unknowns: ready ? understanding!.data.unknowns : [],
    successCriteria: ready ? understanding!.data.successCriteria : [],
    nextQuestion: ready ? understanding!.data.nextQuestion : null,
    correction: {
      appliedObjective: active ? activeObjective ? String(activeObjective.quote) : null : correctionActive && typeof revision.appliedObjective === "string" ? revision.appliedObjective : null,
      constraints: activeConstraints ?? (correctionActive && Array.isArray(revision.constraints) ? revision.constraints as string[] : []),
      until: active ? activeObjective?.validUntil ? String(activeObjective.validUntil) : null : typeof revision.until === "string" ? revision.until : null,
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
  if (draft.status === "CONFIRMED" && (!draft.projectId || !await db.project.findFirst({ where: { id: draft.projectId, deletionRequestedAt: null, memberships: { some: { userId: actor.userId } } } })))
    throw new AppError("PROJECT_NOT_FOUND", "原项目已不可访问，不能读取其临时材料副本", 404);
  if (draft.status === "WITHDRAWN" || draft.withdrawnAt) throw new AppError("INTAKE_WITHDRAWN", "这份材料预览已撤回", 410);
  if (draft.status === "EXPIRED" || +draft.expiresAt <= Date.now())
    throw new AppError("INTAKE_EXPIRED", "材料预览已到期，原件已进入清理", 410);
  return { preview: await buildPreviewFrom(draft.id), confirmedProjectId: draft.projectId, processingConsent: record(draft.processingJson).consent === true,
    expiresAt: draft.expiresAt.toISOString(), canConfirm: ["DRAFT", "PREVIEW_READY", "FAILED", "UNDERSTANDING"].includes(draft.status) && +draft.expiresAt > Date.now() };
}

/**
 * 确认建项。服务端重新核对归属、会话、草稿修订、材料 hash、预览 hash 与接受字段；
 * 前端按钮状态不是凭据。响应丢失后同 requestId 重放返回同一个项目。
 */
export async function confirmIntake(actor: ConversationActor, draftId: string, raw: unknown) {
  const input = confirmSchema.parse(raw);
  return withDraftLock(actor, draftId, async (tx, draft) => {
    const acceptedHash = acceptedHashOf(input.accepted);
    if (+draft.expiresAt <= Date.now()) throw new AppError("INTAKE_EXPIRED", "临时材料已到期，请从原项目继续", 410);
    if (draft.status === "CONFIRMED") {
      const saved = record(draft.confirmRequestJson);
      if (saved.requestId !== input.requestId || saved.acceptedHash !== acceptedHash || saved.previewHash !== input.previewHash || saved.revision !== input.expectedRevision)
        throw new AppError("IDEMPOTENCY_CONFLICT", "原确认已绑定另一版内容，请读取原项目", 409);
      const project = draft.projectId && await tx.project.findFirst({ where: { id: draft.projectId, deletionRequestedAt: null,
        memberships: { some: { userId: actor.userId, role: "OWNER" } } } });
      if (!project) throw new AppError("PROJECT_NOT_FOUND", "原项目已不可访问，不会重新创建", 404);
      return { projectId: project.id, replayed: true, preview: await buildPreviewFrom(draft.id, tx) };
    }
    assertOpen(draft);
    const preview = await buildPreviewFrom(draft.id, tx);
    if (draft.revision !== input.expectedRevision) throw new AppError("INTAKE_CHANGED", "预览已更新，请重新核对", 409);
    if (preview.previewHash !== input.previewHash) throw new AppError("INTAKE_PREVIEW_STALE", "理解或接受字段已变化，请重新核对", 409);
    if (!preview.materials.length) throw new AppError("INTAKE_MATERIALS_REQUIRED", "确认前至少要有一份材料", 422);
    const created = await createOwnedProjectInTx(tx, { ...input.accepted, deadline: input.accepted.deadline ?? null,
      requestId: input.requestId }, actor.userId, input.requestId, {
      sessionId: actor.sessionId, provider: "project-intake-confirm-v1",
      hashExtra: { draftId, revision: preview.revision, materialsHash: preview.materialsHash, previewHash: preview.previewHash, acceptedHash },
      resultExtra: { draftId }, traceExtra: { purpose: "INTAKE_CONFIRM", draftId, materialsHash: preview.materialsHash, previewHash: preview.previewHash, acceptedHash },
    });
    // 只接续用户亲自说出的、仍有效的 literal 指引；模型建议与解释候选不成为指令。
    const controls = record(draft.userRevisionJson);
    const pendingDirectives = Array.isArray(controls.admittedDirectives) ? controls.admittedDirectives.map(record) : [];
    const applicable = pendingDirectives.filter(d => ["WORKING_OBJECTIVE", "CONSTRAINT"].includes(String(d.kind)) &&
      typeof d.quote === "string" && (!d.validUntil || Date.parse(String(d.validUntil)) > Date.now()));
    if (applicable.length) {
      const conversation = await createConversationInTx(actor, { requestId: `intake:${draft.id}`, scope: "PROJECT", projectId: created.project.id, title: "项目材料核对" }, tx);
      for (const d of applicable) {
        const view = await effectiveContinuity(actor.userId, { projectId: created.project.id }, tx);
        await admitDirectiveInTx(actor, { commandId: `intake:${jsonHash({ draftId: draft.id, command: d.commandId })}`, expectedSeq: view.seq,
          scope: { projectId: created.project.id }, operation: "SET", quote: d.quote, admission: "LITERAL", timezone: INTAKE_SCOPE_TIMEZONE,
          ...(d.validUntil ? { validUntil: d.validUntil } : {}) }, tx, { conversationId: conversation.id, requestId: input.requestId });
      }
    }
    await tx.projectIntakeDraft.update({ where: { id: draftId }, data: { status: "CONFIRMED", projectId: created.project.id,
      acceptedJson: json(input.accepted), confirmedAt: new Date(), confirmRequestJson: json({ requestId: input.requestId,
        acceptedHash, previewHash: preview.previewHash, revision: preview.revision, materialsHash: preview.materialsHash }) } });
    return { projectId: created.project.id, replayed: created.replayed, preview: await buildPreviewFrom(draftId, tx) };
  });
}

/**
 * 材料同步：每一份材料单独记录真实状态。
 *
 * 这是数据库提交之后的第二阶段。附件写盘与数据库从来不是一个原子操作，
 * 所以失败时保留已建项目、已同步部分和可恢复入口——绝不重复建项。
 */
export async function syncIntakeMaterials(actor: ConversationActor, draftId: string) {
  await assertSession(actor);
  const draft = await loadDraft(actor, draftId);
  if (draft.status !== "CONFIRMED" || !draft.projectId) throw new AppError("INTAKE_NOT_CONFIRMED", "材料还没有对应的项目", 409);
  const projectId = draft.projectId;
  async function guard(tx: Tx, materialId?: string, token?: string) {
    await assertSession(actor, tx);
    const current = await loadDraft(actor, draftId, tx);
    if (current.status !== "CONFIRMED" || +current.expiresAt <= Date.now()) throw new AppError("INTAKE_CLOSED", "临时材料已失效", 410);
    if (!await tx.project.findFirst({ where: { id: projectId, deletionRequestedAt: null, memberships: { some: { userId: actor.userId, role: "OWNER" } } } }))
      throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化", 404);
    if (materialId) {
      const material = await tx.projectIntakeMaterial.findUniqueOrThrow({ where: { id: materialId } });
      if (record(material.syncJson).token !== token) throw new AppError("INTAKE_SYNC_SUPERSEDED", "同步责任已变化，未继续旧请求", 409);
    }
  }
  await guard(db);
  const materials = await db.projectIntakeMaterial.findMany({ where: { draftId }, orderBy: { ordinal: "asc" } });
  const results: Array<{ materialId: string; state: string; captureId?: string; attachmentId?: string; error?: string }> = [];
  for (const original of materials) {
    const token = crypto.randomUUID();
    const claim = await withDraftLock(actor, draftId, async (tx) => {
      await guard(tx);
      const m = await tx.projectIntakeMaterial.findUniqueOrThrow({ where: { id: original.id } }), sync = record(m.syncJson);
      if (sync.state === "SYNCED" || sync.state === "PROCESSING" && Number(sync.leaseUntil) > Date.now()) return { m, claimed: false };
      let attempt = Number(sync.attempt ?? 0);
      if (m.kind === "TEXT" && sync.state === "FAILED") {
        const prior = await tx.agentRun.findUnique({ where: { provider_externalRequestId: { provider: "intake-local-import-v1",
          externalRequestId: `${projectId}:intake:${draftId}:${m.id}:${m.revision}:${attempt}` } } });
        if (prior?.status === "FAILED") attempt++;
      }
      await tx.projectIntakeMaterial.update({ where: { id: m.id }, data: { syncJson: json({ ...sync, state: "PROCESSING", token, attempt, leaseUntil: Date.now()+60000 }) } });
      return { m: { ...m, syncJson: { ...sync, state: "PROCESSING", token, attempt } }, claimed: true };
    });
    const m = claim.m, sync = record(m.syncJson);
    if (!claim.claimed) { results.push({ materialId: m.id, state: String(sync.state), ...(typeof sync.captureId === "string" ? { captureId: sync.captureId } : {}),
      ...(typeof sync.attachmentId === "string" ? { attachmentId: sync.attachmentId } : {}) }); continue; }
    try {
      const beforeWrite = (tx: Prisma.TransactionClient) => guard(tx, m.id, token);
      let captureId: string | undefined, attachmentId: string | undefined;
      if (m.kind === "TEXT") {
        if (!m.rawText) throw new AppError("INTAKE_MATERIAL_LOST", "文本已清理，无法再同步", 410);
        const capture = await processCaptureWithRequest(projectId, m.rawText, "项目材料", {
          requestId: `intake:${draftId}:${m.id}:${m.revision}:${Number(sync.attempt ?? 0)}`, provider: "intake-local-import-v1", allowCloud: false, beforeSave: beforeWrite });
        captureId = capture.card.captureId ?? undefined;
      } else {
        if (!m.storageKey) throw new AppError("INTAKE_MATERIAL_LOST", "原件已清理，无法再同步", 410);
        const buffer = await readAttachmentFile(m.storageKey);
        const uploaded = await processAttachmentUpload({ projectId, fileName: m.fileName ?? "材料", mimeType: m.mimeType ?? "application/octet-stream", buffer },
          { beforeWrite, allowCloud: false, extractedText: m.rawText });
        attachmentId = uploaded.attachment.id;
      }
      let cleanupFailed = false;
      if (m.storageKey) { try { await deleteAttachmentFile(m.storageKey); } catch { cleanupFailed = true; } }
      await withDraftLock(actor, draftId, async tx => {
        await guard(tx, m.id, token);
        await tx.projectIntakeMaterial.update({ where: { id: m.id }, data: { rawText: null,
          storageKey: cleanupFailed ? m.storageKey : null, cleanupState: cleanupFailed ? "FAILED" : m.kind === "TEXT" ? "PURGED" : "DELETED", cleanedAt: cleanupFailed ? null : new Date(),
          syncJson: json({ state: "SYNCED", captureId: captureId ?? null, attachmentId: attachmentId ?? null,
            at: new Date().toISOString(), ...(cleanupFailed ? { error: "材料已接入项目，临时原件仍待清理" } : {}) }) } });
      });
      results.push({ materialId: m.id, state: "SYNCED", ...(captureId ? { captureId } : {}), ...(attachmentId ? { attachmentId } : {}) });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "材料同步中断";
      await withDraftLock(actor, draftId, async tx => {
        await guard(tx, m.id, token);
        await tx.projectIntakeMaterial.update({ where: { id: m.id }, data: { syncJson: json({ state: "FAILED", token, attempt: Number(sync.attempt ?? 0),
          error: message, code: error instanceof AppError ? error.code : "SYNC_FAILED", at: new Date().toISOString() }) } });
      }).catch(() => undefined);
      results.push({ materialId: m.id, state: "FAILED", error: message });
    }
  }
  return { projectId, materials: results, pending: results.filter(r => r.state !== "SYNCED").length, preview: await buildPreviewFrom(draftId) };
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
export async function cleanupIntakeDraftFiles(draftId: string, ownerUserId: string, now = new Date()) {
  const draft = await db.projectIntakeDraft.findFirst({ where: { id: draftId, ownerUserId } });
  if (!draft) return { cleaned: 0, failed: 0 };
  if (!["EXPIRED", "WITHDRAWN"].includes(draft.status)) throw new AppError("INTAKE_CLEANUP_NOT_CLOSED", "材料仍在使用，未执行清理", 409);
  let cleaned = 0, failed = 0;
  let files: string[] = [];
  try { files = await listProjectAttachmentFiles(`intake-${draft.id}`); } catch { failed++; }
  const materials = await db.projectIntakeMaterial.findMany({ where: { draftId: draft.id } });
  const keys = [...new Set([...files, ...materials.flatMap(m => m.storageKey ? [m.storageKey] : [])])];
  const removed = new Set<string>();
  for (const key of keys) {
    try { await deleteAttachmentFile(key); removed.add(key); cleaned++; } catch { failed++; }
  }
  await db.$transaction(async tx => {
    await tx.projectIntakeDraft.updateMany({ where: { id: draftId }, data: { revision: { increment: 0 } } });
    const current = await tx.projectIntakeDraft.findUniqueOrThrow({ where: { id: draftId } });
    for (const m of materials) {
      const deleted = !m.storageKey || removed.has(m.storageKey);
      await tx.projectIntakeMaterial.update({ where: { id: m.id }, data: { rawText: null,
        ...(deleted ? { storageKey: null, fileName: null, extractionError: null } : {}),
        cleanupState: deleted ? "DELETED" : "FAILED", cleanedAt: deleted ? now : null } });
    }
    const attempts = current.cleanupAttempts + 1;
    await tx.projectIntakeDraft.update({ where: { id: draftId }, data: {
      understandingJson: Prisma.DbNull, understandingHash: null, understandingState: "NONE",
      previewJson: json({}), userRevisionJson: json({}), userRevisionHash: null, acceptedJson: Prisma.DbNull,
      cleanupAttempts: attempts,
      processingJson: json({ ...record(current.processingJson), cleanup: { at: now.toISOString(), files: keys.length,
        cleaned, failed, complete: failed === 0, nextAttemptAt: failed ? +now + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)) : null } }),
    } });
  });
  return { cleaned, failed };
}

/** 原 Worker 有界重试；EXPIRED 不丢责任，失败退避，成功退出队列。 */
export async function expireIntakeDrafts(now = new Date(), limit = 5) {
  const ids = await db.$queryRaw<Array<{ id: string }>>`SELECT d.id FROM "ProjectIntakeDraft" d
    LEFT JOIN "Project" p ON p.id=d."projectId"
    WHERE (d.status IN ('EXPIRED','WITHDRAWN') OR
      (CASE WHEN typeof(d."expiresAt")='integer' THEN d."expiresAt"<=${+now} ELSE julianday(d."expiresAt")<=julianday(${now.toISOString()}) END) OR
      (d.status='CONFIRMED' AND (p.id IS NULL OR p."deletionRequestedAt" IS NOT NULL)))
    AND COALESCE(json_extract(d."processingJson", '$.cleanup.complete'),0) != 1
    AND COALESCE(json_extract(d."processingJson", '$.cleanup.nextAttemptAt'),0)<=${+now}
    ORDER BY d."updatedAt" ASC LIMIT ${Math.max(1, Math.min(20, limit))}`;
  const results: Array<{ draftId: string; state: string; error?: string }> = [];
  for (const { id } of ids) {
    try {
      const draft = await db.$transaction(async tx => {
        await tx.projectIntakeDraft.updateMany({ where: { id }, data: { revision: { increment: 0 } } });
        const current = await tx.projectIntakeDraft.findUniqueOrThrow({ where: { id } });
        // 先封闭消费，再做文件 I/O；迟到发布必须被同一草稿锁挡住。
        if (current.status !== "WITHDRAWN") await tx.projectIntakeDraft.update({ where: { id }, data: { status: "EXPIRED" } });
        return current;
      });
      const { failed } = await cleanupIntakeDraftFiles(id, draft.ownerUserId, now);
      results.push({ draftId: id, state: failed ? "PARTIAL" : "CLEANED" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "清理失败";
      results.push({ draftId: id, state: "FAILED", error: message });
    }
  }
  return results;
}

/** 旧预览/旧确认的版本化读取：客户端只能拿到当前 revision 与预览 hash。 */
export async function readIntakeForClient(actor: ConversationActor, draftId: string) {
  return readIntake(actor, draftId);
}

export const intakeTesting = { intakeScope, materialTextFor, quoteIsVerbatim };





