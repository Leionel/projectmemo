# D2 回执：入口原对象身份接续 + 来源/时间/错误语义

- 生成时间：2026-11-03（UTC+8，Asia/Shanghai）
- 工作树：`D:/Projects/hongmen-final-d-harmony-native`，分支 `codex/final-d-harmony-native`
- 基线 HEAD：`4b696141435825a3582816e8e449c0e0cf013f29`（4b69614）；D2 改动全部相对该提交
- 任务：team task-2（D2），owner teammate `d2-navigation`
- 边界：只改 task-2 列出的 10 个 ArkTS 文件 + 新建 `harmonyos/entry/src/test/WidgetHandoff.test.ets`；未改 Lead 独占文件（MissionDetail/MissionReadbackView/MissionWorkPacketView/WorkPacket/WorkPacketContract.test）、未改后端/接口/权限/schema/构建脚本、未新增客户端批准端点或执行器、不 push、不部署。
- D2 未运行 `npm.cmd run harmony:test` / `harmony:build`（按 Lead 约定统一编译，避免争用重构建资源）；源码冻结时 Lead 统一运行 `harmony:test` = Tests run: 133, Failure 0（含本任务 WidgetHandoff 8 项）。构建/设备证据以 Lead 记录为准，本回执不声称 signed HAP 或设备 PASS。
- 设备/签名/真实后端/真实 Worker/自然日：**未验证（NOT_RUN）**；不声称小艺/Intents/系统分享已接入（本次也不涉及）。

## 1. 行为审计与修复矩阵

### 1.1 身份接续：Focus / 项目 / 问忆程 / 系统卡片

| 入口 | 基线行为与缺口（4b69614） | 现在行为 | 证据（file:line，改后工作区） |
|---|---|---|---|
| 系统卡片点击 → 前台热启动 | `EntryAbility.onNewWant` 只写 AppStorage，页面不重读；Index/ProjectHome 只在 `onPageShow` 消费，App 已在前台时点卡片没有反应 | 新增 `pm.handoffSeq` 序号：EntryAbility 每收到新 Want 递增；Index/ProjectHome 用 `@StorageProp + @Watch` 在“本页可见”时消费一次，消费后立即清空意图，避免重复/跨页双跳 | `entryability/EntryAbility.ets:68-72`（序号）；`pages/Index.ets:135,312-317`；`pages/ProjectHome.ets:126,374-384` |
| 卡片精确定位身份 | 卡片只带 question/approval/`handoffExpiresAt`；`missionVersion` 契约字段从未下发，Index 读取后直接清空不用；`outputId/receiptId` 未捕获 | 卡片下发 `missionVersion`；EntryAbility 捕获 `outputId/receiptId`；索引/项目页统一经纯函数 `missionHandoffRoute()` 生成“project+mission(+question/approval/source/output/receipt)”路由参数，并把卡片版本以 `handoffMissionVersion`、过期标记以 `handoffExpired` 传给详情（只作历史定位线索，不作授权或自动选中） | `widget/pages/WidgetCard.ets:31,380-388`；`entryability/EntryAbility.ets:41-58`；`common/MissionWidgetContract.ets:125-151`；`pages/Index.ets:328-349`；`pages/ProjectHome.ets:446-461` |
| 项目页“当前下一步/关注委托” | `openHomeFocus` 打开 MissionDetail 只传 projectId+missionId，丢掉 `entityRef.questionId/approvalId/outputRevision/version` 与 `homeMission.workState.exactQuestionRef/exactApprovalRef` | 有原对象时带精确 question/approval/revision/version；无原对象时只给 mission 身份，由详情读回当前对象 | `pages/ProjectHome.ets:1652-1697`（`openMission` + 两处调用） |
| 焦点面板 mission 行 | `GlobalFocusPanel.open` 打开 MissionDetail 不带 workState 的 exact 身份 | 带 exactQuestionRef/exactApprovalRef/version | `components/GlobalFocusPanel.ets:128-137` |
| 项目 → 委托列表行（Lead 并行修复，核对） | `components/MissionPanel.ets` 行点击只传 projectId+missionId（基线 :55） | Lead 已改为 `openItem(item)`，带 workState exact 原问题/提案 + 版本线索（D2 未改该文件） | `components/MissionPanel.ets:57-66,132` |
| 问忆程：Copilot 续接卡 | “继续此委托”打开原委托不带版本线索；`suggestion.mission` 为空时仍会打开空 mission 列表 | 空 missionId 不打开；带 question/approval/output/revision + `handoffMissionVersion`；不把“继续”变成新建任务 | `components/CopilotContinuationCard.ets:21-29` |
| 问忆程：讨论中的关联委托 | 打开原委托只带 conversationId/originMessageId | 追加上下文版本线索 `handoffMissionVersion`（来自 ConversationRef.version = mission.version），保留 conversationId/originMessageId 溯源 | `pages/FocusConversation.ets:224-232` |
| 通知 → 项目/提醒 | `openPendingNotification` 要求 projectId 和 interventionId 同时存在，项目卡片（只有 projectId）点了没反应；旧通知意图与新 Want 不互相替换 | 一次新 Want 先清空旧定位意图；projectId-only 意图进入原项目工作台；提醒意图仍进 InterventionDetail；通知/卡片意图都可由前台序号消费 | `entryability/EntryAbility.ets:27-73`；`pages/Index.ets:328-372`；`pages/ProjectHome.ets:446-483` |

