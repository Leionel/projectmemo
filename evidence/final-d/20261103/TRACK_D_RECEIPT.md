# Track D 最终回执：鸿蒙原生消费四问工作包与回原对象（D1/D2/D3 分账）

- 日期：2026-11-03（UTC+8，Asia/Shanghai）
- 工作树：`D:/Projects/hongmen-final-d-harmony-native`
- 分支：`codex/final-d-harmony-native`
- 固定同步检查点：`4b696141435825a3582816e8e449c0e0cf013f29`（4b69614，快进自 485d485，无独有提交、无 reset/clean/stash）
- **候选源码提交：`721ab37a5eb344412cfe86cbcb2a00a8e9acc79e`**（19 文件，+2327/−217；父提交 4b69614）
- 本回执与 `evidence/final-d/**` 作为同一候选的后续证据提交（提交 SHA 见 git log；不回写源码提交）
- 未 push、未合 master、未部署、未迁移用户真实库、未复制 `.env`/签名私钥、无付费调用/外部写入

## 1. 本轮实际改变（用户行为）

### D1 — 手机读懂同一 optional workPacket

- 新增 `harmonyos/entry/src/main/ets/models/WorkPacket.ets`：按 4b69614 源码 `lib/types/workPacket.ts`（`final-a-workpacket-v1` / `schemaVersion 1`）适配真实序列化 JSON。
  - 以 `known` 标记区分「字段不存在（旧服务）」「显式 null」「未知枚举」；不使用 `new` 类默认值把后端 null 显示成 0/空串/成功。
  - 未知主动作/阻断/观察枚举保留原文并显示“请更新客户端”，不映射成 `NONE` 或成功。
  - 未知合同版本/更高 `schemaVersion` 不解释业务字段，提示更新客户端，原委托详情仍可用。
  - 旧后端无 `workPacket` 时返回 null，页面退回原详情并说明摘要未提供。
  - `readbackDelta()` 还解析顶层 `readAt/observation/materialUses[].currentUse/revisionAvailability/availabilityMeaning`。
- 新增 `components/MissionWorkPacketView.ets`：同一工作包的四问摘要（做到哪/依据/为什么停/下一步）、唯一主动作、全部阻断（可展开）、技术细节（可展开：合同版本、快照一致性、身份/版本、`requires`、覆盖窗口、realityOutcome）。
- `components/MissionReadbackView.ets`：新增 `mode='packet'|'full'` 与 `onPrimaryAction`；概况页只呈现工作摘要，进展页保留原结果/回执读回；读取时间与观察时间分开。
- `pages/MissionDetail.ets`：概况页接入工作摘要；主动作路由到原 question/approval/output/receipt/mission；旧问题/被替代提案回当前委托重新核对，不生成另一任务；`snapshot.consistency=VERSION_ADVANCED` 时禁用旧版本提交；409（含 `WORK_PACKET_AUTHORITY_CHANGED`）保留答复/所选资料草稿并重读；403/404 清卡片私有快照；卡片 `handoffMissionVersion/handoffExpired` 只作历史线索提示，不作授权。
- 未新增客户端批准端点、未新增执行器/状态库、未在客户端重算 phase 或优先级；`requires` 只展示为“服务端提交时重查的版本要求”，不是客户端凭据。

### D2 — 回原问题/批准/结果；来源与时间语义

- 入口原对象身份：Focus（`GlobalFocusPanel`）、项目（`ProjectHome` 焦点卡/`MissionPanel` 列表）、问忆程（`CopilotContinuationCard`/`FocusConversation`）、系统卡片/通知（`EntryAbility`/`WidgetCard`/`Index`/`ProjectHome`）打开时回到原 mission，并携带 question/approval/source/output/receipt 身份与卡片版本线索；过期意图只保留 mission 身份并提示“旧问题不会被当成新问题”，不自动选中/批准旧提案、不新建任务。
- 前台热启动：`pm.handoffSeq` 让页面在 App 已在前台收到新 Want 时消费一次意图；消费后立即清除，避免重复/跨页双跳。
- 来源：`currentUse`（ALLOWED/SUPPRESSED/UNKNOWN）、`revisionAvailability`、历史 facts 分开呈现：当前可用不等于独立支持；被抑制/许可未知不作为当前依据；`UNAVAILABLE + excerpt=null + facts>0` 明确“正文当前不可读、历史关联仍保留（不是记录被删除）”。
- 时间：读取时间（`readAt`/旧 `observedAt` 读取时刻）与 Worker 成功观察时间（`observation.lastSuccessfulAt`/`workState.observedAt`）分开；卡片 `updatedAt` 只是同步时刻；`FAILED_LAST`/`NOT_OBSERVED` 不显示“最近成功观察”；刷新不推进成功观察时间。
- 停止/UNKNOWN：停止请求在途显示“尚未结算、不会继续派发新步骤”；UNKNOWN 显示“原状态待核对”，不显示成功勾选；CANCELLED 终态明确“已取消（不是成功）”。
- 卡片 TTL：`min(5 分钟, 会话期限)`，会话期限缺失/不可解析时按不可用处理；观察时间与同步时间分开展示。
- 401/403：MissionDetail/ProjectHome/FocusConversation/WidgetDataService 清私有内容、草稿与卡片快照；迟到响应由 generation + token + owner 栅栏拒绝。

