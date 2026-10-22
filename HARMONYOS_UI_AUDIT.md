# ProjectMemo HarmonyOS UI 审查（2026-10-22）

## 当前状态（2026-10-22，B1–B4 续做）

当前实施和验证以 `HARMONYOS_UI_CHANGELOG.md` 的“B1–B4 续做记录”及 `evidence/pre-r4/20261022-harmony-b2-b4/ACCEPTANCE.md` 为准。下方早期截图、60 项测试、unsigned HAP 和签名阻塞均为历史记录。

这次重点修复：附件成功上传后没有原件入口、列表错误伪装成空列表、PDFKit 缺失导致原件页空白、成果操作在放大字体下越界，以及概览重复展示准备项/主事项/委托/提醒。概览默认只保留三段内容，更多数据从展开区查看。

正常包已构建并覆盖安装；本轮测试库回归 6/6、鸿蒙测试 70/70。图片预览和 PDF 保存有隔离模拟器证据。正式包、尺寸测试副本、隔离附件样例及真实后端数据截图分别标识；不将其合并为真机或平台验收。

## 范围与证据

本轮是 R4 前的鸿蒙界面专项。审查了 `docs/FINAL/ui/HARMONYOS/currentui/` 中 18 张用户提供的现状截图、ArkTS 页面与组件、对应模型及服务端路由；HTML 参考的 17 个视图仅用于信息层级和视觉方向，示例数据不进入产品。环境中的浏览器禁止打开本地 `file:` 页面，因此未完成 HTML 的逐页点击；对照依据是参考源码、预览图和现状截图。仓库根目录没有提示词所列的 `ROADMAP.md`、`SPEC.md`、`STRATEGY.md`；R4 边界取自 `docs/FINAL/R4_FINAL_ROADMAP.md` 和 `R4_FINAL_ARCHITECTURE.md`，本轮没有执行 R4 新业务或迁移。

下文 `151136` 等编号对应 `currentui/Screenshot_2026-10-22T151136.png`；这些是用户提供的修改前画面，截图来自实机还是模拟器未经独立核实。

用户随后补充了 6 张正在运行的模拟器画面，存于 `evidence/pre-r4/20261022-harmony-ui/user-*.png`；同目录 `emulator-project-actions.jpeg` 为本轮通过 `hdc snapshot_display` 获取的项目行动页。补充画面与最终构建包未建立安装哈希对应关系，因此只证明当时运行版本的可见状态。

| 运行画面 | 可核对结果 |
|---|---|
| `user-focus.png`、`user-focus-lower.png` | 首屏有单一主事项、原因和主行动；次要行动、提醒与资料仍可向下查看 |
| `user-mission-detail.png` | 暂停原因、错误代码、继续入口和原目标展开已可见；标题下方留白偏大 |
| `user-project-missions.png` | 当时安装包仍展示两条重复暂停委托；本轮源码折叠尚未完成设备复查 |
| `user-global-memory.png` | 采集来源声明可见，但时态标签用词不准；本轮源码已修正 |
| `user-reminder-evidence.png` | 判断日期与事实日期分开显示；英文规则码暴露，本轮源码已修正 |
| `emulator-project-actions.jpeg` | “填写完成回执”占整行，次操作另行，按钮没有截断 |

现有基础并非空白：`DesignTokens.ets` 已有语义颜色、字级、间距、圆角；`PMAppBar`、`AsyncStateView`、`MetricBadge`、`EvidenceSpineView` 等已在使用。保留这些封装，修正各页面的具体呈现与状态语义。

## 17 个视图映射

