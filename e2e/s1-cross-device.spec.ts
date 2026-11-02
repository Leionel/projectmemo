import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ENV, E2E_PASSWORD, E2E_USERNAME } from "../scripts/e2e-env";
import { fillManualProjectForm } from "./projectMenu";

/**
 * S1-C 跨端接续：手机上回答原问题 → Web 读回同一个 Mission / question / 结果版本。
 *
 * 手机用同一账号的第二个真实会话（不是伪造 owner），回答经由原 Mission 服务；
 * Web 只用原 readback 接口读取，不新建相似任务、不重放业务效果。
 */
function slice(id: string, choice: unknown) {
  const output = execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/e2e-mission-fixture.ts",
    "slice", id, JSON.stringify(choice)], { env: { ...process.env, ...E2E_ENV }, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(output) as { status: string };
}

test("S1-C 手机回答原问题后，Web 读回同一问题、版本与结果分类；旧问题/重复提交不被当成新任务", async ({ page }) => {
  test.setTimeout(150000);
  const cookies = await page.context().cookies();
  const session = cookies.find(c => c.name === "pm_session")!;
  const headers = { Authorization: "Bearer " + session.value };

  // 1. 正常入口建项（保留既有手工路径，材料优先在另一个用例覆盖）。
  await page.goto("/projects/new");
  await fillManualProjectForm(page, {
    title: `S1 跨端 ${Date.now()}`,
    description: "验证手机回答与 Web 核查是同一个原问题。",
    goal: "核实设备条件后再决定演示方案",
  });
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/?#]+$/);
  const projectId = new URL(page.url()).pathname.split("/")[2];

  // 2. 建立原委托并产生一个真实问题（scripted slice，真实服务写入）。
  const created = await page.request.post("/api/missions", { headers, data: {
    requestId: `s1-mission-${Date.now()}`, projectId, goal: "确认旧平板是否能稳定演示", llmContextApproved: true } });
  expect(created.ok()).toBe(true);
  const missionId = (await created.json()).mission.id as string;
  slice(missionId, { kind: "ask", question: "旧平板最近一次成功点亮是什么时候？", missing: "PRIVATE" });
  const missionDetail = await (await page.request.get(`/api/missions/${missionId}`, { headers })).json();
  const questionId = missionDetail.mission.question.id as string;
  const before = await (await page.request.get(`/api/missions/${missionId}/readback?questionId=${encodeURIComponent(questionId)}`, { headers })).json();
  expect(questionId).toBeTruthy();
  expect(before.readback.selected.question.historical).toBe(false);
  expect(before.readback.reviewProgress.classes.map((c: { key: string }) => c.key))
    .toEqual(["executed", "observed", "independentlySupported", "userReported", "counterExamples", "unknown"]);
  expect(before.readback.realityOutcome).toBe("NOT_INFERRED");

  // 3. 手机：同一账号的第二个真实会话回答原问题（稳定 requestId）。
  const login = await page.request.post("/api/auth/login", { data: { username: E2E_USERNAME, password: E2E_PASSWORD } });
  expect(login.ok()).toBe(true);
  const phoneToken = (await login.json()).accessToken as string;
  const phone = { Authorization: "Bearer " + phoneToken, "Content-Type": "application/json" };
  const detail = await (await page.request.get(`/api/missions/${missionId}`, { headers: phone })).json();
  const answer = { requestId: "phone-answer-1", expectedVersion: detail.mission.version, questionId, answer: "上周五点亮过一次，十分钟后黑屏" };
  const first = await page.request.post(`/api/missions/${missionId}/input`, { headers: phone, data: answer });
  expect(first.ok()).toBe(true);
  // 重复点击：同请求身份返回同一结果，不产生第二次业务效果。
  const replay = await page.request.post(`/api/missions/${missionId}/input`, { headers: phone, data: answer });
  expect([200, 202]).toContain(replay.status());
  // 同请求改内容被拒绝。
  const conflict = await page.request.post(`/api/missions/${missionId}/input`, { headers: phone,
    data: { ...answer, answer: "另一份答案" } });
  expect(conflict.status()).toBe(409);

  // 4. Web：读回同一个 Mission 与 question，问题已答标记为历史，版本前移。
  const after = await (await page.request.get(`/api/missions/${missionId}/readback?questionId=${encodeURIComponent(questionId)}`,
    { headers })).json();
  expect(after.readback.missionId).toBe(missionId);
  expect(after.readback.projectId).toBe(projectId);
  expect(after.readback.selected.question.id).toBe(questionId);
  expect(after.readback.selected.question.historical).toBe(true);
  expect(after.readback.missionVersion).toBeGreaterThan(before.readback.missionVersion);
  const events = await (await page.request.get(`/api/missions/${missionId}/events`, { headers })).json();
  expect((events.events as Array<{ type: string }>).some(e => e.type === "INPUT")).toBe(true);

  // 5. 旧问题与跨委托问题不能冒充当前结果。
  const other = await page.request.post("/api/missions", { headers, data: {
    requestId: `s1-mission-other-${Date.now()}`, projectId, goal: "另一个委托", llmContextApproved: true } });
  const otherId = (await other.json()).mission.id as string;
  slice(otherId, { kind: "ask", question: "另一个问题？", missing: "PRIVATE" });
  const foreignDetail = await (await page.request.get(`/api/missions/${otherId}`, { headers })).json();
  const foreignQuestion = foreignDetail.mission.question.id as string;
  const mismatch = await page.request.get(`/api/missions/${missionId}/readback?questionId=${encodeURIComponent(foreignQuestion)}`, { headers });
  expect(mismatch.status()).toBe(404);
  expect((await mismatch.json()).error.code).toBe("MISSION_TARGET_NOT_FOUND");

  // 6. Web 页面上读到同一问题的历史状态，不显示成新问题。
  await page.goto(`/projects/${projectId}/missions?mission=${missionId}&questionId=${questionId}`);
  await expect(page.getByText("旧平板最近一次成功点亮是什么时候？", { exact: false })).toBeVisible();
});