### D3 — 工程与设备分账

- 原生合同测试：本候选 `harmony:test` = **Tests run 133 / Failure 0 / Error 0 / Pass 133 / Ignore 0**（新增 `WorkPacketContract.test.ets` 16 项真实 JSON 正/负例、`WidgetHandoff.test.ets` 8 项纯函数用例；既有 109 项未变）。
- 候选 unsigned HAP 构建通过（见 §3）；signed 安装、系统交互、设备旅程 **NOT_RUN**（原因与恢复条件见 §5）。
- 环境与设备重新探测（模拟器曾短暂 Connected 后退出、当前离线、非真机），见 `d3/ENVIRONMENT_PROBE.json`、`d3/DEVICE_STATUS.md`。
- 同任务 Web/API 读回同身份（隔离库进程内真实业务路径）：19/19 断言 PASS、exit 0、清理后行数归零；负例 B 账号/跨委托 404。见 `d3/BACKEND_READBACK_RESULT.md`。
- 小艺/Intents/系统分享/穿戴/完整离线平台：未接入，也未宣称。

## 2. 候选源码身份与提交

| 项 | 值 |
|---|---|
| 固定检查点 | `4b696141435825a3582816e8e449c0e0cf013f29` |
| 候选源码提交 | `721ab37a5eb344412cfe86cbcb2a00a8e9acc79e` |
| 提交父 | 4b69614 |
| 文件分母 | 19 文件：14 M + 5 A |
| frozen 源码树 digest | `sha256(sorted "relpath\|sha256", LF)`，221 文件 = `39646e8f6eeb0bd633b02b69b299329c4d9248431544654e0e15a76cbc375e68`（构建前/后一致，来自 `d3/FROZEN_SNAPSHOT.json`、`d3/BASELINE_UNSIGNED_HAP.json`） |
| 未提交改动 | 仅 evidence/final-d 文档（本回执及 D2/D3 证据）；无 harmonyos 源码增量 |

## 3. 实际测试与退出码（本候选，不沿用旧 PASS）

| 命令 | 退出码 | 真实结果 | 证据 |
|---|---|---|---|
| `npm.cmd run harmony:test`（Lead 迭代） | 0 | Tests run 133 / Failure 0 / Pass 133 | `tmp/d-final/20261103/d1d2-test-run6.log`（工作树内临时日志，未提交） |
| `npm.cmd run harmony:test`（FROZEN 快照，D3 独立跑） | 0 | Tests run 133 / Failure 0 / Error 0 / Pass 133 / Ignore 0；hvigor BUILD SUCCESSFUL 53s982ms | `d3/BASELINE_TEST.log`、`d3/BASELINE_TEST.exit`、`d3/FROZEN_SNAPSHOT.json` |
| `npm.cmd run harmony:build`（FROZEN 快照） | 0 | BUILD SUCCESSFUL 4m32s737ms；unsigned HAP 8,273,912B；`9c935302a720a34c2cf845f9a0528806d502f23364f07788650d0e9020164629`；mtime 2026-11-03T15:20:40.808+08:00；hvigor 明确 `No signingConfigs profile is configured` → unsigned | `d3/BASELINE_BUILD.log`、`d3/BASELINE_UNSIGNED_HAP.json` |
| 同身份读回探针（隔离库、LLM_MODE=mock、127.0.0.1） | 0 | 19/19 PASS；createMission→input→approval→readback 的 mission/question/approval/output/receipt ID 逐项一致；负例 404 正确；`cleanup.done errors=0`；前后 User/Project/... 行数 0→0 | `d3/PROBE_RUN.log/.exit.json`、`d3/BACKEND_READBACK_PROBE_RESULT.json`、`d3/PROBE_DB_STATE_*.json` |

