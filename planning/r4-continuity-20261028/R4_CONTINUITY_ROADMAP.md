# 下一阶段纵向PR路线图

> **R1 定向修订 · 2026-10-28（Asia/Singapore）**：调整CT-1准入表述，新增§3A单PR内部三个检查阶段及§3B实施探针；CT-2…10与PR-6原范围不重新编排。

## 1. 产品边界与拆分

CT编号是本规划中的切片标识，不是已经创建的GitHub PR。没有创建issue、分支或向外部tracker写入。每个切片都要交付可演示的用户行为，包含相关合同、服务、Web/ArkTS和负例；不是把表、API、UI拆成多个没有独立价值的工程阶段。

第一产品目标：用户纠正方向后，Agent能在新旧来源、工具结果和真实任务之间继续推进。完整目标还包括授权的持续调查、选择性打扰、条件化结果经验与外部行动。不得把后者无限延期为“只读聊天已足够”。

## 2. PR-6先收尾的范围

`PR6-GATE`只补既有Search/Fetch/覆盖/原文/恢复/原研究UI的未决Gate：最终全量、完整Web E2E、独立质量对照、目标设备旅程。原冻结11/48 arms和188/336模型预占保留，不覆盖失败，不以尚余历史额度发起本轮调用。文档应将“PR-6工程实现”和“联网质量/设备/生产”分别签收。

CT-1开发可基于当前HEAD隔离开展，不要求先部署ECS。产品放行则依赖PR-6相关路径通过；新增工具和长期策略不塞回PR-6。生产部署不是本轮或CT-1实现的默认授权。

## 3. 第一实施PR：CT-1 改道后继续办完同一件事

**交付旅程（R1细化）**：CT-J01，联测CT-J02/04/08/10。通过Directive Admission的项目阶段目标直接生效；模型解释不冒充永久指令。Agent用PR-6与内部工具改变调查路径；旧提案不可用；经原服务完成Mission接续与Action结果回执；新会话继续原结果和等待项；可撤回。

**新增量**：一张AgentDirectiveEvent + User.continuitySeq；有效指令/最小context manifest；原GoalGap接收current working objective与原正式目标；原confirm/review/runner读取意图hash；只读handoff；共享UI控制语义。依赖失效与原回执从第一次实施就接入，不能等后续阶段才补正确性。

| 变更组 | 现有入口 / 拟新增位置 | 必须完成的适配 |
|---|---|---|
| 数据与读取 | `prisma/schema.prisma`、新additive migration；`lib/types/conversation.ts`、拟`lib/conversation/directiveService.ts` | 作用域、原话、批次幂等、替代/撤回、到期与CAS；新旧库兼容 |
| 自然指令与控制 | `turnService.ts`、`uiActions.ts`、拟continuity routes | 认证原话优先；活动turn也能接受停止/纠正；不全靠正则、不把模型提取当新授权 |
| 当前上下文 | `workspaceContextService.ts`、`investigationService.ts`、`promptSpecs.ts`、`mission/contextBuilder.ts` | 同一有效intent；既有动态loop继续选工具；关键信息span保留 |
| 旧提案与任务 | `commands.ts`、`workService.ts`、`decision/reviewPersistence.ts`、`mission/approvalService.ts`、`runner.ts` | 发布/确认/恢复都重验；replay仍读已提交原效果；兼容旧提案失效策略 |
| 双端体验 | 原Conversation DTO、Web/ArkTS renderer、ConversationService | 改道差异/撤回、纠正、原任务接续；稳定草稿、旧客户端fallback |
| 验收 | 复用focus/r4/decision/mission测试；拟`tests/continuityIntent.test.ts`、`continuityIntegration.test.ts`、`continuityNativeContract.test.ts`、`e2e/continuity.spec.ts` | CT-J01真服务闭环、跨会话/跨项目、并发、到期和迟到结果 |

**实现顺序（同一PR内，R1调整）**：按§3A的A→B→C三个内部阶段检查。每阶段可留下独立可复现证据；只有C及最终整体验收通过才完成CT-1。中间阶段不作为独立产品PR或缩水交付。

**Feature flag**：拟`FOCUS_CONTINUITY_ENABLED=false`控制新提取/交互入口；guard对已有有效停止/限制常开。capabilities未就绪时不给客户端新按钮。无模型仍可通过明确UI控制命令保存和撤回指令，读回不调用模型。

**完成条件**：

