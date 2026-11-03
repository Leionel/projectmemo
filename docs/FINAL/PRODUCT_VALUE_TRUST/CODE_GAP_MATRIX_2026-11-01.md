# ProjectMemo 最终阶段：代码差距矩阵

日期：2026-11-01。配套阅读：[研究报告](PROJECTMEMO_FINAL_VALUE_TRUST_RESEARCH_2026-11-01.md)、[优先级路线](PRIORITY_ROADMAP_2026-11-01.md)、[最终纵向旅程](FINAL_VERTICAL_ACCEPTANCE_JOURNEY_2026-11-01.md)。

本轮先审计、后形成规划。审计中发现 CT-7 未进入主目录，用户随后明确授权合并；该项业务代码修改只用于 CT-7 整合及必要的冲突适配，下面其他缺口没有顺带实施。整合结果与验证记录另见主目录 `docs/project/implementation/R4_DEPLOYMENT_IMPLEMENTATION_NOTES.md` 的本次追加段。

## 1. 如何读这张矩阵

“源码成立”表示能沿实际调用路径说明行为；“探针”表示本轮运行了特定验证；“历史验收”必须绑定当时版本。它们都不自动等于真实模型质量、真机、自然日或用户价值通过。

优先级按影响判断：P0 是当前收尾必须修复或停止相应能力宣称的项；P1 是能改善核心使用、值得安排完整切片的项；P2 只在需求和设备条件成立后投入。P0 既包含可达缺陷，也包含最终验收的放行条件，两类在表中分开。

## 2. 十个方向的能力与用户行为

| 方向 | 当前已有能力与落点 | 仍缺少的用户行为 | 裁决 |
|---|---|---|---|
| 首次获得可靠价值 | [NewProjectForm](D:/Projects/hongmen/components/NewProjectForm.tsx:9)、[项目创建 API](D:/Projects/hongmen/app/api/projects/route.ts:33)、Capture/Attachment、Conversation 原调查 | 用户拿着一份真实材料就能建立可靠项目，迅速核对第一项判断；知道本次是否使用真实模型、缺了什么和花了多少 | P0 先修创建与模式合同；P1 做材料引导的完整旅程 |
| 低负担采集 | [CaptureBox](D:/Projects/hongmen/components/CaptureBox.tsx:26)、[captureService](D:/Projects/hongmen/lib/services/captureService.ts:34)、[attachmentService](D:/Projects/hongmen/lib/services/attachmentService.ts:165)、鸿蒙 MemoryService/AttachmentService | 从系统分享进入、断网先留存、稍后归属项目、恢复同一次上传；语音校对后入原记录 | P0 草稿隔离；P1 分享和可靠待同步；语音按设备探针推进 |
| 结果与价值判断 | [resultVerifier](D:/Projects/hongmen/lib/mission/resultVerifier.ts:9)、[completionSummary](D:/Projects/hongmen/lib/mission/completionSummary.ts:5)、[actionService](D:/Projects/hongmen/lib/services/actionService.ts:46)、[trajectoryIndex](D:/Projects/hongmen/lib/experience/trajectoryIndex.ts:37) | 看懂“完成了记录”“有了可核查观察”“目标得到支持”之间的差别，核对反例与剩余条件 | P1；现有层级继续保留，不新建结果账本 |
| 人与 Agent 交替推进 | [Admission](D:/Projects/hongmen/lib/continuity/admission.ts:27)、[Turn 协调](D:/Projects/hongmen/lib/continuity/turnCoordination.ts:24)、Mission pause/input/resume、原预览/确认 | 必要时只问关键问题；用户接管后能说明做过什么、从原对象继续，不重复执行 | 基础已实现；P1 补问题质量与跨端旅程验收 |
| 能力如实表达 | [health](D:/Projects/hongmen/app/health/route.ts:3)、[WorkerPresence](D:/Projects/hongmen/lib/mission/workerPresence.ts:63)、[Conversation capabilities](D:/Projects/hongmen/app/api/conversations/capabilities/route.ts:4)、责任与覆盖视图 | 分清“配置了”“有权用”“近期用成功”“仅部分覆盖”“结果未知”，不靠绿色状态猜测 | P0 模式与可用性误导；P1 运行诊断投影 |
| Agent 改进闭环 | [原评测规范](D:/Projects/hongmen/docs/FINAL/AGENT_REVIEW/AGENT_END_TO_END_EVALUATION_SPEC.md:1)、`scripts/eval-r4-*.ts`、原 Run/Step/Event、Experience 反馈 | 用户指出错误后形成可复现样本；新版本能证明少犯旧错，独立评审不只看最终文案 | P0 独立质量放行；P1 脱敏反馈到回归的工具链 |
| 动态能力与费用 | [Tool 合同](D:/Projects/hongmen/lib/mission/tools.ts:11)、[Experience 匹配](D:/Projects/hongmen/lib/experience/injection.ts:75)、[quota](D:/Projects/hongmen/lib/auth/cloudQuota.ts:119)、责任预算 | 明白一次任务的已知费用、未知预占与上界；工具/模型升级后旧建议重新核验 | P1；实际货币上界不可用时不宣称已具备 |
| 数据自主与安全 | SourcePolicy、Temporal Ledger、原确认和回执；[附件存储](D:/Projects/hongmen/lib/storage/attachmentStorage.ts:30)、成果导出 | 带走有来源的完整项目；知道删除停止了哪些使用、还有哪些副本待清理；共享设备不泄露草稿 | P0 删除权限、草稿、远程图片及清理边界；P1 完整导出 |
| 鸿蒙全场景 | [module.json5](D:/Projects/hongmen/harmonyos/entry/src/main/module.json5:7)、[EntryAbility](D:/Projects/hongmen/harmonyos/entry/src/main/ets/entryability/EntryAbility.ets:10)、FormExtension、WidgetDataService、小艺后端 | 分享即存、卡片可靠跳转、手机快速补充与批准、其他设备接回原任务 | 手机与卡片优先；Intents 先探针；穿戴和系统级后台不计已交付 |
| 长期产品价值 | UX-1 WorkState/Reentry；UX-2 综合、假设与纠正；UX-3 持续责任/注意力；CT-8 条件经验；Personal Memory 规划 | 三个月后少重复解释，关键变化不错过，纠正不重犯，原目标的推进可以核对 | P0 开始真实纵向验收；P1 与原 PM-5 共用长期研究 |

