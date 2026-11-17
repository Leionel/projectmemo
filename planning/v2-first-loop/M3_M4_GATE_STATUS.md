# M3/M4 Gate Status（2026-11-17）

工作树 `D:\Projects\hongmen-worktrees\v2-first-loop`，接手 HEAD `95fcc4f`，分支 `codex/v2-first-loop`。本轮无硬重置、未覆盖真实 `.env`/数据库；所有新证据在 `evidence/v2-first-loop/m4-20261117/`。

## 结论

- **M4 Gate：未通过（NOT PASSED）**。本地容量探测有目标内数据，但真实模型、真机、干净可复现安装和 72 小时墙钟均未完成；72h 任务已真实启动，状态 RUNNING。
- **M3 出口：未完成（PARTIAL）**。原生文件选择/分享入口、挑战隐私/指标题/冻结规则集、回访简报已实现并有合约/测试/构建证据；双人冲刺未实现，真机分享/通知、真实用户玩法价值未验证。

## 逐项状态

| 项目 | 状态 | 本轮证据 | 说明 |
|---|---|---|---|
| 原生 TXT/MD/CSV/DOCX 选择+预览+确认 | PASS（合约/构建） | `tests/v2NativeMaterials.test.ts` 3/3；Harmony 165/165；unsigned HAP | 服务端统一解析/校验；无真机选择器实测 |
| 系统分享入口 | PARTIAL | EntryAbility Want 捕获、`nativeShareFileUri` 5 条合约、module skill 声明 | 未在真机系统分享中实测；URI 失效/重复分享仅合约覆盖 |
| Web/鸿蒙同一 Mission | PASS（合约/HTTP） | 既有跨端测试 + M3 浏览器 HTTP pause/material；本轮回访面板 | 未做双设备同时操作 |
| 站内回访简报 | PASS（合成/浏览器） | `tests/v2ReentryBrief.test.ts` 3/3；M3 浏览器六项通过，新增回访已读不推进 Mission | 未做真实通知点击/离线推送；非真机 |
| 挑战删除/保留 | PASS（逻辑） | 5 条指标/隐私测试；tombstone 不含回答原文；30 天保留说明 | 只做逻辑删除，不宣称物理擦除 |
| 指标可比性题 | PASS（规则） | 复用 `compareMetricRecords`；unknown/differ/match 三态 | 仅合成 MetricRecord，未接真实授权实验来源 |
| 冻结规则/报告集 | PASS（20 + 12 合成） | `docs/v2/evaluation/challenge-rules.v1.json`、`challenge-report-contexts.v1.json`；测试锁定 SHA256 | realAuthorizedSources=0，真实授权来源未验证 |
| 双人冲刺 | NOT IMPLEMENTED | — | 按门禁未标记完成；不阻塞原委托 |
| 构建/回归 | PASS | targeted 60；Harmony 165；unsigned HAP 8,930,233 字节 SHA256 `90e26d8d…`；Web build；全量 281 文件 / 2179 条 | 见 `m4-20261117/full-tests.log`、`web-build.log`、`m3-native-import-20261117/` |
| 干净安装/可复现环境 | **FAIL/BLOCKED** | `env/report.json`、`env/clean-install.log` | `npm ci` EUSAGE：lock 与 package.json 不同步（缺 lie/immediate/duck/underscore）；现有 node_modules 有 29 项与声明不一致（next 16.2.11 vs 16.4.3、Prisma 7.8.0 vs 7.10.1 等）。不能据此启用试用 |
| 10/30 活动委托本地负载 | PASS（本地目标） | `load-10/report.json`、`load-30/report.json` | 10：accepted p95 387ms、first local p90 680ms；30：1,028ms / 1,776ms；零重复效果、零双租约、零 busy error；mock 吞吐不是云容量；foreground 样本偏少 |
| 真实模型 | UNVERIFIED | — | 本轮无新增付费授权；未调用 |
| 真机/HAP 安装 | UNVERIFIED | unsigned HAP 8,930,233 bytes，SHA256 `90e26d8d739a9fb1c92fe6a47656a856293be64fefa6ea0cead86223e58af86f` | 未签名、未安装、未做分享/通知真机 |
| 72 小时真实墙钟 | RUNNING（未满） | `long-run-72h/`（run.json/status-initial.log/status-mid.log/evidence.jsonl） | 2026-11-17 15:25 启动，72h 未到（预计 2026-11-20 15:25）；不得标记通过 |
| 受控试用发布包 | NOT READY | — | 依赖门禁：干净安装 FAIL、实模/72h/真机 UNVERIFIED |

## 72h 运行控制

```powershell
npm.cmd exec tsx -- scripts/v2-long-run.ts status --out evidence/v2-first-loop/m4-20261117/long-run-72h
npm.cmd exec tsx -- scripts/v2-long-run.ts resume --out evidence/v2-first-loop/m4-20261117/long-run-72h
npm.cmd exec tsx -- scripts/v2-long-run.ts report --out evidence/v2-first-loop/m4-20261117/long-run-72h
npm.cmd exec tsx -- scripts/v2-long-run.ts stop --out evidence/v2-first-loop/m4-20261117/long-run-72h
```

启动只代表运行中；`report.wallClockComplete=false` 时不能写成 72h 通过。进程使用隔离 SQLite、fixture provider，无付费调用；`stop.flag` 与 PID 双通道停止，`resume` 续跑并记录 resumeCount。

## 试用开关与回滚

- 默认关闭：`MISSION_ENABLED=false`、`MISSION_V2_ENABLED=false`、`MISSION_CHALLENGES_ENABLED=false`。
- 回滚：先 `stop` 长跑；保留事件/Output/Capture；关闭上述开关；`v2-rollout-check` 确认无 v2 行或全部 Worker 为 `r4-ux3-worker-v2`；不删除历史证据。不改真实数据库、不跑 seed/reset。
- 未授权事项：公开部署、邀请用户、付费模型调用、真实设备安装均未执行。