1. D1“扩功能”→D3“稳演示”→D5新会话：新方向被采用，同范围旧推荐不复活，B项目不误受限。
2. 同问题因新观察至少一次改变实际下一工具或结束决定，不只是换一句回答。
3. 当前工作目标、原验收条件和结果层级同时清楚；不能把安装自报当目标完成。
4. 旧Proposal确认被事务级拒绝；两个并发目标修订有一个CAS胜者；重复confirm只一个原业务效果。
5. 撤回/到期后重新协调；旧被拒提案不复活；历史结果不被删除。
6. Web/ArkTS同一fixture同一原对象、撤回和真实回执；源修订/撤权/UNKNOWN/草稿均可复现。

**首轮验证预算提案**：6条开发旅程×旧/新两组=12 runs；每run原Deep上限12模型、4 Search/Fetch，则最高144模型、48外部请求。先用脚本Provider与隔离库验证，真实调用需新的明确总次数与金额上限；本轮执行0。独立留出评测另算，不挤进开发预算。

### CT-1固定服务轨迹

| 步骤 | 服务入口与输入身份 | 必须核对的持久结果 |
|---|---|---|
| 建旧话题 | 原POST conversations，PROJECT/A、requestId=c1；原turn“继续扩功能” | 原Conversation/USER消息及一个PENDING原提案p-old |
| 新会话改道 | 原POST conversations，同owner/A、requestId=c2；turn“本周先稳演示，先别加功能” | 同事务指令事件及真实APPLIED回执；c1内p-old再确认被拒；Project.goal没有偷偷改写 |
| 自主调查 | 原Investigation读取内部原始材料→PR-6用户登记官方URL；中间发现规则版次不适用，换读本届条款或原安装记录 | 实际轨迹随观察改变；intent/context/source/grant hash齐备；没有新Mission伪造actor |
| 选择与执行 | 只使用服务器返回binding，经原ui-actions/work预览/确认 | 一个原Action/原Mission效果；同requestId重放回同回执；不用fixture自造executionId |
| 结果与再次接续 | 原complete_action/结果确认，虚拟到D5新会话访问continuity并发起追问 | resultCardId链、REPORTED层级、下一责任方/启动日志缺口；不重复执行 |
| 撤回与隔离 | 撤回该阶段指令；另外B项目保持自己的规则 | 原指导重新协调，旧被拒提案不复活；B不被A抑制 |

原恢复/迁移测试的“真实服务”指独立库与真实handlers，模型/外部Tool仍可脚本化；完整真实模型/目标设备另验。CT-J04等后续完整场景在CT-1只测原Mission已能表达的材料等待/接续，不把尚无adapter的远程实验监控算已交付。

### 3A. 【R1 新增】一个实施PR内的三个内部阶段

| 阶段 | 该阶段可检查的结果 | 必需证据 / 内部通过条件 |
|---|---|---|
| **A 指令与失效保护** | Admission分流、字面有限指导直接生效/精确确认/一次澄清；scope/时间/撤回/迁移；原提案与所有关键消费入口的intent/reusePolicy guard | 独立库真实API/SQL：旧按钮确认被后端拒绝；两端CAS唯一胜者；无事件到期失效；SUPPRESS_USE逐路径矩阵和UNKNOWN链；空库/旧库迁移。拟tests/continuityAdmission.test.ts、continuitySuppression.test.ts、continuityTimeScope.test.ts。无模型状态可核对，不以建表成功收尾 |
| **B 认知与调查改道** | 原Turn内ACTIVE→失效→drain→新generation；GoalGap按有效目标和新观察重评；动态换工具/停止/移交；旧结果正确结算和复用 | A通过；原Provider/Tool adapter注入barrier，真实事务及OS worker竞争：旧lease无写权、迟到模型不发布、成功原文可复用、UNKNOWN不重发、根预算累计。至少一条新观察实际改变下一工具，不只更改文字。拟tests/continuityRecoordination.test.ts、continuityRecoordination.integration.test.ts |
| **C 跨会话双端完整闭环** | Web/HarmonyOS自然指令、纠正/撤回、生成式UI、原Mission等待/恢复、原Action确认/完成/resultCardId回读、D5新会话handoff | A/B通过；真实handlers和原服务读写：至少一个原Mission接续、一条原Action完成回执，确认重放一个效果；多日同owner与跨项目、时间边界、稳定草稿/旧客户端；模型布局随不同目标/证据有合理变化。拟tests/continuityNativeContract.test.ts与e2e/continuity.spec.ts，相关全量/类型/lint/build/鸿蒙检查 |

