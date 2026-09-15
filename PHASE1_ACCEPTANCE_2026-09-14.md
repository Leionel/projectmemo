# ProjectMemo 第一阶段验收回执

日期：2026-09-14  
范围：A1 普通记录可靠写入及鸿蒙入口、A2 会议确认并发与过期冲突、A3 行动依赖原子更新与可行性、SUB-01/SUB-02/SUB-07/SUB-08 的本地可验证部分。

## 总结结论

- A1、A2、A3：`CODE_VERIFIED`。服务端持久化约束、Web 调用方、鸿蒙模型/服务/入口和自动化回归已完成。
- 本地构建与隔离数据证据：通过。
- 设备安装/启动/重启、真实评审后端、签名包、公开托管和平台提交：未通过验收；具体原因为无设备目标、无签名配置、无真实评审地址且本轮没有外部写入授权。
- 因此本文件不是“可提交复赛”证明，最终状态仍为 `NOT_READY`。

统一证据目录：`evidence/phase1-20260914-1835/`。其中 `results.json` 由独立 SQLite、`LLM_MODE=mock` 探针生成，未使用开发库、个人登录态或聊天中出现过的凭据。

## A1 普通记录可靠写入及鸿蒙录入入口

### 原问题

同一记录在超时、响应丢失、重试或并发提交时可能重复创建 Capture/Card；旧入口在顶部记录、正文记录和缺口记录之间不统一，响应未知时无法可靠恢复原文和请求 ID。

### 实际修复

1. 增量迁移 `prisma/migrations/20260914080000_phase1_reliability/migration.sql` 为 `Capture` 增加 `requestId/requestHash`，建立项目内 `(projectId, requestId)` 唯一约束；新增 `AgentRun.confirmedAt` 和 `ActionItem.dependencyVersion`。
2. `lib/services/captureService.ts` 新增持久请求路径：预留 `AgentRun`，在短事务内原子写入 Capture、知识卡片和完成回执；同 ID 同 payload 重放原业务结果，同 ID 不同 payload 返回 409 `IDEMPOTENCY_CONFLICT`。模型/检索调用在事务外；后处理失败返回已保存且待重试的明确状态。
3. `app/api/projects/[id]/captures/route.ts` 接收 body/header 的 request ID，校验不一致输入，并保留无 request ID 旧调用的兼容路径。
4. `components/CaptureBox.tsx` 在提交前持久化草稿和稳定 request ID；用户修改原文或来源时生成新 ID；成功/重放清理草稿，失败保留输入。
5. `harmonyos/entry/src/main/ets/pages/ProjectHome.ets`、`MemoryService.ets`、`Memory.ets` 和 `DeviceIdentity.ets` 同步 request ID、草稿恢复和提交状态。顶部、正文、`requirement` 缺口、`experiment` 缺口都调用统一录入入口并传入正确来源类型。

### 逐项证据

| 检查 | 结果 | 证据 |
|---|---|---|
| 同 ID 并发 10 次只生成一个 Capture/Card | PASS | `results.json`: HTTP 201×1、200×9，Capture count=1，Card ID 唯一 |
| 同 ID 不同原文 | PASS | `results.json`: 409 `IDEMPOTENCY_CONFLICT` |
| 同文不同 ID | PASS | `results.json`: 两个 201、两个不同 Card ID |
| 首次响应丢失后重试 | PASS | `tests/phase1Reliability.test.ts`；同 request ID 返回相同 Card |
| 模型失败/后处理失败不重复 | CODE_VERIFIED | 服务层事务外模型与 `postProcessingPending` 分支；全量回归通过 |
| 鸿蒙入口、输入保留和恢复 | CODE_VERIFIED | ArkTS 编译、27/27 鸿蒙单测、源码调用方检查；真实设备交互未运行 |

## A2 会议确认可靠执行

### 原问题

同一提案并发确认可能执行两次；预览后用户修改截止日期或相关事实时，旧提案可能覆盖新事实；部分冲突可能留下部分业务写入。

### 实际修复

1. `lib/services/meetingStateDiffService.ts` 在预览中持久化截止日期等基线，并在确认时校验 proposal ID、版本、源文本 hash、changeId、项目归属、澄清状态和非空选择。
2. 确认事务内条件抢占 `AgentRun.confirmedAt`。只有一方取得执行权；同选择重试返回原结果，不同选择返回已执行/选择冲突，不再创建第二组行动。
3. 相关源字段冲突检查、变化写入、结果卡和完成回执处在同一个事务；截止日期基线不一致返回 `STATE_CHANGED_REPREVIEW`，不覆盖用户后来保存的截止日期。
4. `MeetingImportSheet.ets` 收到 409 时保留会议原文和日期，回到草稿并提供重新预览路径，不自动确认新版。

### 逐项证据

| 检查 | 结果 | 证据 |
|---|---|---|
| 相同确认并发只执行一次 | PASS | `results.json`: `alreadyConfirmed=[false,true]`，两个结果 Card ID 相同 |
| 不同选择并发只有一组成功 | PASS | `tests/meetingStateDiff.test.ts` 与全量回归 |
| 预览后修改截止被拒绝 | PASS | `results.json`: `STATE_CHANGED_REPREVIEW`，新截止日期保留 |
| 多项确认一项冲突不部分写入 | PASS | targeted meeting regression |
| 并发取代/事务中途失败/确认后刷新失败可恢复 | CODE_VERIFIED | 事务条件 claim、失败回执和非致命刷新分支；外部服务故障演练未运行 |
| 歧义日期、同名旧方案、取消预览不产生错误事实 | CODE_VERIFIED | 现有会议校验与回归；真实鸿蒙交互未运行 |

