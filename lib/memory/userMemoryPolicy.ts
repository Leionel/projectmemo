import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Tx } from "@/lib/conversation/repository";
import { json, jsonHash } from "@/lib/mission/contracts";

/**
 * 账户个人记忆策略：一行 per user；读取资格与处理许可的服务端权威。
 * 关闭 useInContextEnabled 不等于删除；privacyRevision 是所有个人上下文读集的同步失效水位。
 * 首批：显式保存始终可用；候选推断默认关闭；云处理个人正文默认关闭（J29）。
 */
export const USER_MEMORY_POLICY_VERSION = "user-memory-policy-v1";

export type UserMemoryPolicyRow = {
  ownerUserId: string; useInContextEnabled: boolean; explicitCaptureEnabled: boolean;
  candidateInferenceEnabled: boolean; cloudProcessingEnabled: boolean;
  settingsVersion: number; privacyRevision: number; extractionNotBefore: Date | null;
};

/** 在既有写事务内读取或零初始化策略；调用方持有原 User 写锁。 */
export async function policyInTx(tx: Tx, userId: string): Promise<UserMemoryPolicyRow> {
  const existing = await tx.userMemoryPolicy.findUnique({ where: { ownerUserId: userId } });
  if (existing) return existing;
  return tx.userMemoryPolicy.create({ data: { ownerUserId: userId } });
}

export async function readPolicy(userId: string, tx: Tx = db): Promise<UserMemoryPolicyRow | null> {
  return tx.userMemoryPolicy.findUnique({ where: { ownerUserId: userId } });
}

/** 条目当前内容的稳定指纹：修订 + 陈述 + 状态 + 条件一起变化才视为同一内容版本未变。 */
export function personalEntryContentHash(claim: {
  currentRevision: number; canonicalStatement: string; statusProjection: string; conditionsJson: unknown;
}): string {
  return jsonHash({ revision: claim.currentRevision, statement: claim.canonicalStatement,
    status: claim.statusProjection, conditions: claim.conditionsJson ?? {} });
}

export type PersonalMemoryReadSet = {
  version: string;
  policyVersion: number;
  privacyRevision: number;
  useInContextEnabled: boolean;
  items: Array<{ claimId: string; revision: number; contentHash: string }>;
  projectModes: Array<{ projectId: string; mode: string; version: number }>;
  nextBoundary: string | null;
};

/** 空读集也绑定策略水位：策略变化必须让"当时没有个人记忆"的旧选择结果失效。 */
export async function buildPersonalMemoryReadSet(userId: string, items: PersonalMemoryReadSet["items"],
  projectModes: PersonalMemoryReadSet["projectModes"], nextBoundary: string | null, tx: Tx = db): Promise<PersonalMemoryReadSet | null> {
  const policy = await readPolicy(userId, tx);
  if (!policy) return null;
  return { version: USER_MEMORY_POLICY_VERSION, policyVersion: policy.settingsVersion, privacyRevision: policy.privacyRevision,
    useInContextEnabled: policy.useInContextEnabled, items, projectModes, nextBoundary };
}

/**
 * 同步失效守卫：读集快照与当前状态不一致即抛 COGNITIVE_RECOORDINATE，
 * 由原 assertTurnCurrent / runner 断言点映射为 TURN_RECOORDINATE 进入原重协调；不重置预算。
 */
export async function assertPersonalMemoryReadSet(userId: string, snapshot: unknown, tx: Tx = db, now = new Date()): Promise<void> {
  if (!snapshot) return;
  const readSet = snapshot as PersonalMemoryReadSet;
  if (readSet.version !== USER_MEMORY_POLICY_VERSION) throw new AppError("COGNITIVE_RECOORDINATE", "个人记忆读集版本已变化，正在重新协调", 409);
  const policy = await readPolicy(userId, tx);
  if (!policy) throw new AppError("COGNITIVE_RECOORDINATE", "个人记忆策略已变化，正在重新协调", 409);
  if (policy.privacyRevision !== readSet.privacyRevision || policy.settingsVersion !== readSet.policyVersion ||
    policy.useInContextEnabled !== readSet.useInContextEnabled)
    throw new AppError("COGNITIVE_RECOORDINATE", "个人记忆使用策略已变化，正在重新协调", 409);
  for (const item of readSet.items) {
    const claim = await tx.agentClaim.findFirst({ where: { id: item.claimId, ownerUserId: userId, scopeType: "ACCOUNT" } });
    if (!claim) throw new AppError("COGNITIVE_RECOORDINATE", "一条个人记忆已不可用，正在重新协调", 409);
    if (claim.currentRevision !== item.revision || personalEntryContentHash(claim) !== item.contentHash)
      throw new AppError("COGNITIVE_RECOORDINATE", "一条个人记忆内容或状态已变化，正在重新协调", 409);
  }
  for (const mode of readSet.projectModes) {
    const membership = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId: mode.projectId } } });
    if (!membership || membership.personalMemoryMode !== mode.mode || membership.personalMemoryModeVersion !== mode.version)
      throw new AppError("COGNITIVE_RECOORDINATE", "项目个人记忆例外已变化，正在重新协调", 409);
  }
  if (readSet.nextBoundary && +new Date(readSet.nextBoundary) <= +now)
    throw new AppError("COGNITIVE_RECOORDINATE", "一条个人记忆已过有效边界，正在重新协调", 409);
}
