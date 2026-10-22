# Web 工作台精细化改造与卡片核查

2026-10-22。原目录 `D:/Projects/hongmen` 已合并 Pre-R4 UX，合并点 `15eb02f`，登录状态修正 `5f98a2e`。本轮继续在原目录实施，不推送、不部署。

## 设计决定

保留暖纸白/森林绿，改为紧凑工具栏、工单和分区面板。用户要先判断当前事项，再打开具体对象；主操作只负责进入原流程，业务写入仍由原审批/服务处理。规则：`rule/name-object-scope-consequence`、`rule/one-primary-action`、`rule/structure-before-containers`、`rule/navigation-vs-action`、`rule/preserve-mental-model`。

按 apple-design 的即时反馈、排版和克制原则，以及 ui-animation 的高频操作无过场原则实施。反馈仅采用短颜色变化/箭头位移；等待输入不用持续呼吸灯。桌面按钮视觉32px，触摸环境扩展至44–48px；头像/状态圆点保留圆形，按钮/标签4–6px、面板8px。保留深色、窄屏、大字体和Reduced Motion。

## 阶段

- V1：概览布局、具体CTA、紧凑导航/属性栏/工具栏、真实快捷键、原文数值的排版。完成后commit。
- V2：各路由与卡片逐项核查；修复重复容器、同权重、空态、错误/权限、模糊按钮；保留需独立审阅的边界。完成后commit。
- V3：隔离浏览器截图与交互、回归、实际预览、更新开放Gate。完成后commit。

## 路由与卡片清单

| 路由/宿主 | 卡片/容器 | 核查重点 | 当前状态 |
| --- | --- | --- | --- |
| 首页、登录、新建项目 | 营销段落、LoginForm、NewProjectForm | 不把营销卡片样式带入工作区；输入/错误/确认语义 | 待核查 |
| 项目列表 | ProjectList/ProjectCard | 多层边框、圆角、全卡可点误导；科研项目参赛文案 | 待核查 |
| 概览 | focus/summary/ProjectStartGuide/ProjectEvolutionSummary/ProjectPulse | 松散、全宽绿块、弱CTA、日期/数值、无基线不冒充变化 | 改造中 |
| 委托 | MissionPanel/Continuation/Approval/Output/Adoption | 工单/轨迹/设置不同层级；批准与完成区分 | 待核查 |
| 资料 | CaptureBox/AttachmentInbox | 捕获表单不是报告卡片；原文/处理进度分离 | 待核查 |
| 会议 | MeetingImportCard | 预览、勾选确认与已应用结果分离，不能把空预览当成功 | 待核查 |
| 行动 | ActionBoard/InterventionPanel/SchedulePlanner | 提醒≠行动；当前/历史/演示；完成写结果回执 | 待核查 |
| 记忆与问答 | KnowledgeFeed/CardView/ArchivedMemory/Consolidation/MemoryCopilot | 记忆、来源、建议不同角色；弱空卡片和重复说明 | 待核查 |
| 体检与演进 | State/DecisionTimeline/Episode/Health/Readiness | 来源/关系/基线、已发布修订、指标与状态真实性 | 待核查 |
| 成果 | ArtifactGenerator/AuditPanel | 固定版本、编辑、来源审计、未验证Claim，不做第二文档系统 | 待核查 |
| 全局设置/项目设置 | GlobalSettings/ProjectSettings | 模态边界、焦点、错误和破坏性操作 | 待核查 |

本表以当前源码和浏览器为证据，不把mock数据解释为真实科研结论。不引入R4服务、隐藏思考或虚构进度。实际改动与验收随阶段更新。


## V1 实际改动

概览改为白底工单、琥珀等待标签、右侧明确操作；最近资料和状态观察有独立细边面板。导航分割线、当前项标记、32px桌面工具栏、真实Ctrl/⌘J已接入。原文指标只做等宽排版，不改字句。复用鸿蒙品牌衬线子集及OFL许可，仅用于品牌；正文采用系统无衬线回退，不依赖外部字体请求。

全站已有业务卡片圆角和按钮外观收紧。项目列表筛选不再套卡、行动新增表单移除重复外框；科研等非竞赛项目不再显示参赛准备度；记忆默认精简并保留完整模式，空态直接链接资料页；成果空态减少无用高度；生成、发送问题、新增行动和取消行动明确对象。模态、审批、来源、错误与成果版本仍保留独立边界。

定向20项通过，TypeScript和lint通过。首轮全量测试635项通过、4项失败：2项来自已修正的ProjectList引号编辑错误，2项在并行生产构建时超过既有5秒门限；需串行重跑。首次E2E构建失败保留日志；修正后生产构建通过，13/14场景通过，演示提醒写请求500仍待重跑定位。未据此标记最终放行。

## 新增导航工作包 N1–N3

用户确认的全局目的地：焦点 / 项目 / 记忆 / 行动；设置位于右上角。项目内导航保持概览 / 委托 / 资料 / 行动 / 成果。

- N1：现有数据的跨项目只读投影与Web入口；先过滤项目成员关系，Mission同时要求当前用户所有权和OWNER角色。归档默认排除；等待补充/审批/暂停/失败分别展示；运行活动来自现有Step/Output。
- N2：鸿蒙四目的地、设置工具入口、同契约焦点与原对象定位。保留旧项目、通知、委托及审批流程；加载/失败/401清空聚合视图，防止残留私有内容。
- N3：权限/状态/分页/深链接/空态验证，实际浏览器走查与截图、HAP和设备Gate。人工预览使用隔离库副本，避免与测试重建同一库。

README独立改为产品介绍，开发信息迁至DEVELOPMENT.md，旧原文留档；不把R4规划写成上线能力。
