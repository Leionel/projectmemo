import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { continuityDatabase } from "./helpers/continuityDatabase";
const isolated = continuityDatabase("mission-wait-notice");
let db: typeof import("@/lib/db").db;
beforeAll(async () => {
  db = (await import("@/lib/db")).db;
  vi.stubEnv("MISSION_ENABLED", "true");
  vi.stubEnv("AUTH_PUBLIC_BASE_URL", "https://example.invalid/");
  vi.stubEnv("AUTH_EMAIL_FROM", "忆程 <noreply@example.invalid>");
  vi.stubEnv("AUTH_MAIL_TRANSPORT", "resend");
  vi.stubEnv("RESEND_API_KEY", "synthetic-not-a-real-key");
});
afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); void isolated; });

async function waitingMission(username: string) {
  const { createMission } = await import("@/lib/mission/missionService");
  const user = await db.user.create({ data: { username, displayName: "合成用户", passwordHash: "unused" } });
  await db.accountSecurity.create({ data: { userId: user.id, email: `${username}@example.invalid`, emailVerifiedAt: new Date(), dailyCloudLimit: 5 } });
  const project = await db.project.create({ data: { title: "毕业论文实验", description: "", goal: "完成对照实验", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  // 静默时段设为空，避免测试结果依赖运行时刻
  await db.interventionPolicy.upsert({ where: { scope: `USER:${user.id}` }, create: { scope: `USER:${user.id}`, quietStartMinute: 0, quietEndMinute: 0 }, update: { quietStartMinute: 0, quietEndMinute: 0 } });
  const mission = await createMission(user.id, { projectId: project.id, requestId: username, goal: "整理对照实验的数据划分", llmContextApproved: true });
  await db.agentMission.update({ where: { id: mission.id }, data: { status: "WAITING_INPUT", waitStateJson: { questionId: "q-1", missing: "数据划分比例" } } });
  return { user, project, missionId: mission.id };
}

it("同一个等待只提醒一次；新问题再提醒；邮件不含问题正文", async () => {
  const { processWaitNotices } = await import("@/lib/mission/waitNotice");
  const { missionId } = await waitingMission("notice-owner");
  vi.stubEnv("MISSION_WAIT_EMAIL_ENABLED", "true");
  const sent: Array<{ to: string; subject: string; text: string; idempotencyKey?: string }> = [];
  const send = async (mail: { to: string; subject: string; text: string; idempotencyKey?: string }) => { sent.push(mail); };

  expect((await processWaitNotices({ send })).sent).toBe(1);
  expect(sent[0]).toMatchObject({ to: "notice-owner@example.invalid", subject: "忆程：「毕业论文实验」的委托在等你" });
  expect(sent[0].text).toContain(`/missions?mission=${missionId}&questionId=q-1`);
  expect(sent[0].text).not.toContain("数据划分比例");

  expect((await processWaitNotices({ send })).sent).toBe(0);
  expect(sent).toHaveLength(1);

  await db.agentMission.update({ where: { id: missionId }, data: { waitStateJson: { questionId: "q-2", missing: "基线来源" } } });
  expect((await processWaitNotices({ send })).sent).toBe(1);
  expect(sent[1].idempotencyKey).not.toBe(sent[0].idempotencyKey);
  const types = (await db.agentMissionEvent.findMany({ where: { missionId }, orderBy: { seq: "asc" } })).map(e => e.type).filter(t => t.startsWith("USER_NOTICE"));
  expect(types).toEqual(["USER_NOTICE_SENDING", "USER_NOTICE_SENT", "USER_NOTICE_SENDING", "USER_NOTICE_SENT"]);
});

it("用户对委托选择停止时不发；投递失败只记录、不重发；开关关闭时不扫描", async () => {
  const { processWaitNotices } = await import("@/lib/mission/waitNotice");
  const stopped = await waitingMission("notice-stopped");
  await db.goalQuestionPreference.create({ data: { userId: stopped.user.id, missionId: stopped.missionId, questionId: "*", mode: "STOP", contextHash: "synthetic" } });
  const failing = await waitingMission("notice-failing");
  vi.stubEnv("MISSION_WAIT_EMAIL_ENABLED", "true");
  const attempts: string[] = [];
  const send = async (mail: { to: string }) => { attempts.push(mail.to); throw new Error("rejected"); };

  const first = await processWaitNotices({ send });
  expect(attempts).toEqual(["notice-failing@example.invalid"]);
  expect(first.failed).toBe(1);
  expect((await db.agentMissionEvent.findMany({ where: { missionId: failing.missionId, type: { startsWith: "USER_NOTICE" } } })).map(e => e.type).sort())
    .toEqual(["USER_NOTICE_FAILED", "USER_NOTICE_SENDING"]);
  expect(await db.agentMissionEvent.count({ where: { missionId: stopped.missionId, type: { startsWith: "USER_NOTICE" } } })).toBe(0);

  await processWaitNotices({ send });
  expect(attempts).toHaveLength(1);

  vi.stubEnv("MISSION_WAIT_EMAIL_ENABLED", "false");
  expect(await processWaitNotices({ send })).toEqual({ checked: 0, sent: 0, failed: 0 });
});