说明：MissionDetail 是 Lead 文件；D2 只负责把身份参数按原路由格式送达，详情侧的版本/过期消费已由 Lead 并行接线（核对 §6.1）。

### 1.2 旧问题 / 已替代或过期提案

| 行为 | 实现 | 证据 |
|---|---|---|
| 意图过期（`expiresAt<=now`、`=now` 边界、缺省/不可解析、登录排队/冷启动跨过） | 纯函数 `handoffIntentExpired()`（不可解析也按过期）→ `missionHandoffRoute()` 过期时只保留 mission 身份与卡片版本线索，把 question/approval/source/output/receipt 清空；页面 toast“原卡片已过期，已回到当前委托；旧问题不会被当成新问题”，再进入原 mission。不生成新任务，不自动选中/批准 | `common/MissionWidgetContract.ets:115-151`；`pages/Index.ets:338-349`；`pages/ProjectHome.ets:452-461` |
| 卡片快照过期不再作为当前内容 | 卡片 TTL 失效后 `missionData()` 返回空身份（卡片不再显示旧 mission），点击时按过期意图处理 | `services/WidgetDataService.ets:186-228`；`widget/pages/WidgetCard.ets:369-395` |
| 版本线索 | 卡片下发/页面转交 `handoffMissionVersion`（仅提示“卡片记录的是旧版本”的素材），服务端当前版本仍以详情读回为准；不新增后端字段、不作为 expectedVersion | `widget/pages/WidgetCard.ets:385`；`pages/Index.ets:348`；`entryability/EntryAbility.ets:50,57` |
| 旧提案不显示为成功 | 卡片关注点分支：`APPROVAL_EXPIRED`→“原提案已过期，请重新核对”；`SUCCEEDED`→“委托条件已验收，可回看结果”（不写“已完成”）；`CANCELLED`→“已取消，历史结果保留，不能视为成功”；`OBSOLETE/SKIPPED` 分别事实措辞 | `common/MissionWidgetContract.ets:38-58` |

### 1.3 迟到响应 / 换账号 / 离开页面

