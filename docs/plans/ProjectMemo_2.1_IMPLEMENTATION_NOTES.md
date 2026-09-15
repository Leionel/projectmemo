# 忆程 ProjectMemo 2.1 实施笔记

日期：2026-08-27

## 结论

- W00：`VERIFIED`（本地可重复构建、测试与证据目录已固化）。
- W01 原生 UI：`PARTIAL`（静态审视、代码修复和离线回归完成；目标 AVD 运行矩阵被模拟器环境阻塞）。
- S05 Inbox：`PARTIAL`。
- S06 Deliverable Gap：`PARTIAL`（本地规则回归通过，App 操作矩阵未完成）。
- S07 Notification：`BLOCKED`（AVD 无法通过 hdc 连接）。
- S09：按用户要求未执行；W03 小艺平台云工具已配置并保存，真实调试调用与 20 轮对账仍待执行。

## 本轮提交

- 代码批次：`248257a` — `fix: refine HarmonyOS UI states and controls`。
+ 证据批次：本文件与 `../../evidence/2.1/` 的 W00/W01 记录，提交号以包含本文件的 Git 历史为准。
- 未纳入：用户已有的 `ProjectMemo_2.1_PLAN.md` 修改、`next-env.d.ts`、浏览器运行日志、`output/`、`storage/`、`tmp/` 和其他本地运行产物。

## 网页设计优点向鸿蒙端的迁移

本轮没有修改网页代码，只把网页端已验证的交互模式迁移到 ArkUI：

1. `GlobalSettings` 的图标 tile、标题/说明、分组字段和主操作，迁移到 `Index.ets` 设置页；在线 API 与离线确定性引擎的字段边界现在明确。
2. 网页设置页的状态反馈迁移为“当前运行方式”“数据同步”“连通测试成功/失败”，不再用静态“网络正常”暗示实际状态。
3. `CaptureBox` 的标题/说明/来源选择/状态反馈迁移到 `ProjectHome.ets` 的“记录项目碎片”区；图片、PDF、文本沉淀的入口层级更一致。
4. `ActionBoard` 的主次操作和可恢复反馈迁移到行动卡片与完成弹窗；上传、空态、错误态、返回和设置入口补足 44–48vp 触达尺寸。
5. 选中状态不再只靠颜色：筛选、来源和引擎模式同时使用文字/勾号、边框和 `accessibilitySelected`；状态文字也会被无障碍标签播报。
6. 附件提取失败或 `NEEDS_OCR` 时保留真实状态并提供“重试提取”，不生成伪造记忆；重复上传的失败记录也不会被“已复用”成功文案遮蔽。

## 代码变更范围

- `DesignTokens.ets`：提高小字号与底部导航字号，降低极小文字在手机上的阅读负担。
- `AsyncStateView.ets`：错误重试和空态 CTA 统一为 48vp。
- `PMAppBar.ets`：返回与右侧操作统一 44vp 点击区。
- `Index.ets`：设置栏分层、在线/离线配置切换、真实同步状态、筛选/任务操作语义、创建项目和表单尺寸。
- `ProjectHome.ets`：项目设置说明、来源/上传/重试/文本沉淀状态与触达尺寸、项目内底部导航。
- `ActionBoard.ets`、`InterventionDetail.ets`：高影响操作与弹窗确认操作统一触达尺寸。
- `module.json5`：声明 `2in1` 设备类型；折叠屏仍以 AVD profile 抽测，不把它写成已验证的独立布局。
- `vitest.config.ts`：关闭文件级并行，消除测试对 `DATABASE_URL`/SQLite 单例的竞态，使 `npm.cmd test` 可重复。

## 最终回归

| 检查 | 结果 |
|---|---|
| Vitest | 13 files / 89 tests PASS |
| TypeScript | `tsc --noEmit` PASS |
| ESLint | PASS |
| Next.js production build | PASS；保留既有附件存储 NFT tracing warning |
| HarmonyOS Hypium | 23/23 PASS |
| S08 adapter | 8/8 PASS |
| HarmonyOS HAP | BUILD SUCCESSFUL；unsigned；1,565,158 bytes |
| HAP SHA-256 | `e6931284e799481ab03f913da6f570589b2d05c898191292a5ed6ff52820cee9` |
| whitespace check | `git diff --check` PASS |