工程风险（如实记录）：`scripts/harmony-test.ts` 以 hvigor 进程退出码判定，hypium 用例失败时 hvigor 仍可能 exit 0；本次同时解析 `test_result.txt` 真实分母（Failure 0）并保留日志，未把 exit 0 当唯一 PASS 证据。`scripts/harmony-build.ts` 默认优先打印 unsigned 产物（FS-E01）；本次显式核对 `outputs/default` 全部 HAP（仅 1 个 unsigned、0 个 signed），signed 判定不依赖文件名推断，并对脚本首版 `-match 'signed'` 误命中 unsigned 的子串问题做了自纠记录（`d3/BASELINE_UNSIGNED_HAP.json.signed_detection`）。

## 4. 正常与异常证据

- 正常：waiting-approval（唯一 REVIEW_APPROVAL 主动作+2 阻断）、running/queued/paused、succeeded、daily-budget-waiting、observation-no-change（读时间≠成功观察时间且有“无新变化”结论）、stop-requested（PAUSE_REQUESTED 未结算 + CHECK_STOP_SETTLEMENT）。
- 异常/负例：UNKNOWN（phase=UNKNOWN + unsettledEffect + 不显示成功）、cancelled（COMPLETED/CANCELLED 不显示成功勾选）、旧服务无 workPacket（退回原详情）、显式 null vs 缺字段、未知主动作/观察/阻断枚举、未来 schemaVersion、malformed/`workPacket:null`、来源 SUPPRESSED 且 excerpt 为 null 但 facts 保留、UNAVAILABLE 显示“历史关联仍保留（不是记录被删除）”、VERSION_ADVANCED 不沿用旧 requires。
- 来源：`harmonyos/entry/src/test/WorkPacketContract.test.ets` 的 16 项断言直接消费真实序列化 JSON（`WorkPacketFixtures.ets`，源自 `evidence/final-a/20261103/samples/`，无合成字段名猜测）。
- 对照来源：合同以 4b69614 源码 `lib/types/workPacket.ts`/`lib/mission/workPacket.ts` 与 A2 样本为准；未按旧 A 截图猜字段。

## 5. 兼容、回滚与剩余限制

### 兼容

- 旧后端：无 `workPacket`/`readAt`/`observation` → 退回原详情；`materialUses[].currentUse/revisionAvailability/availabilityMeaning` 缺失 → 显示“当前许可未知（旧服务未提供）”，不推断允许。
- 旧客户端不受影响：本提交只改 D 树 ArkTS 客户端，无后端/schema/迁移/公共构建脚本改动；`MissionWidgetSnapshot` 新字段默认空、`clearMission(ctx,true)` 第二参数默认 false，旧调用兼容。
- Web/API 契约未改；同身份读回在隔离库真实业务路径验证。

### 回滚

- 代码回滚：`git revert 721ab37`（或 D 分支回到 4b69614）；仅客户端文件，无数据/库/后端副作用。
- 视觉回滚不影响已有业务对象：工作摘要是只读投影，隐藏摘要入口后原委托详情、原问题/提案/结果/回执路径仍可用。
- 证据保留：本目录 `d2/`、`d3/` 原始日志/失败记录不删除；旧 485d485 unsigned HAP（`2d64b3da…`）已被本次构建同名覆盖，旧 hash 仅作历史记录，不作为本候选证据。

### 剩余限制（NOT_RUN / BLOCKED，不并入 PASS）

