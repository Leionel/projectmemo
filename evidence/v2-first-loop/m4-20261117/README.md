# M4 成本、容量与恢复证据（2026-11-17）

基线 `95fcc4f`。本轮无新增 Schema/Migration、无付费模型调用、无生产部署、未修改真实数据库。

## 1. 可复现环境：FAIL / BLOCKED

- `env/report.json`：实际安装与声明不一致 **29 项**；关键差异：Next `16.2.11` vs 声明 `16.4.3`、Prisma `7.8.0` vs `7.10.1`、`@prisma/client 7.8.0`、zod `4.4.3` vs `4.6.7`、vitest `4.1.10` vs `4.1.12`。DOCX 运行依赖 mammoth 1.13.0/fflate 0.8.3 与声明一致。
- `env/clean-install.log`：在临时副本执行 `npm ci --ignore-scripts`，返回 **EUSAGE**：`package.json` 与 `package-lock.json` 不同步，lock 缺 `lie@3.3.3`、`immediate`、`duck`、`underscore`。
- 结论：现有 `node_modules` 不能作为可复现/生产打包证据。修复 lock 或按 lock 安装属于单独的依赖变更，本轮不擅自改 lock/升级。
- Web 生产构建（使用现有 node_modules）通过，`web-build.log`；这不抵消 clean install 失败。

## 2. 成本与预算审计：PASS（本地规则）

- `tests/v2M4CostAudit.test.ts` 3/3：
  - 模型硬闸在 provider 调用前拦截（maxModels=1，第二次 provider 调用数保持 1，错误 `BUDGET_EXHAUSTED`，用量不重置）；
  - 工具硬闸在第二个工具前拦截（成功步骤保持 1，工具用量不回退）；
  - 失败/未知用量保留 UNKNOWN 与输出预留，另一个 Mission 的预算独立且成功调用不释放失败预留。
- 既有日界线/累计/预留测试继续在全量套件中运行；未发现需要超过现有预算/租约/fence 的扩容证据。

## 3. 10/30 活动委托负载：PASS（本地目标，非云容量）

`scripts/v2-load.ts` 使用真实 Mission 行、真实 Runner、独立 SQLite、双 worker 循环、前台读请求；混合 READY/观察等待/用户等待/过期租约/活租约。

| 规模 | accepted p95 | 首次本地结果 p90 | 前台读 p95 | 失败率 | busy/双租约/重复 | 用量 |
|---|---|---|---|---|---|---|
| 10 | 387 ms | 680 ms | 9.6 ms | 0 | 0 | 12 model / 8 tool |
| 30 | 1,028 ms | 1,776 ms | 9.8 ms | 0 | 0 | 36 / 24 |

目标 p95 accepted <2s、p90 first local <120s 在本地 mock 达成；前台样本仅 1（运行太快），不足以做延迟分布结论。**localhost mock 吞吐不等于真实云容量**；活租约 RUNNING 行按设计不被抢，未测真实 provider 延迟/限流。

## 4. 72 小时真实墙钟：RUNNING（未满）

- 目录 `long-run-72h/`；`start` 于 2026-11-17 15:25（Asia/Shanghai），`durationHours=72`，interval 60s，materialEvery 60 轮，隔离 SQLite，fixture provider，PID 见 `run.json`。
- `status-initial.log`/`status-mid.log` 显示 workerAlive=true、evidence 在追加、输出/预算增长；`report.wallClockComplete` 未到 72h 时为 false。
- 控制：`status | resume | stop | report`；`resume` 记录 `resumeCount`，`stop.flag`+PID 双通道。启动不等于通过；最终以自然时间 + 日志/DB 证据判定。
- 真实长期风险（断电、跨日预算、网络、真机）仍未验证；若进程/环境结束，凭 `run.json` 与 `resume` 继续并保留空档记录。

## 5. 成本/用量未知与货币

- 只记录真实调用/token 配额；未校价时不显示金额封顶，不使用历史账单当授权。本轮无付费调用。

## 6. Gate

结论与逐项状态见 `planning/v2-first-loop/M3_M4_GATE_STATUS.md`。M4 不通过，原因：干净安装 FAIL、真实模型 UNVERIFIED、72h RUNNING、真机 UNVERIFIED。
