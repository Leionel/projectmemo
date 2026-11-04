import { db } from "@/lib/db";

/**
 * 回答“这次参考了哪些记忆”的只读投影。
 *
 * 来源是该轮 readManifest 中服务端已冻结的三类读集（个人偏好、项目判断、项目经验）：它们是
 * 提供给本轮调查的上下文，不代表模型逐条采用，也不改变任何记忆状态。读取时按当前账号与项目成员
 * 关系重新过滤；已删除的个人条目不再返回原文，之后有修订的条目标出“之后已更新”。
 */
export type MemoryUseItem = { kind: "PERSONAL" | "JUDGMENT" | "EXPERIENCE"; id: string; projectId: string | null; title: string; stateLabel: string; active: boolean; changedSince: boolean };
export type MemoryUse = { items: MemoryUseItem[] };

const personalLabels: Record<string, string> = { ACTIVE: "使用中", PAUSED: "已暂停使用", WITHDRAWN: "已撤回", DELETED: "已删除" };
const judgmentLabels: Record<string, string> = { PROPOSED: "待核实", INVESTIGATING: "调查中", SUPPORTED: "有条件支持", REFUTED: "发现反例", INCONCLUSIVE: "尚无结论", EXPIRED: "需要重核", RESTRICTED: "暂不可读" };
const experienceLabels: Record<string, string> = { ACTIVE: "可参考", CANDIDATE: "候选经验", REVOKED: "已撤销" };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const num = (value: unknown) => typeof value === "number" ? value : null;

/** `projectIds` 可由同一次读取复用，避免每条消息重复查询成员关系。 */
export async function readMemoryUse(userId: string, manifestJson: unknown, projectIds?: () => Promise<string[]>): Promise<MemoryUse | null> {
  const manifest = record(manifestJson);
  const personalRefs = list(record(manifest.personalMemoryReadSet).items).map(r => ({ id: text(r.claimId), revision: num(r.revision) })).filter(r => r.id);
  const judgmentRefs = list(manifest.cognitiveReadSet).map(r => ({ id: text(r.claimId), revision: num(r.revision) })).filter(r => r.id);
  const experienceRefs = list(manifest.experienceReadSet).map(r => ({ id: text(r.experienceId), version: num(r.version) })).filter(r => r.id);
  if (!personalRefs.length && !judgmentRefs.length && !experienceRefs.length) return null;

  const projects = projectIds ? await projectIds() : (await db.projectMembership.findMany({ where: { userId }, select: { projectId: true } })).map(m => m.projectId);
  const [personal, judgments, experiences] = await Promise.all([
    personalRefs.length ? db.agentClaim.findMany({ where: { id: { in: personalRefs.map(r => r.id) }, ownerUserId: userId, scopeType: "ACCOUNT" },
      select: { id: true, canonicalStatement: true, statusProjection: true, currentRevision: true } }) : [],
    judgmentRefs.length ? db.agentClaim.findMany({ where: { id: { in: judgmentRefs.map(r => r.id) }, ownerUserId: userId, scopeType: "PROJECT", projectId: { in: projects } },
      select: { id: true, projectId: true, canonicalStatement: true, statusProjection: true, currentRevision: true } }) : [],
    experienceRefs.length ? db.agentExperience.findMany({ where: { id: { in: experienceRefs.map(r => r.id) }, ownerUserId: userId, projectId: { in: projects } },
      select: { id: true, projectId: true, title: true, status: true, version: true, revokedAt: true } }) : [],
  ]);

  const items: MemoryUseItem[] = [];
  for (const ref of personalRefs) {
    const claim = personal.find(c => c.id === ref.id);
    if (!claim) continue;
    const deleted = claim.statusProjection === "DELETED";
    items.push({ kind: "PERSONAL", id: claim.id, projectId: null, title: deleted ? "一条已删除的个人偏好" : claim.canonicalStatement,
      stateLabel: personalLabels[claim.statusProjection] ?? "状态待确认", active: claim.statusProjection === "ACTIVE",
      changedSince: !deleted && ref.revision !== null && claim.currentRevision !== ref.revision });
  }
  for (const ref of judgmentRefs) {
    const claim = judgments.find(c => c.id === ref.id);
    if (!claim) continue;
    items.push({ kind: "JUDGMENT", id: claim.id, projectId: claim.projectId, title: claim.canonicalStatement, stateLabel: judgmentLabels[claim.statusProjection] ?? "待核实",
      active: !["REFUTED", "EXPIRED", "RESTRICTED"].includes(claim.statusProjection), changedSince: ref.revision !== null && claim.currentRevision !== ref.revision });
  }
  for (const ref of experienceRefs) {
    const experience = experiences.find(e => e.id === ref.id);
    if (!experience) continue;
    const revoked = Boolean(experience.revokedAt) || experience.status === "REVOKED";
    items.push({ kind: "EXPERIENCE", id: experience.id, projectId: experience.projectId, title: experience.title, stateLabel: revoked ? "已撤销" : experienceLabels[experience.status] ?? "可参考",
      active: !revoked, changedSince: ref.version !== null && experience.version !== ref.version });
  }
  return items.length ? { items } : null;
}