保留原一张指令事件表、原Turn/Mission/Decision/AgentExperience以及所有授权和回执机制。A/B可以用于定位故障，**不能在A或B结束后宣称CT-1完成**；最终仍是“有效目标→自主调查→用户确认→原Mission/Action效果与真实回执→结果重评→多日跨会话双端接续”。

“真实回执”指由原业务服务提交并从持久库读回，同一完成操作的resultCardId链可核查；fixture自造SUCCEEDED、UI动画或模型一句“已完成”均不计。真实模型质量、模拟器/目标设备和生产Gate继续分开签收，设备不可用不阻塞A/B及可验证的C服务合同。

### 3B. 【R1 新增】先做的实施探针及阻断规则

1. **Admission探针**：三类项目常见句式、反向否定、引号/转述、隐含指代、无期限推广；量测误准入与不必要确认。不能用全量候选/全量手工表单规避自然指令目标。
2. **事务探针**：用户指令行→原Conversation/Mission/提案行的锁顺序；真实SQLite多连接/进程、confirm与修订/抑制并发、时间边界最终guard。busy重试不得自动重发模型/工具。
3. **原Turn探针**：当前mutateTurn/heartbeat/modelResults缓存的改道/取消交互，验证g/token/版本各自作用；不能删CAS、放过空lease或复制原Runner。
4. **消费闭包探针**：原Artifact逐块manifest、旧summary/近期对话、ACTIVE经验与待确认提案的来源覆盖；旧来源链缺失时，仍能通过原文调查完成任务，不能靠UNKNOWN提升证据或全部停工。

探针不通过时修复对应合同实现并重跑；涉及架构假设变化记入原拟实施记录Deviations。不得用“先只做UI”“不接真实回执”“取消动态工具选择”替代CT-1完整目标。

## 4. 后续PR与依赖

| ID / 可见结果 | 真正阻塞依赖 | 主要实现/最小Schema | flag与费用/权限 | 冻结验收与放行 |
|---|---|---|---|---|
| **CT-2：这次提交是否解决当前阻碍** | CT-1合同和PR-6相关guard；不依赖长期调度 | 固定SHA的CI checks、失败job有界日志/必要diff；扩SourceConnection/观察result，复用Focus/Mission adapter；不预设新CI表 | 拟REPO_CI_OBSERVER_ENABLED；公开repo先可运行，私有授权另补；元数据请求预算与模型分账 | 绿CI≠部署；新旧attempt/移动ref、同事件重复、撤权、注入；原Action结果改变GoalGap |
| **CT-3：获准后持续调查，真正需要时再叫我** | CT-1；Tool输入可先用已有PR-6/材料事件，CT-2不是强依赖 | 原continuationPolicy新增BOUNDED_INVESTIGATION；nextAttemptAt/worker/lease；统一Attention和Handoff；既有JSON可承载，必要索引按查询实测 | 拟MISSION_INVESTIGATION_DELEGATION_ENABLED；一次scope/期限/总预算批准；默认无系统推送 | 三日断线/进程重启、静默继续、截止/STOP、预算耗尽、false silence、无新信息0模型；原任务而非新Runner |
| **CT-4：原要求能定位到页/表，换版后知道影响哪里** | CT-1；不依赖CI/CT-3 | 原附件修订加入结构化提取sidecar，原attachmentRevision + parser/hash；read_page/section/table adapter；必要时仅加sidecarRef字段/索引 | 拟DOCUMENT_DEEP_READ_ENABLED；首批文本PDF，OCR/复杂parser按真实缺口选；不默认模型OCR | 旧届/未来生效/附录/表头/OCR不确定；课程与竞赛新旅程；点击原页核对 |
| **CT-5：实验可比，固定核算结果能改变决策** | CT-1；真实执行子切片需隔离环境门槛 | CSV/JSON指标reader→条件比较→原批准固定脚本→真实job回执→D2；原step result/verification/experience字段增量，无训练平台 | 拟EXPERIMENT_OBSERVER_ENABLED、SANDBOX_VERIFICATION_ENABLED独立；先离线copy，CPU/内存/时间/无网 | 不同split/单位/seed/代码、异常、UNKNOWN job、负结果；禁止任意shell/真实重训练 |
| **CT-6：论文结论与本项目实测连起来** | CT-1；CT-4支撑全文定位、CT-5支撑项目对照；metadata读取可先独立 | 一个专用metadata adapter，DOI/版本规范化；PR-6/OA/原附件组合 | 拟ACADEMIC_RESEARCH_ENABLED；按授权概念与预算，不先接多个provider | metadata不冒充全文；论文指标不替代本地结果；PR-6已够的题无额外工具收益 |
| **CT-7：工程验收看到真实服务层级** | CT-1；CI可用更易比较但不是部署观察的授权前提 | 原SourceConnection支持固定env/release观察；原工具/来源/原Action | 拟DEPLOYMENT_OBSERVER_ENABLED；明确只读环境/日志scope，无生产变更 | build/deploy/health/user-path分层；旧健康记录、release不一致、日志泄漏、恢复状态 |
| **CT-8：结果经验帮助下一次，失效时停止复用** | CT-1 + 至少一类实际结果（CT-2/5/7任选）；CT-5优先 | 扩AgentExperience.applicabilityJson/trajectoryIndex与Focus只读入口；原Use记录；不新建经验库 | 原PROJECT_EXPERIENCE_ENABLED；case参考与ACTIVE方法建议区分；不自动更改Prompt | 同序列不同环境、单样本类比、反例归因、撤销/删除和无负迁移 |
| **CT-9：Fetch读不到时还能调查，日程通知能关联项目** | CT-1 + 对应资源合同；拆为Browser和外部应用两个实施PR | Browser只读隔离adapter；选定Mail/Docs/Calendar资源adapter；共用观察/权限/回执 | 两个独立flag；浏览器环境与OAuth分别批准 | 页面/邮件注入、跨账号、自动提交、JS内容定位、时区和届次 |
| **CT-10：批准后能把结果落到外部系统** | CT-1 + 已验证对应只读adapter/连接；不以Tool-4到期自动开启 | 原Proposal/Approval/Runner扩具体白名单write+effect查询；优先Issue或日程一种 | 具体外部写scope、payload、期限/版本和预算逐项绑定；可一次批准一个明确批次 | 丢回包/重复confirm/外部幂等/UNKNOWN先对账；未授权写入单例阻断 |

