# 持续运行可靠性切片

基线 `9c7b256`。范围：用户离开页面、Worker 重启、材料重复到达、控制指令并发时，同一 Mission 的成果、预算、许可与证据链一致。复用既有扫描器、事件、租约、持久游标，未建事件平台、无新增迁移。

## 复现并修复的缺口

1. **相同内容重传唤醒模型周期**：`investigationInputHash` 含来源 id，新 Capture 行即使内容相同也会唤醒 Mission。修复：增加忽略 id 的内容指纹（集合化、排序、去空白），扫描器在结构哈希变化但内容指纹相同时只更新检查游标并记一次 `INVESTIGATION_DUPLICATE_IGNORED`，不唤醒、不耗模型；检查点释放时同时持久化 `inputHash/contentHash`。
2. **项目摘要被观察等待挤掉**：`missionWorkspaceSummary` 只按 `updatedAt` 取 3 条等待任务，大量 `waitingFor=OBSERVATION` 会挤掉真正 `waitingFor=USER` 的判断。修复：先用 SQLite JSON 谓词查询用户需处理的行（含 `waitStateJson` 为 NULL 的历史行），再补最近活动；观察等待不再占用户判断名额。
3. **v2 行在关闭开关时被错误认领**：旧 `claimMission` 先认领再在 `fenced` 抛 `MISSION_V2_DISABLED`，会改写 v2 行状态。修复：认领查询和过期 `RUNNING` 清理都按协议版本过滤（关闭时只认 v1），未知版本永不被认领；Worker 启动时检查迁移列和“关闭开关但存在 v2 行”并中止。
4. **混合 Worker 升级风险**：Worker 版本标识升级为 `r4-ux3-worker-v2`；新增只读 `v2-rollout-check` 与 `inspectV2Rollout`，按“迁移列 / v2 行数 / 开关 / Worker 构建 / 身份”给出 `V1_ONLY_SAFE / V2_READY / BLOCKED`，失败退出码 2。

## 故障注入与竞态验证（真实隔离 SQLite + 真实 Runner 子进程）

- `tests/v2FaultInjection.test.ts`（8/8）：独立 Node 进程先后执行真实 Runner。
  - 读取后崩溃 → 新进程从同一 Mission、同一证据链续到下一检查点；
  - 产稿提交前崩溃（退出码 137，步骤停在 RUNNING）→ 租约过期后新进程重跑未完成步骤，只提交一个 revision；
  - 检查点提交后崩溃 → 新进程读回状态，100 次扫描不重复产稿、预算不变；
  - 两个 Worker 进程同时竞争一个 READY Mission → 恰好一个认领、一次写入；
  - 规划/研究/复盘/创作四种交付各由第二个进程恢复（阶段成果与报告版本）。
- `tests/v2ContinuityReliability.test.ts`（5/5）：40 个同内容 Capture / 100 次重复扫描不唤醒；真实内容变化只唤醒一次；乱序到达折叠为一个有界观察；交付后 100 次扫描无自唤醒；并发扫描/Worker 串行。
- `tests/v2ControlConcurrency.test.ts`（7/7）：新材料与暂停/取消并发不会在停止后派发；改道指令与新资料竞争只产生一版且绑定新工作重点；撤权、许可到期在派发前停住且保留草稿；4 个长期周期预算单调、预留归零、未知用量失败不清零；20 个观察等待 Mission 不挤掉用户判断摘要。
- `tests/v2RuntimeReliability.test.ts`（5/5）：`vi.setSystemTime` 推进时钟验证 `nextAttemptAt` 到期才唤醒、过期租约被回收；关闭 v2 时 Worker 不清理/不认领 v2 行；升级门四种状态；长时运行脚本冒烟。
- 模拟时钟只验证调度语义，**不写成 72 小时真实运行**。

## 长时运行与升级操作

```powershell
# 有界冒烟（本轮证据就是这种，10 个周期）
npm.cmd exec tsx -- scripts/v2-long-run.ts start --out evidence/.../long-run --interval-ms 30 --cycles 10 --material-every 2 --wait
# 真实长跑：去掉 --wait，用 intervals/cycles 覆盖目标时长；随时注入材料/状态/停止/报告
npm.cmd exec tsx -- scripts/v2-long-run.ts material --out <dir> --text "新增材料"
npm.cmd exec tsx -- scripts/v2-long-run.ts status --out <dir>
npm.cmd exec tsx -- scripts/v2-long-run.ts stop --out <dir>
npm.cmd exec tsx -- scripts/v2-long-run.ts report --out <dir>
# 混合升级门（只读，退出码 2 = 必须停止升级流程）
npm.cmd exec tsx -- scripts/v2-rollout-check.ts
```

本轮冒烟证据：`long-run/evidence.jsonl`、`run.json`、`status.log`、`report.json`，10 个周期、3 版成果、4 个观察等待、预算单调且预留归零；报告明确标注“只覆盖实际执行窗口，不是 72h 证明”。数据库文件不入库（`.gitignore`），命令可重放。

## 契约与迁移

- 无新增 Schema/Migration；复用 `runtimeProtocolVersion`、`planJson`、事件与租约。
- Web 构建通过；工作台 API 字段未改。Harmony 合约测试 155/155 通过（依赖 `oh_modules` 从原检出本地补齐，未改 ArkTS 源码）；未做真机/HAP。
- V2 仍默认关闭；旧 v1 路径与 finish 语义未改；旧 Worker 混跑由版本标识 + 升级门 + 启动中止三重防护。

## 验证汇总

- 全量：272 文件 / 2124 条通过（`full-tests.log`）。
- 定向：17 文件 / 131 条通过（`targeted-tests.log`）；故障注入 8、控制竞态 7、运行可靠性 5、去重回归 5。
- tsc / scoped eslint / webpack 构建通过（`tsc.log`、`eslint.log`、`build.log`）。
- 历史失败与修复前日志保留在 `history/`（相同内容唤醒、摘要被挤、升级门身份条件等）。

## 剩余限制

- 未执行真实 72 小时运行；模拟时钟与 10 周期冒烟不能替代长跑。
- 未用真实旧 Worker 二进制混跑（只验证版本/身份门与代码路径）；生产启用前须在目标环境跑 `v2-rollout-check`。
- 未进行真机/HAP 验证；本轮无付费模型调用、无生产部署、未改真实数据库。
