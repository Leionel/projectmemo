import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Tx } from "@/lib/conversation/repository";
import { json, jsonHash } from "@/lib/mission/contracts";
import { admitPersonalMemory } from "./personalAdmission";
import { policyInTx, personalEntryContentHash, buildPersonalMemoryReadSet } from "./userMemoryPolicy";
import { ACCOUNT_SCOPE_KEY } from "./scope";

/**
 * 账户个人记忆写路径：复用原 AgentClaim/Event 的修订、CAS、payloadHash 与 owner+requestId 幂等。
 * 与原项目 ClaimCorrection 的 controlSeq 解释链隔离：个人事件 controlSeq 保持为空。
 * 所有变更在原 User 写锁内同事务提交条目修订、控制回执、privacyRevision 与消费者失效。
 */
export const PERSONAL_KINDS = ["PREFERENCE", "BACKGROUND", "FOCUS"] as const;
export type PersonalKind = (typeof PERSONAL_KINDS)[number];

export type PersonalEntryView = {
  claimId: string; kind: string; statement: string; quote: string | null; status: string;
  conditions: { topics: string[]; expiresAt: string | null };
  revision: number; contentHash: string; createdAt: string; updatedAt: string;
};

const contentHash = (statement: string, conditions: unknown) => jsonHash({ statement, conditions: conditions ?? {} });

function entryView(claim: {
  id: string; kind: string; canonicalStatement: string; conditionsJson: unknown; currentRevision: number;
  statusProjection: string; createdAt: Date; updatedAt: Date;
}, quote: string | null): PersonalEntryView {
  return { claimId: claim.id, kind: claim.kind, statement: claim.canonicalStatement, quote,
    status: claim.statusProjection, revision: claim.currentRevision, contentHash: personalEntryContentHash(claim),
    conditions: recordConditions(claim.conditionsJson), createdAt: claim.createdAt.toISOString(), updatedAt: claim.updatedAt.toISOString() };
}

function recordConditions(raw: unknown): { topics: string[]; expiresAt: string | null } {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const topics = Array.isArray(value.topics) ? value.topics.filter((t): t is string => typeof t === "string").slice(0, 6) : [];
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : null;
  return { topics, expiresAt };
}

export type PersonalCommandInput = {
  requestId: string; operation: "ADD_EXPLICIT" | "ADD_FROM_EXPRESSION" | "UPDATE" | "PAUSE" | "RESUME" | "WITHDRAW" | "DELETE" | "DELETE_ALL";
  expectedPolicyVersion?: number; expectedRevision?: number;
  claimId?: string; quote?: string; kind?: string; topics?: string[]; expiresAt?: string | null;
};

export type PersonalCommandResult = {
  requestId: string; receiptId: string; operation: string;
  claimId: string | null; revision: number | null; status: string | null;
  policyVersion: number; privacyRevision: number;
  replayed: boolean; admissionStatus?: string; admissionReason?: string; admissionQuestion?: string;
  purge?: Record<string, unknown>;
};

/** 同一 requestId 换载荷必须拒绝；同载荷回放返回原操作回执，不重复变更。 */
async function replayOrThrow(tx: Tx, userId: string, requestId: string, payloadHash: string) {
  const prior = await tx.userMemoryControlReceipt.findUnique({ where: { ownerUserId_requestId: { ownerUserId: userId, requestId } } });
  if (!prior) return null;
  if (prior.payloadHash !== payloadHash) throw new AppError("REQUEST_CONFLICT", "该请求编号已用于其他内容", 409);
  return prior;
}

async function loadPersonalClaim(tx: Tx, userId: string, claimId: string) {
  if (!claimId) throw new AppError("CLAIM_REQUIRED", "缺少目标条目", 422);
  const claim = await tx.agentClaim.findFirst({ where: { id: claimId, ownerUserId: userId, scopeType: "ACCOUNT" } });
  if (!claim) throw new AppError("CLAIM_NOT_FOUND", "个人记忆条目不存在或不可访问", 404);
  return claim;
}

