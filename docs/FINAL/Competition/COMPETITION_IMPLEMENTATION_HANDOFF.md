# 下一轮开发交接：先恢复可信基线，再交付正常产品闭环

日期：2026-11-01。此文件供用户下一轮明确启动实施时使用，**不是本轮执行授权**。当前任务只形成六份规划；不因本文存在启动付费模型、后台任务、真实库迁移、部署、外部写入或源工程封包。

依赖：[当前审查](COMPETITION_AGENT_PRODUCT_AUDIT.md)、[S0～S3时间视图](COMPETITION_SPRINT_ROADMAP.md)、[真实旅程](COMPETITION_REAL_USER_JOURNEY.md)、[鸿蒙策略](COMPETITION_HARMONYOS_STRATEGY.md)、[交付清单](COMPETITION_DELIVERABLE_CHECKLIST.md)。原 [G/FVT Roadmap](../PRODUCT_VALUE_TRUST/PRIORITY_ROADMAP_2026-11-01.md)、[V01～V40](../PRODUCT_VALUE_TRUST/FINAL_VERTICAL_ACCEPTANCE_JOURNEY_2026-11-01.md)及PM合同保持业务权威。

## 1. 可整体交给实施Agent的公共Prompt

你在Windows/PowerShell的ProjectMemo仓库工作。请只实施用户本轮明确指定的S0/S1/S2任务，先检查当前真实代码和所有权，不重做R4、不新建比赛模式、Planner/Runner、记忆/目标状态库、通知或结果账本。

1. 阅读适用AGENTS.md、上列六文档与对应原G/FVT/PM合同；记录当前HEAD、worktree、tracked/untracked、当前依赖和正在运行的验证。所有历史SHA/计数只作定位，执行时重核。
2. 审查截点：主目录master@1ee89f3有19项tracked未提交路径；PM树cf1bbb0有PM4/入口未提交实现；线上只读release71499b6，实际安装HAP身份未知。不要据此直接部署或迁移真实库。
3. 当前PM工作在D:/Projects/hongmen-personal-memory；若你就是原实施者继续本树，接手须有明确交接。不要从旧master重做PM，不跨会话争用Index、UserNav、个人记忆/责任组件，不复制dirty文件拼合。
4. 其他修复从核对过的已提交基线开codex/独立树。备份并核对具体重叠文件；不blanket stash/reset/删除，不恢复别人修改，不顺手提交AGENTS、历史截图、签名配置、生成文件或真实数据。旧prunable worktree也不顺手清理。
5. 先给当前事实与本任务范围，再做完整实现、调用方适配和必要验证。普通可逆本地工作与隔离验证不逐步询问；具体付费/生产/真实库/外写条件不足只阻塞相关动作，继续其他已授权工作。
6. 不写死比赛日期、项目名、科研题目或展示轨迹。复用正常原工具；Agent可以不联网、没有新假设、无变化、拒绝委托或保留UNKNOWN，不为镜头强制调用。
7. API/DTO改变同时核查Web和harmonyos的models/services，原owner/来源/版本/请求幂等与结果事务不降级。模型/网络在事务外，旧generation/lease不得发布，UNKNOWN和累计预算不清零。
8. 阶段交付以用户行为与原对象回执为准，不以新增表/页面/测试数量替代；日志标明provider、fixture/真实材料、版本和缺口，不输出密钥/私有正文。

## 2. 第一包任务：S0恢复与独立审查

### 2.1 PM原工作树：先裁决失败，再形成可审查提交

核对PM1～3的既有提交、PM4实际diff、未跟踪文件、实施记录与最新日志。禁止在别人仍跑全量时重新开启并行Vitest或复制数据库。

**要解决的具体问题：**

- `full-regression-pm4.log`为1447通过/2失败，退出1，位于PDF reader/Poppler。核对真实可执行路径/版本与测试输入、当前源码。若根因是环境，配置可复现的解析器并重跑受影响检查；若是代码缺陷，先补可复现负例再修。不得通过skip、空返回、减少物理页/版本断言或隐藏日志来变绿。
- `personal-memory-visibility/.../acceptance-run.log`早先browser back落到focus并超时，本轮末次复核已26项通过/0失败。读取最新脚本的水合等待/历史栈记录与源码，复核原“正常导航进入、返回原位置”断言和API/owner覆盖，不只检查URL直达。不重复修一个已解决问题，也不将26项脚本断言等同于完整跨端或实模签收。
- PM-R01：构造超过12个其他CHAT Run、模型在途且尚无Step、同owner不同Mission、条目暂停/修改/隐私关闭/撤权/到期。使用await屏障，在原派发/发布/结算边界证明同步守卫保护。若有遗漏补原对象身份/依赖回查，不为测试删窗口外条目或全局无差别暂停所有任务。
- 核对原准入、候选不注入、范围/处理许可、暂停/删除/导出及防复活；当前有效个人条目能在两Composer消费，实际Action/resultCardId/Handoff不被入口修复切断。