CT-9是能力分组，实施时两个独立PR分别纵向验收。CT-5也可先交指标比较、再交固定脚本真实执行；每个PR都有独立结果回读，不能先开任意执行器。文档/工具先后可按实际用户数据调整，不降低验收合同。

## 5. 与原路线映射

| 原规划分组 | 本方案落点 |
|---|---|
| Continuity-0 / Tool-0 | 本轮审计、合同、矩阵、36场景与决策；不另建横向平台 |
| Continuity-1 | CT-1；含其正确运行必需的最小Context/Handoff，而非孤立意图表 |
| Continuity-2 / Tool-1 | CT-1依赖检查 + CT-2 CI / CT-4文档 |
| Continuity-3 | CT-1原任务接续 + CT-3授权持续调查和注意力 |
| Continuity-4 / Tool-2 | CT-5/6/8结果、科研、经验与撤回；删除抑制从CT-1开始 |
| Tool-3 | CT-5固定沙箱、CT-7部署观察、CT-9浏览器 |
| Tool-4 | CT-3合法观察主动性 + CT-10具体外部写入，分别授权 |

## 6. 发布、回滚与停止条件

开发阶段使用空库/旧库副本、Mock/脚本工具；迁移先additive，不执行真实开发库db:setup。每个跨端PR需类型/lint/相关测试和双端合同；可发布切片跑全量、Web build/E2E、harmony:test/build。设备实测、独立模型质量和生产签收分开。

正常回滚停新入口和新调查委托，保留原历史/回执及有效guard。无法维持新限制校验的旧binary不能作为可写回滚版本；先切只读和停止派发，再前向修复。派发中的UNKNOWN费用/效果不因关flag而清零。迁移回退不DROP新表。

以下情况暂停相关实施路径并报告：基线HEAD或目标schema已变得不兼容；既有确认服务不能携带完整读集；真实外部系统没有effect查询却要求自动重试写入；安全沙箱只能提供有宿主权限的普通子进程；需额外账号/付费/生产操作但无对应授权。继续完成不依赖该条件的本地工作。

实施后维护根目录拟 `R4_CONTINUITY_IMPLEMENTATION_NOTES.md`：每批记录实际改动、验证、失败、Gate及Deviations；偏离计划时写“原方案/代码事实/采用方案”。它目前尚不存在，本轮不伪造实施记录。

## 7. 规划质量自审

完整性、范围、可测试性和风险分别已有明确合同；可行性仍有两项需实施探针：新指令控制与原Turn lease交互、结构化文档/沙箱环境。外部凭据、真实质量和删除留存政策仍是显式假设。**不将设计自审分数称为实现质量通过，也不为达到5/5而隐藏待确认项。**

本次验证范围：规划文件完整性、链接/代码路径、fixture结构和场景覆盖、原工作树保持。实际业务测试未因文档新增重跑。