1. **signed HAP、安装、登录后继续、冷/热启动、系统返回、卡片系统刷新、键盘/中文输入、大字、长标题、换账号迟到响应、离线 TTL 前/等于/越过、同任务 Web UI 读回**：NOT_RUN。原因：`harmonyos/build-profile.json5` 的 `signingConfigs` 为空、本树无用户签名材料（按任务边界不复制主目录 build-profile/私钥），且模拟器实例两次退出后当前离线。恢复条件：用户在 DevEco 为本工程配置受权签名（或提供授权 signingConfig）→ 重建 → 需模拟器/真机稳定在线 → 按 `d3/CASE_MATRIX.md` 12 项执行并核对 signed 路径/mtime/hash/非敏感签名身份/安装对象。
2. **设备身份**：历史/本次探测均为模拟器（AVD 配置 Pura 90 / HarmonyOS 6.1.1(24) / API24 / x86_64 / PHEMU-FD00，来自配置与启动参数，未取得 shell 内 `param get`），**不是真机**；不得写成真机 PASS。
3. **真实后端 HTTP 腿/Web UI E2E**：HTTP 腿未启动（避免重负载争用）；Web UI 端到端未跑（C 的 Web 消费未合入本树）。同身份读回目前是隔离库进程内真实业务路径 + 服务/API 级证据；不宣称 Web UI 已读回。
4. **真实 Worker、真实模型、自然日、独立用户**：NOT_RUN（本任务未授权付费调用/自然日/独立用户）；探针为 `LLM_MODE=mock`、无模型/外网调用。
5. **平台能力**：小艺/Intents/系统分享/穿戴/完整离线同步未接入，不宣称。
6. **残余技术风险**：
   - `SessionStore.clearSession()` 在 `appContext === undefined` 时早退会跳过卡片清理；无 context 时无法清 Widget Preferences，保留为残余并建议后续把清理移到 context 就绪后重试。
   - `DeviceIdentity` 采集草稿只在 ProjectHome 当前页 401/403 清理，账号切换后本账号文本可能残留（同账号内容，非跨账号读取）。
   - Copilot 确认回执丢失时后端 409 `COPILOT_CONTINUATION_CONSUMED` 不含 missionId，客户端无法深链原委托，需 A/主控扩展错误载荷。
   - 卡片 “待确认” 徽标为固定文案（未在本轮重做 485d485 UI）。
   - `harmony:test` 退出码不反映 hypium 失败（工程脚本问题，主控/公共脚本边界外）；`harmony:build` 默认打印 unsigned（FS-E01）。
   - ArkTS 编译警告中存在基线既有 WARN（如 pushUrl deprecated、Function may throw exceptions），本轮未新增错误；未做 lint/全量 Vitest/Next build/E2E（本任务 D 树客户端范围与资源队列约束）。

## 6. 证据索引

| 路径 | 内容 |
|---|---|
| `d3/FROZEN_SNAPSHOT.json` | FROZEN 时 HEAD/branch/dirty 全清单/source_tree_digest |
| `d3/BASELINE_TEST.log` / `.exit` | FROZEN 快照 harmony:test 命令/退出码/真实分母/摘要 |
| `d3/BASELINE_BUILD.log` / `BASELINE_BUILD.exit.json` / `BASELINE_UNSIGNED_HAP.json` | FROZEN 快照 harmony:build、全部 HAP 清单（1 unsigned、0 signed）、候选绑定与 signed 自纠 |
| `d3/ENVIRONMENT_PROBE.json`、`d3/DEVICE_STATUS.md`、`d3/DEVICE_TARGETS.log`、`d3/raw/*` | DevEco/SDK/hvigor/ohpm/hdc 环境、模拟器 AVD 身份与时间线、原始探测日志 |
| `d3/SIGNING_INVENTORY.md`、`d3/SIGNING_EVIDENCE.log` | signingConfigs 空、无签名材料、FS-E01、恢复条件 |
| `d3/CASE_MATRIX.md` | D-WP/D-HO/D-TTL/D-ACC/D-REC/D-SRC/D-UI + E-HAP-01 共 12 项：前置/步骤/期望/当前 NOT_RUN/恢复条件 |
| `d3/BACKEND_READBACK_RESULT.md`、`d3/BACKEND_READBACK_PROBE_RESULT.json`、`d3/PROBE_RUN.*`、`d3/PROBE_DB_STATE_*.json`、`d3/BACKEND_READBACK_PLAN.md` | 隔离库同身份读回探针（19/19 PASS、负例 404、清理归零） |
| `d3/BASELINE_TEST_ATTEMPT1_MIDEDIT.*`、`d3/BASELINE_TREE_STATE.md` | 开发中冻结窗口失效的原始失败记录（如实保留，不记基线 PASS/FAIL） |
| `d2/D2_RECEIPT.md`、`d2/d2-changes.patch`、`d2/post-change-evidence.txt`、`d2/syntax-parse-check.log`、`d2/logic-check-node.log`、`d2/baseline-excerpts/` | D2 行为矩阵/file:line/基线缺口/纯逻辑镜像/语法结构自查 |
| 本文件 | Track D 汇总回执 |

## 7. 分账结论

- 工程（本候选）：PASS — 原生测试 133/133、unsigned HAP 可构建、合同/引用/身份探针通过；证据绑定 frozen 源码 digest 与构建前后一致性。
- 设备（signed 安装/系统交互/真实卡片刷新/离线与账号切换旅程）：BLOCKED / NOT_RUN — 无受权签名、模拟器不稳定且当前离线；恢复条件已列。
- 平台（小艺/Intents/系统分享/穿戴/完整离线）：NOT_IMPLEMENTED — 不宣称。
- 真实 Worker / 真实模型 / 自然日 / 独立用户：NOT_RUN — 本任务未授权，不以 mock/合成数据替代。