| 场景 | 修复/核对 | 证据 |
|---|---|---|
| 卡片延迟写入（A 请求在途 → 退出 → B 登录） | `updateMission` 在入队前捕获调用时会话 token/expiry 与 generation，串行执行时再与当前 owner/user/expiry/token 全量比对，不一致直接丢弃；`missionData` 另要求 token 非空 + owner + 项目 + 会话未过期 | `services/WidgetDataService.ets:275-315`（`callToken` 捕获 :279；校验 :291-295）；`services/WidgetDataService.ets:186-228` |
| 卡片私有内容在 401/403 清理 | 401：既有 `SessionStore.handleSessionExpired → clearSession → WidgetDataService.clearMission + ConversationDraftStore.clear`（未改，已核对）；403/404：ProjectHome 清项目私有内容并 `clearMission(ctx, true)` 连项目摘要一起清；`clearMission` 新增第二参数（默认 false，不破坏既有调用） | `services/WidgetDataService.ets:234-260`；`pages/ProjectHome.ets:307-321,728-736` |
| 页面 generation / token 栅栏 | 核对并保留既有：Index 数据加载 `isCurrentDataLoad(token,generation)`；GlobalFocusPanel refresh 捕获 generation+token；ProjectHome loadAllData generation+token+projectId；FocusConversation generation + ApiClient SESSION_CHANGED；Copilot 卡 generation+token。补 FocusConversation：`SESSION_CHANGED` 按会话失效处理、403/404 清内容并离开页面 | `pages/Index.ets:525-526`；`components/GlobalFocusPanel.ets:34-48`；`pages/ProjectHome.ets:590-660`；`pages/FocusConversation.ets:73-91,152-159`；`components/CopilotContinuationCard.ets:26-48` |
| 旧账号意图跨账号 | Index 会话失效（含退出登录）立即清空 pending 卡片/通知意图，B 登录后不会被带到 A 的原对象 | `pages/Index.ets:211-216,319-326` |
| 前台投递意图不丢 | 见 §1.1 `pm.handoffSeq`；页面不可见时不消费、不清空，回到可见页再消费，仍按当时时间重新判过期 | `pages/Index.ets:135,291-317`；`pages/ProjectHome.ets:126,374-384` |

### 1.4 时间语义（同步 ≠ 成功观察）

| 行为 | 实现 | 证据 |
|---|---|---|
| `observedAt` 只放 Worker 成功观察时间 | `workState.observedAt` 是服务端 delegation.lastObservedAt（读取不推进）；卡片写入前格式化为短时间，仍只来自该字段 | `services/WidgetDataService.ets:309-310`；后端语义参考 `lib/mission/workState.ts:70-71`（只读核对） |
| `updatedAt` 只是本机同步时刻 | 单独写 `new Date()` 的格式化结果，与 observedAt 分开存储 | `services/WidgetDataService.ets:312` |
| 展示不互相冒充 | `widgetSyncLabel`：有观察→“上次观察 X”，否则→“上次同步 X”，都没有→“尚未同步”；WidgetCard 2×2 底部显示该标签 | `common/MissionWidgetContract.ets:60-66`；`widget/pages/WidgetCard.ets:319-322` |
| 卡片期限 = min(5 分钟 TTL, 会话期限)，不可解析不延长 | 新增纯函数 `widgetSnapshotExpiry()`（会话期限不可解析/缺失返回 0，卡片视为不可用），替换原 `Math.min(now+300000, Date.parse(...))`（NaN 会写进 JSON） | `common/MissionWidgetContract.ets:79-88`；`services/WidgetDataService.ets:314` |
| 停止请求在途不写成“已停止/成功” | 卡片快照新增 `phase/reasonCode`（来自 workState）；关注点：`STOP_REQUESTED_IN_FLIGHT`→“停止请求待结算，不会继续执行”；`UNKNOWN`→“状态待核对，打开后重新核对”；`UNAVAILABLE`→“状态暂不可用，打开后重新核对”；`DAILY_BUDGET_WAITING`→“额度已用完，等待下次检查” | `common/MissionWidgetContract.ets:33-58`；`services/WidgetDataService.ets:301-302` |
| FAILED/PAUSED 分开 | 原实现把 FAILED 也显示成“已暂停，保留原记录”；改为 FAILED→“执行中断，保留原记录”、PAUSED→“已暂停，保留原记录” | `common/MissionWidgetContract.ets:50-51`（基线 `:36-37`） |
| 焦点/项目页状态标签 | 焦点 Primary 与项目首页焦点卡按 `reasonCode` 显示“停止请求待结算/等待额度恢复”，否则用 workPhaseLabel（UNKNOWN→状态待核对），不显示已停止/成功 | `components/GlobalFocusPanel.ets:138-149`；`pages/ProjectHome.ets:1660-1669,1703` |
| 卡片刷新下发字段 | EntryFormAbility 原来只回填 4 个 mission 字段；改为按 missionData 键全量合并（missionVersion/ExpiresAt/Attention/Sync/Question/Approval 等），过期/换号时 missionData 返回空身份即清空卡片 | `entryformability/EntryFormAbility.ets:72-93` |