function assertManageable(claim: { statusProjection: string }, operation: string) {
  if (claim.statusProjection === "DELETED") throw new AppError("CLAIM_DELETED", "该条目已删除；重新添加会形成新的记忆事件", 409);
  if (operation === "PAUSE" && claim.statusProjection !== "ACTIVE")
    throw new AppError("CLAIM_STATE_CHANGED", "只有使用中的条目可以暂停", 409);
  if (operation === "RESUME" && !["PAUSED", "WITHDRAWN"].includes(claim.statusProjection))
    throw new AppError("CLAIM_STATE_CHANGED", "该条目当前状态不支持恢复", 409);
  if (["UPDATE", "WITHDRAW", "DELETE"].includes(operation) && claim.statusProjection === "WITHDRAWN")
    throw new AppError("CLAIM_STATE_CHANGED", "该条目已撤回；如需继续使用请先恢复", 409);
}

export async function commandPersonalMemory(userId: string, raw: PersonalCommandInput): Promise<PersonalCommandResult> {
  const requestId = raw.requestId.trim();
  if (!requestId || requestId.length > 128) throw new AppError("REQUEST_ID_INVALID", "请求编号缺失或过长", 422);
  const kind = raw.kind ? (raw.kind as PersonalKind) : undefined;
  if (kind && !PERSONAL_KINDS.includes(kind)) throw new AppError("KIND_INVALID", "不支持的条目类别", 422);
  const quote = raw.quote?.trim();
  if (["ADD_EXPLICIT", "ADD_FROM_EXPRESSION", "UPDATE"].includes(raw.operation)) {
    if (!quote) throw new AppError("QUOTE_REQUIRED", "请提供要记住的原文", 422);
    if (quote.length > 2000) throw new AppError("QUOTE_TOO_LONG", "原文过长，请精简后保存", 422);
    const admission = admitPersonalMemory(quote);
    if (admission.status === "REJECTED_FOR_MEMORY") throw new AppError("MEMORY_REJECTED", admission.reason, 422);
    if (admission.status === "NOT_USER_MEMORY_COMMAND") throw new AppError("MEMORY_NOT_USER_COMMAND", admission.reason, 422);
    if (raw.operation === "ADD_FROM_EXPRESSION" && admission.status !== "DIRECT_APPLIED")
      return { requestId, receiptId: "", operation: raw.operation, claimId: null, revision: null, status: "NOT_SAVED",
        policyVersion: 0, privacyRevision: 0, replayed: false, admissionStatus: admission.status, admissionReason: admission.reason, admissionQuestion: admission.question };
    if (raw.operation === "ADD_EXPLICIT" && admission.status === "SESSION_ONLY")
      return { requestId, receiptId: "", operation: raw.operation, claimId: null, revision: null, status: "NOT_SAVED",
        policyVersion: 0, privacyRevision: 0, replayed: false, admissionStatus: admission.status, admissionReason: admission.reason };
  }
  if (raw.expiresAt && +new Date(raw.expiresAt) <= Date.now()) throw new AppError("EXPIRY_INVALID", "有效边界已过期", 422);
  const conditions = { topics: (raw.topics ?? []).slice(0, 6), ...(raw.expiresAt ? { expiresAt: raw.expiresAt } : {}) };
  const payloadHash = jsonHash(raw);
  return db.$transaction(async tx => {
    // 原 User 写锁：SQLite 行级写锁串行化同一账户的并发记忆修改。
    await tx.user.updateMany({ where: { id: userId }, data: { continuitySeq: { increment: 0 } } });
    const replay = await replayOrThrow(tx, userId, requestId, payloadHash);
    if (replay) {
      const version = replay.resultVersionJson as Record<string, unknown>;
      return { requestId, receiptId: replay.id, operation: replay.operation, claimId: (version.claimId as string) ?? null,
        revision: (version.revision as number) ?? null, status: (version.status as string) ?? null,
        policyVersion: (version.policyVersion as number) ?? 0, privacyRevision: (version.privacyRevision as number) ?? 0,
        replayed: true };
    }
    const policy = await policyInTx(tx, userId);
    if (raw.expectedPolicyVersion !== undefined && raw.expectedPolicyVersion !== policy.settingsVersion)
      throw new AppError("POLICY_CHANGED", "记忆使用策略已变化，请核对后重试", 409);
    let claimId: string | null = null, revision: number | null = null, status: string | null = null, purge: Record<string, unknown> = {};
    if (raw.operation === "ADD_EXPLICIT" || raw.operation === "ADD_FROM_EXPRESSION") {
      if (!policy.explicitCaptureEnabled) throw new AppError("CAPTURE_DISABLED", "当前策略未允许保存新的个人记忆", 409);
      const origin = { kind: "USER_ENTRY", via: raw.operation, requestId, admission: raw.operation === "ADD_FROM_EXPRESSION" ? "EXPLICIT_EXPRESSION" : "FORM" };
      const created = await tx.agentClaim.create({ data: { ownerUserId: userId, scopeType: "ACCOUNT", projectId: null,
        scopeKey: ACCOUNT_SCOPE_KEY, conversationId: null, missionId: null, originKey: jsonHash({ ...origin, at: new Date().toISOString() }),
        originJson: json(origin), kind: kind ?? "PREFERENCE", canonicalStatement: quote!, conditionsJson: json(conditions),
        statusProjection: "ACTIVE" } });
      claimId = created.id; revision = 1; status = "ACTIVE";
      await tx.agentClaimEvent.create({ data: { claimId: created.id, ownerUserId: userId, revision: 1, requestId, payloadHash,
        eventKind: "PERSONAL_ADD", actorKind: "USER", userQuote: quote, targetHash: contentHash(quote!, conditions),
        evidenceManifestJson: [], assessmentJson: json({ admission: origin.admission }) } });
    } else if (raw.operation === "DELETE_ALL") {
      // 清空全部：逐条清除正文并停用；不要求目标条目，提取起点同步推进。
      const rows = await tx.agentClaim.findMany({ where: { ownerUserId: userId, scopeType: "ACCOUNT", statusProjection: { not: "DELETED" } }, select: { id: true } });
      for (const row of rows) {
        await tx.agentClaimEvent.updateMany({ where: { claimId: row.id }, data: { userQuote: null, modelInterpretation: null } });
        await tx.agentClaim.update({ where: { id: row.id }, data: { canonicalStatement: "", conditionsJson: json({}), statusProjection: "DELETED", currentRevision: { increment: 1 } } });
      }
      purge = { canonicalStatementPurged: true, eventQuotesPurged: true, clearedCount: rows.length, extractionNotBeforeSet: true };
    } else {
      const claim = await loadPersonalClaim(tx, userId, raw.claimId!);
      assertManageable(claim, raw.operation);
      if (raw.expectedRevision !== undefined && claim.currentRevision !== raw.expectedRevision)
        throw new AppError("CLAIM_CHANGED", "这条记忆已在另一端更新，请重读后操作", 409);
      claimId = claim.id;
      const eventKind = { UPDATE: "PERSONAL_UPDATE", PAUSE: "PERSONAL_PAUSE", RESUME: "PERSONAL_RESUME",
        WITHDRAW: "PERSONAL_WITHDRAW", DELETE: "PERSONAL_DELETE", DELETE_ALL: "PERSONAL_DELETE" }[raw.operation]!;
      revision = claim.currentRevision + 1;
      const nextStatement = raw.operation === "UPDATE" ? quote! : claim.canonicalStatement;
      const nextConditions = raw.operation === "UPDATE" ? conditions : claim.conditionsJson;
      status = { UPDATE: "ACTIVE", PAUSE: "PAUSED", RESUME: "ACTIVE", WITHDRAW: "WITHDRAWN", DELETE: "DELETED", DELETE_ALL: "DELETED" }[raw.operation]!;
      if (raw.operation === "UPDATE") {
        await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: userId, revision, requestId, payloadHash,
          eventKind, actorKind: "USER", userQuote: quote, targetHash: contentHash(nextStatement, nextConditions),
          evidenceManifestJson: [], assessmentJson: {} } });
        await tx.agentClaim.update({ where: { id: claim.id }, data: { currentRevision: revision, canonicalStatement: nextStatement, conditionsJson: json(nextConditions), statusProjection: status } });
      } else {
        // 删除：正文立即清除（条目与历史事件都不再保留原文），仅保留不含正文的操作标记。
        if (raw.operation === "DELETE") {
          await tx.agentClaimEvent.updateMany({ where: { claimId: claim.id }, data: { userQuote: null, modelInterpretation: null } });
          await tx.agentClaim.update({ where: { id: claim.id }, data: { canonicalStatement: "", conditionsJson: json({}), statusProjection: "DELETED" } });
          purge = { canonicalStatementPurged: true, eventQuotesPurged: true, note: "正文已清除；此前已外发内容由原业务系统管理" };
        } else {
          await tx.agentClaim.update({ where: { id: claim.id }, data: { currentRevision: revision, statusProjection: status } });
        }
        await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: userId, revision, requestId, payloadHash,
          eventKind, actorKind: "USER", userQuote: null,
          targetHash: contentHash(nextStatement, nextConditions), evidenceManifestJson: [], assessmentJson: {} } });
      }
    }
    // 三类变更的统一同步水位：privacyRevision 先挡旧内容的新派发与新发布，失效扇出进入原重协调。
    const privacyBump = ["ADD_EXPLICIT", "ADD_FROM_EXPRESSION", "UPDATE", "PAUSE", "RESUME", "WITHDRAW", "DELETE", "DELETE_ALL"].includes(raw.operation);
    const updatedPolicy = await tx.userMemoryPolicy.update({ where: { ownerUserId: userId },
      data: { ...(raw.operation === "DELETE_ALL" ? { extractionNotBefore: new Date() } : {}), privacyRevision: { increment: privacyBump ? 1 : 0 } } });
    const eventIds = await tx.agentClaimEvent.findMany({ where: { ownerUserId: userId, requestId }, select: { id: true } }).then(rows => rows.map(r => r.id));
    const { invalidatePersonalMemoryConsumers } = await import("./personalInvalidation");
    await invalidatePersonalMemoryConsumers(tx, userId, eventIds);
    const receipt = await tx.userMemoryControlReceipt.create({ data: { ownerUserId: userId, requestId, operation: raw.operation,
      targetClaimId: claimId, payloadHash, resultVersionJson: json({ claimId, revision, status, policyVersion: updatedPolicy.settingsVersion,
        privacyRevision: updatedPolicy.privacyRevision }), purgeJson: json(purge) } });
    return { requestId, receiptId: receipt.id, operation: raw.operation, claimId, revision, status,
      policyVersion: updatedPolicy.settingsVersion, privacyRevision: updatedPolicy.privacyRevision, replayed: false, purge };
  });
}

