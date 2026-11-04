import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { accountMailConfiguration, sendAccountMail, type AccountMail } from "@/lib/auth/mail";
import { decidePrivateMissionAttention } from "@/lib/services/interventionPolicyService";
import { jsonHash } from "@/lib/mission/contracts";
import { event, lock } from "@/lib/mission/repository";

/**
 * 委托等你回答或批准时，给已验证邮箱发一封提醒（MISSION_WAIT_EMAIL_ENABLED，默认关闭）。
 *
 * - 同一个等待（原问题或原审批）只发一次：先在原委托事件中以 commandRequestId 认领，再在事务外发信；
 *   投递使用固定 idempotencyKey，失败只记录，不换键重发。
 * - 沿用私有委托注意力决策：静默时段、每日预算和用户对该委托的“停止 / 稍后”都会让本次不发，
 *   之后条件变化再重新判断；不创建新的通知表或收件箱。
 * - 邮件只含项目名、等待类型和回到原问题的链接，不含问题正文、资料或模型输出。
 */
const WAITING = ["WAITING_INPUT", "WAITING_APPROVAL"] as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type WaitTarget = { key: string; kind: "QUESTION" | "APPROVAL"; id: string };

async function waitTarget(mission: { id: string; status: string; waitStateJson: unknown }): Promise<WaitTarget | null> {
  if (mission.status === "WAITING_INPUT") {
    const questionId = String(record(mission.waitStateJson).questionId ?? "");
    if (questionId) return { key: `${mission.id}:question:${questionId}`, kind: "QUESTION", id: questionId };
    const latest = await db.agentMissionEvent.findFirst({ where: { missionId: mission.id, type: "QUESTION" }, orderBy: { seq: "desc" }, select: { id: true } });
    return latest ? { key: `${mission.id}:question:${latest.id}`, kind: "QUESTION", id: latest.id } : null;
  }
  if (mission.status === "WAITING_APPROVAL") {
    const approval = await db.agentMissionApproval.findFirst({ where: { missionId: mission.id, status: "PENDING" }, orderBy: { expiresAt: "asc" }, select: { id: true } });
    return approval ? { key: `${mission.id}:approval:${approval.id}`, kind: "APPROVAL", id: approval.id } : null;
  }
  return null;
}

export function waitNoticeMail(input: { to: string; key: string; projectTitle: string; kind: WaitTarget["kind"]; link: string }): AccountMail {
  const need = input.kind === "QUESTION" ? "补充一项信息" : "审阅一项待批准的操作";
  return {
    idempotencyKey: "mission-wait/" + jsonHash(input.key),
    to: input.to,
    subject: `忆程：「${input.projectTitle}」的委托在等你`,
    text: `「${input.projectTitle}」的长期委托需要你${need}才能继续。\n\n打开原委托处理：${input.link}\n\n同一个问题只提醒一次。不想再收到这类邮件，可以在原委托里选择“停止关注”，或在提醒策略中设置静默时段。`,
  };
}

export async function processWaitNotices(options: { limit?: number; now?: Date; send?: (mail: AccountMail) => Promise<void> } = {}) {
  if (!isFeatureEnabled("MISSION_WAIT_EMAIL_ENABLED", false)) return { checked: 0, sent: 0, failed: 0 };
  const config = accountMailConfiguration();
  if (!config) return { checked: 0, sent: 0, failed: 0 };
  const now = options.now ?? new Date(), send = options.send ?? sendAccountMail;
  const missions = await db.agentMission.findMany({
    where: { status: { in: [...WAITING] }, updatedAt: { gte: new Date(+now - 3 * 86400000) }, project: { deletionRequestedAt: null } },
    orderBy: { updatedAt: "asc" }, take: Math.max(1, Math.min(20, options.limit ?? 10)),
    select: { id: true, status: true, waitStateJson: true, ownerUserId: true, projectId: true, project: { select: { title: true } } },
  });
  let sent = 0, failed = 0;
  for (const m of missions) {
    const target = await waitTarget(m);
    if (!target) continue;
    const commandId = "wait-notice:" + jsonHash(target.key);
    if (await db.agentMissionEvent.findFirst({ where: { missionId: m.id, commandRequestId: commandId }, select: { id: true } })) continue;
    const account = await db.accountSecurity.findUnique({ where: { userId: m.ownerUserId }, select: { email: true, emailVerifiedAt: true } });
    if (!account?.email || !account.emailVerifiedAt) continue;
    const claimed = await db.$transaction(async tx => {
      await lock(tx, m.id);
      const current = await tx.agentMission.findUnique({ where: { id: m.id }, select: { status: true, waitStateJson: true, ownerUserId: true, projectId: true } });
      if (!current || current.status !== m.status || jsonHash(current.waitStateJson) !== jsonHash(m.waitStateJson)) return false;
      const owner = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: current.ownerUserId, projectId: current.projectId } } });
      if (owner?.role !== "OWNER") return false;
      if (await tx.agentMissionEvent.findFirst({ where: { missionId: m.id, commandRequestId: commandId }, select: { id: true } })) return false;
      const preferences = await tx.goalQuestionPreference.findMany({ where: { userId: m.ownerUserId, missionId: m.id, OR: [{ questionId: "*" }, { questionId: target.id }] } });
      const anchors = await tx.conversationAnchor.findMany({ where: { ownerUserId: m.ownerUserId, missionId: m.id }, select: { mode: true, snoozedUntil: true } });
      const level = preferences.some(p => p.mode === "STOP") || anchors.some(a => a.mode === "STOPPED") ? "SUPPRESS"
        : [...preferences, ...anchors].some(p => p.mode === "LATER" && p.snoozedUntil && p.snoozedUntil > now) ? "QUEUE" : "URGENT";
      const decision = await decidePrivateMissionAttention(tx, { userId: m.ownerUserId, projectId: m.projectId,
        candidateKey: "wait-email:" + jsonHash(target.key), urgent: true, level, reason: m.status, now });
      if (decision.level !== "URGENT") return false;
      await event(tx, m.id, "USER_NOTICE_SENDING", { channel: "EMAIL", wait: target.kind, decisionId: decision.decisionId }, { id: commandId, hash: jsonHash(target.key) });
      return true;
    });
    if (!claimed) continue;
    const query = target.kind === "QUESTION" ? `&questionId=${encodeURIComponent(target.id)}` : `&approvalId=${encodeURIComponent(target.id)}`;
    const link = `${config.baseUrl}/projects/${encodeURIComponent(m.projectId)}/missions?mission=${encodeURIComponent(m.id)}${query}`;
    let outcome: "USER_NOTICE_SENT" | "USER_NOTICE_FAILED" = "USER_NOTICE_SENT";
    try { await send(waitNoticeMail({ to: account.email, key: target.key, projectTitle: m.project.title, kind: target.kind, link })); sent++; }
    catch { outcome = "USER_NOTICE_FAILED"; failed++; }
    await db.$transaction(tx => event(tx, m.id, outcome, { channel: "EMAIL", wait: target.kind }));
  }
  return { checked: missions.length, sent, failed };
}