### 1.5 401/403 私有缓存、离线/过期历史只读

| 行为 | 实现/核对 | 证据 |
|---|---|---|
| 401 清卡片快照 + 对话草稿 | 既有路径核对无缺口：`ApiClient` 401 → `SessionStore.handleSessionExpired` → `clearSession`（ConversationDraftStore.clear + WidgetDataService.clearMission + 凭证删除）。本次未改 SessionStore（不在写入范围），缺口见 §6.3 | `services/ApiClient.ets:24-31`；`services/SessionStore.ets:110-132,185-202`（只读核对） |
| 403/404 清项目私有内容与卡片 | ProjectHome 主加载 403/404：清 agentContext/homeMission/项目详情/提醒/行动/成果/附件/里程碑/草稿并 `clearMission(ctx,true)`；FocusConversation 403/404 清讨论内容并回 Index；GlobalFocusPanel 既有 401/403/404 清焦点视图 | `pages/ProjectHome.ets:307-321,728-736`；`pages/FocusConversation.ets:152-159`；`components/GlobalFocusPanel.ets:42-47` |
| 401 后不继续使用旧快照 | 卡片：missionData token/owner/expiry 校验；ProjectHome/FocusConversation 清页面私有状态；MissionDetail 由 Lead 负责（建议见 §6.1） | `services/WidgetDataService.ets:199-211`；`pages/ProjectHome.ets:307-321` |
| 离线/过期历史只读 | 卡片过期只回原委托（不带旧 question/approval 执行入口）；GlobalFocusPanel 打开始终进入详情读回，不在焦点页直接批准/执行；Copilot 创建委托仍需 preview+confirm，服务端重查 | `common/MissionWidgetContract.ets:115-151`；`components/GlobalFocusPanel.ets:128-137`；`components/CopilotContinuationCard.ets:26-48` |
| 不伪造 401 之外的清理 | 403 只清本项目内容/卡片；同一账号的 ConversationDraftStore 草稿不清（不属于跨账号泄漏；账号切换由 401/退出路径清） | 见 §6.4 残余说明 |

## 2. 逐个入口现状（file:line）

| 入口 | 现状 |
|---|---|
| `pages/Index.ets` 焦点区/卡片/通知 | `GlobalFocusPanel` 焦点区（`:2962` 附近渲染）；卡片/通知意图统一由 `openPendingNotification` 消费（`:328`），过期回原 mission 并提示（`:340-349`）；前台热启动由 `pm.handoffSeq`（`:135,312`）驱动；登录成功后立即消费登录期间保留的意图（`:247`）；会话失效清空跨账号意图（`:215`） |
| `components/GlobalFocusPanel.ets` | mission 行带 exact 原问题/提案/版本（`:128-137`）；状态标签区分停止在途/额度/UNKNOWN（`:138-149`）；既有 generation+token+过期监听保留 |
| `pages/ProjectHome.ets` | 项目首页焦点卡带 identity（`:1652-1697`）；重复的卡片意图消费与 Index 统一（`:446-483`）；前台序号消费（`:126,374-384`）；401 清私有内容+登录页（`:118-121,307-321`）；403/404 清私有内容+卡片（`:728-736`）；项目状态标签事实化（`:1660-1669,1703`） |
| `pages/FocusConversation.ets` | 关联委托带 conversationId/originMessageId/版本线索（`:224-232`）；401/SESSION_CHANGED 清空并回登录页（`:73-91`）；403/404 清空回 Index（`:152-159`） |
| `components/CopilotContinuationCard.ets` | 打开原委托带 question/approval/output/revision/version（`:21-29`）；空 id 不打开空页面 |
| `services/WidgetDataService.ets` | 卡片快照写入：owner/session token/expiry 重检（`:275-315`）、phase/reasonCode（`:301-302`）、观察/同步时间分离（`:309-312`）、min TTL 会话期限（`:314`）；读卡片数据 token+owner+项目+会话校验（`:186-228`）；清私有快照（`:230-260`） |
| `common/MissionWidgetContract.ets` | TTL/身份/注意力/时间纯函数与 `missionHandoffRoute`（`:25-151`） |
| `widget/pages/WidgetCard.ets` | 点击意图带 missionVersion（`:31,369-395`） |
| `entryformability/EntryFormAbility.ets` | 系统回调 onAddForm/onUpdateForm 通过 missionData 全量合并（`:72-93`，missionData 内已校验 owner/session） |
| `entryability/EntryAbility.ets` | 新 Want 替换旧意图（`:34-40`）；捕获 outputId/receiptId（`:48-58`）；notification 分支只认真实通知参数（`:59-64`）；前台热启动序号（`:68-72`） |