**验收：**稳定源码指纹、必要全量/类型/lint/Web构建/E2E、Harmony单测与页面HAP构建，实际入口和返回；新UI/在途用例按风险适配。旧环境说明不替代新回执；构建和安装分开。通过后提交PM4/入口及实施记录，列实际Commit/剩余Gate；未经用户授权不自动合并/部署。

### 2.2 原P0修复：按共享不变量分包，不搞一次性全库重构

| 修复包 | 指定边界 | 必须负例 / 完成行为 |
|---|---|---|
| 原建项与模式 G02/G03/G04 | Project/OWNER/稳定requestId同事务；Capture原件保存与规则/模型/失败模式分开；capabilities读实际资格不付费探活 | 归属失败无孤儿，回包丢失只建一次；零额度/缺key/失败不宣称真实模型判断；Web/Harmony读回一致 |
| 账户与销毁 G10/G12/G13 | 草稿owner隔离及退出/撤权；原销毁服务内当前角色/确认/相关版本；同步停用→文件/派生清理与无正文恢复身份 | A退出B同项目不见旧草稿；MEMBER直接DELETE拒绝；上传/清除竞争及清理失败可恢复，不先级联删掉全部清理身份 |
| 渲染外发 G15 | 原MarkdownRenderer和附件渲染，禁止未批准外部img/preload等自动加载 | 合成canary的真实浏览器网络检查，合法本地/鉴权附件仍可用；仅SSR标签检查不签实际外发已修 |
| 依赖 G21 | 独立package/lock兼容安全补丁，不与业务schema顺带混改 | 公告/实际运行路径、目标OS/SQLite/Next/Prisma、必要全量和两端构建；不audit fix --force、不回滚易受攻击版本当安全方案 |

每包先检查是否已有别的提交修复，发现已解决就复核而不重复建设。真实数据不用于漏洞利用或删除试验。必要UI显示沿原状态，不加技术控制台。只有实际修复提交和负例证据才能关闭对应Issue。

### 2.3 Worker和后端版本：准备可审查结果再申请具体发布

先在隔离的同部署拓扑环境验证Web/原Worker用同数据库、同契约/开关/实际release及presence可见路径。记录启动、scan/claim/失败、App关闭/Worker重启后的原任务、nextAttempt/预算/UNKNOWN和停止。不要使用默认真实.env自动跑`mission:worker`，它可能消费已有任务/付费。

若用户后续授权真实发布，先备好实际目标Commit、变更/迁移计划、可恢复备份、原服务/Worker/用户数据保护、回滚与真实用户路径验证。生产部署、迁移、实例重启最后按具体授权进行；本文件不批准。公共health仅作liveness/release；认证业务/Worker/模型/来源各自取证。

## 3. 第二包任务：S1完整纵向产品切片

### 3.1 材料理解与动态调查（FVT01/06）

目标：真实用户提供材料后，得到带出处、可整体核对与纠正的项目理解，确认后建立原业务对象，并在原Conversation/Mission查清一个问题。

- 先探针项目前材料处理。原Capture/Attachment要projectId，不造假项目。复用原账户Conversation/Turn/AgentRun和解析器，必要临时原件仅有owner/hash/期限/清除身份，不成为永久事实或任务。
- 预览明确原文/推断/未知、目标/约束/时区/验收候选与下一方向。冻结draft/revision/原件/预览hash、用户修订与requestId；整体确认后原子建Project/OWNER/回执，再以原请求接资料同步。附件失败保留真实部分状态，不重建项目或宣称文件与事务原子完成。
- Agent从实际证据选择直接回答、原文/工具调查、一项必要问题、具体权限请求或停止。继续复用原动态工具与观察回流，不规定固定工具步骤或强制新Dream。
- Web原文/整体核对、手机短预览/纠正和原问题接回；原Action批准→完成→resultCardId→Handoff必须保留，不接受只做表单/摘要。
- 验证原V01/03/05/07/08/10/16与V25/26/35/36；真实材料与模型独立评分证明调查收益，脚本仅证明状态。没有新许可不付费探索。
- 11/05完成探针，11/09停止新格式/provider扩展；回滚到明确手工建项与原调查，数据/隐私守卫不可回滚掉。

### 3.2 持续理解与有界责任（原UX2/3、CT/PM，非新执行器）

核查hypotheses/effectiveMemory/Experience已进入两个原Composer；只针对实际错误补长期条件检索、来源资格与反例修订。用同一真实问题观察旧假设是否改变原文核对/工具选择；同根摘要不增独立支持，个人偏好不代替项目条件。