## W01 验收边界

四个 AVD profile 均存在，但 `Emulator.exe -start "Pura 90" -instancePath ...` 返回退出码 1（`Unable to start the emulator`），随后 `hdc list targets` 为 `[Empty]`。历史 Pura 90 日志还记录主机可用内存低于 3 GB、Guest OS 启动后 hdc 未连接。完整回执见 `../../evidence/2.1/ui-matrix/W01-emulator-blocked.txt`。

因此本轮不宣称以下项目通过：Phone/Foldable/Tablet/2in1 截图与 `uitest dumpLayout`、大字体、键盘遮挡、慢网/乱序、深色模式运行矩阵、S05 图片/PDF 各 5 份模拟器回执、S06 10 次 App 操作、S07 系统通知权限/点击/冷热启动/Snooze/重启矩阵。后续代码批次 `28809bf` 已将深色语义色接入 `base/dark` 资源，但尚无新的目标设备截图或 dump，因此深色运行验收仍为 `UNVERIFIED`。

S05–S07 的离线状态与代码边界见 `../../evidence/2.1/inbox-gap-notification/W01-s05-s07-status.md`；原生 UI 审视见 `../../evidence/2.1/ui-matrix/native-ui-audit.md`。

## Deviations

### 2026-08-27｜W01｜目标 AVD 无法连接

- 计划要求：优先在四类目标 AVD 完成截图、布局 dump、无障碍和 S05–S07 手工矩阵。
- 代码实际：AVD 启动失败，`hdc` 无目标；无法取得真实运行回执。
- 采取方案：保留阻塞原始证据；完成不依赖设备的 ArkUI 审视、可恢复 UI 修复、HAP 构建和离线回归；禁止把静态检查写成模拟器通过。
- 影响范围：W01 运行矩阵和 S07 运行验收保持 `PARTIAL/BLOCKED`；不影响本地构建、单测和 2.0 核心闭环代码。
- 验证结果：见 `W01-final-regression.txt`、`W01-emulator-blocked.txt` 和本文件最终回归表。

### 2026-08-27｜W00/W01｜测试文件级并行竞态

- 计划要求：标准 `npm.cmd test` 可保存为可复核回执。
- 代码实际：测试文件修改 `DATABASE_URL` 并共享 Prisma 单例，默认并行会偶发 SQLite 事务超时。
- 采取方案：在 `vitest.config.ts` 固定 `fileParallelism: false`，不改变业务逻辑。
- 影响范围：测试耗时增加，但标准命令变为稳定串行回归。
- 验证结果：`npm.cmd test` 12/12 files、85/85 tests PASS。

## W01/W02 收尾补记｜2026-08-27

### W01

- 状态保持：W01 `PARTIAL`；S05 `PARTIAL`；S06 `PARTIAL`；S07 `BLOCKED`。
- 已有证据支持：原生 UI 静态审视、离线规则/契约回归、附件与 Gap 的代码边界，以及 AVD 启动失败和 `hdc` 空目标回执。
- 未宣称通过：四类设备运行截图、`uitest dumpLayout`、大字体/键盘/慢网/乱序、深色运行矩阵、S05/S06/S07 的模拟器人工矩阵。深色资源接线已在 `28809bf` 完成，但运行态仍 `UNVERIFIED`。

### W02

- 状态：`IMPLEMENTED / G2 BLOCKED`。
- 已完成：DeepSeek OpenAI-compatible chat 配置预设（`https://api.deepseek.com/v1` + `deepseek-v4-flash`）、provider 解析、设置页模型字段、独立 embedding provider 门槛、mock/keyword fallback 保留，以及 provider 错误脱敏。
- 本地验证：`npm.cmd test` 13/13 files、89/89 tests PASS；`tsc --noEmit`、ESLint 和 Next.js production build PASS。构建保留既有附件存储 NFT tracing warning，不影响退出码。
- 真实探针：按指定模型完成一次脱敏 DeepSeek chat 请求，HTTP 200，响应模型为 `deepseek-v4-flash`，存在 choices；没有保存完整响应或凭据。
- 验收边界：S03 20 样例、真实 embedding 和 S04 benchmark 均未运行；当前只关闭 provider chat 连通性子项，G2/Hybrid Search Gate 保持 `BLOCKED/UNVERIFIED`，不产生语义指标声明。DeepSeek chat key 不自动用于 embedding。
- 凭据边界：本轮没有把任何 API key 写入源码、`.env`、日志、证据或 Git。