## 3. 测试

### 3.1 新增 HarmonyOS 本地单测（纯函数、不依赖设备）

`harmonyos/entry/src/test/WidgetHandoff.test.ets`（新建，8 用例）：

1. `valid_handoff_keeps_exact_question_and_approval_identity`
2. `expired_handoff_keeps_mission_identity_but_not_old_question_entry`（含 `=now` 边界、空期限）
3. `card_ttl_and_session_expiry_take_the_earlier_boundary`（含不可解析→0）
4. `stop_request_unknown_and_cancel_are_not_reported_as_finished`
5. `failure_and_success_use_fact_wording_not_optimistic_labels`
6. `expired_card_is_not_offered_as_current_content`
7. `observation_time_and_sync_time_never_stand_in_for_each_other`
8. `formats_iso_time_but_keeps_unparsable_existing_labels`

既有 `S1Handoff.test.ets` 的断言（卡片可见性/过期边界/attension/sync 标签/`handoffIntentExpired`）保持兼容：`widgetAttentionLabel` 的 PAUSED/READY/RUNNING/过期分支与新顺序一致（已逐条比对 + 镜像脚本验证）。

**注册状态**：D2 未改 `List.test.ets`（避免与 Lead 同时改同一文件）；Lead 已在并行工作区完成注册：`import widgetHandoffTest from './WidgetHandoff.test';` + `testsuite()` 内 `widgetHandoffTest();`（核对 `harmonyos/entry/src/test/List.test.ets` 当前工作区）。

### 3.2 纯逻辑镜像校验（Node/tsx，非构建产物）

- 命令：`npm.cmd exec -- tsx <临时目录>/d2check/check.ts`（临时目录内放 `MissionWidgetContract.ets` 的同内容副本 + 断言镜像，不写入仓库、不参与构建）
- 结果：`PASS 37, FAIL 0`，退出码 0
- 日志：`evidence/final-d/20261103/d2/logic-check-node.log`（含合同文件 sha256）
- 覆盖：37 条断言（包括既有 S1Handoff 全部期望，防回归）

### 3.3 由 Lead 统一运行的结果（D2 未复跑）

- `npm.cmd run harmony:test`：D2 按约定未运行；源码冻结时 Lead 统一运行结果为 **Tests run: 133, Failure 0**（含本文件新增 WidgetHandoff 8 项，已在 Lead 的 `List.test.ets` 注册）。该数字由 Lead 记录，D2 未独立复跑。
- `npm.cmd run harmony:build`：D2 未运行；HAP 构建结论以 Lead 记录为准（本回执不声称 signed/设备证据）。
- 设备、签名 HAP、真实后端、真实 Worker、系统卡片真实刷新：未验证（NOT_RUN）。

## 4. 验证记录

