# Focus Agent 实施记录

## 2026-10-26 F1 与真实 Action 协作窄切片

基线：codex/r3-runtime-research@4d7b4796b83df7bb8e45e532883c0542948440aa。原 dirty/hash 见 evidence/focus-agent/F1/20261026-local/baseline.json。用户已授权修订方案并开始 F1，本轮不部署、不清空真实库、不调用付费模型。

范围：用户私有会话、跨项目路由/优先级解释、项目/Mission 来回的原会话、已有提醒手动追问、真实 Action 冻结确认/读回、Web/鸿蒙合同及入口。完整 D1/D2 自动推送与动态重规划仍后续。

## 已实现的切片

- Conversation、Turn、Binding、Project、手动 Anchor 及个人 Priority Preference；消息与审计复用 AgentMessage/AgentRun。新增迁移允许 workspace projectId 为空，旧记录、外键和原 ID 保留，无 owner 历史不猜归属。
- 授权项目目录最多60项、定向深入最多3项目、来源片段最多12项；原记忆检索/时态来源复用。Priority Reasoning 独立保留重要性、长期目标、时效、阻塞、投入和用户偏好，不把 deadline 当全局排名。
- 同一个 Conversation 经 Focus、项目知识页、Mission 页面往返；项目导航保留原 Conversation/message 参数。新项目讨论与 WORKSPACE 复用同服务；旧 Web Copilot 在功能开启时收为只读历史区。
- 既有 Intervention/GoalQuestion/Impact 的手动入口引用与去重。没有自动把全部通知写消息，也没有新增后台付费扫描。
- 原 Action 冻结确认、源版本校验、createActionInTx 与消费回执共用同事务；同会话读回同一 Action ID/当前状态。全局 AgentRun 保持 projectId=null，避免项目审计泄漏跨项目讨论。
- 对已讨论的原 PAUSED Mission，先预览再确认原 resume；commandMission 增可传 tx 的入口，成功条件、范围和预算不重建。其他状态不通用恢复。
- 显式用户计费、每请求 ROUTE/ANSWER 两次唯一预占、usage/unknown、断线重放。未知模型请求不自动重发；用户消息在受理时持久化。

## UI 修订

按用户“符合 App 调性”的反馈，沿用原纸色、墨色、青绿、圆角卡片与语义控件。Web 收敛左侧事项、降低重复按钮/标签、折叠来源与取舍；移动 Web 对话置前。鸿蒙使用固定输入栏、收起的历史/范围、较轻的对象链接，保留原页面返回链。

## 验证与证据

证据目录：`evidence/focus-agent/F1/20261026-local/`。

| 检查 | 结果/记录 |
| --- | --- |
| 全量单元/集成 | 113文件，945/945通过，unit-all-final.log；首次2个导航 mock 缺失失败已修复并保留原日志 |
| 后续受影响回归 | final-affected.log，5文件50/50通过，覆盖新会话、原 Copilot、导航、Decision UI |
| 模型协议 | 真实 provider 包装路径由 fetch stub 测路由、用户额度、来源和 UNKNOWN；未调用付费模型，不构成真实语义质量验收 |
| Web E2E | 旧功能14项通过，新开关关闭时专项1项按预期跳过；另开启开关实跑 Focus专项：登录＋业务旅程2项通过，零跳过 |
| Focus 业务旅程 | 确认 Action→原项目核同 ID→知识页同会话→返回 Focus；桌面/390px截图为实际隔离后端规则模式 |
| ArkTS合同 | 实际 ConversationService.ets/DTO 转译后调用带认证的 Next handlers，创建/读回同 Action；不是复制协议的测试实现 |
| 类型/lint/Web build | 通过；交付回执记录最终日志 |
| 鸿蒙 | 83/83单测，HAP构建通过；最新包未安装验收，不能算设备或平台通过 |
| 迁移 | 空库全重放、旧库副本保留旧消息/Run/owner未知、foreign_key_check；只升级独立测试库/E2E库 |

浏览器首次专项因 Secure Cookie 没有随 APIRequestContext 发出而错误跳过，随后加严格 HTTP状态断言与显式测试身份，修复描述夹具长度后真实旅程通过。初版迁移 SQL 的 JSON 默认值引号和 ArkTS 隐式类型/空对象问题已修复；失败日志保留。

## Deviations 与剩余门槛

1. 目录/路由、指代与历史编排暂集中在 workspaceContextService、turnService、service，未为每个概念拆新文件。优先建立两端可用纵向切片。
2. 暂不自动压缩长会话：历史分页读取，模型最多最近6条、否决持久 pin 至多24项，超过后明确提示另开主题；不会静默丢失否决。自动摘要、复杂多提案指代仍后续。
3. Action 写入复用原 Copilot 的全项目 manifest，安全但仍有较粗失效范围；跨项目读取合同已独立，后续再将新提案迁至局部 read-set。没有声称无关资料变化必然不失效。
4. 调用次数、请求预占、超时和字符上限已落地；精确累计 token 预占未完成。真实模型预算/质量 Gate、真人效果、设备跨端旅程仍未关闭，整个 F1 不标完成。
5. 原项目 Copilot API 和历史保留，不批量自动迁移成新 Conversation。新 UI 打开关联原会话或创建 PROJECT 会话，跨项目私聊不进入项目公共历史。
6. 本次没有实施 D1/D2/E1/N6 自动深化；手动提醒追问不代表自动变化理解已完成。

