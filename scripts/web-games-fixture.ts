/**
 * Web 玩法验收的合成数据。只在隔离 SQLite 中创建，不读取或写入真实项目。
 * 数据刻意包含：多来源引用、未引用来源、待判断项与真实持久 Step/Output 的形状。
 */
export const WEB_GAMES_USERNAME = "web-games-reviewer";
export const WEB_GAMES_PASSWORD = "web-games-reviewer-password";

export async function seedWebGamesFixture() {
  const { db } = await import("../lib/db");
  const { hashPassword } = await import("../lib/auth/password");
  const { createMission } = await import("../lib/mission/missionService");
  const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
  const { claimMission } = await import("../lib/mission/runtimeStore");
  const { json } = await import("../lib/mission/contracts");

  const passwordHash = await hashPassword(WEB_GAMES_PASSWORD);
  const user = await db.user.create({ data: { username: WEB_GAMES_USERNAME, displayName: "玩法评审（合成）", passwordHash } });
  const project = await db.project.create({ data: {
    title: "发布准备 · 合成演示", goal: "整理发布说明，并保留尚未验证的边界", description: "Web 玩法验收合成项目", scenario: "INNOVATION",
    memberships: { create: { userId: user.id, role: "OWNER" } },
  } });
  const mission = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: "web-games-fixture", goal: "整理发布说明与验证边界" });
  const { addMissionMaterial } = await import("../lib/mission/materialService");
  const materials = [
    { requestId: "fixture-record", name: "输入回归记录（节选）.txt", text: "输入回归测试通过：桌面端输入与粘贴均已回归。\n系统分享尚未在真机验证，不能写成已完成。\n记录人：陈明" },
    { requestId: "fixture-plan", name: "分享联调计划（节选）.txt", text: "计划在 11 月 20 日开展系统分享真机联调；需要一台 HarmonyOS 真机与测试账号。" },
    { requestId: "fixture-sketch", name: "界面草图说明.txt", text: "发布页保留旧版入口；草图只用于排版讨论，不作为功能验收依据。" },
  ];
  const added: Array<{ sourceId: string }> = [];
  for (const item of materials) added.push(await addMissionMaterial(user.id, mission.id, { ...item, kind: "MATERIAL" }));
  const [refRecord, refPlan, refSketch] = await Promise.all(added.map(item =>
    readProjectMaterial(project.id, item.sourceId)));
  if (!refRecord || !refPlan || !refSketch) throw new Error("合成来源读取失败");
  const content = { blocks: [
    { blockId: "b1", kind: "PROJECT_OBSERVATION", text: "输入回归已完成；系统分享仍待真机验证。", sourceIds: [refRecord.id, refPlan.id] },
    { blockId: "b2", kind: "PROJECT_OBSERVATION", text: "分享联调安排在 11 月 20 日。", sourceIds: [refPlan.id] },
    { blockId: "b3", kind: "INFERENCE", text: "如果真机联调顺利，本周五可以发布。", sourceIds: [] },
  ], missingInformation: ["系统分享的真机验证", "验收口径"] };
  const output = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "NOTE",
    contentJson: content, sourceRefsJson: json([refRecord, refPlan, refSketch]), claimChecksJson: [] } });
  await claimMission("web-games-worker", mission.id);
  // 合成演示没有常驻 Worker；延长租约只让冲刺可启动，不推进步骤或稿件。
  await db.agentMission.update({ where: { id: mission.id }, data: { leaseUntil: new Date(Date.now() + 3600_000) } });
  return { user, project, mission, output, refs: { record: refRecord, plan: refPlan, sketch: refSketch } };
}
