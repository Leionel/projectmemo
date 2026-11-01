# 交接文档 — 问忆程对话 / 焦点 / 委托 / 资料行动 / Widget UI 精修（2026-11-01）

本文件记录本轮多批次 UI/UX 改造的完成状态、验证结果与编译阻塞点的修复记录，供下一次接手直接继续。

## 本次接手结果（2026-11-01）

已从 `9a9479f` 的干净 Index.ets 重新应用三处改动，没有复制 `.zcode` 备份的嵌套收尾：

- 顶栏搜索入口覆盖记忆 Tab，继续复用原 `searchOpen` / `globalSearchQuery` / 搜索与筛选逻辑。
- 移除全局记忆页重复的常驻输入框；搜索仍由顶栏展开，收起且有关键词时显示轻量条件与清除按钮，按钮保留 44 高度。
- 现有记忆摘要保留两行截断并增加 40 最小高度，不补造摘要或修改记忆事实。

**验证**：先仅恢复顶栏入口构建，再加入搜索布局构建，最后加入摘要高度组合构建，三次 `harmony:build` 均退出 0；最终页面编译实际执行，并非只运行不包含页面的 UnitTestArkTS。`harmony:test` 90/90。`tests/documentReader.test.ts` 当前 8/8 通过（包含真实 PDF 提取的两个用例），无需降低页码与来源校验。

当前文件最后 85 行与 HEAD 一致；备份 WIP 尾部与 HEAD 有额外结构差异。本次没有复现三处 UI 改动本身造成语法失败，不能沿用原报告把它们认定为编译根因。保留旧备份，仅供排查，禁止整份覆盖。

证据在 `evidence/ui-handover-fix/20261101/`；最终 unsigned HAP SHA-256 为 `5361d37a0c6e34575a88bdd85a7c49daa49668ba73b28f804c7ddf1f0c4b00d7`。

**仍待验收**：全局记忆默认/搜索展开/摘要高度的模拟器截图。本轮未安装包或连接生产做交互验收。构建通过不等于视觉验收通过，也不证明不同标题/无摘要的整张卡片一律等高。

**生产 404**：本地责任合同接口存在；404 也可能表示归属/对象不可访问，不能仅据状态码认定服务器版本落后。需对照实际请求路径、响应体、用户归属与服务端发布版本；不能用静默空列表代替错误，不能未经授权部署或自动批准操作。本轮不改生产地址、不迁移数据库，保留此项。

**其他工作树**：原有 ProjectHealthCard、RepositorySources 删除、Health/Metric/Impact/State 原生组件及打包配置等未提交内容均未由本轮修改或纳入提交。

## P0 历史阻塞：Index.ets 记忆页三处改动（已修复，原排查记录保留）

为全局「项目记忆档案」页做了三处小改动，但合入后 `harmony:build` 在 `Index.ets` 尾部（约 3201-3212 行的嵌套 `Column` 收尾属性区）报 `arkts-no-any-unknown` 与 `Declaration or statement expected`。**已验证与缓存无关**（清空 `harmony/entry/build` 与 hvigor 缓存后仍复现），且：

- `git checkout HEAD -- Index.ets` 后单独构建：**通过**；
- HEAD + 三处改动（任意组合整体合入）：**失败**，错误行号始终落在尾部收尾属性；
- 三处改动本身括号平衡，均不触碰尾部。

三处改动内容（从 HEAD 基线重新应用即可复现，用于定位）：

1. 顶栏放大镜对记忆 Tab 生效：删除 `if (this.currentMainTabIndex !== 1) {` 包裹（约 2660 行）。
2. `GlobalMemoryTab()` 内常驻 `TextInput` 搜索框改为：收起态「搜索：xx 清除✕」提示条 + 顶栏放大镜展开（约 1342 行）。
3. 记忆卡摘要 `.constraintSize({ minHeight: 40 })`（约 1523 行）——解决「记忆 / 随手记录卡片不一样大」。

