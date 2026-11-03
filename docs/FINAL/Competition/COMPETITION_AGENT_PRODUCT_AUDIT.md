# ProjectMemo 全国总决赛：Agent 与产品独立审查

日期：2026-11-01；赛程采用用户提供的通知，时区为北京时间 UTC+8。本轮只读源码、历史证据、截图、SDK 和公开存活接口，输出规划；未运行新模型、测试、Worker 或设备安装。赛方权重、获奖概率和未公布规则不作推断。

配套：[冲刺视图](COMPETITION_SPRINT_ROADMAP.md)、[真实旅程](COMPETITION_REAL_USER_JOURNEY.md)、[鸿蒙策略](COMPETITION_HARMONYOS_STRATEGY.md)、[交付清单](COMPETITION_DELIVERABLE_CHECKLIST.md)、[开发交接](COMPETITION_IMPLEMENTATION_HANDOFF.md)。长期权威仍为 [Final Value & Trust Roadmap](../PRODUCT_VALUE_TRUST/PRIORITY_ROADMAP_2026-11-01.md)、[G 差距矩阵](../PRODUCT_VALUE_TRUST/CODE_GAP_MATRIX_2026-11-01.md)、[V01～V40 旅程](../PRODUCT_VALUE_TRUST/FINAL_VERTICAL_ACCEPTANCE_JOURNEY_2026-11-01.md)与 [原快照](../PRODUCT_VALUE_TRUST/AUDIT_SOURCE_SNAPSHOT_2026-11-01.json)。本目录是时间和交付视图，不另建 CT/PM 路线。

## 1. 独立结论

最值得深化的是一条协作链：**把材料中的问题查清楚，把交代过的工作接着跟进，在手机与 Web 上回到同一问题并核对结果。** 长期记忆提供条件与来龙去脉，持续责任让新观察回到原目标，鸿蒙把采集与短回应放到用户日常入口。三者是同一任务的不同环节，不宜作为三个独立技术展区。

ProjectMemo 已有实际决策循环和可恢复执行基础；最大欠缺不是再造框架，而是当前版本整合、真实部署、独立 Agent 质量和用户闭环证据。建议保护复杂调查与动态选择，优先打磨：材料理解的整体纠正/确认、假设驱动的原文核对及反例修订、有界长期委托、卡片/手机到原问题的接续。

**当前不能签收“全部能力可对外发布”。** G 系列 P0 未关闭，PM 最新全量仍有失败；记忆入口后续脚本已26项通过，但尚非完整跨端放行。线上 release 落后于本地，真实 Worker、独立实模、目标真机和自然日证据不足。这不否定已有实现，也不应靠新功能数量掩盖。

## 2. 当前版本与证据身份

| 对象 | 本次事实 | 能说明什么 / 不能说明什么 |
|---|---|---|
| 主目录 | `D:/Projects/hongmen`，master `1ee89f38852afa6a29518bb409da0d9210af2751`；19 个 tracked dirty 路径 | CT7 与 CT8～10 已整合；UI/config/历史图及删除仍有未提交工作，不能把干净候选检查扩给这些改动 |
| CT7 原树 | `hongmen-ct7`，`cb5fec8`；整合树 `hongmen-ct7-main-integration`，`1ee89f3` | 原分支证据保留；当前 master 的祖先关系已含其实现 |
| CT8～10 原审计树 | `hongmen-ct8-10-audit`，`2b0067d`；原 CT8 树当前 `codex/ct9-browser-read@bc74e97` | `2b0067d` 已进入主目录；旧报告“CT7 尚未合并”是历史语句，不再作为当前结论 |
| PM 原树 | `hongmen-personal-memory`，`codex/personal-memory-explicit@cf1bbb0` | PM1 `092fc4f`、PM2 `e0407ee`、PM3 `cf1bbb0` 已提交，已合入 CT7；PM4 和入口有未提交实现，尚非主目录能力 |
| 其他树 | UI quality `f4f4174`；web-ecs `a7e3676`；PR6/R3 的两个旧条目标为 prunable | 只读登记，不清理或自动合并；新产品任务不能从旧树复制实现 |
| 公开后端 | 2026-11-01T14:11:37Z 一次 GET `/health`，200，release `71499b6d6e48fbf1116cdbcb76e2fe3d07e4602e` | 该提交是当前 master 的较旧祖先。仅证明当次公开存活/版本，不证明登录业务、Worker、数据库或模型健康 |
| 鸿蒙地址 | `Constants.ets` 为 review flavor，指向 `https://project.luojiatutor.xyz` | 源码中的目标后端；没有据此推断模拟器已安装的是哪份 HAP。需要包 hash、安装读回及契约核查 |

线上核对仅一次无鉴权存活读取；浏览工具未取得该接口内容，随后 PowerShell GET 成功。未通过 SSH 读取配置、运行服务命令或访问用户数据。三份版本不同，是“本地做完但手机看不到”的直接排查入口，不是自动部署理由。

### 2.1 分层验收表

| 能力 | 已实现 | 工程证据 | 实模 | 模拟器 | 真机/部署/用户 |
|---|---|---|---|---|---|
| CT1～3、PR6 与原调查 | 是 | 原 Turn/lease/预算与 UX3/CI 回归 | 有历史开发实模及公开来源修复记录；当前独立留出未签收 | 历史双端部分旅程 | 当前组合的真机/自然日/真实用户未签收 |
| CT4～6 文档/论文/指标 | 是 | 原页定位、元数据、固定核算；PM 全量 PDF 环境失败另列 | 不是论文理解或训练成效证明 | 部分原来源查看 | 当前目标设备及真实跨工具质量未签收 |
| CT7 环境观察 | 已合入 | 整合候选 181 文件/1411 项，原部署传输负例 | 当前独立质量未签收 | 历史隔离许可修订/撤销 | 独立部署流水线/制品、实际 TLS/真机/多日仍缺 |
| CT8～10 经验/Browser/外写 | 已合入 | 原冻结审计及合并回归 | 经验净收益、隐藏题/独立人评未签收 | 新外写跨端旅程未完整签收 | 实际 OAuth/真实外写读回和补偿未签收，不能默认启用 |
| PM1～3 | 分支存在 | 阶段单测/构建与文档；不能合计成最新全量绿色 | 主题/指纹工程结果不是个性化收益 | 新 PM 页面尚无完整签收 | 未合入 master，真机/用户/PM5 未签收 |
| PM4/记忆入口 | 有未提交实现 | 最新全量 **1447 通过/2 失败，退出 1**；入口脚本先失败，最后复核为26项通过/0失败（含UI与API断言） | 无当前独立实模签收 | 不以 HAP 构建代替 | 待稳定提交与独立验收，不称26条完整业务E2E |
| Always On 部署 | 原 Worker 有实现 | 三队列扫描、公平轮转、heartbeat/claim 与可控时钟三日回放 | 实际模型/自然日组合未签收 | App 退出不等于服务器停止，架构可分离 | README 历史“两个服务已运行”不是本轮运行状态 |

