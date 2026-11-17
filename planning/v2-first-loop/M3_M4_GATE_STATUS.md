# M3/M4 Gate（2026-11-17 接手修复后）

基线 `04b4b732`；工作树 `D:/Projects/hongmen-worktrees/v2-first-loop`；分支 `codex/v2-first-loop`。修复明细、接口、验证与回退见 `REVIEW_M3_M4_20261117.md`，新证据在 `evidence/v2-first-loop/review-20261117/`。

**M4 未通过，受控试用不放行。** 本地 M3 代码缺项已补；设备、实模、内容与长期价值仍有门槛。

| 项目 | 当前结论 | 可核查证据 |
|---|---|---|
| 原生材料/分享 | 合约与构建 PASS；真机 UNVERIFIED | 全格式服务端字节校验、单文件分享、预览确认、全文请求绑定；Harmony 165/165、unsigned HAP 8,941,026 bytes |
| 挑战隐私/指标/回访 | 本地 PASS | 超 24 事件、退出/交回后删除、派生链抑制、30 天访问清理、单选/重复指标、单调回访游标回归 |
| 双人冲刺 | Web 可点击闭环 PASS；真实用户与原生界面 UNVERIFIED | 3 个真实 Step 回执、1 份稿、丢包重试；结束不推进/暂停 Mission；360px 截图 |
| 环境与生产构建 | PASS | npm ci、Prisma 7.10.1 生成、隔离空库迁移、Next 16.4.6 生产构建；当前工作树安装差异 0、.env 保留 |
| DOCX 生产运行 | PASS | Worker typed array 包装修复；HTTP DOCX=200、非法 UTF-8=422、预览不写 Mission；不代表 OCR/复杂排版覆盖 |
| 回归 | PASS | 干净环境全量 283 文件 / 2193 条；随后 CLI/DOCX 定向 21 条；tsc、scoped eslint、Harmony 构建 |
| 生产依赖审计 | PASS（已知公告扫描） | npm audit --omit=dev 为 0；开发依赖 7 项 moderate 保留，未全库升级 |
| 10/30 本地协调 | PASS（fixture） | 两个 OS 进程；实际运行 4/12 个可运行委托，其余保持等待/有效租约；accepted 与首次结果达本地目标、前台样本不少于 30；不代表云容量或实模聊天并发 |
| 64 冻结路由 | 模式/序列无误；完整评分 PARTIAL | 完整评分 39/64；25 个内容判据未证明，安全违反 0、关键失败 0；没有改冻结答案 |
| 四场景持续改稿 | 协议/结构 PASS；内容 UNVERIFIED | localhost HTTP mock：40/40 协议、24/24 结构，16 项语义未验；首发人群仍是待验证假设 |
| 原 72h | INTERRUPTED | 原进程已退出，存在 6,534 秒心跳空档；升级前协作停止；未计入新窗口 |
| 新 72h | RUNNING，未满 | 2026-11-17 19:00:28 新窗口；隔离 SQLite、fixture、每小时新材料、总预算 240 模型/640 工具；首稿已产出 |
| 无人值守恢复 | PARTIAL | 任务计划注册被系统以 0x80070005 拒绝；未提权。当前用户隐藏后台宿主短跑通过；注销/休眠/重启/Codex 退出后的存活未验 |
| 实模、真机与真实授权来源 | UNVERIFIED | 无付费调用、设备安装或真实来源样本；不以 synthetic 数据代替 |

没有新增 Schema/Migration；Codex `/root` 是唯一负责人。没有迁移真实库、seed/reset、公开部署、邀请用户或外发。

## 新窗口操作

```powershell
npm.cmd exec tsx -- scripts/v2-long-run.ts status --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts report --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts stop --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts resume --background-host --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
```

机器应保持当前用户登录和唤醒。启动与 report 的时间差不能证明在线；需 `coverage.reliabilityGatePassed`、资源与故障证据同时满足。预计窗口结束为 2026-11-20 19:00:28；中断必须保留，超过窗口仍不通过时另起新窗口。运行态文件不跟踪，`run.snapshot.json` 与初始心跳是冻结证据。

## 回退

先由支持 V2 的 Worker 暂停并排空槽，再关闭 V2 开关、冻结 V2 行；继续使用能跳过 V2 的新 Worker 消费 V1。存在 V2 行时不能换回不识别协议版本的旧 Worker。最近一份心跳不能替代全部进程清单。保留数据库、事件和历史成果，按切片反向 revert 代码；不做 schema 回退。