/** 列表只返回本账户当前有资格视图；删除行不返回正文。 */
export async function listPersonalMemory(userId: string, filter: { includeStopped?: boolean } = {}) {
  const rows = await db.agentClaim.findMany({ where: { ownerUserId: userId, scopeType: "ACCOUNT", kind: { in: [...PERSONAL_KINDS] },
    ...(filter.includeStopped ? {} : { statusProjection: { in: ["ACTIVE", "PAUSED"] } }) }, orderBy: { updatedAt: "desc" }, take: 100 });
  return { items: rows.map(row => entryView(row, null)), coverage: { loaded: rows.length, hasMore: rows.length >= 100 } };
}

export async function personalEntryDetail(userId: string, claimId: string) {
  const claim = await loadPersonalClaim(db, userId, claimId);
  const events = await db.agentClaimEvent.findMany({ where: { claimId: claim.id, ownerUserId: userId }, orderBy: { revision: "asc" } });
  const history = events.map(e => ({ revision: e.revision, eventKind: e.eventKind, at: e.createdAt.toISOString(),
    quote: e.userQuote, actorKind: e.actorKind }));
  const origin = claim.originJson as { kind?: string; via?: string };
  return { entry: entryView(claim, events.find(e => e.eventKind === "PERSONAL_ADD")?.userQuote ?? null),
    source: { kind: "USER_ENTRY", description: origin.via === "ADD_FROM_EXPRESSION" ? "你在对话或输入中明确提出，按明确范围保存。" : "你在\"我的记忆\"中主动添加。",
      formedAt: claim.createdAt.toISOString() },
    history };
}
