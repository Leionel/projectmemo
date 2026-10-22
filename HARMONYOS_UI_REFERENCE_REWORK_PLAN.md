# HarmonyOS UI：按 HTML 参考重新改造的执行计划

日期：2026-10-22。状态：B1 已获用户画面认可；B2/B3 已实施，并按反馈再次精简概览；B4 的本地测试、构建和模拟器证据见当前验收记录。

## 1. 基线与这次要纠正的问题

唯一视觉基准是 `docs/FINAL/ui/HARMONYOS/projectmemo_harmonyos_ui_reference.html`，并参考同目录 `projectmemo_reference_preview.png`、`projectmemo_mobile_preview.png`。HTML SHA-256：`2008723a00abb318799d1fddde5101aea69c58497adc253d436dc6a680bd3dc8`。

上一轮主要改善了状态语义、按钮主次和重复记录，原页面结构保留过多，不能算已经落实参考稿的视觉改造。现有 P0 语义修复继续保留。

| 已确认差距 | 真实代码 / 画面 | 本次处理 |
|---|---|---|
| 品牌顶栏占位、字级、对齐不同 | `Index.build()` 仍是左图标、居中品牌、右图标；用户截图中的品牌很突出 | 改为左侧 30vp 品牌标记、左对齐标题与副标题、右侧上下文操作 |
| 大量药丸按钮 | 原生 `Button` 大多没有显式指定普通按钮类型；用户截图仍显示大胶囊 | 使用 `ButtonType.Normal`，业务按钮圆角统一 11vp；筛选 chip 单独处理 |
| 首屏仍被系统错误占据 | `GlobalFocusPanel.primaryEntry()` 优先取 waiting 第一条，当前数据为暂停委托 | 优先需要用户补资料/审阅的委托，再呈现真实提醒、行动；同类执行错误降为紧凑摘要行 |
| 详情与委托页大块空白 | `user-project-missions.png`、`user-mission-detail.png` | 核对 Scroll 内容对齐和容器高度；明确顶对齐，以新版截图确认原因和修复结果 |
| 多个区域仍是纵向长卡和按钮堆叠 | `GlobalFocusPanel.Group`、`MissionPanel`、项目资料和成果区域 | 列表用图标、标题、两行摘要、状态和箭头；入口点击整行，重要操作才使用主按钮 |
| 页面缺少参考稿的标题、摘要和节奏 | 全局记忆先显示筛选与大提示，委托页只有委托列表和问答按钮 | 增加紧凑页面标题、说明、搜索、分组标题；长解释按需展开 |

参考稿中的数字、项目阶段、失败次数和审核状态均为演示数据。布局可以复现，业务内容必须来自当前接口。

## 2. 视觉与组件基线

这些数值是本项目参考稿的风格约定。

| 项目 | 目标 |
|---|---|
| 色彩 | 背景 `#F7F5EF`，卡片白色，主色 `#176B60`，柔青绿 `#E7F0EB`，正文 `#213732`；风险/待核对继续使用独立语义色 |
| 形状 | 主卡片 18vp、内嵌块 12vp、按钮 11vp、标签 8vp；删除项目卡左侧粗风险装饰条 |
| 字级 | 页面标题 22–24fp，主判断 20–21fp，模块标题 16–17fp，正文 14–15fp，辅助 12–13fp，导航 11–12fp；最终以默认及放大字体截图确定 |
| 间距 | 页面左右 16–17vp，卡片内 14–16vp，卡间 10–12vp，模块间 20–24vp |
| 顶栏 / 底栏 | 顶栏内容区约 58vp；底栏图标 20vp、选中图标有柔青绿底；安全区继续由平台处理 |
| 操作 | 主按钮整行 44–48vp；列表入口为整行点击；短视觉标签通过外层容器保留至少 44vp 点击区域 |

复用 `DesignTokens`、`PMAppBar`、`MetricBadge`、`AsyncStateView`、`PMIcons`。补充缺少的 `PMButton`、页面标题、分组标题、摘要指标和列表行封装；先检查已有组件，避免建立同义组件。系统输入、选择、授权和日期控件沿用原生交互。

原生按钮的 `.type(ButtonType.Normal)` 已在本地 API 24 SDK 声明中查到；Scroll 的对齐修复需编译并在运行版确认。不会用批量缩小字体来代替布局调整。

## 3. 17 个视图的实际改造