### W03

- 状态：`PARTIAL / PLATFORM_TOOLS_CONFIGURED`。
- Edge 中已核对现有云插件 `ProjectMemo 记忆记录`：工具列表为 4 个，包含原有 `Memory_Recorded`，以及新增并保存的 `query_memory`、`inspect_project`、`create_action`。
- 三个新增工具均指向 `https://project.luojiatutor.xyz`，接口路径分别为 `/xiaoyi/v1/memories/search`、`/xiaoyi/v1/projects/inspect` 和 `/xiaoyi/v1/actions`；输入参数已按本地严格 schema 配置，包含必需的 Header `Authorization` 字段，且工具开关已开启。
- `create_action` 保留两步语义：`confirmed=false` 只预览提案，`confirmed=true` 通过 `proposal_id` 提交；未在平台输入或传输任何 API key/适配层 Token。
+ 三个新增工具当前显示“未调试”。本轮未执行平台远程调试、20 轮正常/负向调用、`proposal_id`/`action_id` 对账或 App 同 ID 验证，因此 G3 仍为 `UNVERIFIED`，不宣称真实平台闭环已通过。配置回执见 [`../../evidence/2.1/xiaoyi/W03-platform-tool-config.md`](../../evidence/2.1/xiaoyi/W03-platform-tool-config.md)。

#### 2026-09-03 公网复核

- `GET https://project.luojiatutor.xyz/health` 返回 200，确认 HTTPS、Nginx 与 ProjectMemo 服务在线。
- 无效鉴权探针显示 `record_memory` 路由存在并返回 JSON 401；`query_memory`、`inspect_project`、`create_action` 均返回 HTML 404，确认 ECS 仍是只含最早 tracer bullet 的旧版本。
- 已新增公开版本指纹、四能力声明、无写入公网预检和显式确认的 20 轮对账脚本；部署教程增加安全更新流程。
+ W03 状态更新为 `PARTIAL / DEPLOYMENT_DRIFT`。部署新提交并完成 App/平台同 ID 对账前，G3 仍不通过。详见 [`../../evidence/2.1/xiaoyi/W03-public-audit-20260903.md`](../../evidence/2.1/xiaoyi/W03-public-audit-20260903.md)。

#### 2026-09-04 防部署漂移验证

- 新增的本地 production preflight 六项检查全部通过；同一脚本对公网旧版本返回失败，精确识别三个 HTML 404、缺失 2.1 schema、版本指纹和能力列表。
- 当前回归：Vitest 17 files / 111 tests、TypeScript、ESLint、Next.js production build、W05 40/40 benchmark、HarmonyOS Hypium 27/27 和 HAP 构建全部通过。
- 当前 unsigned HAP：1,820,804 bytes，SHA-256 `9a6d7b0c42a0d3e1e112e75cbdd8ca6a2db89ddf95f3c13cf3f919997261e8f3`。
- 本轮没有真实适配层 Token，因此没有运行 `verify:w03-live`，也没有产生任何公网项目写入；W03/G3 状态保持 `PARTIAL / DEPLOYMENT_DRIFT`。
- 上线前依赖复核将 Next.js 从 `16.2.10` 补丁升级至 `16.2.11`，并同步 `eslint-config-next`；升级后 TypeScript、111 项测试、ESLint 和 production build 复跑通过，Next 自身命中的 9 条直接公告已不再出现。
- `npm audit --omit=dev` 仍报告 13 项间接依赖告警（9 high、4 moderate），主要沿 Next 的 PostCSS/Sharp 和 Prisma CLI 工具链进入。`npm audit fix --dry-run` 会大幅改动依赖树并尝试调整 Prisma 版本，因此本轮未执行自动修复；不能宣称依赖审计清零。

#### 2026-09-07 工作流关联 ID 辅助路由

