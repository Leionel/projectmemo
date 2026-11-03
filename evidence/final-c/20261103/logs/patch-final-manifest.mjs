import fs from "node:fs";
const manifestPath = "evidence/final-c/20261103/manifest.json";
const notesPath = "evidence/final-c/20261103/notes.md";
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
m.evidenceMethod.iterations = [
  "iteration-1（候选 5b89ecf/e9f8be1 期间）：64 检查 / 60 PASS / 4 FAIL；goal-question 既有 POST 归类、legacy 断言跨区域、VERSION_ADVANCED 读取时机（日志 logs/capture-web-iteration1.log，部分被覆盖前的 manifest 见 logs/iteration-2-*）。",
  "iteration-2（候选 21cb961 期间）：64 检查 / 62 PASS / 2 FAIL；legacy 误把分类标签当成功语义、401 首次读取未等工作包渲染（logs/capture-web-iteration2.log、logs/iteration-2-manifest.json）。",
  "final-attempt1（候选 2d61578，正式构建前）：68 检查 / 66 PASS / 2 FAIL；legacy 命中旧组件说明文案“费用 0”、409 提示读到加载态（logs/final-attempt1-manifest.json）。",
  "final-attempt2（候选 2d61578，正式构建前）：68 检查 / 65 PASS / 3 FAIL；001-focus UI 登录 dev 冷编译时序（logs/final-attempt2-manifest.json）。",
  "final-attempt3（候选 2d61578，与 Lead production build 时间窗重叠）：68 检查 / 68 PASS，但为消除 .next/dev 与 build 冲突风险，在 BUILD_DONE 后以 final-attempt4 重跑为准（logs/final-attempt3-manifest.json）。",
  "final（权威快照，BUILD_DONE 之后）：68 检查 / 68 PASS / 0 FAIL / 0 NOT_RUN，exitCode=0；本 manifest 即本次快照。",
];
m.evidenceMethod.loginTiming =
  "UI 登录提交后等待 POST /api/auth/login 的 2xx 响应（并配合 URL 变化判定），失败重试一次；dev 冷编译下如仍失败才用认证端点兜底并把 method 记为 UI_LOGIN_WITH_API_FALLBACK。本次 method=UI_LOGIN。";
m.evidenceMethod.devServerWarmup =
  "capture 前在同一 dev 实例上以 HTTP 预热 /health、/focus、Mission 页面与 readback，避免 dev 编译阻塞截图；预热请求不计入用例请求审计。";
m.build = {
  command: "npm.cmd run build",
  exitCode: 0,
  log: "evidence/final-c/20261103/logs/next-build.log",
  note: "Lead 在候选 2d61578 上执行的生产构建（构建成功），本 EV2 采集在 BUILD_DONE 之后启动 dev 实例。",
};
m.limitations.push(
  "dev 模式 Turbopack 在路由编译时可能显示左下角“Compiling …”指示器；个别截图可能包含该 dev-only 指示器（如 409 截图），不是产品 UI。",
  "本地隔离 SQLite 与 mock 模式，不覆盖生产构建运行、真实模型质量或真实用户数据。",
);
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf8");
const notes = fs.readFileSync(notesPath, "utf8");
const extra = [
  "",
  "## 历史迭代（同一候选或更早候选，保留日志不删）",
  ...m.evidenceMethod.iterations.map((line) => `- ${line}`),
  "",
  "## 生产构建与环境",
  `- ${m.build.command}：exit ${m.build.exitCode}（日志 ${m.build.log}，由 Lead 在候选 2d61578 执行）；本 EV2 快照在 BUILD_DONE 之后启动 dev 实例。`,
  `- 登录时序：${m.evidenceMethod.loginTiming}`,
  `- dev 预热：${m.evidenceMethod.devServerWarmup}`,
  "- dev-only 说明：Turbopack 路由编译时可能显示“Compiling …”指示器；个别截图（如 409）可能包含该指示器，不是产品 UI。",
  "",
];
fs.writeFileSync(notesPath, notes.trimEnd() + "\n" + extra.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ ok: true, totals: m.totals, exitCode: m.exitCode, screenshots: m.screenshots.length, iterations: m.evidenceMethod.iterations.length }, null, 1));