| 项目 | 结果 |
|---|---|
| `git rev-parse HEAD` | `4b696141435825a3582816e8e449c0e0cf013f29` |
| D2 文件 `git diff --stat` | 10 files changed, 388 insertions(+), 93 deletions(-)（见 `git-diff-stat.txt`） |
| 新增测试文件 | `harmonyos/entry/src/test/WidgetHandoff.test.ets`（未跟踪，待 Lead 注册） |
| 静态自查 | 10 个改动文件花括号/圆括号平衡；无重复私有方法名；新增 import 均被使用；`handoffIntentExpired` 旧引用已全部替换（Index/ProjectHome 改为 `missionHandoffRoute`） |
| 语法结构自查（TS parser 对照基线） | 纯逻辑/基础文件 0 诊断（MissionWidgetContract/WidgetDataService/EntryFormAbility/EntryAbility + 新测试文件）；含 ArkUI `@Builder/struct` 的页面文件与基线诊断数一致、无新增语法诊断；**不是 ArkTS 编译器**，不替代 hvigor（见 `syntax-parse-check.log`） |
| Node 纯逻辑镜像 | PASS 37 / FAIL 0，exit 0（`logic-check-node.log`） |
| 原生测试（Lead 统一运行） | Tests run: 133, Failure 0（含 WidgetHandoff 8 项；由 Lead 运行并记录，D2 未复跑；源码冻结时点） |
| 工作区 | 保持 clean 之外仅含本任务与 Lead 并行改动；D2 未触碰 Lead 文件（见 `git-diff-stat.txt` 的 status 段） |

## 5. 未验证与剩余限制

1. **未编译**：ArkTS 编译、Hypium 运行、HAP 构建由 Lead 统一执行；如编译报错，请把报错文件/行贴回，D2 立即修。
2. **设备行为未验证**：卡片真实添加/刷新、`postCardAction` 参数透传、前台热启动（onNewWant→页面 watch）在真机/模拟器上的行为均未实测；代码路径已就绪，但不能据此声称 D-HO-01/D-TTL-01/02 通过。
3. **MissionDetail 接线已由 Lead 完成**（核对时点）：详情读取 `handoffExpired`/`handoffMissionVersion`（`:88,:117-118`），过期即清空 `readTarget` 并提示、版本推进时提示“已按当前对象重新核对”（`:187-200`），403 清卡片快照（`:154`）。该文件属 Lead，D2 只负责按原路由格式送达参数；最终以 Lead 提交为准。
4. **Copilot 确认回执丢失后无法深链**：后端 `COPILOT_CONTINUATION_CONSUMED` 409 只给文案、不含已创建 missionId；客户端无法定位原委托，只能提示“请查看原任务”。需要 A/主控改服务端错误载荷或在建议上回填 missionId，D2 不在范围。
5. **项目委托列表入口**：`components/MissionPanel.ets` 已由 Lead 并行补齐 identity（核对 `:57-66,132`）；D2 未改该文件。
6. **卡片静态文案**：mission 卡右侧徽标与“待确认委托”小标题对所有 mission 状态固定显示，未按状态改写（不是“成功/停止”错误断言，属 UI 措辞优化）；避免在本轮重做 485d485 UI。
7. **SessionStore 边界**：`clearSession` 在 `appContext === undefined` 时提前 return，理论上可跳过卡片清理；`DeviceIdentity` 采集草稿存储只在 ProjectHome 当前页 401/403 时清理，未做全局清空（不属于跨账号读取，但可在账号切换后残留本账号文本）。两者不在 D2 写入范围，见 §6.3。
8. **会话期限缺失时的保守策略**：token 有效但 `expires_at` 缺失/不可解析时，卡片 mission 数据按不可用处理（`widgetSnapshotExpiry` 返回 0、`missionData` 返回空），避免无期限展示私有快照；登录正常返回 expiresAt 时不触发。

## 6. 需 Lead 处理的补丁建议（不越界修改）

### 6.1 `pages/MissionDetail.ets`（Lead 独占）：handoff 版本/过期线索消费（**Lead 已并行实现，供复核**）

