import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("D:/Projects/hongmen/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://127.0.0.1:33399", OUT = "D:/Projects/hongmen/evidence/material-motion-audit-20261107", SHOTS = OUT + "/screens";
const CONV = "cmw4olbc6008mxo8otdmkp635", MAIN = "cmw4ohyjz0000b88osiggwy11";
const browser = await chromium.launch();
const auth = await browser.newContext();
await auth.request.post(BASE + "/api/auth/login", { data: { username: "e2e-reviewer", password: "e2e-reviewer-password", client: "web" } });
const state = await auth.storageState(); await auth.close();
const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
const p0 = await ctx0.newPage(); const cdp0 = await ctx0.newCDPSession(p0); await cdp0.send("DOM.enable"); await cdp0.send("CSS.enable");
const fonts = {};
const probe = async (label, url, sel) => {
  await p0.goto(BASE + url, { waitUntil: "load" }); await p0.waitForTimeout(1500);
  const { root } = await cdp0.send("DOM.getDocument");
  const { nodeId } = await cdp0.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
  if (!nodeId) { fonts[label] = "not found"; return; }
  const r = await cdp0.send("CSS.getPlatformFontsForNode", { nodeId });
  const cf = await p0.$eval(sel, e => getComputedStyle(e).fontFamily.slice(0, 70) + " | wt " + getComputedStyle(e).fontWeight);
  fonts[label] = { css: cf, used: r.fonts.map(f => f.familyName + "(" + f.glyphCount + ")") };
};
await probe("home-h1", "/", "h1"); await probe("home-h2", "/", "#flow h2"); await probe("home-body", "/", "p[class*=heroSub]");
await probe("focus-h1", "/focus", "h1"); await probe("focus-hero-h2", "/focus", "[class*=hero] h2"); await probe("brand", "/focus", ".app-brand-name");
await probe("projects-card", "/projects", ".project-card-title"); await probe("project-h1", "/projects/" + MAIN, "h1"); await probe("body", "/focus", ".global-nav-link");
await ctx0.close();
fs.writeFileSync(OUT + "/platform-fonts.json", JSON.stringify(fonts, null, 1)); console.log(JSON.stringify(fonts));
const ref = (kind, id) => ({ kind, id, projectId: MAIN, revision: "r1" });
const blocks = [
  { blockKey: "p", semanticType: "prose", emphasis: "primary", fallbackText: "", actionBindingIds: [], content: [{ type: "paragraph", spans: [{ kind: "text", text: "比赛材料要求演示可复现，但任务记录里没有回执。先补演示结果，再写汇报。" }] }] },
  { blockKey: "g", semanticType: "goal_gap", emphasis: "primary", fallbackText: "", actionBindingIds: [], goalGap: { goalQuote: "形成带来源的阶段汇报草稿", criteria: [{ id: "c1", requirement: "比赛要求已对应到来源", state: "VERIFIED", explanation: "比赛材料 10/20 已读取" }, { id: "c2", requirement: "演示流程可复现", state: "UNKNOWN", explanation: "现有材料无法确认" }, { id: "c3", requirement: "汇报素材齐备", state: "BLOCKED", explanation: "缺少实际运行结果" }], nextInformationNeed: "演示流程的实际结果" } },
  { blockKey: "t", semanticType: "investigation", emphasis: "supporting", fallbackText: "核对了 3 份资料", actionBindingIds: [], steps: [{ id: "s1", status: "SUCCEEDED", decision: { decision: "READ_EXISTING", informationNeed: "比赛材料的交付要求" } }, { id: "s2", status: "SUCCEEDED", decision: { decision: "READ_EXISTING", informationNeed: "任务记录里的完成回执" } }, { id: "s3", status: "FAILED", failureReason: "附件暂时无法读取", decision: { decision: "READ_EXISTING", informationNeed: "老师反馈附件" } }] },
  { blockKey: "e", semanticType: "evidence", emphasis: "primary", fallbackText: "这个判断的 2 条依据", actionBindingIds: [], evidence: [{ source: ref("SOURCE", "src1"), quote: "目前还没有完整 Demo，需要先完成项目创建、碎片捕获和成果生成闭环。", claim: "演示流程未核验", relation: "SUPPORTS" }, { source: ref("SOURCE", "src2"), quote: "初赛需要准备创意描述、设计稿、作品介绍文档和演示材料。", claim: "演示材料是交付项", relation: "SUPPORTS" }] },
  { blockKey: "c", semanticType: "comparison", emphasis: "primary", fallbackText: "", actionBindingIds: ["b2"], candidates: [{ id: "a", title: "先补演示结果", tradeoff: "多花半天，汇报依据完整", feasibility: "READY", stopCondition: "拿到运行截图即止", branches: [] }, { id: "b", title: "先写汇报草稿", tradeoff: "更快，但结论要标注未核验", feasibility: "READY", stopCondition: "", branches: [] }] },
  { blockKey: "ap", semanticType: "approval", emphasis: "primary", state: "PENDING", fallbackText: "创建行动：补充演示运行结果\n完成后回到原委托继续整理汇报。", actionBindingIds: ["b3", "b4"] },
  { blockKey: "r", semanticType: "receipt", emphasis: "supporting", state: "SUCCEEDED", verification: "REPORTED", fallbackText: "演示结果已写回原委托", actionBindingIds: [], title: "演示结果已写回原委托" },
];
const allowedActions = [{ bindingId: "b2", actionKind: "CONFIRM", label: "按这个方案继续", enabled: true, frozen: {} }, { bindingId: "b3", actionKind: "CONFIRM", label: "确认创建", enabled: true }, { bindingId: "b4", actionKind: "OPEN", label: "查看提案", enabled: true }];
const phases = [["READING_SOURCE", [{ id: "p1", status: "SUCCEEDED", label: "读取比赛材料" }, { id: "p2", status: "STARTED", label: "读取任务安排" }]], ["WAITING_MODEL", [{ id: "p1", status: "SUCCEEDED", label: "读取比赛材料" }, { id: "p2", status: "SUCCEEDED", label: "读取任务安排" }]]];
for (const [mode, vp, extra] of [["desktop", { width: 1440, height: 1500 }, {}], ["mobile", { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, storageState: state, ...extra });
  await ctx.addInitScript(s => { try { localStorage.setItem("theme", s); } catch {} }, scheme);
  const page = await ctx.newPage();
  let phase = null;
  await page.route(/\/api\/conversations\/[^/?]+(\?.*)?$/, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch(); let j;
    try { j = await res.json(); } catch { return route.fulfill({ response: res }); }
    const msgs = j.messages ?? []; const a = [...msgs].reverse().find(m => String(m.role).toUpperCase() === "ASSISTANT");
    if (a) { a.presentation = { schemaVersion: 1, blocks, allowedActions }; a.fileGuides = []; }
    if (phase) j.activeTurn = { id: "turn1", status: "RUNNING", progress: { phase: phase[0], steps: phase[1] } };
    await route.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), "content-type": "application/json" } });
  });
  await page.goto(BASE + "/projects/" + MAIN + "?conversation=" + CONV, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {}); await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + "/agent-" + mode + "-" + scheme + "-drawer.jpg", type: "jpeg", quality: 80 });
  const blocksEl = page.locator('[data-testid="agent-message-blocks"]').last();
  console.log(mode, scheme, "blocks", await blocksEl.count());
  if (await blocksEl.count()) {
    await blocksEl.locator("[data-block=goal_gap]").scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(200);
    await page.screenshot({ path: SHOTS + "/agent-" + mode + "-" + scheme + "-blocks1.jpg", type: "jpeg", quality: 80 });
    await blocksEl.locator("[data-block=approval]").scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(200);
    await page.screenshot({ path: SHOTS + "/agent-" + mode + "-" + scheme + "-blocks2.jpg", type: "jpeg", quality: 80 });
  }
  if (scheme === "light") {
    for (const ph of phases) { phase = ph; await page.reload({ waitUntil: "load" }); await page.waitForTimeout(1600); await page.screenshot({ path: SHOTS + "/agent-" + mode + "-progress-" + ph[0] + ".jpg", type: "jpeg", quality: 80 }); }
    phase = null;
  }
  await ctx.close();
}
await browser.close(); console.log("done");