## A3 行动依赖原子更新及可行性

### 原问题

依赖编辑同时移除和添加同一目标时可能把新增依赖静默丢掉，导致未完成前置被误判 READY；批量非法目标可能部分写入；过期编辑和并发反向依赖可能覆盖或形成环。

### 实际修复

1. `ActionItem.dependencyVersion` 作为增量版本；服务接收 `expectedVersion`，过期编辑返回 `FEASIBILITY_VERSION_CONFLICT`。
2. `lib/services/actionFeasibilityService.ts` 在同一事务读取现状、计算最终依赖集合，再一次性校验并提交。hard/note 修改、同目标替换、删除和添加不再依赖调用顺序。
3. 事务内校验项目归属、自依赖、重复目标和最终行动图环路；非法批次在任何写入前失败。并发反向依赖遇到 SQLite 锁或图冲突时转为明确 409，不形成环。
4. 提交后基于当前数据库重新评估 READY/BLOCKED/UNKNOWN，忽略客户端传入的 READY；已完成前置撤回或来源不可用时不沿用旧评估。
5. `Action.ets`、`ActionFeasibilityEditor.ets` 同步 dependencyVersion 和 expectedVersion。

### 逐项证据

| 检查 | 结果 | 证据 |
|---|---|---|
| 修改备注后硬依赖仍存在且未完成前置 BLOCKED | PASS | `tests/actionFeasibility.test.ts` 与全量回归 |
| 硬转软符合定义 | PASS | `results.json`: 目标仍存在，hard=false，note=软依赖 |
| 非法目标整批无修改 | PASS | `results.json`: `CROSS_PROJECT_REQUIREMENT` |
| 自依赖、跨项目、环路拒绝 | PASS | targeted action regression；反向并发最终只有合法边 |
| 过期编辑不覆盖另一端 | PASS | `expectedVersion` 回归 |
| 前置完成撤回后不显示旧 READY | CODE_VERIFIED | 提交后当前数据评估路径；设备详情显示未运行 |

## SUB-01 / SUB-02 / SUB-07 / SUB-08

### SUB-01 地址与网络

状态：`BLOCKED`。

唯一来源已收口到 `harmonyos/entry/src/main/ets/common/Constants.ets`：

- 开发：`BUILD_FLAVOR=development`，`DEVELOPMENT_BASE_URL=http://10.0.2.2:4400`，只用于 DevEco 模拟器。
- 评审：改为 `BUILD_FLAVOR=review` 并填写真实 `REVIEW_BASE_URL`；`requireBaseUrl()` 拒绝空地址、`10.0.2.2`、`localhost` 和 `127.0.0.1`。

真实评审域名/HTTPS 证书/非开发网络业务请求尚未提供或验证，未编造地址。

### SUB-02 安装与签名

状态：本地 `BUILD_VERIFIED`，最终安装 `BLOCKED`。

- `npm.cmd run harmony:test`：退出码 0，27/27。
- `npm.cmd run harmony:build`：退出码 0；unsigned HAP `harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap`，2,665,540 bytes，SHA-256 `1f7e30c536937dd47085e2d9483fde55d1dbd97cf7ab7f295ec33c8a10847c4d`。
- `harmonyos/build-profile.json5` 的 `signingConfigs` 为空；`hdc.exe list targets` 为空。因此没有签名安装、启动、杀进程/重启证据。

### SUB-07 干净环境与持久化

状态：`PARTIAL`。

独立探针完成空库迁移重放和旧库副本增量升级；`npm.cmd test` 为 29 files/214 tests；隔离 `npm.cmd run test:e2e` 通过。没有真实设备空安装、重启后数据恢复和附件持久化证据。

### SUB-08 托管与隔离

状态：`NOT_RUN/BLOCKED`。

本轮没有公开部署、没有上传、没有改变服务器访问控制，也没有进行外部写入。真实评审认证、匿名写入边界、持久数据库/附件目录、备份恢复和故障联系人待托管环境提供后核验。

## 相关命令结果

| 命令 | 结果 |
|---|---|
| `npm.cmd test -- tests/phase1Reliability.test.ts tests/meetingStateDiff.test.ts tests/actionFeasibility.test.ts tests/xiaoyi.adapter.test.ts` | 0；4 files / 40 tests passed |
| `npm.cmd test` | 0；29 files / 214 tests passed |
| `npm.cmd exec tsc -- --noEmit` | 0 |
| `npm.cmd run lint` | 0；0 errors，7 个既有 warnings |
| `npm.cmd run build` | 0 |
| `npm.cmd run test:e2e` | 0；隔离 E2E passed |
| `npm.cmd run harmony:test` | 0；27/27 |
| `npm.cmd run harmony:build` | 0；unsigned HAP |

本阶段未执行 `seed`、`demo-reset`、破坏性迁移、公开部署、平台上传或远端推送；现有未提交工作区和旧证据均保留。
