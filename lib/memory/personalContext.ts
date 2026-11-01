import { db } from "@/lib/db";
import type { Tx } from "@/lib/conversation/repository";
import { buildPersonalMemoryReadSet, personalEntryContentHash, readPolicy, type PersonalMemoryReadSet } from "./userMemoryPolicy";

/**
 * 个人上下文资格与选择：Conversation 与 Mission 两个原 Composer 共用。
 * 只返回当前有资格的条目；每条遗漏有原因，条目与读集一起裁剪。
 * 个人记忆不扩大 allowedProjectIds、researchScope、公开检索词、连接权限或工具白名单。
 */
export const PERSONAL_CONTEXT_VERSION = "personal-context-v1";
export const PERSONAL_CONTEXT_BUDGET = { maxItems: 6, maxCharacters: 2400 };

export type PersonalContextItem = {
  claimId: string; revision: number; contentHash: string; kind: string;
  statement: string; topics: string[]; expiresAt: string | null;
  authority: "USER_STATED_PREFERENCE";
  sourceClass: "ACCOUNT_EXPLICIT";
};

export type PersonalContextOmissionReason = "POLICY_OFF" | "PROJECT_ONLY" | "STATUS_UNAVAILABLE" | "EXPIRED" |
  "TOPIC_MISMATCH" | "PROCESSING_PERMISSION" | "BUDGET";

export type PersonalContextResult = {
  items: PersonalContextItem[];
  omissions: Array<{ claimId: string; reason: PersonalContextOmissionReason }>;
  coverage: { available: number; selected: number; complete: boolean };
  readSet: PersonalMemoryReadSet | null;
  processingAllowed: boolean;
  nextBoundary: string | null;
  usagePolicy: string;
};

export type PersonalContextInput = {
  purpose: "CONVERSATION" | "MISSION";
  projectIds: string[];
  conversationId?: string;
  missionId?: string;
  query: string;
  /** 当前模型是否为远端处理；个人正文仅在账户允许云处理或本地规则模式下进入上下文（J29）。 */
  remoteProcessing?: boolean;
  audience?: "PRIVATE_CHAT" | "MISSION_INTERNAL";
};

export async function resolvePersonalContext(userId: string, input: PersonalContextInput, tx: Tx = db,
  now = new Date()): Promise<PersonalContextResult> {
  const policy = await readPolicy(userId, tx);
  const omissions: PersonalContextResult["omissions"] = [];
  const usagePolicy = "个人偏好是用户确认的协作背景：不是项目事实、工具授权或业务批准；当前明确请求与项目约束优先。";
  if (!policy || !policy.useInContextEnabled) {
    const readSet = policy ? await buildPersonalMemoryReadSet(userId, [], await projectModes(tx, userId, input.projectIds), null, tx) : null;
    return { items: [], omissions, coverage: { available: 0, selected: 0, complete: true }, readSet,
      processingAllowed: false, nextBoundary: null, usagePolicy };
  }
  const projectIds = input.projectIds;
  // 路由前用途只允许不泄露项目内容的账户默认；这里条目为账户显式自述，不含项目派生内容（PM-2 晋升合同另加检查）。
  const modes = await projectModes(tx, userId, projectIds);
  const allowedByModes = modes.every(m => m.mode !== "PROJECT_ONLY");
  const claims = await tx.agentClaim.findMany({ where: { ownerUserId: userId, scopeType: "ACCOUNT",
    kind: { in: ["PREFERENCE", "BACKGROUND", "FOCUS"] } }, orderBy: { updatedAt: "desc" }, take: 64 });
  const processingAllowed = policy.cloudProcessingEnabled || input.remoteProcessing !== true;
  const queryTerms = new Set((input.query.toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []));
  const items: PersonalContextItem[] = [];
  let characters = 0;
  let nextBoundary: string | null = null;
  for (const claim of claims) {
    const conditions = claim.conditionsJson as { topics?: string[]; expiresAt?: string };
    if (!allowedByModes) { omissions.push({ claimId: claim.id, reason: "PROJECT_ONLY" }); continue; }
    if (!["ACTIVE", "PAUSED"].includes(claim.statusProjection)) { omissions.push({ claimId: claim.id, reason: "STATUS_UNAVAILABLE" }); continue; }
    const expiry = conditions?.expiresAt ? new Date(conditions.expiresAt) : null;
    if (expiry && +expiry <= +now) {
      omissions.push({ claimId: claim.id, reason: "EXPIRED" });
      if (!nextBoundary || +expiry < +new Date(nextBoundary)) nextBoundary = expiry.toISOString();
      continue;
    }
    if (expiry && (!nextBoundary || +expiry < +new Date(nextBoundary))) nextBoundary = expiry.toISOString();
    const topics = Array.isArray(conditions?.topics) ? conditions.topics as string[] : [];
    // PAUSED 的条目保留读集绑定（暂停也要让在途轮次重协调），但不进入模型上下文。
    if (claim.statusProjection !== "ACTIVE") { omissions.push({ claimId: claim.id, reason: "STATUS_UNAVAILABLE" }); continue; }
    if (topics.length && !topics.some(t => queryTerms.has(t.toLowerCase()) || input.query.toLowerCase().includes(t.toLowerCase()))) {
      omissions.push({ claimId: claim.id, reason: "TOPIC_MISMATCH" }); continue;
    }
    if (!processingAllowed) { omissions.push({ claimId: claim.id, reason: "PROCESSING_PERMISSION" }); continue; }
    const text = JSON.stringify({ statement: claim.canonicalStatement, kind: claim.kind });
    if (items.length >= PERSONAL_CONTEXT_BUDGET.maxItems || characters + text.length > PERSONAL_CONTEXT_BUDGET.maxCharacters) {
      omissions.push({ claimId: claim.id, reason: "BUDGET" }); continue;
    }
    items.push({ claimId: claim.id, revision: claim.currentRevision, contentHash: personalEntryContentHash(claim),
      kind: claim.kind, statement: claim.canonicalStatement, topics, expiresAt: conditions?.expiresAt ?? null,
      authority: "USER_STATED_PREFERENCE", sourceClass: "ACCOUNT_EXPLICIT" });
    characters += text.length;
  }
  const readSet = await buildPersonalMemoryReadSet(userId,
    claims.filter(c => ["ACTIVE", "PAUSED"].includes(c.statusProjection)).map(c => ({ claimId: c.id, revision: c.currentRevision, contentHash: personalEntryContentHash(c) })),
    modes, nextBoundary, tx);
  return { items, omissions, coverage: { available: claims.length, selected: items.length, complete: omissions.length === 0 },
    readSet, processingAllowed, nextBoundary, usagePolicy };
}

async function projectModes(tx: Tx, userId: string, projectIds: string[]) {
  if (!projectIds.length) return [];
  const memberships = await tx.projectMembership.findMany({ where: { userId, projectId: { in: projectIds } },
    select: { projectId: true, personalMemoryMode: true, personalMemoryModeVersion: true } });
  return memberships.map(m => ({ projectId: m.projectId, mode: m.personalMemoryMode, version: m.personalMemoryModeVersion }));
}

/** 本地/脚本 provider 不外发个人正文；真实远端模型需要账户云处理许可（J29）。 */
export function isLocalModelProvider(provider: string | null | undefined): boolean {
  if (!provider) return true;
  return /rule|mock|script|synthetic|fixture|project_state|local/i.test(provider);
}