| HTML 视图 | 真实入口 | 真实数据与状态 | 本轮处理或保留的边界 |
|---|---|---|---|
| focus | `Index` → `GlobalFocusPanel` | `/api/workspace/focus`；委托、行动、提醒、资料分组 | 一项主判断先呈现；同类暂停/失败折叠，原委托可展开 |
| projects | `Index.ProjectsTab` | `/api/projects` 的 `dashboard.readiness.items`、截止日 | 准备项进度保留明确名称；逾期只影响截止提示，不把进度条染成风险 |
| memory | `Index.GlobalMemoryTab` | 跨项目卡片与各项目时态投影 | 显示采集来源声明；状态说明可展开；项目链接定位到对应卡片 |
| actions | `Index.TasksTab` | 全局提醒/行动聚合；确认路由 | 保留提醒与行动分区及服务端确认流程；详见行动页 |
| settings | `Index.SettingsTab` | `/api/settings` 与会话、设备能力 | 保留分组和只读状态；账号名缺失时不伪称演示账号 |
| overview | `ProjectHome.CockpitView` | 项目状态、差异、准备项、提醒、行动 | 焦点委托不重复展示长目标；状态与下一步仍由真实投影给出 |
| delegate | `ProjectHome.MissionView`、`MissionPanel` | `/api/missions/summary` | 同类异常折叠并可展开原委托；摘要限行；快速问答入口统一品牌样式 |
| chat | `ProjectHome.CopilotView` | `/api/projects/[id]/agent/chat` | 缺失依据与补资料路径可见，引用来源不按标题猜类别；重复回答需后续真实模型评测 |
| materials | `ProjectHome.MemoryView` | 卡片、采集、时态关系 | `CURRENT` 显示为“当前时态”，当前卡也展示 `displayReason`；原始采集仍可展开 |
| projectActions | `ProjectHome.ActionView` | `/api/projects/[id]/actions` | 完成回执入口独占一行，日历/启动为次操作；回写标记受 `DONE`、非模拟、`resultCardId` 约束 |
| outcomes | `ProjectHome.ArtifactView` | `/api/projects/[id]/artifacts` | 已生成内容标记“成果草稿 · 待人工复核”；不声称已交付 |
| reminder | `InterventionDetail`、`EvidenceSpineView` | `/api/projects/[id]/interventions` 的 `evidence.facts/cardIds/evaluatedAt` | 判断时间与事实日期分开；来源无法逐事实绑定时显示待核对；保留建议及用户确认 |
| changes | `ProjectHome.RecentChangesView`、`ProjectChangeBrief`、`MemoryTimeline` | 状态差异、关系提案、版本确认 | 保留候选变化与确认；归并主卡缺失不再默认 `CURRENT` |
| actionDetail | `ActionBoard`、完成回执弹层 | 行动 PATCH 与提醒处置回执 | 主操作完整显示；完成提示须由返回的 `DONE` 和 `resultCardId` 支撑 |
| mandateDetail | `MissionDetail` | `/api/missions/[id]` 与事件流 | 失败原因/错误类别/恢复路径前置，原目标及执行日志按需展开 |
| memoryDetail | `ProjectHome.MemoryView` 的展开卡、`MemoryTimeline` | Capture 原文、来源声明、时态投影 | 来源声明与事实支持分开；未知不转成否定或当前有效 |
| outcomeDetail | `ProjectHome.ArtifactReaderContent`、成果审计 | Artifact 内容与 audit/recheck | 草稿标签常驻；审计和导出入口在窄屏分行；无交付状态字段不展示“已交付” |

## 问题分级与处理