```ts
// 字段
private handoffVersion: string = '';
private handoffExpired: boolean = false;
// aboutToAppear() 读取 getParams 处
this.handoffVersion = params?.['handoffMissionVersion'] ?? '';
this.handoffExpired = params?.['handoffExpired'] === '1';
// refresh() 成功写入 detail 之后（在 this.mission = detail 附近）
if (this.handoffExpired) {
  this.notice = '原卡片已过期，已回到当前委托；旧问题/提案需重新核对，不会被自动选中或批准。';
  // 同时把 readTarget 的 questionId/approvalId/sourceId/outputId/receiptId 清空，避免带旧身份读回
} else if (this.handoffVersion !== '' && /^\d+$/.test(this.handoffVersion) && detail.version > Number(this.handoffVersion)) {
  this.notice = `卡片记录的是 v${this.handoffVersion}，当前已是 v${detail.version}：已按当前对象重新核对，不会自动选中或批准旧提案。`;
}
// fail() 的 403/404 分支
await WidgetDataService.clearMission(getContext(this), true).catch(() => {});
```
（清 readTarget 可放在 `openMission`/`aboutToAppear` 之后的首次 refresh 成功时，避免重复提示；仅提示与清理，不改变任何写入授权。）

### 6.2 `components/MissionPanel.ets`（**Lead 已并行实现，供复核**）

行点击应带原对象身份：把 `open(id: string)` 改为 `open(item: MissionWorkspaceItem)`，参数追加
`questionId: item.workState?.exactQuestionRef ?? '', approvalId: item.workState?.exactApprovalRef ?? '', handoffMissionVersion: item.workState ? String(item.workState.originalRef.version) : ''`。
否则“项目 → 委托列表 → 委托”这条入口仍只到 mission 层。

### 6.3 服务边界（只读核对，建议主控裁决）

- `SessionStore.clearSession()`：`appContext === undefined` 时提前 return，跳过 `WidgetDataService.clearMission`；可把清卡片/草稿移到 return 之前（或 finally）。
- 账号切换/401 时除 `ConversationDraftStore.clear()` 外，建议同时清 `projectmemo_capture_drafts`（DeviceIdentity）；当前只有 ProjectHome 当前页清自己的草稿。
- `WidgetDataService.missionData` 的旧导入 `missionStatusLabel` 未使用（基线既有），可在下一轮 lint 清理。

### 6.4 残余（接受或另立任务）

- 403 只清页面/卡片私有内容，不清同账号的草稿池（同账号文本，不构成跨账号泄漏；如需更严格可在 ApiClient 403 统一降级为“只读历史”状态）。
- 卡片 `pendingCount` 仍写快照但未展示；“待确认”徽标为固定文案（见 §5.6）。

## 7. 证据索引（`evidence/final-d/20261103/d2/`）

| 文件 | 说明 |
|---|---|
| `git-diff-stat.txt` | 基线/时间、D2 10 文件 diff stat、完整 working tree status（标明 Lead 并行改动与未跟踪文件） |
| `d2-changes.patch` | D2 10 文件完整 diff（供 Lead 复核/选择性 rebase） |
| `post-change-evidence.txt` | 改后 file:line 证据 grep（合同/页面/服务/卡片/EntryAbility/EntryFormAbility） |
| `baseline-excerpts/*.txt` | 基线 4b69614 的缺口片段（带原始行号）：Index/ProjectHome 卡片消费、WidgetDataService updateMission/missionData/clearMission、MissionWidgetContract 关注点、WidgetCard 跳转、EntryAbility 捕获、EntryFormAbility 刷新、GlobalFocusPanel/Copilot/FocusConversation 打开与错误处理 |
| `logic-check-node.log` | Node/tsx 纯逻辑镜像校验 PASS 37 / FAIL 0（合同 sha256） |
| `syntax-parse-check.log` | 语法结构自查：纯逻辑/基础文件 0 诊断，页面文件与基线诊断数一致（TS parser 对照，非 ArkTS 编译器） |
| `WidgetHandoff.test.ets` | 新增 Hypium 测试的存档副本（仓库内同文件为准） |