Web E2E 统一口径：整合报告 35 实例 = setup 1 通过 + Chromium 业务 32 通过 + 业务 2 跳过，0 unexpected/flaky。两条 legacy 跳过分别涉及 D1/D2 directed read 与 F3 原问题关注；不是 33 条业务全通过，不覆盖 PM 新 UI。

### 2.2 不应抹平的失败

PM `full-regression-pm4.log` 中 documentReader/Poppler 两项失败仍是当前未决。旧 `validation.json` 有环境解释与早期定向复测，但没有替代这个新全量的冻结 PASS。入口 `evidence/personal-memory-visibility/20261101/acceptance-run.log` 在本轮早先读取时曾browser back回 `/focus` 并超时；最后复核并行Agent已产出26项通过/0失败，包含正常菜单/范围导航、390px、浏览器返回、键盘焦点、条目CRUD/CAS/导出/owner隔离。脚本新增了客户端水合与历史栈记录，应保留修复归因。当前如实更新为脚本检查通过，不继续定性“返回功能失败”，也不把它当26条完整E2E或真机/实模通过。

PM-R01 仍是风险探针：失效扇出读取最近 12 个 CHAT Run，需证明超窗/无 Step 的在途消费者仍由同步读集守卫保护。未运行新并发测试，不称已复现漏洞。PM5 的真实质量、一周/月/三月计划完整保留。

## 3. Agent 智能链是否真的存在

| 环节 | 源码位置 | 本次判断与缺口 |
|---|---|---|
| 原件与有效事实 | `lib/memory/temporalLedger.ts`、`lib/continuity/sourcePolicy.ts`、Capture/AttachmentRevision | 原件、版本、范围与 UNKNOWN 约束已存在；“存在一条来源”不证明命题 |
| 缺口/假设 | `lib/memory/hypothesisService.ts`、`lib/decision/questions.ts`、`lib/decision/dynamicCandidates.ts` | 主张有条件、支持/反例与同一身份；SUPPORTED 是有条件模型判断，非用户授权/现实认证 |
| 假设进入决策 | `lib/conversation/investigationService.ts:191` 附近、`lib/mission/contextBuilder.ts:54` 附近 | 两个原入口确实 composeHypotheses/effectiveMemory；不是只供页面看。但“注入了”尚不能证明改变了正确工具选择 |
| 动态读取/改道 | 原 investigationService、`lib/mission/runner.ts`、各 tool adapter | 原循环接受模型选择工具/提问/结束，观察回流下一步；源码成立。允许不联网、不生成新假设，固定工具序列不作智能评分 |
| 修订判断 | hypothesisService 的 expectedRevision/qualified supports/counters、原 cognition readSet | 新反例可修订同一 claim；混合/不独立支持不能拼成多源真相。需要真实模型对照证明模型会用对 |
| 纠正与抑制传播 | 原 Continuity/admission/turnCoordination、SourcePolicy、发布前守卫 | 有原 runtime 保护基础；P0 与 PM 风险需针对当前组合复核，不能靠 UI stale 标签替代 |
| 长期条件 | 原 digest/hypothesis Composer、GoalState、PM3 personalContext | 项目假设候选读取仍有 16/选4窗口，Digest 最近8及 GoalState 最近8行动/4输出。PM3 改善个人通道，不等于所有项目旧有效条件已解决 |
| 经验回流 | `lib/experience/{extract,conditions,injection,trajectoryIndex}.ts` | 条件、工具/协议版本、反馈、Use 与原结果链已在；经验开/关的留出净收益仍无当前签收 |

认知能力的优先验证：相同可读原文，分别有/无旧条件或假设，比较工具选择、原文核对、反例修订和必要澄清。不能给完整条件更多权限、未来答案或额外隐藏调用。移除记忆后仍能找到同一答案并不否定其价值，需看重复解释、调查代价和条件错误；若均无改善，就不能把存储量称创新。

### 3.1 Personal × Project 的真实边界

PM 使用统一 AgentClaim/Event 的 ACCOUNT/PROJECT 范围及 UserMemoryPolicy，两个原 Composer 消费同一资格判断。账户偏好、用户自述、项目约束、当前指令、候选推测、方法经验不是同一种事实。当前具体指令和项目硬限制优先；临时“这次详细点”不永久保存；候选确认不切断项目根、不授权外写；个人云处理不由项目云许可自动扩张。

最有价值的个性化不是改语气，而是用户明确“实验方案先核对数据划分和基线”后，Agent 在科研项目真正先核对这些条件；课程项目另有要求时又不负迁移。主题词元匹配与固定预算不是语义长期召回的全量证明，PM5 仍需测旧约束、条件冲突和相似但不适用经验。

## 4. Always On 的责任链与部署缺口

现有链是：自然语言目标 → 原责任预览/用户批准 → Mission 限定工具/来源/时限/累计预算 → Worker 观察与变化判断 → 原模型调查/等待/提问 → Attention 去重/安静时段 → 手机/Web 回原对象 → Action/resultCardId 与 Experience。这比定时重复 prompt 更完整，但尚不能据此宣布线上持续运行验收完成。