| 优先级 | 可复现证据 | 处理 |
|---|---|---|
| P0 | `151136` 中项目记忆标“当前有效”，`151053` 中跨项目记忆却标“尚无佐证来源”；`MetricBadge.TemporalBadge` 把 `CURRENT` 显示为有效 | 改为“当前时态”，改用证据色；当前卡照样展示服务端理由。两个投影若仍不一致，不能由 UI 猜测哪一方正确 |
| P0 | 补充截图 `user-global-memory.png` 中采集来源已显示，时态标签仍说“尚无佐证来源”；`NO_SUPPORTING_EVIDENCE` 在服务端实际指缺少时态关系证据 | 跨项目标签改为“时态依据不足”，`ACTIVE_SUPPORT` 改为“当前时态有依据”；采集来源单列为未经核实的声明 |
| P0 | `EvidenceSpineView` 把评估时间补成事实时间，并按关键词猜测“实验记录/截止日期”等来源；`151114` 同时有历史日期与当前提醒 | 缺失的事实时间与逐事实来源明确写“未注明/待核对”，评估时间单列。来源实体绑定需后端补结构化字段 |
| P0 | `MemoryTimeline.consolidationMasterState` 缺主卡时默认为 `CURRENT`，归并理由的兜底句默认可归并 | 缺失归 `UNKNOWN`；只有全部为 `CURRENT` 才展示可继续核对的提示 |
| P0 | `ActionBoard`/项目行动仅凭 `resultCard` 对象显示已回流；提交后固定成功 Toast | UI 同时核对 `DONE`、非模拟、有效 `resultCardId`，否则提示关联待核对。服务端原子写入仍是最终约束 |
| P1 | `151011`、`151126` 两条同类暂停委托及长目标占满首屏 | 全局焦点单独提出主事项，同类异常折叠；项目委托摘要限行；详情保留目标与事件 |
| P1 | 补充截图 `user-project-missions.png` 仍显示两条重复暂停委托，说明当时安装包早于本轮摘要折叠代码 | 源码中按同项目、状态与错误摘要折叠；原记录从“查看全部委托”进入；最终包尚未在模拟器复查 |
| P1 | `151147` 行动卡“完成并写…”被三列操作挤断 | 项目行动和行动详情改为完整宽度的“填写完成回执”，次操作另行 |
| P1 | `151131` 长期委托详情先展示整段目标，系统默认亮蓝按钮明显突兀 | 失败说明前置，目标折叠；设置和日志入口统一品牌次操作 |
| P1 | 补充截图 `user-mission-detail.png`、`user-project-missions.png` 中，标题和正文之间有较大的空白 | 滚动内容明确从顶部排列；最终包尚未在该模拟器复查布局 |
| P1 | 成果页 `ArtifactItem` 只有内容与时间，没有审核/交付字段 | 页面如实标草稿/待人工复核，避免保存等于交付的暗示 |
| P2 | `151049` 项目逾期时准备项百分比也变红 | 准备项保持品牌色，截止日继续独立标风险 |
| P2 | 设置缺失账号名显示“复赛演示账号” | 显示“账号名称未读取” |
| P2 | 补充截图 `user-reminder-evidence.png` 的提醒原因直接显示 `no_project_activity_for_72_hours`，且“为什么是现在”可能误读为当前重新判断 | 已按服务端规则语义翻译已知规则，并将区块改名“提醒触发原因”；判断生成日期与事实日期分别显示 |
| P3 | HTML 的所有装饰、动画、页面切换与微交互 | 未逐项复制；现有原生安全区、系统控件和暗色语义资源保留 |

## 口径与验收界限

- 准备项百分比仅是服务端 `readiness.items` 的阶段覆盖，不是项目总体完成率；行动创建、排程、完成和写回执是不同事件。
- `CURRENT` 是时态，`UNKNOWN` 是未定，来源声明与事实支持是两层状态。相对时间须结合原采集日，不按今天解释。
- `AgentEvidence` 只有 `facts: string[]` 与独立的 `cardIds: string[]`，没有逐事实来源指针；前端无法安全建立一对一的“时间—来源—事实”深链。
- `ArtifactItem` 没有可供列表直接展示的人工审核或交付字段，因此界面一律按草稿处理；审计结果须进入现有审计流程核对。
- 本轮没有改变 API、数据库或 Web 契约。测试和 HAP 构建不代表真机交互、不同屏宽/字体缩放、后端在线、真实模型或平台提交验收。
- 模拟器目标曾连接为 `127.0.0.1:5555`。一次中间构建包替换安装返回 `install sign info inconsistent`，旧应用数据未清除；最终构建后目标已断开，未完成再次安装。因此本轮新增截图不能作为最终包的设备验收。已目视核对当时运行版本的焦点、项目、记忆、行动、委托与提醒页面。