- 本地新增 `POST /xiaoyi/v1/requests/begin`，作为小艺工作流的首个内部辅助节点。它要求 Bearer 鉴权、`XIAOYI_ADAPTER_ENABLED=true`、固定 `XIAOYI_TEST_PROJECT_ID` 和现有限流；不要求客户端提供 `request_id`，不接受 `project_id`，只返回 `ok`、UUID `request_id` 和 `issued_at`。
- `begin_request` 不创建 KnowledgeCard、Action 或 `AgentRun`。当前 `AgentRunType` 没有自然的“工作流启动”枚举，因此不伪造 `agent_run_id`。健康检查仍把四项 S08 业务能力列在 `capabilities`，另列 `workflow_helpers: ["begin_request"]`，避免把辅助节点宣传成第五项业务能力。
- 小艺平台配置方案：第一个插件节点只配置 Authorization Header；将输出的 `request_id` 映射给 `record_memory`、`query_memory`、`inspect_project` 和 `create_action`，其中 create_action 的预览/确认两阶段复用同一个 ID。单次工作流内关联成立，但整轮重试会重新生成 ID，不能据此宣称跨整轮重试幂等。
+ 本轮未部署 ECS、未操作平台、未运行 `verify:w03-live`，因此 W03/G3 仍为 `PARTIAL / DEPLOYMENT_DRIFT`，平台真实调用、20 轮对账和真机小艺入口保持 `UNVERIFIED`。完整边界见 [`../../evidence/2.1/xiaoyi/W03-platform-tool-config.md`](../../evidence/2.1/xiaoyi/W03-platform-tool-config.md)。
- 本地回归：S08 专项 12/12、全量 Vitest 20 files / 128 tests、健康检查 2/2、TypeScript、ESLint、Next.js production build、HarmonyOS Hypium 27/27、HAP build 和 `git diff --check` 通过；production build 仅保留既有 NFT tracing warning，HAP build 仍有既有弃用 API 警告。公网预检仍需在 ECS 更新到本批提交后重跑，不能以本地通过替代平台验收。

## W04 本地实现｜2026-08-30

- 状态：`IMPLEMENTED / LOCAL G4 PASS / AVD RUNTIME PENDING`。
- 已完成：CardRelation additive migration、时态有效性和当前事实计算、跨项目/自环/成环保护、提议/确认/撤销/时间线 API、Search 兼容字段、HarmonyOS 决策演化 UI 与确认/撤销操作。
- 回归：Vitest 14 files / 101 tests、Temporal 专项 12/12、TypeScript、ESLint、Next.js production build、HarmonyOS Hypium 27/27、HarmonyOS HAP 均通过。
+ benchmark：60 组规则型人工定义样例通过，指标与逐例预测写入 `../../evidence/2.1/temporal/benchmark.json`；该结果用于确定性回归，不冒充真实项目盲测。
+ 未宣称通过：DevEco AVD 两卡片纵向运行、截图/布局 dump 和真实项目独立标注。完整边界见 [`../../evidence/2.1/temporal/W04-local-implementation-status.md`](../../evidence/2.1/temporal/W04-local-implementation-status.md)。

## W05 本地实现｜2026-09-02

- 状态：`IMPLEMENTED / LOCAL GATE PASS / AVD RUNTIME PENDING`。
- 已完成：claim 级证据回执、三态确定性判定、旧/冲突/跨项目引用拦截、拒答、`AgentRun.trace` 审计、来源 run 写闸门、Web/HarmonyOS 回执展开和 40 题规则门禁。
- 回归：Vitest 15 files / 107 tests、W05 40/40 benchmark、TypeScript、ESLint、Next.js production build、HarmonyOS Hypium 27/27、HarmonyOS HAP 均通过；unsigned HAP SHA-256 为 `9dde65e14c4f386fbae95fd2d198d4093f3456a3be953d13140bafc01e6bc0f0`。
- 回退：`EVIDENCE_TRUST_RECEIPT_ENABLED=false` 恢复 2.0 引用展示与旧写操作确认路径。
- 边界：不把规则型 benchmark 当真实项目盲测；不宣称 DevEco 模拟器中的深色、大字体、键盘、读屏与渲染表现已通过。
+ 详情：[`../../evidence/2.1/trust/W05-local-implementation-status.md`](../../evidence/2.1/trust/W05-local-implementation-status.md)。