`scripts/mission-worker.ts` 独立 Node 进程运行，扫描 IMPACT/MATERIAL/DELEGATION，执行 Conversation/ Mission，heartbeat 每10秒；三个扫描成功才标 scan，claim 另记。`workerPresence.ts` 默认本地 `.runtime/worker-presence.json`，60秒 heartbeat/120秒 scan 判断；它不是跨节点事实源，也不是每个委托成功证明。版本字符串还需与实际 release、数据库和配置身份对齐。

`deploy/alibaba-cloud-linux/projectmemo.service` 是 Web unit 样例；部署 README 说明实际机器有独立 Worker 服务，但未提供当前实时状态。下一轮应在授权环境核对真实 unit、同库/同 release/原功能开关、presence 路径可见性、重启/退避和非 root 写权限。无需新 Worker/Redis 架构；先通过“关闭 App 和 Web，原服务器依旧有实际观察与恢复”的自然日证据。

无变化可花获准 HTTP 额度但应避免无意义模型调用/通知；未检查、失败、过期、等待用户必须不同。来源变更、时间越界和用户改道进入原 generation/lease；旧批准及迟到输出不得生效，UNKNOWN 不释放成零，也不换工具再发一次外写。当前缺口主要是这些合同在真实部署与独立质量中的联合证明，以及用户能否自然交代责任、看懂等待和停止。

## 5. 核心价值与创新主张

| 候选定位 | 优点 | 局限 / 裁决 |
|---|---|---|
| “有记忆的项目 AI” | 好理解、入口明确 | 容易被理解成笔记检索；不能单独承载持续责任 |
| “替你持续跟进项目的 Agent” | 突出用户离开后的责任 | 必须有运行、范围、结果和通知证据，不能暗示无限后台 |
| “记得来龙去脉，查清问题，随时接着推进” | 将理解、调查、长期跟进和跨端接在一起 | 推荐主表达；内部技术名称放依据/活动详情 |

技术上最可辩护的是**原决策循环与有版本证据、用户纠正、长期累计预算和跨端原对象恢复的联合机制**，是系统工程和产品创新候选，不声称算法首创或行业独有。Memory/Dream/定时器/卡片/数据库持久化各自都是常见技术；组合是否有价值取决于下面可观测行为。

| 比较对象 | 能力可能重叠的地方 | ProjectMemo 应证明的区别 |
|---|---|---|
| 通用 AI 助手 | 记忆、联网工具、计划、任务均可能存在 | 学生项目来源/目标版本与原结果链连续，纠正能改在途判断，重复解释与错误迁移更少；不声称别的助手一律做不到 |
| AI 笔记 | 保存、摘要、检索、问答 | 推测影响原调查，新证据反驳旧判断并合法改道，而非只生成另一篇摘要 |
| 任务管理 | 到期、提醒、任务状态 | 观察真实来源后决定何时调查/提问/等待，Action DONE 不冒充项目目标实现 |
| 常见自动化 | 事件/定时触发和固定动作 | 在原责任内由模型按新观察选择工具和路径；确定性的鉴权/预算守卫不等于固定业务流程 |