## 启用与回滚

`FOCUS_AGENT_ENABLED` 默认 false；先对选定目标库备份并部署迁移、生成客户端，再设置 true。开发真实库、ECS均未迁移或部署；没有改现有 .env。开关关闭返回旧焦点/项目问答，保留新会话与真实业务回执；不能在已有 workspace 数据后直接回滚旧 Prisma schema。

原定下一步是先关闭精确 token 预算和真实模型/设备门槛。用户随后明确继续 F2，故本轮在保留这些门槛的同时实现下述本地协作适配；不将工程回归等同于阶段签收。

[本轮验收回执](evidence/focus-agent/F1/20261026-local/ACCEPTANCE.json)记录检查、截图与HAP哈希；旧未提交文件最终哈希均保持不变。业务功能未部署，提交/推送未执行。

## F2 本地协作与 Demo UI · 2026-10-26

参考 `docs/FINAL/AGENT_REVIEW/ProjectMemo_FocusAgent_Demo.html` 的暖白与青绿、重点事项、紧凑列表和固定会话布局。保留真实焦点计数与项目记录；手机切换“项目焦点 / 与忆程协作”。会话来源、优先级与材料核对折叠呈现，复用原测量条件核对组件。

### 已落地的协作

- `workService.ts` 与 `conversationWork.ts` 提供原对象读取、预览、原批准/拒绝、问题答复、材料评估/接续、恢复、固定方案对比/采用、精确 Output 归入，以及行动完成。四个新 work/reconcile route 复用原服务，不回调自己的 HTTP，也不新增运行器。
- `options` 与 `ConversationBinding` 冻结原方案 ID、原 hash、选项次序和 Mission 版本。“选第一种”“验证结果是……”只产生待确认提案。相互矛盾的项目参数、对象引用和用户否决会阻断写入；否决第一种仍可另选第二种。
- 命令信封保存在原 `CopilotToolExecution.proposalJson`，包含 qualified ref、命令、局部版本、会话限制 hash 和15分钟有效期。确认时重查权限、原状态、来源和期限；业务效果、执行记录、ConversationTurn 与聊天回执在同一事务提交。
- 原 `commandMission`、材料接续、方案采用、成果归入接受调用方事务。行动结果拆成事务外 prepare 与事务内 commit，保存原 Action 的 `resultCardId`，取消/编辑后的旧预览不能完成。Focus 的复盘使用本地结构化用户原话，不隐式调用云模型。
- `reconcile` 只重读原执行与业务结果。重复确认返回原效果；批准、就绪、工具实际执行和用户报完成分别呈现。Web / 鸿蒙均可在原 Conversation 中完成预览和确认，原详情页保持会话返回链。

专项发现并修复原方案服务的暂停边界：已 PAUSED 的 Mission 可生成和采用方案；仍在运行或正在停止的 Mission 继续拦截。批准只将原步骤置为可执行，实际 Action 仍由原 Worker 创建。

### 验证记录

本批证据写入 `evidence/focus-agent/F2/20261026-local/`，未覆盖 F1 回执。测试仅使用独立 SQLite、脚本 provider 与规则模式。

受影响服务测试、Web 生产构建、两条开启 Focus 的浏览器旅程、类型/lint、鸿蒙83项单测与 HAP 构建均有独立日志。浏览器旅程分别验证同 Action 创建/跨页返回/完成/复盘，以及原 Mission 方案选择/采用/恢复。实际截图包括桌面、390px手机、方案卡片与深色模式；最终数量和哈希见本目录 `ACCEPTANCE.json`。

| 最终检查 | 结果 |
| --- | --- |
| 全量单元/集成 | 114文件，970/970；unit-all-final.log |
| F2 / F1 / Decision 受影响回归 | 66/66；affected-delivery.log |
| 开启 Focus 的浏览器专项 | 登录与两条业务旅程，3通过、0跳过；focus-e2e-delivery.log |
| 关闭 Focus 的旧入口 E2E | 14通过、2项 Focus 专项按开关跳过；e2e-legacy-final.log |
| 类型 / lint / Web 生产构建 | 通过；types-delivery.log、lint-delivery.log、e2e-legacy-final.log |
| 鸿蒙 | 83/83单测；最新 unsigned HAP 构建通过，未安装设备验收 |
| 原有保护文件 | AGENTS.md、演进路线图、鸿蒙构建配置、next-env.d.ts、tsconfig.json 哈希与本轮起点一致 |

早期失败日志保留：测试使用错误的 ask 工具夹具、写入开关缺失、旧构建与文案断言不一致、重复运行的 Mission 请求编号，以及未等待确认响应的浏览器断言已修复。业务暂停边界另有真实服务与浏览器回归。

