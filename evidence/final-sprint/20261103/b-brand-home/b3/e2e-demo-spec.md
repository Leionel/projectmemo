# 隔离 E2E：首页/登录态 CTA 定向回归（候选 `9bae926`）

命令：`npm.cmd run test:e2e -- e2e/demo.spec.ts`
（`scripts/setup-e2e.ts` 重建隔离库 + seed + 建 e2e 身份；`scripts/run-e2e.ts` 以 `.next-e2e` 生产构建 + `next start` 运行 `e2e/demo.spec.ts`）

环境：
- 工作树 `D:/Projects/hongmen-final-b-brand-home`，分支 `codex/final-b-brand-home`，HEAD `9bae926e9475cedef118deedf5e002ec8365a23b`，源码无未提交改动。
- 隔离 SQLite `prisma/projectmemo-e2e.db`（重建+seed），mock LLM，独立端口 `PROJECTMEMO_E2E_PORT=33411`；不使用真实账号或真实数据库。
- 首次尝试使用默认 33321 端口时被同机其他进程占用（EADDRINUSE，未 kill 他人进程），改用 33411 重跑成功。两次的失败/成功均如实保留。

结果：**PASS**
- 生产构建成功（Turbopack，43 页，TypeScript 通过；6 条与首页无关的既有 fs-tracing warning）。
- Playwright：`Expected: 10 / Unexpected: 0 / Flaky: 0 / Skipped: 0`，耗时 37.6s，`[e2e] completed with passing result.`，退出码 0。
- 覆盖到的与 Track B 相关路径：登录态首页可见“回到我的工作台”并跳转 `/focus`；首页匿名文案与 Hero 仍满足既有断言；账号页与工作台旧主线不因官网改版回归（其余 9 条为项目/工作台既有流程）。

原始结构化结果：`e2e-demo-spec-results.json`（由 `test-results/e2e-results.json` 复制，`stats.expected=10, unexpected=0`）。