公开方法参照只支撑设计判断：Anthropic 区分预定义工作流与模型动态控制过程/工具；文章标明部分工具生态已经变化，不当作当前全部产品清单。[Building effective agents](https://www.anthropic.com/research/building-effective-agents)。LangGraph 区分线程 checkpoint 与跨线程 store，说明持久化并非独有贡献，也不自动解决副作用幂等。[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)。本轮不引入它们的框架或新依赖。

## 6. 独立比较矩阵

定性判断不构成赛方评分。成本是相对现有工程的增量，不是工期承诺；Owner/资源未指定，冲刺以依赖和停止扩展条件管理。

| 深化项 | Agent 深度 / 用户价值 | 鸿蒙差异 | 复用与当前完成度 | 安全/可靠性及平台依赖 | 整合成本 / 长期影响 / 11月12日前现实性 |
|---|---|---|---|---|---|
| 材料理解→核对→原调查 | 高 / 高 | 手机捕获、短纠正 | FVT01/06，原采集/Turn/批准；项目前预览未闭合 | 准入、G02/03/04/10、临时原件与处理许可；实模必验 | 中高；强化原入口不换执行器；建议主线，11/5探针失败则保留手工确认并如实缩小已交付宣称 |
| Memory/Dream 驱动改道 | 高 / 条件成立时高 | 跨会话/手机纠正 | UX2/CT1/CT8/PM；上下文链已在 | 根来源、旧窗口、撤权/迟到/负迁移；独立实模 | 中；优先质量与召回局部修复；适合先积累对照，不先建新存储 |
| 有界长期责任 | 高 / 高 | 用户离开后 App 快速接回 | UX3/CT3 原 Worker/Attention 大量实现 | 真实服务器、版本/库/权限与自然日；不能靠 `/health` 证明 | 中；主要是部署契约与验收，值得 S0/S1 优先 |
| 卡片＋原问题接续 | 中高的协作价值 / 高 | 高，减少找回上下文 | 原 Form/Want/Handoff；精确问题/证据待验 | TTL、owner、冷/热启动、失效审批、真机 | 中；复用原身份，推荐鸿蒙主线；不要求新增小艺才能完成 |
| 系统分享 | 本身低，接理解后中高 / 高 | 高，真实捕获场景 | 原 Capture/Attachment 复用；原生接收未实现 | URI、离线原件、账户和处理许可，真机 | 中；11/5平台探针通后可 S2→S1，不能消耗核心回归缓冲 |
| 小艺/Intents | 平台入口本身低 / 取决于频率 | 中高，平台开通后 | 受限 resume 后端存在，原生注册/分发未签收 | 签名、注册、投递、权限；不批准高风险 | 不确定；先探针，11/5无条件即留 S3，不假接入 |
| 结果与费用说明 | 中 / 高信任价值 | 手机摘要、Web核查 | 原 G07～09/FVT02/05，货币成本仍未知 | 报告≠独立验证、费用包含关系和覆盖 | 中；基础只读投影 S1，完整货币账单/上界随原路线 |
| 大型记忆平台/穿戴全功能 | 未证 / 未证 | 可能有长期价值 | 原架构无此必要增量 | 新权限、数据复制、设备/签名与高回归面 | 高；当前投入会挤压真实质量，保留有条件 S3 |

## 7. 15 个问题的明确回答

| 问题 | 独立回答与证据边界 |
|---|---|
| 1 与通用聊天的实质区别？ | 应是项目目标/材料版本/原责任和结果的连续服务，不是多一段 system prompt；第3～4节代码支持基础，净收益待真实任务 |
| 2 与笔记/任务/自动化的区别？ | 来源有效性参与决策、观察引发调查、结果支持分层；常见产品也可能有相似功能，不作排他比较 |
| 3 哪些真自主？ | 模型按证据选工具、形成信息需求、读原文、改道和决定问/停；sourcePolicy、事务与租约是执行边界，不是智能本身 |
| 4 Dream 是否影响判断？ | 假设已进入两个原 Composer，具备影响路径；只有受控实模比较显示改变正确决策时才可声称有效认知收益 |
| 5 怎样区别重规划与定时？ | 触发只是唤醒；GoalGap/原循环根据新观察改下一步，需展示真实工具选择与反例后的差异，不展示预排的全工具流程 |
| 6 长期责任有边界/恢复吗？ | 原 Mission 合同、累计预算、lease/UNKNOWN/停止已在；真实后台联合证明未完成 |
| 7 Personal 是否超越语气？ | 可把显式实验习惯用于先核对条件，但需观察实际工具/条件决策；纯风格改善不足以证明项目协作收益 |
| 8 鸿蒙何时明显有用？ | 材料出现即分享、卡片看到关键等待、手机补一项条件后 Web 回原问题；详见鸿蒙策略 |
| 9 哪些只是平台调用？ | 注册表单卡片、Want 路由、Intents 注册本身；原对象/权限/时效与认知协作闭环才是产品增量 |
| 10 怎样核查结果？ | 原 Action/resultCardId 与独立目标条件/设备实测分别记录，CI/自述/报告/反例/未知分开；不由模型自评盖章 |
| 11 什么承诺缺实证？ | 广泛长期理解、Experience 净收益、语义旧条件召回、真实多日通知价值、真机/小艺分发、当前版本线上协作 |
| 12 去掉一端损失什么？ | 无 Web 仍可能完成后端任务，但深证据/预算核查负担上升；无鸿蒙仍可用 Web，但捕获与日常短协作/卡片可达性损失。不是人为技术互锁 |
| 13 去掉记忆/Dream/Always On 呢？ | 部分即时任务仍可完成；比较遗漏条件、重复解释、错误调查与用户不在线时的观察/接续。无变化场景不强迫证明每个模块必需 |
| 14 足够清楚的创新主张？ | 证据有效性与可纠正判断、带责任边界的动态持续协作、跨端原问题接续；联合效果要证实，不以架构复杂度推导 |
| 15 最值得打磨什么？ | 已有动态调查/原文回读、纠正与恢复、Worker观察及低打扰、原结果核查与双端入口；优先于新市场/新后台/炫技硬件 |

## 8. UX 与最危险的五个风险

截图和源码显示信息层级有改善，但没有足够证据认定老师的信息过载问题已解决。旧 Web focus 同屏有主焦点、列表与大空对话区；鸿蒙 focus 有一项主提醒但紧接两张计数卡；新项目页仍用“4/6 项已形成”和数量突出状态，用户可能误认真实目标进度。当前 `lib/projectDashboard.ts` 的六项是类型存在/草稿形成信号，不是官方六项交付要求或自主智能。

主目录 ProjectCard 的未提交说明已解释“清单比例非项目完成率”，鸿蒙对应口径和实际点击仍需读回验证。不要继续把比赛稿件模板扩成隐藏 Agent 规则；任何原已有显式成果模板都应标为用户选择的文档辅助，而非自动执行计划。陌生用户首先回答主焦点、重要变化、持续委托，其余原文/工具/假设/预算通过正常详情展开。专家使用同一产品入口，不做评委专页。

最危险的五类风险按当前投入顺序为：

1. **隐私/权限与依赖安全开放未闭合**：G10/G12/G13/G15/G21；外发、越权删除或脏包不能用比赛时间豁免。
2. **多版本和迁移断层**：本地/PM/线上/HAP 不同，未知当前安装包；把分支能力宣称成线上能力。
3. **持续责任只在开发进程里成立**：真实 Worker、同库/presence/重启和自然日未经签收；App 关闭后无人观察。
4. **工程 PASS 被包装成智能/结果 PASS**：PM 新失败、E2E setup、mock、旧截图或 Action DONE 混算为真实收益。
5. **冻结前扩展失控**：分享/Intents/新工具/视觉重绘挤压当前 UI 返回、用户理解和安全回归，最后无法完整运行和封包。

安全、功能、证据三个 Gate 的具体关闭条件与 Owner 槽位见冲刺视图。源码比对只证明缺口仍在，未在真实数据库复现破坏性操作。下一轮先独立库负例再修，不在生产验证删除或外写。

## 9. 本轮来源与图像核对

| ID | 文件/来源 | 使用边界 |
|---|---|---|
| A01 | [原 Roadmap](../PRODUCT_VALUE_TRUST/PRIORITY_ROADMAP_2026-11-01.md)、[代码矩阵](../PRODUCT_VALUE_TRUST/CODE_GAP_MATRIX_2026-11-01.md)及其快照 | 八项 FVT、G01～21 与三类 Gate 继续为权威，不重新编号替代 |
| A02 | [UX Roadmap](../../../planning/r4-agent-ux-integration/R4_AGENT_UX_INTEGRATION_ROADMAP.md)、[UX实施](../../project/implementation/R4_AGENT_UX_IMPLEMENTATION_NOTES.md) | UX1～3、旧模拟器/可控时钟证据；旧HEAD不覆盖当前分支 |
| A03 | [CT7实施](../../project/implementation/R4_DEPLOYMENT_IMPLEMENTATION_NOTES.md)、[CT8～10审计](../../../planning/r4-post-ux2-implementation/R4_CT8_TO_CT10_INDEPENDENT_AUDIT_2026-10-31.md) | 以追加记录/当前祖先关系解释历史矛盾 |
| A04 | [PM实施](D:/Projects/hongmen-personal-memory/docs/FINAL/Memory/PERSONAL_MEMORY_PM1_IMPLEMENTATION_NOTES.md)、[PM4日志](D:/Projects/hongmen-personal-memory/evidence/personal-memory-pm1/20261101/full-regression-pm4.log) | 分支已实现、阶段验证与最新失败分开；不替该 Agent 写 PASS |
| A05 | [PM入口日志](D:/Projects/hongmen-personal-memory/evidence/personal-memory-visibility/20261101/acceptance-run.log) | 早先返回失败；末次复核26项脚本断言通过、0失败，待提交/整合与跨端独立验收 |
| A06 | [Web focus](../../../evidence/r4-ui-quality/20261031/after/web-focus-desktop.png)、[原生focus](../../../evidence/r4-ui-quality/20261031/after/native-focus.jpg) | 本轮确实查看；历史隔离数据/截图，非当前 dirty UI 的全量视觉签收 |
| A07 | [项目新截图](../../../evidence/settings-ux-20261101/04-projects-final.jpeg)、[设置新截图](../../../evidence/settings-ux-20261101/06-settings-new.jpeg) | 可见主次层级/草稿清单及小艺未接入状态；未新跑操作、不证明真实业务数据 |
| A08 | [CT7撤销截图](../../../evidence/r4-deployment/20261031-acceptance/native-VerifyRevoked.png) | 合成 service.example.org、历史只读许可撤销；不能用于宣称真实环境上线 |

本轮未重新执行完整 AX 23 规则并给新分数，原 AX 审计只作为对应基线的依据。当前产品发布判断来自具体 G/PM/部署 Gate，不借旧分数覆盖新风险。鸿蒙细项规则、上下文和验证矩阵见鸿蒙策略。

## 10. 最终取舍：深化什么，先证明什么

**三个完整产品能力**按冲刺S1交付：①材料理解、整体纠正与自主核查；②记忆/假设参与的有界长期责任；③鸿蒙卡片/手机接回原问题，Web核对真实结果。它们共用一个项目与原任务身份，不是三套新增系统。

**三个优先智能行为**是：①从当前条件找出真正缺口并回原文，决定是否需要工具；②新观察/反例到来后修订原主张并合法改道；③恰当选择自行调查、一个关键问题、请求权限或停止，接管后从原身份恢复。前两项检验长期理解是否超越总结，第三项避免自主性变成无边界执行。

**最值得先提高质量的已有功能**是UX2假设/纠正和旧条件读取、原Worker/Attention的无变化/失败/等待表达、CT7来源范围/时效、PM入口与控制、原Action/结果/Handoff及两端渐进披露。它们不需要新品牌名或新的数据库。

**先积累实证而非继续加功能**：动态工具选择、纠正对在途消费者的影响、Dream是否改变正确判断、Experience净收益、实际三日低打扰、手机/Web同一问题接续。若独立对照发现无收益，先修失败类别和选择策略，不以追加更多记忆类型来回避。

**当前应避免的扩展**：未具设备/平台条件的穿戴审批与全量分布式迁移、通用工具市场/新provider、自动Prompt演化、新常驻“夜间Dream”服务、大范围UI重绘和比赛轨迹控制台。它们回归面或权限面大，而本轮关键证据仍未闭合。

**时间不足的保护项**：安全和数据、原目标/来源/预算/结果身份、动态调查与合理停止、纠正/接续、原生手机主路径、完整可运行源码和真实素材。决赛后继续原PM5长期研究、语义旧条件召回、条件经验/能力恢复、系统分享/Intents及真实多设备，不借截止期删长期目标。

## 11. 本轮只读来源指纹与保护回执

下列机读记录用于复查本轮观察，不是业务账本或设备签收。初始指纹与末次证据更新分别保留；原Final Value文档保持原字节，本轮只新增本目录六份Markdown。

```json
{
  "capturedAtUtc": "2026-11-01T14:37:19.021673+00:00",
  "userSpecificationSha256": "add575546b1d4e4bf0c410346238fe57c2b456b8d4fa8d851a04e7fe69c223a5",
  "mainHead": "1ee89f38852afa6a29518bb409da0d9210af2751",
  "personalMemoryHead": "cf1bbb012f07d7fe84143b2fdc4befec54eedf59",
  "worktreesPorcelain": "worktree D:/Projects/hongmen\nHEAD 1ee89f38852afa6a29518bb409da0d9210af2751\nbranch refs/heads/master\n\nworktree C:/Users/Administrator/.codex/worktrees/web-ecs/hongmen\nHEAD a7e36760788f4ae26aae92b90b8c5dac4a37b2d6\nbranch refs/heads/codex/web-ecs\n\nworktree D:/Projects/hongmen-ct7\nHEAD cb5fec8c3d516f4ff62fdf24850229e08e958a79\nbranch refs/heads/codex/ct7-deployment-observer\n\nworktree D:/Projects/hongmen-ct7-main-integration\nHEAD 1ee89f38852afa6a29518bb409da0d9210af2751\nbranch refs/heads/codex/ct7-main-integration\n\nworktree D:/Projects/hongmen-ct8\nHEAD bc74e97c62604467930be37073f7ebb9353e32c6\nbranch refs/heads/codex/ct9-browser-read\n\nworktree D:/Projects/hongmen-ct8-10-audit\nHEAD 2b0067da03bc59b0c74d8c86c42cc74dcdc936a2\nbranch refs/heads/codex/ct8-ct10-integration-audit\n\nworktree D:/Projects/hongmen-personal-memory\nHEAD cf1bbb012f07d7fe84143b2fdc4befec54eedf59\nbranch refs/heads/codex/personal-memory-explicit\n\nworktree D:/Projects/hongmen-pr6-closeout-20261028\nHEAD 1132f30ee149e42d5f9fce79219ba1d9ecf02ea3\ndetached\nprunable gitdir file points to non-existent location\n\nworktree D:/Projects/hongmen-r3-release-merge\nHEAD 21d8bf178fec2e570aba18064cd0fc7f0595c6ba\nbranch refs/heads/codex/pre-r4-ux\nprunable gitdir file points to non-existent location\n\nworktree D:/Projects/hongmen-ui-quality\nHEAD f4f41744036c7ff49b88a1706f3b00cffa543a62\nbranch refs/heads/codex/r4-ui-quality",
  "protectionBefore": {
    "D:\\Projects\\hongmen": {
      "head": "1ee89f38852afa6a29518bb409da0d9210af2751",
      "files": {
        "AGENTS.md": "dbff8a9d83193830b2fd06c5c131b9324c0a8e472be2c8aa2f66deff990e2750",
        "components/ProjectCard.tsx": "253afb64a75c316c0406e90e22a94a0b0ffd8d7b12591348d7a54dcb3630f363",
        "components/ProjectHealthCard.tsx": "79b8b332330f2e9c9e9a564df6534859d5d8e5a23d7ffb1f8128f20ba5e716fe",
        "components/RepositorySources.tsx": null,
        "docs/FINAL/AGENT_REVIEW/AGENT_EVOLUTION_ROADMAP.md": "7328e70a94cbd17f400c23ef418d0a62f396a408ea9a1926c9d1f057f211f631",
        "docs/UI_UX_HANDOVER_2026-11-01.md": "ed27b171e758cda572d35fddfe02b6510d84693c610637e9dbff4702644bfbbf",
        "evidence/r4-agent-ux/20261030-ux2/web-correction.png": "f273bc0c2cea85febe8dfbdb8953c875b8963db8c38d37b43a3460ca9f4da657",
        "evidence/r4-agent-ux/20261030-ux2/web-memory-panel.png": "6decb083f0dc0d1a8da5e9b6a6baaf532bd1e442c868c0a10ccb46ce86e82913",
        "harmonyos/AppScope/app.json5": "5a8bae4ea88b58de670140f29e52fa50288453ff445861e8d0491d6a4ec8a71e",
        "harmonyos/build-profile.json5": "442618a372bd9a74d204e7162ffe6844b6fc49dbf4c09b8cc5bc58c6709a1924",
        "harmonyos/entry/src/main/ets/components/HealthEntryCard.ets": "302e993efb19fd468664d2bc3cc3d7a86458b7a852973a978a4c1b403d86b7ab",
        "harmonyos/entry/src/main/ets/components/MetricBadge.ets": "c6ab46386e7f3459b3b2350ae6fb7f9ddbbbbb6017d2633cf24dde2a7f85d9d2",
        "harmonyos/entry/src/main/ets/components/ProjectImpactPanel.ets": "809afc4893b9f2c8606cc38e3e2aee0ea0f547063cb53033e851ffd984a76177",
        "harmonyos/entry/src/main/ets/components/ProjectStatePanel.ets": "4a4bda4843547ab417f986e388b6d52b3e04b074a8b25a46d102d4f435cabb37",
        "harmonyos/entry/src/main/ets/components/ReminderSettingsView.ets": "88a8574364f17954a7c6cd5ddb093eb9e49e2c3c16627234551a9e5b55d0e748",
        "harmonyos/entry/src/main/ets/pages/FeatureGuide.ets": "371f50b59860477f103902e0073fb6309dd65c595bf22ac7a9359ca745153bdd",
        "harmonyos/entry/src/main/ets/pages/Index.ets": "c7b93aa352adaa8bdd9f51230a03eb2b11e12ffd6cf6586324d640e226dcd03b",
        "harmonyos/entry/src/main/ets/pages/ProjectHome.ets": "dd9bbe483ed7a3b318f219a7210029d430ddfab39e5f3728b1b470372c0f4a77",
        "tsconfig.json": "af1b4fbd345a0d2b7e23394aca3540b524a3d4826fca6a51169b13b2a325ee4a"
      }
    },
    "D:\\Projects\\hongmen-personal-memory": {
      "head": "cf1bbb012f07d7fe84143b2fdc4befec54eedf59",
      "files": {
        "app/api/me/memory/policy/route.ts": "3e800563504b5b4b8d879271c84ccac25ecadd64fa8a8907f1ef46b54b2c3e03",
        "components/GlobalWorkspacePage.tsx": "fb561470853675505159bd17030a7c6eea8832062d822647f9b28eb060e371bd",
        "components/MissionResponsibilityPanel.tsx": "b6edd5a0dc71267319fc2d0fe4dedd168024465a0367db5ad4d4c98840c8a53b",
        "components/PersonalMemoryManager.tsx": "482b4cf2aac238423c9e0a97796a73881013907cac6ea0619f550543f9fef166",
        "components/UserNav.tsx": "59c5ea7986f611d070b14b8049d53f91ca837b2c5cd1220c724c4c0384b1f91a",
        "harmonyos/entry/src/main/ets/pages/Index.ets": "90228805d018e30529c8ba32edda48d36408159ae5ae9461c39ebda4b203659d",
        "lib/memory/personalInvalidation.ts": "90d3d758d3f2301de31b6affbcb5d26af82c6518c7ac3ad8a7a2c9b3e61bb9d2",
        "lib/memory/personalMemoryService.ts": "590c034521eb7fa5e8e26b8e73efcaffc4bcb4ca74bc55c46d14e29ceb820ced",
        "lib/mission/modelProtocol.ts": "468b82fa7c66bc962d03f832550101f8ffeff61c1aa8c09af3ddd126097a0778",
        "lib/mission/responsibility.ts": "5d9d97e559b290ba98f4ede6d0efafc1211769054f092d36c329afdec2e74b66"
      }
    }
  },
  "protectionObservedAfter": {
    "D:\\Projects\\hongmen": {
      "headChanged": false,
      "hashChanges": [],
      "newDirtyPaths": []
    },
    "D:\\Projects\\hongmen-personal-memory": {
      "headChanged": false,
      "hashChanges": [],
      "newDirtyPaths": [
        "next-env.d.ts"
      ]
    }
  },
  "originalFinalValueDocumentsUnchanged": {
    "CODE_GAP_MATRIX_2026-11-01.md": true,
    "FINAL_VERTICAL_ACCEPTANCE_JOURNEY_2026-11-01.md": true,
    "PRIORITY_ROADMAP_2026-11-01.md": true,
    "PROJECTMEMO_FINAL_VALUE_TRUST_RESEARCH_2026-11-01.md": true
  },
  "publicHealth": {
    "method": "one unauthenticated GET /health",
    "observedStatus": 200,
    "release": "71499b6d6e48fbf1116cdbcb76e2fe3d07e4602e",
    "checkedAtReturned": "2026-11-01T14:11:37.224Z",
    "workerOrAuthenticatedAcceptance": false
  },
  "businessCodeOrDataWritten": false,
  "newModelTestWorkerDeviceOrDeploymentStarted": false,
  "sourceAndEvidenceRawSha256": {
    "D:\\Projects\\hongmen\\AGENTS.md": "dbff8a9d83193830b2fd06c5c131b9324c0a8e472be2c8aa2f66deff990e2750",
    "D:\\Projects\\hongmen\\lib\\memory\\hypothesisService.ts": "86f72182ce3abffb2a00f67809bbcd4ae22ccf9534037ed1618e682e544b1cf6",
    "D:\\Projects\\hongmen\\lib\\memory\\digestService.ts": "8c5616b65bbe9397f9cbae3a6012e56d133a5bcf94aae84d854270172a96a53e",
    "D:\\Projects\\hongmen\\lib\\mission\\contextBuilder.ts": "2b159eb69420ff946550069b6c3ec554709090d519033b046b9a412824cc55e2",
    "D:\\Projects\\hongmen\\lib\\conversation\\investigationService.ts": "7e0115a7b6c3b25447318caaf2e0108fdee55608e7b821c9a5e382cba9cbb508",
    "D:\\Projects\\hongmen\\lib\\mission\\runner.ts": "cc77e37caae11ee496ab4b7fe195328767ddad6cc49f828bfdc77286921851dd",
    "D:\\Projects\\hongmen\\lib\\continuity\\sourcePolicy.ts": "d3e3eb331febb3efc492258e0b032b4dfbb069e4f39d736349fc026980de855e",
    "D:\\Projects\\hongmen\\lib\\decision\\goalState.ts": "3ad9ba05181068962b8c960db4014c7682c12861c95744fe0255e86ad8aa9407",
    "D:\\Projects\\hongmen\\lib\\projectDashboard.ts": "680dea13c8cf7a6061433eab402c1624ee4df6976118153cc16adc2b447d872f",
    "D:\\Projects\\hongmen\\lib\\mission\\workerPresence.ts": "bf8b5597a232cd0fd92ff26976ba0947dd71b527ce37d58850c445fb68e57fbd",
    "D:\\Projects\\hongmen\\scripts\\mission-worker.ts": "fc789fa23167d31f2176a2bc3cd487111decb05c4e168fad867513f724e825e0",
    "D:\\Projects\\hongmen\\deploy\\alibaba-cloud-linux\\projectmemo.service": "a5b14dd5304d3548019581ebf2ec6d8a7c97fa6a8de7851f43e7c797773bc459",
    "D:\\Projects\\hongmen\\deploy\\alibaba-cloud-linux\\README.md": "22fbf2e23508d2cc8fbbbe69e8cec224c72555c902d47a79ae65647e582a8af9",
    "D:\\Projects\\hongmen\\harmonyos\\entry\\src\\main\\ets\\common\\Constants.ets": "dc1cb22e32f49a6200c8d59a0a2fbd64dba7f44a2bf66371d1e68428fed0bbe8",
    "D:\\Projects\\hongmen\\harmonyos\\entry\\src\\main\\module.json5": "c2b62a9c9cf3c25ab177b4b3d4ccd31cbc4bff1723a1276351e814343e2354ac",
    "D:\\Projects\\hongmen\\harmonyos\\entry\\src\\main\\ets\\services\\WidgetDataService.ets": "e2dd5c00983534925de292fca92fc4b316295edb7cbdd47c5181904693ca3c5f",
    "D:\\Projects\\hongmen\\harmonyos\\entry\\src\\main\\ets\\entryformability\\EntryFormAbility.ets": "dc4f7f8629d25d0f8718e4c507004fe28093823dbf2f360b5badbdd4e60cc82c",
    "D:\\Projects\\hongmen\\harmonyos\\entry\\src\\main\\ets\\entryability\\EntryAbility.ets": "9be16055aacd221cea04953da833ea450600caee90c26e603ac7c4742006db6f",
    "D:\\Projects\\hongmen\\lib\\xiaoyi\\inspectMissionService.ts": "da92238c7500dfb9f080b71e3c485f7dd4169d9cf7367a17c6179b70bd17f563",
    "D:\\Projects\\hongmen\\lib\\xiaoyi\\resumeMissionService.ts": "8b738f11e05d965f58a0b2770f8f316f8300a5f619504e9f1f507dcc87ee0124",
    "D:\\Projects\\hongmen\\app\\api\\projects\\route.ts": "14a79b4d826816547f70f4dd40b1d2d4b49ee58dfe0ec4631270bd8aab1dd7aa",
    "D:\\Projects\\hongmen\\app\\api\\projects\\[id]\\route.ts": "0e1782f6446195b8eedc0f34d97085a999e343c9740ba0beec8b44052d914636",
    "D:\\Projects\\hongmen\\components\\MarkdownRenderer.tsx": "eb8f011abcff1b52a8b3fe58977c5ec00b94559dd1d95b098db3c9a68a306708",
    "D:\\Projects\\hongmen\\app\\health\\route.ts": "65eb21a5144d46e4442a29dbddd0d76e2ac05e76b97ce83217f8498cc303016b",
    "D:\\Projects\\hongmen\\app\\api\\conversations\\capabilities\\route.ts": "b090786c84e1167a5478fe468cd7432b0cebe305f27ebe8862f5e1b5f56b7962",
    "D:\\Projects\\hongmen\\package.json": "9aa7e133182cbc5b23f0653671abab62b244cc964927da865b220ec7b0d132bb",
    "D:\\Projects\\hongmen-personal-memory\\lib\\memory\\personalInvalidation.ts": "90d3d758d3f2301de31b6affbcb5d26af82c6518c7ac3ad8a7a2c9b3e61bb9d2",
    "D:\\Projects\\hongmen-personal-memory\\lib\\memory\\personalContext.ts": "ebbea4e251ae84a14847209d362b113155c8a30204bebfa7edf0163204fb46b9",
    "D:\\Projects\\hongmen-personal-memory\\components\\PersonalMemoryManager.tsx": "482b4cf2aac238423c9e0a97796a73881013907cac6ea0619f550543f9fef166",
    "D:\\Projects\\hongmen-personal-memory\\components\\UserNav.tsx": "59c5ea7986f611d070b14b8049d53f91ca837b2c5cd1220c724c4c0384b1f91a",
    "D:\\Projects\\hongmen-personal-memory\\components\\GlobalWorkspacePage.tsx": "fb561470853675505159bd17030a7c6eea8832062d822647f9b28eb060e371bd",
    "D:\\Projects\\hongmen-personal-memory\\components\\MemoryScopeNav.tsx": "4f752aa6da53b12ec0958cfc1289fe5a1c2105eb0e6fffb36974c1ab946b1763",
    "D:\\Projects\\hongmen-personal-memory\\harmonyos\\entry\\src\\main\\ets\\pages\\Index.ets": "90228805d018e30529c8ba32edda48d36408159ae5ae9461c39ebda4b203659d",
    "D:\\Projects\\hongmen-personal-memory\\tests\\pm4EvolutionResponsibility.test.ts": "f9fe014f2213776e77abe6a0fe573d14a4267588f5e325d93a47f890bc8a6156",
    "D:\\Projects\\hongmen-personal-memory\\evidence\\personal-memory-pm1\\20261101\\full-regression-pm4.log": "c0f805731b64febeba74c765dc0c6d39a429bdda0ac5e33a41f9b5f8258a01f8",
    "D:\\Projects\\hongmen-personal-memory\\evidence\\personal-memory-pm1\\20261101\\validation.json": "a2b5e5a31fc0195b752818fa9f802c726010b04875aee5eb8dd135ed89b2c703",
    "D:\\Projects\\hongmen-personal-memory\\evidence\\personal-memory-visibility\\20261101\\acceptance-run.log": "15f41fb54c07c56b206f349be53d0ec5de694b3d450e8a4d5c29efc0e89ba019"
  },
  "viewedImageRawSha256": {
    "D:\\Projects\\hongmen\\evidence\\r4-ui-quality\\20261031\\after\\web-focus-desktop.png": "5fca586dd66707ae41a2a608fecf6e1c5757c9a6f9acaae5e7042620289bbb59",
    "D:\\Projects\\hongmen\\evidence\\r4-ui-quality\\20261031\\after\\native-focus.jpg": "c5aa6673c094e50bc26710763fe6f75fc60ab70f458e7e1754a4fbf22022ac5f",
    "D:\\Projects\\hongmen\\evidence\\settings-ux-20261101\\04-projects-final.jpeg": "5392234ef736503b4f80d9c348d4c59e1c7c0b47cf6e8b05f449fcfef44f86cb",
    "D:\\Projects\\hongmen\\evidence\\settings-ux-20261101\\06-settings-new.jpeg": "744af2e3fd3efee2e00e3b0eadc26ee4920a1dd3ad0a87b3e3d8aad5da9d3152",
    "D:\\Projects\\hongmen\\evidence\\r4-deployment\\20261031-acceptance\\native-VerifyRevoked.png": "cb34ce142390e523f43a5414df3af041a0aaa1ead41eee7bae51132c26fcce59"
  },
  "siblingDocumentsSha256": {
    "COMPETITION_DELIVERABLE_CHECKLIST.md": "37c0a5188d7548576575ec9b6d3ba5dfbee2cd2b52dc3ac7b539f8589a385354",
    "COMPETITION_HARMONYOS_STRATEGY.md": "85aab460ac5d8b59ab2f3cc0779f4e4c26e868ed1569b384d4bb75afcdc6b4a1",
    "COMPETITION_IMPLEMENTATION_HANDOFF.md": "527b00c09b200ae0beb1be9d049b9787a68943fb182010f0c7da935473402588",
    "COMPETITION_REAL_USER_JOURNEY.md": "1e11423fe0c3076dce5a4e1ff766a761babf7a95f0f32d5540eb7b8367352417",
    "COMPETITION_SPRINT_ROADMAP.md": "218ce101a11d0a4f901a0b25629f13ebac6c3d6a3b52cd93d79801b84b8bca4d"
  },
  "note": "Raw Windows worktree hashes, no private configuration bodies. Source trees may change in parallel after this snapshot; only observed before/after is claimed. The containing audit file is excluded from its own hash list.",
  "lateEvidenceUpdate": {
    "observedAtUtc": "2026-11-01T14:40:57.866490+00:00",
    "personalMemoryHead": "da92ba1fb996e6ce18787de984a19215385b6393",
    "memoryVisibility": {
      "passed": 26,
      "failed": 0,
      "scope": "script checks including API and UI, not 26 complete cross-device business E2Es",
      "summaryPresent": true,
      "logSha256": "15f41fb54c07c56b206f349be53d0ec5de694b3d450e8a4d5c29efc0e89ba019",
      "scriptSha256": "e851701a8065da2d0f66bbf6f09d39b30dc440980d379a8c0e754f229e23b910",
      "earlierFailure": "Earlier inspection saw browser-back navigation failure; current script records hydration/history and passes. Earlier observations retained; no claim of physical device or real-model acceptance."
    },
    "pmFullRegression": "Latest inspected full-regression-pm4.log still 1447 passed/2 failed EXIT 1; not closed by UI checks",
    "businessCodeTouchedByThisTask": false
  },
  "documentValidation": {
    "localLinks": "PASS",
    "balancedFences": "PASS",
    "documents": 6,
    "introductionNonWhitespaceCharacters": 513,
    "newBusinessTests": "NOT RUN (planning-only)",
    "originalRoadmapAndBusinessWorktrees": "Existing tracked dirty hashes preserved at snapshot; other Agent added next-env.d.ts; not restored or staged"
  }
}
```