### 仍待阶段验收

F2 当前覆盖原对象协作与固定方案。自然语言快捷解析是有界规则，云模型仍采用 F1 两次调用合同；没有新增可自主执行任意工具的模型循环。必要新 Mission 的目标语义匹配、动态 D2 候选、12段真实模型质量评估、精确累计 token 预占和设备冷启动/跨端旅程仍待验收。开关默认关闭，真实开发库及 ECS 未迁移或部署。

用户随后要求先提交。提交范围为本轮 Focus 会话内核、F2 适配、双端 UI、路线图及本地证据；原有 AGENTS、演进路线图、签名配置、next-env 与 tsconfig 修改不纳入。提交不包含推送或部署。

## F3 本轮：关注、原事件回流与投影恢复

在 `d004c8a` 上继续实施。用户显式进入提醒/GoalQuestion/Impact 后才建立 Anchor；同一 Mission 的问题修订继续关联原 Conversation。点击“关注后续”才消费后续结构化变化；后台不自动创建会话，也不做模型复述。

### 实现边界

- `anchorService.ts` 统一原入口修订、请求别名、关注策略、投影、已读和恢复。重复入口、重复事件、重复确认不会新增第二条业务效果。来源变化后重放已提交入口返回原会话，但仍校验当前权限。
- 扩展原 ConversationAnchor，新增消息投影、入口回执和原 Action 观察关系。它们保存送达/观察元数据，业务状态仍读取原 Mission、Output、Action 与 resultCardId。增量迁移保留旧消息 ID，并从原 QUESTION/Impact 反查旧 Anchor 的 Mission；旧主题保持 MANUAL。
- STOP/LATER 复用原 GoalQuestion 偏好和反馈事务，明确定位目标 Mission，不能因项目当前选择另一条 Mission 而反馈错对象。原页面的 STOP、当前问题的 LATER/UNKNOWN 继续约束后续投影；已解决旧问题的 LATER 不阻断下一问题。
- 后续来源只消费原 SOURCE_ARRIVED：重新校验问题、来源 hash、可读性、原材料条件核对与时间有效性。未知保持未知，错位/已替代/争议来源不作为可接续的事实；不自动完成缺口或恢复任务。
- 状态、成果版本和 Action 回执分别读回。原会话已经提交的操作仅登记投影，不再发重复结果消息。终态会先排空既有事件/Action 观察；成功 Mission 尚有原待办时继续等待原回执，取消则排空当前观察后停止。
- 事件游标、有界 Action 轮转与工作台会话轮转处理离线积压，不把“只取最新几项”当完整恢复。丢失消息通过持久快照与 `SET NULL` 投影关系恢复；不调用原业务命令。STOPPED/MANUAL 只修历史，不消费新变化。
- Web 与 ArkTS 提供关注、稍后、停止、明确 ACK 和冷启动同步。GET 不制造新消息、不自动标已读；策略/ACK 同时推进会话版本，让另一端刷新能看到变化。默认关闭关注开关，手动讨论和原项目入口保留。

独立审查发现并修复了旧入口重放、旧 Anchor 关联、超过8会话的轮转饥饿、终态修复、LATER 到期/目标关联和大批次结果遗漏等问题；相应变体进入隔离测试。证据写入 `evidence/focus-agent/F3/20261025-local/`，日期按本轮客户端时区命名。未覆盖 F1/F2 回执。

### 阶段状态

本批是 F3-A/B/D 的工程底座。D1/D2 语义发现、V2 动态规划、真实模型16段 episode、5名目标用户对照与真机/跨端冷启动验收仍待实施或验收；规则与脚本 provider 不计为真实模型质量通过。原开发库、ECS 和真实数据未迁移或部署。

### 本轮验证

| 检查 | 结果 |
| --- | --- |
| 全量单元/集成 | 116文件，992/992；unit-all-delivery.log |
| F3/F1/F2 专项 | 4文件62项通过；quality-green.log。含19项 Anchor 与3项旧库/真实 ArkTS-API 合同 |
| 开启 Focus 与关注的 E2E | 登录＋3条业务旅程通过，0跳过；focus-e2e-delivery.log。新材料读回、未读跨刷新保留、ACK、STOP、原任务不误续跑，并检查新结果实际进入视口 |
| 关闭新功能的旧入口 E2E | 14通过、3项 Focus 专项按开关跳过；legacy-e2e-final.log |
| 类型/lint/Web 生产构建 | 通过；types-delivery.log、lint-delivery.log、focus-e2e-delivery.log |
| 鸿蒙 | 83/83单测与最新 unsigned HAP 构建通过；harmony-test.log、harmony-build-final.log；未装机验收 |
| 独立审查 | 规格和代码质量两轮通过；问题先复现再修正，失败日志保留 |

截图输出改为 `FOCUS_EVIDENCE_DIR` 指定的新目录，默认只写 test-results，避免验证覆盖旧验收截图。原有保护文件与旧 F1/F2 证据保留。提交只纳入本轮源代码、迁移、测试和本地回执；不推送或部署。