用户从原界面确认责任范围/期限/工具/累计预算，原Worker在用户离开后保持原对象、观察水位与等待。无变化不反复调用模型/通知；失败/未检/失效/等用户分开；Scope/STOP/到期与迟到模型/工具、旧批准/UNKNOWN按原守卫结算。

最小完整结果：两类真实项目的原许可/观察/必要协作/实际结果链与独立评分。不是要求真实三日每个分支都发生；缺失分支用独立故障轨。11/06或最迟11/08启动已获授权自然日轨，晚于窗口就保留未验，不改时间造证据。

### 3.3 鸿蒙原问题接续与结果核查（FVT04＋FVT02基础）

复用WidgetDataService/FormExtension、EntryAbility、原Handoff/readback/entry；保留owner/session/generation/TTL。原导航身份增加question/source/proposal版本和定位意图，不能带执行批准令牌、私有原话或任意URL。

手机/卡片只显示最重要关注与真实观察/同步/等待，点开原对象重鉴权；短回应后Web读回同一questionId与结果。旧问题已答、旧批准过期、换账号、撤权、断网和重复点击都可恢复/拒绝，不复制Mission。

Web进展和费用基础投影复用原GoalState/Completion/Run/Step/Action/resultCardId，区分已执行/观察/独立支持/报告/反例/未知，monetaryCost无依据仍未知，不虚构目标完成率/ROI。真机、模拟器、HAP构建分别签收；只有SDK声明不算系统渠道成功。11/09后不重构整套ArkUI导航或做穿戴扩展。

## 4. S2按条件接入，禁止泛化成新平台

分享、Intents、Adaptive自然语言、完整费用和失败经验沿冲刺表的探针/Gate进入。明确对原服务的新增量与Web/Harmony调用方，再实现。新HTTP、处理方或外写权限必须仍走原机制；实验/工具开关不是用户同意。

分享探针失败保留应用内捕获，不加假入口；小艺未开通保持“尚未接入”，不以HTTP请求mock平台；失败经验先有同意/脱敏/标签/配对对照，不能自动改生产Prompt或自增授权。所有延期保留原长期目标和重新投入条件。

## 5. 隔离验证与证据规范

1. 新写探针在导入db前设独立DATABASE_URL，复用continuityDatabase/E2E隔离脚本；Vitest不启文件并行。真实开发/生产库不得迁移/seed/reset。
2. 按本任务风险运行：`npm.cmd test -- <相关测试>`、`npm.cmd exec tsc -- --noEmit`、`npm.cmd run lint`、`npm.cmd run build`、`npm.cmd run test:e2e`；涉及ArkTS/API时加`npm.cmd run harmony:test`和`npm.cmd run harmony:build`。共享schema/核心运行合同变更需必要全量、空库重放/旧库副本升级。不是每改一行都重复全部检查。
3. 网络/模型默认合成fixture以验证守卫，标明不证明智能收益；真实调用必须对应明确模型/费用/数据处理范围与原总预算，临时错误/重试/Judge全部计量。
4. 并发用await屏障；断言派发/发布/原回执与预算，而非只看最终UI。禁止sleep碰时序、直接置DONE/SUCCEEDED、跳过失败或删断言。
5. 新证据目录，保留首次失败/修复回归、命令退出/源指纹/配置/设备/模型。Web E2E分setup/业务/跳过/重试/flaky与源码；不能沿用“33业务全通过”。
6. 工程、首次用户、真实模型、模拟器、真机、自然日、独立结果分轨；每轨关联Issue/Owner/Worktree/修复Commit/原证据/剩余风险。HAP哈希、HTTP200与用户点赞不能相互替代。
7. 不提交个人数据库、auth state、private trace、storage原件、真实.env、签名私钥；只stage自己本任务的具体文件。保留主目录UI、旧证据与其他Agent未提交工作。

## 6. 完成报告模板与冻结

结束时给出：当前用户新增能做什么；原模块复用与真实增量；逐项Security/Functional/Evidence状态；修复Commit/源码与dirty范围；实际运行的检查、独立质量/设备/自然日结果；失败/未知与恢复条件；回滚方法；下一责任方和原对象位置。

更新原G/FVT/PM追踪，不在AGENTS.md累积进度。提交成功、合并、push、部署、安装、提交U盘是不同动作，没有对应回执就不写已完成。用户若只授权实现则先交可审查提交，不自动发布；用户已明确授权的后续本地整合不再无故重复询问，但仍需保护并行工作与相关Gate。

内部11/09能力冻结、11/10候选冻结、11/11干净封包是建议工作闸门，赛方11/12 22:00才是用户通知的作品截止。临近期限不删准入/来源/费用/恢复保护；停止低收益扩展，保住原动态调查、可纠正责任、手机/Web接续与真实证据。