| HTML 视图 | ArkUI 落点 | 必须发生的可见变化 |
|---|---|---|
| focus | `GlobalFocusPanel` | 日期与标题、单一判断主卡、两列真实行动/提醒摘要、紧凑关注列表；刷新和归档控制下移 |
| projects | `Index.ProjectsTab/projectItem` | 页面标题及筛选、统一白色卡、准备项细进度、摘要分隔、下一步行；移除粗色边 |
| memory | `Index.GlobalMemoryTab` | 标题与说明、可见搜索、chip 筛选、紧凑白色列表、来源/日期辅助行；缩小常驻提示 |
| actions | `Index.TasksTab` | 标题、行动与提醒分区、统一状态筛选、紧凑卡片；当前状态只突出相关操作 |
| settings | `Index.SettingsTab` | 标题、账号卡、分组设置行、说明置于标签下；原生开关保持正确禁用和权限状态 |
| overview | `ProjectHome.CockpitView` | 项目简介、阶段/准备项主卡、证据变化、下一步、两列项目档案；异常委托下移 |
| delegate | `ProjectHome.MissionView/MissionPanel` | 顶部“委托与对话”、问忆程入口主卡、长期委托分组、同类失败摘要、最近进展内嵌块 |
| chat | `ProjectHome.CopilotView` | 紧凑上下文、用户/助手消息层次、事实/未知/补证据/来源入口、统一底部输入区 |
| materials | `ProjectHome.MemoryView` | 标题、搜索、筛选、概要列表；原始记录、时态与来源只在展开后详细展示 |
| projectActions | `ProjectHome.ActionView` | 两列真实状态摘要、筛选、标题清楚的行动卡；完成入口整行、其他操作降级 |
| outcomes | `ProjectHome.ArtifactView` | 草稿数量和可用状态摘要、紧凑成果列表及待复核标签；不虚构已验证交付数量 |
| reminder | `InterventionDetail/EvidenceSpineView` | 顶部状态和短判断、独立证据链卡、触发原因、建议行动、固定底部操作；减少编号视觉权重 |
| changes | `RecentChangesView/ProjectChangeBrief/MemoryTimeline` | 候选判断、原结论和证据差异同屏分组，确认动作明确；不折叠掉必需的确认信息 |
| actionDetail | `ActionBoard` | 状态与行动标题、预期结果、推进记录、结果输入和回执操作分区；使用实际回执链 |
| mandateDetail | `MissionDetail` | 状态 chip、短目标、失败原因卡、恢复建议、执行时间线；技术日志独立折叠 |
| memoryDetail | 展开资料卡、`MemoryTimeline` | 摘要、时态/证据状态、原始采集引用块分层；来源声明和事实支持分别呈现 |
| outcomeDetail | `ArtifactReaderContent` | 草稿/待复核标签、标题、摘要/正文、证据与审核、导出操作；正文阅读宽度和操作区统一 |

## 4. 实施批次与停止条件

### B1：基础层 + 一张能对照的焦点页

1. 更新颜色、圆角及明确的字号层级；改 `PMAppBar`、`Index` 顶栏和两套底栏。
2. 建立普通矩形圆角按钮及列表行，先用于焦点和委托；其他按钮逐文件适配，保留已有回调、禁用和确认逻辑。
3. 重排焦点首屏，使用真实提醒/行动；系统故障成为次要聚合行。
4. 构建，在同一屏宽/字体下采集焦点、项目列表、项目委托、委托详情四张图，与参考逐项比对。

通过条件：顶栏、卡片、按钮形状、首屏密度和信息顺序能对应参考稿；短内容从顶部排列；普通业务按钮不再是大胶囊。四张截图不通过时先修 B1，不继续铺开其他页。

### B2：项目工作台与两套列表

完成 overview、delegate、projects、actions/projectActions、memory/materials。共用布局稳定后再覆盖数据多、数据少、加载、失败和权限状态。完成一批即构建并保存相同参数的截图。

### B3：证据、阅读与设置

完成 reminder、changes、chat、memoryDetail、outcomes/outcomeDetail、actionDetail、settings。保留服务端确认、来源版本、原始采集和真实回执。缺少逐事实来源指针和审核/交付字段的地方只展示可支持的状态。

### B4：完整验收与记录

- 360/390/430vp，默认和至少一种放大字体；页面回退、筛选、搜索、键盘顶起、滚动、弹层和禁用状态。
- 每个实际入口有截图或明确未验证记录；截图注明设备、vp、字号、主题和所装 HAP 哈希。
- 各实现批次运行 `npm.cmd run harmony:build`；共用控件完成后运行 `npm.cmd run harmony:test`。最后核对差异并更新 `HARMONYOS_UI_AUDIT.md`、`HARMONYOS_UI_CHANGELOG.md`。
- 代码构建通过与参考视觉通过分别记录。网页参考在当前浏览器中打开本地文件曾被安全策略阻止，不绕过策略；目前依据 HTML 源码和自带预览图对照。

## 5. 当前执行记录

- B1 顶栏、卡片、焦点和委托画面已得到用户“我觉得挺好”的反馈，作为后续风格基线。
- B2/B3 已实现列表、资料、行动、成果、阅读、证据及设置调整；后续反馈要求撤回大标题、收紧层级，概览再次去重并将详细状态集中到展开区。
- 附件增量任务已纳入：资料页常驻原件库，原件查看、图片预览、系统打开/保存和提取文本入口。失败、鉴权与缺失文件状态可分辨。
- 70 项鸿蒙测试、6 项独立库 Web 回归和 HAP 构建通过。正常签名包与临时尺寸测试包分别留存，详见 `HARMONYOS_UI_CHANGELOG.md`。
- B4 每项实际覆盖、截图与剩余设备边界见 `evidence/pre-r4/20261022-harmony-b2-b4/ACCEPTANCE.md`。PDF 实际阅读器、物理真机与平台验收单独记录。
- 原工作区修改、签名配置和历史证据继续保留；本轮没有提交、推送或部署。