**已回退**：`Index.ets` 当前保持在 HEAD 基线（可编译），三处改动未包含在提交中。接手后建议**逐条二分**定位触发者（改动 1 顶栏 if 包裹删除 / 改动 2 Builder 内 if 条件渲染芯片 / 改动 3 摘要 minHeight，逐条合入各自构建），修复合入即可完成全局记忆页与项目资料页的搜索/卡片统一。注意两点排查线索：
- 同期并行会话曾在 `Index.ets` 尾部留下游离 `}`（`.width` 属性悬在 struct 外），已修复为 HEAD 的双组收尾形态——重新合入时不要把该形态当作错误删掉；
- `npm.cmd run harmony:test` 的 UnitTestArkTS **不编译页面文件**，页面包是否可编译必须以 `npm.cmd run harmony:build` 为准（曾出现 90/90 测试通过但构建失败的情况）。

## 已完成并验证（`harmony:test` 88/88、`harmony:build` 通过、模拟器实测）

- **对话页两轮**：气泡自适应；纠正理解改轻量入口 + Dialog/Drawer（Web）与底部弹层（鸿蒙），精确偏移/contentHash/CAS/草稿/409 协议全部保留；引用资料收敛为「资料 N」入口 + 独立来源面板；委托轻卡片；「为什么这样建议」替代原始字段堆叠；输入框自适应高度 + 更多菜单；独立历史讨论页（鸿蒙）与抽屉（Web）。
- **焦点页**：问忆程胶囊悬浮入口（`FocusAgentLauncher` 重构，去「忆」方块）；「为什么提醒我」收进行内；统计压成「待办/提醒」chips；PAUSED/FAILED 技术细节收进详情；归档/刷新移顶部菜单；提醒时间人性化。
- **委托模块**：列表按状态分组去重复入口；新建表单四段式 + 完成要求折叠 + 提交前确认；详情四视图（概况/进展/方案/设置）；进展 JSON 适配层 `MissionProgressPresentation.ets`（原始 JSON 只进折叠技术诊断）；运行额度卡（复核与继续是两个操作）；方案对比点选卡（陈旧禁用采用）；回执改摘要 + 展开入口。
- **资料/行动页**：行动卡状态驱动主操作（TODO=开始、DOING=完成并回执、次操作轻量化）；资料/行动页右上角放大镜搜索（行动为本地标题+描述过滤，与状态筛选相与，深链不受影响）；「安排时间」迁入更多菜单；资料卡类型标签中性化（不再红）、CURRENT→「当前有效」；预期结果去灰框 2 行截断；演示口径文案澄清；全局记忆卡摘要 2 行等高（**该改动因上述阻塞点暂缓**）。

## 用户 WIP 修复记录（保留语义的最小修复）

- `ProjectHome.ets` `getRecentActivities()`：误挂 `@Builder` 导致编译失败 → 移除注解（数据函数）。
- `WidgetDataService.ets` `formatDeadlineState`：对象字面量类型违反 arkts 规则 → 抽出 `DeadlineState` 接口。

## 提交状态（未推送）

- `1319fc1` feat(ui): unify conversation, focus, mission and materials/action UX across web and harmony（对话/焦点/委托/资料行动多轮精修 + 测试 + E2E 适配 + 截图证据 + 本文档）。
- `bec5515` feat(harmony-ui): widget card dual-size persistence and overview restructure（并行会话的 Widget 双尺寸持久化、隐私脱敏、截止日语义、卡片跳转路由；ProjectHome 概览三层收敛；本会话修复其 `Index.ets` 尾部游离括号后一并提交）。

## Widget/概览（bec5515，另一会话完成，本会话收尾提交）

- `WidgetCard.ets` 2×2 / 2×4 独立布局分支；`WidgetDataService.ets` 按 formId 持久化尺寸、`safeSanitizeText` 脱敏、`formatDeadlineState` 截止日语义（无虚假倒计时）；`EntryFormAbility.ets` 按 `formDimension` 推送。
- `Index.ets` 桌面卡片仅带 projectId 时路由到 `pages/ProjectHome`（通知路由 WIP 一并入库）。
- `ReentryMapping.test.ets` Hypium 用例；`harmony:test` 90/90。

## 遗留与建议