## 3. 可定位的差距与负例

| ID / 类别 | 源码或证据 | 可复现情形与缺口 | 最小补全 / 失败判据 | 优先级 |
|---|---|---|---|---|
| G01 版本整合，已解决 | 初始主目录 `1c3b6a5` 不含 CT-7 `cb5fec8`；本轮整合提交 `1ee89f3` 已进入 master | 初始分支状态会使能力判断与实际 master 不符；旧验收仍只能证明旧版本 | 本轮覆盖 CT-7 与 CT-8～10 混合工具、共享预算及双端构建；全量 1411 项、E2E 33 通过。主目录重叠 UI 原补丁可反向验证，其余 18 个 dirty 文件 hash 未变；真实库未迁移 | 原 P0 版本 Gate，本轮工程通过 |
| G02 建项非原子 | [POST projects](D:/Projects/hongmen/app/api/projects/route.ts:33)、[createProject](D:/Projects/hongmen/lib/repositories/projects.ts:53) | 项目写入成功、OWNER membership 失败；或回包丢失后再次提交；当前没有创建请求身份 | 原服务内原子建立项目与 OWNER，稳定 requestId/payload hash 与原回执；故障后只有一个可访问项目，无孤儿项目 | P0，源码缺陷 |
| G03 采集模式丢失 | [agent/index](D:/Projects/hongmen/lib/agent/index.ts:18)、[capture API](D:/Projects/hongmen/app/api/projects/[id]/captures/route.ts:10)、[MemoryService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/MemoryService.ets:27) | 云调用被拒绝或失败后使用规则草稿，Run 有原因，客户端只拿 card 并显示生成成功；不能由此认定模型已作出判断 | 返回保存回执与整理模式，区分原文已存、规则整理、模型分析失败；两端读回一致，不泄露原始错误或凭据 | P0，能力表达 |
| G04 配置等同可用 | [Conversation capabilities](D:/Projects/hongmen/app/api/conversations/capabilities/route.ts:4)、[cloudQuota](D:/Projects/hongmen/lib/auth/cloudQuota.ts:159) | `LLM_MODE` 配好但 key 缺失、账号未开通或额度耗尽；`cloudAvailable` 仍可为 true | 配置、账号资格、配额、近期执行观察分别表达；任何资格查询不得产生付费模型请求 | P0，能力表达 |
| G05 health 覆盖过窄 | [health](D:/Projects/hongmen/app/health/route.ts:3)、[health tests](D:/Projects/hongmen/tests/health.test.ts:4) | 数据库不可用、Worker 停止、模型不可用时，函数仍可返回静态 `ok` | 保留原公开存活/版本合同；增加受鉴权、无副作用的就绪投影；业务路径须另验。仅 HTTP 200 不通过后台健康 Gate | P1，能力补全 |
| G06 Presence 拓扑有限 | [workerPresence](D:/Projects/hongmen/lib/mission/workerPresence.ts:18)、[worker entry](D:/Projects/hongmen/scripts/mission-worker.ts:19) | Web 与 Worker 不共享工作目录、多个 worker 覆写一个文件，或心跳仍在但扫描持续失败 | 单机先冻结文件可见性与部署身份；展示扫描/领取/失败事实。跨节点确有需求再接同库租约投影，不新增执行器 | P1，运行可靠性 |
| G07 货币费用缺口 | [responsibility](D:/Projects/hongmen/lib/mission/responsibility.ts:119)、[LLM usage](D:/Projects/hongmen/lib/agent/llmAgent.ts:53)、原 Turn/Step 预占 | `monetaryCost` 当前明确为 null；token/次数不等于最终账单；未知请求不能按零收费 | 在原记账上增加费率版本与只读汇总，分已知、估算、未知与可证明上界；费率不明时停止承诺货币硬上限 | P1；货币上界宣称的 P0 Gate |
| G08 条件完成与现实效果 | [resultVerifier](D:/Projects/hongmen/lib/mission/resultVerifier.ts:19)、[presentation](D:/Projects/hongmen/lib/mission/presentation.ts:50) | 默认草稿存在可满足委托条件，来源数量不证明论证充分；Action/resultCardId 证明完成记录，不单独证明现实效果 | 原结果只读投影关联目标版本、支持范围、条件和反例；允许草稿型委托完成，禁止因此宣布现实目标达成 | P1，产品价值 |
| G09 完成后仍需重评 | [actionService](D:/Projects/hongmen/lib/services/actionService.ts:99)、[goalState](D:/Projects/hongmen/lib/decision/goalState.ts:8) | 行动完成会处理来源提醒；“用户说已解决”仍可能缺独立观察。最近 8 行动窗口也不覆盖全部旧承诺 | 区分提醒已处理和目标已支持；接原 Impact/GoalGap 重评，定向找回仍有效的原行动；缺证据保留未知 | P1，待纵向验证 |
| G10 采集草稿未按账户隔离 | [CaptureBox](D:/Projects/hongmen/components/CaptureBox.tsx:29)、[UserNav](D:/Projects/hongmen/components/UserNav.tsx:55) | 同一浏览器、同一共享项目，A 留下未提交草稿后退出，B 登录可按相同 localStorage key 恢复 | owner+项目+用途隔离，退出/撤权清理或封存，迟到写入不串账号；扩展离线前先验这个反例 | P0，隐私 |
| G11 原生采集未闭环 | [module skills](D:/Projects/hongmen/harmonyos/entry/src/main/module.json5:25)、[附件支持](D:/Projects/hongmen/lib/services/attachmentService.ts:123) | 目前入口是应用内文本/文件；没有系统分享目标、音频原件协议、可靠离线待同步语义 | 先做文本/URL/单文件分享到本地草稿，再复用原 Capture/Attachment；语音校对成文与保存音频分开验收 | P1；完整录音管线 P2 |
| G12 删除角色不足 | [DELETE project](D:/Projects/hongmen/app/api/projects/[id]/route.ts:25)、[guard](D:/Projects/hongmen/lib/auth/guard.ts:74) | handler 使用只检查 membership 的鉴权，未在该路径限制 OWNER；普通成员可达删除调用 | 明确销毁权限、原确认与相关版本，事务内重验角色；隔离库中 MEMBER 直接调用也必须拒绝 | P0，源码权限缺陷 |
| G13 删除不覆盖文件 | [deleteProject](D:/Projects/hongmen/lib/repositories/projects.ts:81)、[storage](D:/Projects/hongmen/lib/storage/attachmentStorage.ts:30) | 项目删除只调用数据库级联；附件文件有独立存储，未串起项目清除流程 | 先停用消费/派发，再按原 Worker 有界处理文件及派生物；失败可重试，删除状态可查，不能把 204 解释为所有副本已清除 | P0，数据生命周期 |
| G14 可携带性不完整 | [ExportFormatter](D:/Projects/hongmen/harmonyos/entry/src/main/ets/common/ExportFormatter.ets:4)、原成果导出；初始扫描 154 个 API route，整合后 156 个 | 成果 Markdown 导出不能带走全部原文、附件修订、目标变化与结果链；没有账户/项目全量导出路径 | 带权限过滤与一致时间点的 manifest、原件、事件和回执；另一个 owner 的私有 Mission、凭据及不可读来源不进入导出 | P1，当前收尾应有基础版本 |
| G15 Markdown 隐式联网 | [MarkdownRenderer](D:/Projects/hongmen/components/MarkdownRenderer.tsx:4)、[ArtifactGenerator](D:/Projects/hongmen/components/ArtifactGenerator.tsx:148) | 本轮纯 SSR 输出了指向 `audit.invalid` 的远程 img 与 image preload；这是预览侧网络入口，未经过 Tool 授权和计量 | 禁止未批准远程资源自动加载；来源附件走已鉴权路径。浏览器网络探针必须确认渲染无隐式外发，包括 preload | P0，已有探针 |
| G16 能力版本不够完整 | [Tool.version](D:/Projects/hongmen/lib/mission/tools.ts:11)、[Experience version checks](D:/Projects/hongmen/lib/experience/injection.ts:75)、[promptSpec](D:/Projects/hongmen/lib/agent/promptSpec.ts:13) | 版本检查已有；但 optional version 默认 1，schema/effects 改动若未升版，旧经验和批准未必能看出语义变化 | 受控工具 manifest/hash、兼容性检查、模型升级回归；能力变化沿原 generation/readSet 失效，不新增 Planner | P1，演进可靠性 |
| G17 独立质量与自然日缺证 | [UX-3 最终复审](D:/Projects/hongmen/R4_AGENT_UX_IMPLEMENTATION_NOTES.md:252)、[CT-8～10 审计](D:/Projects/hongmen/planning/r4-post-ux2-implementation/R4_CT8_TO_CT10_INDEPENDENT_AUDIT_2026-10-31.md:85) | 工程回归充分，开发实模与同 provider 评审也有记录；这些不能代替新留出题、独立人评、连续真实使用 | 复用原评测脚本、分母、UNKNOWN 账本；新增脱敏样本准入、独立标签与版本对照；自然日与时间推进分别签收 | P0，最终质量放行条件 |
| G18 长期召回与最小提问 | [goalState](D:/Projects/hongmen/lib/decision/goalState.ts:8)、原 digest/hypothesis Composer、[Personal Memory 路线](D:/Projects/hongmen/docs/FINAL/Memory/PERSONAL_MEMORY_ROADMAP.md:1) | 最近窗口可能遗漏较旧但仍有效的约束；当前已有 ask/缺口分类，没有证明模型总能少问且问对 | 原 PM-3 的定向旧信息召回、原 GoalGap 的必要性评测；只读可调查条件不反复问用户，关键授权不省略 | P1，复用既有专项 |
| G19 小艺与设备能力未等价 | [inspectMission](D:/Projects/hongmen/lib/xiaoyi/inspectMissionService.ts:5)、[resumeMission](D:/Projects/hongmen/lib/xiaoyi/resumeMissionService.ts:8)、EntryAbility | 小艺后端与低风险接续存在，不等于 Intents 注册、正式分发和平台审批；一个模拟器不证明跨设备 | 先验证打开原任务与最小脱敏摘要；批准仍回登录 App；穿戴及跨设备迁移另设实机 Gate | P1 探针；穿戴 P2 |
| G20 卡片与无变化体验 | [FormExtension](D:/Projects/hongmen/harmonyos/entry/src/main/ets/entryformability/EntryFormAbility.ets:135)、[WidgetDataService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/WidgetDataService.ets:248)、原 Attention | 卡片刷新读取本地缓存；Mission snapshot 已有 owner/会话/期限保护，但系统刷新和后台投递仍需实测；静默不代表检查成功 | 显示上次同步和覆盖，跳转后重鉴权；观察失败/过期与无变化分开；断网、进程退出和静默期实测 | P1，设备与信任 |
| G21 依赖安全放行 | [package.json](D:/Projects/hongmen/package.json:49)、原锁文件；独立整合树 `npm audit --omit=dev --json`；[Next.js Windows 公告](https://github.com/advisories/GHSA-p293-qw3h-jr36)、[图片优化公告](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)、[Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Next 16.2.11 落在公告受影响范围；Windows 服务与 AVIF 优化各有攻击前提。扫描共 16 项：5 moderate、10 high、1 critical，含传递依赖，不能等同于 16 个远程可利用产品漏洞 | 发布前逐项核对实际锁定版本、运行路径与部署条件；独立补丁 PR 升级到覆盖全部相关公告的兼容版本并重跑回归，不执行批量 audit fix。本轮只扫描与核对公告，未升级或利用漏洞 | P0，安全发布 Gate；不是本轮引入 |

## 4. 当前证据能支持什么

| 证据 | 已核对内容 | 可支持的结论 |
|---|---|---|
| 本轮主目录定向回归 | `health`、`llm.fallback`、`captureDraftReady`、`ux3WorkerCycle`：4 文件 / 8 项通过，退出 0 | 原断言在本次读取版本可运行；不覆盖新增差距的全部负例 |
| 本轮纯 SSR 探针 | `react-dom/server` + 默认 ReactMarkdown；构造仅含合成 marker 的 `audit.invalid` 图片 | 会生成自动加载资源标签；没有发送 HTTP、没有真实内容外传，也没有调用模型 |
| CT-7 旧验收 | `D:/Projects/hongmen-ct7/R4_DEPLOYMENT_IMPLEMENTATION_NOTES.md:39` 后的最终记录、模拟器布局和数据库回执 | 对应分支的工程与模拟器核心旅程有证据；不能替代合并后回归或独立部署回执 |
| CT-8～10 历史冻结结果 | 175 文件 / 1382 项；类型/lint/Web/Harmony 的 `.exit` 均核对为 0 | 对应冻结版本的工程放行；真实 OAuth、设备新增旅程、实模独立质量仍未签收 |
| 本轮 HDC 只读查询 | 目标 `127.0.0.1:5555`；API 24；系统 `OpenHarmony-6.1.1.125` | 模拟器当前可连接及基础版本；没有安装应用或运行新原生业务旅程 |
| 本机 SDK 声明 | ShareExtensionAbility、FormProvider、InsightIntent、SpeechRecognizer、continueManager | 有实现探针的 API 基础；不证明 HMS 服务、语言资源、权限开通、分发或真机支持 |
| 本轮 CT-7 整合全量 | 181 文件 / 1411 项；类型检查退出 0；lint 退出 0，另有两条既有测试未用变量警告 | 合并候选的后端回归通过，不替代真实环境和独立语义质量 |
| 本轮双端构建与浏览器 | Web E2E 报告 33 通过 = setup 1 + Chromium 业务 32；另 2 跳过、0 失败/flaky；Harmony 单测 90 通过；unsigned HAP 构建退出 0 | 含生产 Web 构建及跨工具保留检查；不能将 setup 计作业务验收；HAP 没有在本轮安装到模拟器或真机 |
| 本轮依赖核查 | 保留 `npm-production-audit.json`、退出码及三份主公告的适用条件 | 已识别需发布前处理的依赖风险；没有进行攻击测试，不声称当前部署已被利用 |

## 5. 不应重复建设的部分

已有 Turn/Mission 的 generation、lease、累计预算、事件与 UNKNOWN；已有 Capture/Attachment 修订与幂等；已有 SourcePolicy/Temporal Ledger；已有原提案确认、Action/resultCardId、Handoff、InterventionPolicy；已有条件经验和反馈阶段。这些继续作为唯一业务路径。

新增内容主要是：原入口的原子性与权限补齐、可核对的只读投影、采集的本地待同步状态、能力/费率的版本绑定，以及独立评测的样本和签收协议。任一方案若开始复制 Runner、另记一套结果状态或建立平行记忆库，应退回原合同重新接入。

## 6. AX 规则审查附录

采用 ax-audit 的 Chat、Tool Execution、Configuration、Dashboard 四组检查，并对本轮 CT-7 整合检查新增入口与工具是否匹配。审查对象是当前源码的完整相关路径；不是对生产或设备交互作放行证明。

候选界面清单：ConversationPanel、MissionPanel、MissionResponsibilityPanel、ArtifactGenerator、MarkdownRenderer、GlobalSettings、AgentMemoryPanel，以及相应 ArkTS 调用方。整合树扫描到 156 个 API route、120 个显式 POST/PUT/PATCH/DELETE handler；这些是入口清单，不等于 120 个都应开放给模型。账号、连接授权、审批、永久删除是用户控制边界，按本项目合同排除自动工具对等要求。原不可变事件也不要求 Agent 能删除。

共执行四组 29 项规则实例及一项整合差异检查，合并为 23 条独立规则：16 pass、1 fail、2 warn、4 unknown。未知占 17.4%；上述界面中无 ax-audit-ignore 注释，抑制数 0。观察型规则没有凭静态搜索判失败。

| 规则 | 结果 | 当前证据或边界 |
|---|---|---|
| parity-no-tool-parity | pass，限定委托范围 | 原 Mission/Conversation 工具与实际可委托业务操作对照；用户授权/审批保持用户专属 |
| parity-orphan-ui-action | pass | CT-7 环境观察界面与 inspect_deployment/read_deployment_logs 同批整合；授权控制继续走原服务 |
| parity-crud-incomplete | pass | 原任务可创建/读取/暂停/取消/恢复/重试，来源可纠正/撤销；不要求删除审计历史 |
| granularity-workflow-shaped-tool | pass | 读取、保存草稿、提出行动、批准执行分离；事务原子操作不被误拆成工具链 |
| granularity-static-api-mapping | unknown | 当前工具按项目领域分工；是否需要动态发现须用实际工具增长和选择任务验证 |
| context-no-injection | pass | 原 investigationService/contextBuilder 动态加入项目、有效约束、材料和原任务 |
| context-starvation | pass | 工具与范围随许可/功能变化；整合保留部署、Browser、Calendar 的实际清单 |
| context-no-checkpoint-resume | pass | 原 Turn/Step/lease/UNKNOWN 持久化及接续；原预算不清零 |
| comm-no-approval-gate | fail，release-blocker | MarkdownRenderer:4～7 与 ArtifactGenerator:148 的预览可以生成未受控远程资源；G15 的 SSR 探针已证实标签路径。禁用自动外链资源并补浏览器网络断言 |
| comm-no-completion-signal | pass | 原 finish/outputId 与 verifyMissionResult 明确结算，不以静默或计时猜完成 |
| comm-no-progress-visibility | pass | Runner TOOL_STARTED/完成事件，Turn progress，原 Event 读取与轮询路径 |
| trust-no-confidence-cues | warn，fix-this-sprint | G03：Capture API/MemoryService 丢失整理模式，卡片原文有来源但用户难区分云分析与规则后备。补 DTO 和原处读回 |
| trust-no-uncertainty-markers | unknown | 已有 UNKNOWN/coverage/待核实字段；用户能否正确理解其视觉表达仍需任务观察 |
| trust-no-escalation-path | pass | 原 ask、WAITING_INPUT/APPROVAL、Handoff 和 App 内协作；无权限不以近似写入替代 |
| control-no-approval-gate | pass | 原 Mission/Copilot 高影响业务效果有载荷、版本、来源与幂等校验；G15 是另外的隐式联网路径 |
| control-no-escape-hatch | pass | 原停止/暂停/撤销与服务端派发、发布守卫；已派发请求按 UNKNOWN 处理，不假装已撤销 |
| control-over-conversational | unknown | 已有直接控制；操作层级是否合适、是否仍被迫多轮对话需真实任务验证 |
| context-memory-not-visible | pass，现有项目范围 | AgentMemoryPanel、纠正、原来源与经验历史可见；未来账户记忆不计已实现 |
| context-under-contextual | warn，fix-this-sprint | G18/GoalState:8：有界近期窗口不保证注入所有旧有效承诺。沿原定向查询和 PM-3 补测试及选择策略 |
| context-no-adaptive-canvas | pass | 原 WorkState、等待问题、批准、活动、草稿与接续按状态切换；不是固定按钮墙 |
| comm-no-progress-signal | pass | ConversationPanel:328 的阶段/步骤及停止入口；Mission 状态和事件实际消费原数据 |
| comm-no-intent-handshake | pass | Admission 的直接准入/候选/澄清，原预览确认、责任修订与 CAS |
| comm-no-generative-momentum | unknown | 已有起步提示；新用户拿真实材料时是否得到合适草稿仍需首次任务验证，不能只因表单空白要求加模型 |

源码层 AX 裁决为 **NOT READY：一项隐式外发阻断项、两项本阶段修复项**。其他 P0 权限和数据问题仍以 G 表独立处理，不用 AX 分数覆盖。

关系判断：Agent 已能记住项目变化、接回原委托，并在批准后产生行动和结果回执；有界后台维护也有实现。账户层长期个人理解仍是规划，不能称已证明越用越懂用户。信任基础为中等：授权与恢复链较强，但旧入口的模式、数据和渲染边界仍会破坏这种信任。最关键问题是用户能否从一条真实项目旅程里判断 Agent 实际做过什么、结果证明了什么，并成功纠正它；这需要独立任务研究回答。

## 7. 产品深化增量：最新状态与原差距的关系

以上审计与 AX 统计绑定初始整合基线。本轮产品规划复核主目录仍为 `1ee89f3`，PM 工作树已到 `cf1bbb0` 且有 PM4/入口未提交实现。账户能力不再只有规划；但分支存在、工程验证、合入主目录、真实模型/设备/自然日是不同状态，不将新增 PM 代码追记为初始 AX 已审查。

新增 FVT 编号与管理问题的完整 Owner/worktree/Commit/证据/风险见 [Roadmap 第 11 节](PRIORITY_ROADMAP_2026-11-01.md#11-issueowner-与工作树追踪矩阵)。此表不创建另一组重复需求。

| 增量 Issue | 对应原差距 | 代码成立与本轮结论 | 真正需验证的用户行为 |
|---|---|---|---|
| FVT-01 | G02/G03/G04/G10 | schema 允许无项目 Conversation/AgentRun，但 Capture/Attachment 要求 projectId；原建项尚无材料整体预览确认 | 改正模型对材料的理解，再确认建立唯一业务对象；预览不静默建项 |
| FVT-02 | G08/G09/G18 | 原 GoalState/Completion/Action 回执有分层与有界覆盖；不是缺第二个结果库 | 回来能说清已执行、独立支持、报告、反例、未知与下一步 |
| FVT-03 | G18/G20、PM | PM 分支有准入/政策/读集与到期处理；自然语言 Attention 组合不能由此推定完成 | 临时/项目/账户偏好生效范围可知、到期/撤回正确，不新增授权 |
| FVT-04 | G11/G19/G20 | 原 Handoff、Want 的 mission/project 身份、小艺受限 resume 已有；问题/证据/审批精确交接待验 | 换端回原位置，旧链接不复制对象或执行过期批准 |
| FVT-05 | G07/G08 | 责任预算仍 monetaryCost:null；源调用与成果可用于只读说明 | 理解已知/估算/未知与覆盖，用真实成果决定继续/停止 |
| FVT-06 | G17/G18 | 原 questions/dynamicCandidates/runner 支持调查/ASK/等待；没有独立提问时机收益证明 | 已知信息不重复问、私有缺口不猜测，中途接管后合法继续 |
| FVT-07 | G16/G17、CT8/PM5 | Experience 条件匹配和轨迹已有；样本/独立对照不足 | 原失败变成可复验反例，下次决策更正确，负迁移不被均分掩盖 |
| FVT-08 | G04/G05/G06/G16 | 原动态工具/恢复/UNKNOWN 已有，不需要新发现服务 | 合法改道时说明覆盖，无法继续时说清原因与恢复条件 |
| PM-REGRESSION | Functional Gate | 最新 PM4 全量日志 1447 通过/2 失败，退出 1；旧 validation 汇总不能替代 | 稳定环境与当前源码的回归签收，未据环境解释直接放行 |
| PM-R01 | Security/Functional 待探针 | PM 未提交失效服务回查项目最近 12 个 CHAT Run；同步读集守卫也在 | 超窗、无 Step、在途修改时仍阻断旧派发/发布，预算不丢；未做运行验证，不定性为已复现漏洞 |
| MGT-E2E | Evidence Gate | 完整报告复核为 setup 1 + 业务 32 通过 + 业务 2 跳过 | 对相关开关开启的独立 profile 真正验收 D1/D2 与 F3，不能只修改统计措辞 |

G02/G03/G04/G10/G12/G13/G15/G21 保留 P0 和原失败判据，当前没有本轮修复 Commit，不填“已修”。导出/删除、费用/预算、Capability Truth 和工具版本仍沿原 G 合同推进。规划中的“立即实施”不是本轮业务授权。