- `Index.ets` 编译阻塞已解除，三次分步构建及最终 90/90 已通过；全局记忆默认/搜索展开/摘要高度截图待补。
- 原文档记录的 `documentReader.test.ts` 两项环境失败本次未复现，当前 8/8 通过；后续应记录实际解析器路径，不将历史环境失败当作当前基线。
- 评审环境（review 包连生产后端）下部分只读视图报 HTTP 404（如委托「运行与接续」、纠正面板），按约定本轮未处理。
- `Index.ets` 的通知路由改动（仅带 projectId 时打开 ProjectHome）已随 `bec5515` 入库；其记忆页 WIP 的中间状态备份在 `.zcode/Index.ets.user-wip-backup.ets`（含损坏尾部，仅作对照，勿直接覆盖）。
- 工作树中仍有意未提交：`AGENTS.md`、`harmonyos/build-profile.json5`（review flavor）与 `Constants.ets`（评审包地址）、`next-env.d.ts`、`tsconfig.json`、`docs/FINAL/AGENT_REVIEW/AGENT_EVOLUTION_ROADMAP.md`、`components/ProjectHealthCard.tsx`——属评审打包与另一条线内容，提交前需与所有者确认。
- 截图证据：`evidence/agent-conversation-ux/`（对话、焦点、委托四视图、资料/行动、任务全部轮次）。

## 专项完成：我的项目空间 UI/UX 精修（2026-11-01 下午）

- **卡片四层结构**：身份（类别+截止日）→ 一行简况 → 关键进展（参赛准备项仅竞赛场景 + 紧凑统计）→ 「下一步」行动区。`projectItem()` 全部区域独立绑定 onClick（见下方坑 1）。`readinessSummary` 只输出 `4/6 项已形成`（百分比从卡片主文案移除，进度条只代表清单比例）；`getProjectMetricSummary` 压缩为 `16 记忆　3 提醒　4 行动　6 草稿`（全角空格分隔、零值不展示）。
- **非竞赛场景**：不展示六项竞赛准备清单（避免误读为通用进度）；`nextAction` 的 gap 分支（detail 以「参赛准备度」开头）按 Web 同规则改写为「记录最新进展 → 资料页」。
- **下一步导航映射**（`openNextAction`）：`#action-board`→`tab=actions`；`#capture-box`/`?cardType=`→`tab=memory`；`/generate?type=`→`tab=artifacts`（ProjectHome 新增 `tab=artifacts` 深链）；`#interventions` 与未知锚点降级进概览。真机验证：查看清单弹层不再冒泡导航、下一步准确进概览、长按管理菜单正常。
- **排序与筛选**：筛选胶囊选中态去 2px 描边；新增「最近更新 / 需要关注」排序切换。`attentionScore` 含 `(100-readiness%)` 项对非竞赛项目是结构性 +100 偏置（六项竞赛清单对课程/科研永远 ~0%），故「需要关注」用本地可比评分（结构同服务端，准备项缺口只计入 COMPETITION，`projectAttentionScore`）。
- **项目管理入口**：ProjectHome 设置弹层「基本信息」尾部新增「项目归档」行（长按不再是唯一入口）；删除仍在列表长按（二次确认）。
- **Web 同步**：`ProjectCard.tsx` 准备项改 `4/6 项已形成` 主 + % 辅；tsc 通过。

## 专项完成：个人设置与功能指南重构（2026-11-01 傍晚）

- **设置首页信息架构**：账号卡（头像+名称+会话状态，点进账号详情）+ 四组核心入口：AI 与服务（模型与连接 / 设备与小艺）、提醒与偏好（提醒策略合并 4 项旧入口）、数据与安全（数据同步与连接 / 证据与记忆原则）、帮助与关于（使用指南 / 关于忆程）。原 16 行逐项分类：可编辑保留/合并、固定规则移入「证据与记忆原则」二级页、小艺两条「暂未接入」合并、AppInfoCard 大卡与版本行移入「关于忆程」。`AppInfoCard` builder 已删除。
- **提醒策略作用域核查结论**：服务端 `InterventionPolicy.scope = USER:${userId}`（`interventionPolicyScopeForUser`），预算账本 `USER:x:GLOBAL`——**策略是账号级共享**；API 路径中的 projectId 仅用于 `authorizeProjectAccess` 与项目级降频偏好，不影响策略本体。鸿蒙 `SettingsSheet` 用 `policyAnchorProjectId()`（主列表优先、归档项目兜底）消除对 `projects[0]` 的隐式依赖；UI 文案统一为「按账号生效，全部项目共享」。未改任何服务端协议。
- **ReminderSettingsView 重构**：每日上限改 0–50 步进器；免打扰时段改系统 TimePickerDialog（跨午夜由服务端支持，UI 说明）；时区只读展示；读取失败/保存成功/保存失败三类反馈区分颜色；无可访问项目时显示诚实的定位限制说明，不展示表单。真机验证：读取、选择时间、保存（「已保存到服务端，对你的全部项目生效」）全链路通过。
- **二级页**：账号（会话状态+服务端地址+退出登录，保留原确认对话框）、设备与小艺（「尚未接入」+ 无模拟授权入口）、数据同步与连接（项目数据/模型引擎/设备通知三段，明确 dataSyncState 只反映项目数据读取）、证据与记忆原则（五条固定机制说明）、关于忆程（版本/平台/产品说明）。`ProjectHome` 设置弹层策略文案同步为账号级。
- **FeatureGuide → 使用指南**：品牌简介（让项目进展有迹可循）+ 一行核心流程（记录→理解→确认→行动→回执，无横向滚动）+ 四组任务式功能卡（记录与整理/理解变化/推进项目/整理成果，图标+标题+一行说明+可展开详情）+「忆程如何处理你的信息」五条 +「功能支持情况」（已可用/需要配置/暂不支持/演示数据，逐条对照代码核对：桌面卡片=真实数据、行动依赖三态=已实现、小艺语音=未接入）+「前往功能」跳转（AppStorage `pm.pendingMainTab` → `Index.onPageShow` 消费切 tab；委托/问忆程需项目上下文，仅引导先打开项目）。
- **Web**：`GlobalSettings` 核查为运行模式弹窗，可执行性说明与安全规则语义已准确，未改。

### 本轮关键技术坑（复用价值高）

1. **ArkUI onClick 会向父级冒泡**：`HitTestMode.Block` 不能阻断（真机验证），`ClickEvent.stopPropagation` 在本 SDK stub 不存在（编译报 property not exist）。可靠方案是**结构上避免嵌套 onClick**——项目卡片整卡不绑 onClick，身份区/准备项/统计/下一步各自独立绑定。
2. **@Builder 参数传函数（`() => void` 回调）在真机上点击不生效**：设置页 `SettingsNavRow` 曾用函数参数分发，真机点击无响应；改为传 `targetMode` 字符串在 builder 内部分发后正常。
3. **bindSheet FIT_CONTENT 内 Scroll 的 `constraintSize({ maxHeight: '72%' })` 会导致内容高度塌陷为 0**：表现为遮罩出现但弹层空白（提醒策略「打不开」的根因）。去掉百分比 maxHeight 后正常。
4. **`width('100%') + margin({ left: N })` 会向右溢出 N**：使用指南展开详情曾溢出卡片右缘；去掉 `width('100%')` 用 margin 自适应。
5. 复验管道退出码：`npm run harmony:build | tail` 会吞掉 hvigor 失败（exit 0 假阳性），必须以日志中 `BUILD SUCCESSFUL` 为准。

### 验证记录

- `harmony:build` 成功（最终 sha256 `79bc18ec…`，versionCode 临时 +1 至 1000001 便于确认安装生效——提交前可按需还原）。
- `harmony:test` 90/90；`tsc --noEmit` 通过。
- 模拟器截图证据：`evidence/settings-ux-20261101/`（00-22：焦点页、项目卡四层、准备项弹层、长按菜单、下一步导航、设置首页×2、提醒策略（读取/时间选择器/保存反馈）、账号、设备、数据、原则、关于、使用指南展开）。
- 模拟器运行环境：生产演示后端（contest-demo 账号），非本地 4400；`harmony:backend` 当时已启动但未被 App 使用。

### 未完成与遗留

- 「需要关注」排序的展示顺序为本地可比评分，与服务端 `attentionScore` 的差异已在代码注释说明；未做跨场景排序效果的独立量化验证。
- 小艺真实接入后需按权限范围补「设备与小艺」页的授权状态与操作。
- 归档项目再次进入 ProjectHome 时设置弹层的归档按钮仍可点（服务端幂等，无副作用），未加已归档态展示。
- InfoSheetHeader 的 ✕ 关闭按钮字形在部分 sheet 中渲染异常（显示为 ›），点击仍可关闭；后续可换成统一图标组件。
- 全部改动**未提交**（用户要求改完暂不提交）；工作树另有评审 flavor 等他人未提交内容，勿混入。
