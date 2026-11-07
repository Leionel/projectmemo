# 忆程 ProjectMemo｜Web + HarmonyOS 视觉材质与交互动效审查

审查日期：2026-11-07　基线：`e0fa08b`（`master`）　范围：只审查，未修改业务代码、样式、组件或依赖。

## 0. 证据口径

每条重要判断带一个标记：

| 标记 | 含义 |
|---|---|
| **[代码]** | 直接读源码或本机 SDK 声明文件得到 |
| **[测得]** | 在隔离环境实际渲染或量测得到，原始数据见 `evidence/material-motion-audit-20261107/` |
| **[截图]** | 来自既有真机/模拟器截图（`docs/FINAL/NewHMUI/`，2026-11-04，生产演示账号）。此后鸿蒙又有启动页和附件提交，这批截图不代表最新构建 |
| **[判断]** | 审美或产品判断，可以不同意 |
| **[待验证]** | 需要真机或用户验证，本轮没有证据 |

Web 运行环境：`.next-e2e` 生产构建 + 隔离的 E2E 库副本 + mock 模型，未碰开发库和生产环境。Agent 富块（目标差距、批准、回执等）E2E 库中没有数据，由 Playwright 拦截接口注入假数据后渲染真实组件，所以样式是真的、内容是假的。鸿蒙本轮没有运行新构建。

---

## 1. 执行摘要

**不值得全局引入毛玻璃，也不值得在 Web 上做液态玻璃。** 最推荐的方向是“实体纸面 + 语义动效”：内容和阅读面保持实体，材质只留给极少数真正浮在变化内容之上的控件，把动效预算投到 Agent 状态和证据链上。

理由有三个，其中前两个是这次实测得出的：

1. **玻璃在这套配色里几乎看不出来。** 暖白底 + 白卡片本身缺少可透出的色彩。为保证 `--ink-soft` 滚过深色内容时仍达 AA（4.5:1），透明条的不透明度必须 ≥88% **[测得]**。而 92% + 10px 模糊注入工作台顶栏后，和实体版几乎没有差别（[前](../../evidence/material-motion-audit-20261107/before-after/E1-header-desktop-before.jpg) / [后](../../evidence/material-motion-audit-20261107/before-after/E1-header-desktop-after.jpg)）。安全的玻璃看不出，看得出的玻璃不安全。
2. **现有的鸿蒙模糊已经在白白耗费渲染。** 11 处弹层遮罩使用 `COMPONENT_ULTRA_THICK` 实时模糊 **[代码]**，真机截图上背后内容完全不可辨，只是一片灰 **[截图]**。华为文档明确写实时模糊每帧渲染、负载较大。
3. **Agent 的状态数据已经齐了，只是没有被呈现。** 服务端已返回 8 种阶段和逐步状态，界面却只显示一行字加 `✓` / `·` **[代码][测得]**。不改后端就能做出差异化，这才是“高端 Agent 产品”的来源。

**审查中还发现一批比材质更影响观感的问题，修复成本都很低：**

| 问题 | 证据 |
|---|---|
| 官网主标语“项目别**掉**线”的“掉”字不在品牌字体子集内，落到系统字体 | [代码][测得] |
| 工作台所有宋体标题依赖用户电脑上碰巧装了 Noto Serif SC，没装时掉到 SimSun | [测得] |
| Windows 上 500 与 400 字重完全相同，550–800 全部相同，代码里的 10 档字重实际只剩 2 档 | [测得] |
| 官网产品截图还是 10 月的旧界面，并且露出 `experiment_log、code_issue` 内部枚举 | [测得] |
| 手机端对话的消息区只占屏幕 41%，隐藏一块常驻内容后升到 61% | [测得] |
| 项目卡进度条的轨道是白色压白色，4/6 看不出比例 | [代码][测得] |
| 28px 品牌图标加载 810.7 KB 的 PNG，是官网最大的单个资源 | [测得] |

完整结论见[第 11 节](#11-最终判断)。

---

## 2. 现状审查

### 2.1 现有审查报告的覆盖情况

已读 `HARMONY_UI_UX_INDEPENDENT_AUDIT.md`、`HARMONY_UI_UX_IMPLEMENTATION_PLAN.md`、`docs/UI_UX_HANDOVER_2026-11-01.md`、`docs/UX_QUICK_WINS_SURVEY_2026-11-03.md`、`docs/design/UI_REFERENCE_REVIEW_AND_PROMPT_2026-09-15.md`。它们聚焦信息真实性和流程，几乎不涉及材质与动效。本报告不重复以下内容，只在有新证据时引用：

- 鸿蒙字号 token 化、按钮三层级、Unicode 图标、ISO 时间（WP-C5 / X4–X6、X9）。
- `router` 改 `Navigation` 的结构议题（X8）。本报告认为不应该为动效发起这次迁移，见 [6.2](#62-harmonyos)。
- 悬浮“问忆程”遮挡（X1）：**仍然存在**，见 H2。

一项既有结论已过期：`UX_QUICK_WINS_SURVEY` 第三档写“Web 准备项不区分场景”，当前 `components/ProjectCard.tsx:33` 已限定 `COMPETITION`，不用再处理。

### 2.2 组件实现状态

| 状态 | 组件 |
|---|---|
| 已实现 | 官网全部区块、工作台四个全局页、项目详情子页、对话面板、Agent 十种语义块（`components/AgentMessageBlocks.tsx`）、通用弹层 `OverlayPanel`、错误浮窗 `ErrorPopupHost`、鸿蒙主 Tab / 项目 Tab / 对话 / 弹层 / 桌面卡片 |
| 部分实现 | 动效 token（鸿蒙只有 `PMMotion` 两档；Web 只有官网局部的 `--ease-out`）、骨架屏（有形状无闪动）、减少动效（Web 完整，鸿蒙没有） |
| 不存在 | **命令面板**（只有 `Ctrl/⌘+J` 打开问忆程，`components/ProjectOverviewToolbar.tsx:12`）、统一 toast、页面转场、共享元素、Agent 状态动效、Web 手机底部导航 |

### 2.3 官网 Landing Page

**当前有什么**：编辑式宋体大标题 + 右侧接续卡；滚动进度条、接续线、轻微视差（`components/home/HomeMotion.tsx`）；可亲手操作的五步示例（`components/HomeJourney.tsx`）；顶栏已有轻毛玻璃（88% + 14px，`components/SiteHeader.module.css:76`）。

**实际效果** [判断]：气质对路。没有渐变光晕和粒子，暖纸、墨色、青绿、宋体的组合已有书院感，在同类 AI 产品官网里算克制。但记忆点集中在一句标语，首屏结构（左文案、右产品卡、双按钮）仍是常见模板，第二屏起观感开始趋同。

**主要问题**

| # | 问题 | 证据 | 标记 |
|---|---|---|---|
| L1 | 标语的“掉”字不在 `PM Editorial` 子集（共 401 个汉字），落到回退字体。“让、走、遍”同样缺失，影响 3 个区块标题 | `CSS.getPlatformFontsForNode`：`PM Editorial(11) + Noto Serif SC(1)`，见 `platform-fonts.json` | [测得] |
| L2 | 产品截图过期：旧版左侧图标导航、无衬线标题，并露出 `experiment_log、code_issue` | [截图](../../evidence/material-motion-audit-20261107/before-after/home-platform-shot-actual.jpg)，`public/home/workspace-desktop.jpg` 日期 10-23 | [测得] |
| L3 | 看起来能点的假按钮：`补充演示结果 / 审阅提案`、`补充材料 / 查看草稿` 实为 `aria-hidden` 的 span，点了没反应 | `components/home/HomeResumeCard.tsx:22`、`app/page.tsx:176` | [代码] |
| L4 | 中文断行差：桌面 H2 断成“新情况出现时，它 / 带着出处回来。”，“它”被甩在行尾 | [截图](../../evidence/material-motion-audit-20261107/screens/home-desktop-light-flow.jpg) | [测得] |
| L5 | 第二 CTA 是“在 GitHub 查看源码”，而对学生最有说服力的“无需登录体验”藏在第二屏底部小链接 | `app/page.tsx:96`、`:159` | [判断] |
| L6 | 同一声明重复 4 次（首屏卡、接续线下方、示例引导、示例底栏），视频区也用三行解释加载方式 | `app/page.tsx`、`components/home/DemoVideoPlayer.tsx` | [判断] |
| L7 | 三点式假浏览器窗框是典型模板元素 | `app/home.module.css:1539` | [判断] |
| L8 | 动效代码有一半空转：`[data-draw]`、`[data-hero-lens]` 在页面上已无对应元素，`.kicker` 无引用；27 个类名在 TSX 中无引用 | `grep`，重排提交 `4c1ed73` 后的残留 | [代码] |
| L9 | 滚动时每帧写继承型 CSS 变量并强制读布局，详见 [6.1](#61-web) | `HomeMotion.tsx:37-66` | [代码][测得] |
| L10 | 资源：`/logo.png` 810.7 KB 显示为 28px（`unoptimized`）；两个 TTF 共 319 KB，未转 WOFF2 | `capture-metrics.json`、`components/BrandLink.tsx:12` | [测得] |
| L11 | 顶部 2px 阅读进度条对这个长度的页面价值低，并和分隔线形成双线 | [截图](../../evidence/material-motion-audit-20261107/screens/home-desktop-light-experience.jpg) | [判断] |

**是否需要加材质或动效**：不加材质。动效做减法，再加一个有品牌含义的“接续线”，见[实验 5](#实验-5官网接续线)。

### 2.4 Web 工作台

**当前有什么**：全部实体。顶栏实心（`app/globals.css:311`），卡片白底细边，大圆角 14–18px，主卡有长距离柔阴影。`app/globals.css:234` 的注释写明“Product chrome is solid and quiet”。

**实际效果** [判断]：干净可信，方向正确，和材质调研的结论一致。问题不在“不够高级”，而在**层级和节奏**。

| # | 问题 | 证据 | 标记 |
|---|---|---|---|
| W1 | 版心不统一：同一视口下品牌左缘与内容左缘分别是官网 100/110、焦点和项目列表 64/100、项目详情 64/40；品牌字号官网 16px、工作台 19px。切页时内容左右跳 | `layout-metrics.json` | [测得] |
| W2 | 标题字体依赖本机：`PM Brand` 只含“忆程”两字，其余落到 Noto Serif SC，本机恰好安装。模拟未安装时掉到 SimSun，字重和气质都变了 | [有 Noto](../../evidence/material-motion-audit-20261107/screens/font-focus-with-noto.jpg) / [无 Noto](../../evidence/material-motion-audit-20261107/screens/font-focus-without-noto-simulated.jpg) | [测得] |
| W3 | 字重塌缩：Windows 微软雅黑上，同段文字 400 与 500 墨量都是 1956，550–800 都是 2977。代码有 10 档字重（600×79、650×35、500×32、550×23……）和 561 处 Tailwind 字重类（含 84 处残留的 `font-black`）。结果是小字大量变粗，12–13px 的粗体糊成一片 | `layout-metrics.json` | [测得] |
| W4 | 两种主色打架：青绿 `editorial-button` 和近黑 `headingPrimary`、`project-card-open` 并存。`/projects` 里 11 张卡有 11 个同权重黑按钮，页面没有焦点 | [截图](../../evidence/material-motion-audit-20261107/screens/projects-desktop-light.jpg) | [测得] |
| W5 | 进度条轨道白压白：`.project-card-bar` 用 `--paper-strong`（#FFF），卡片也是 #FFF，比例不可读，0/6 时什么都看不到 | `app/globals.css:351`，[前后对比](../../evidence/material-motion-audit-20261107/before-after/E2-card-after.jpg) | [代码][测得] |
| W6 | 零值噪声：`0 条提醒 0 项待办 0 张卡片 0 份成果`（鸿蒙已隐藏零值，Web 没有） | `components/ProjectCard.tsx:38` | [测得] |
| W7 | 项目头部 255px 在每个子页都重复。`/actions` 依次是 H1、H2“行动与提醒”、H2“项目行动板”、说明、筛选、输入框，第一条行动在 y=642。手机上首屏看不到任何行动 | `layout-metrics.json`，[手机截图](../../evidence/material-motion-audit-20261107/screens/projActions-mobile-light.jpg) | [测得] |
| W8 | 滚动后丢失项目身份：顶栏只剩全局导航，看不到当前在哪个项目，“问忆程”也滚走了 | [截图](../../evidence/material-motion-audit-20261107/screens/project-desktop-scrolled.jpg) | [测得] |
| W9 | 概览下一步卡通栏宽 1160px，文字限 62ch，右半空白；它的阴影又是全页最重的。“接下来要做”只有一张 280px 小卡，孤零零在左 | [截图](../../evidence/material-motion-audit-20261107/screens/project-desktop-light.jpg) | [测得] |
| W10 | `查看当前项目判断委托下一个目标` 是可点链接，但样式和正文一样，没有可点感 | `components/ProjectStartGuide.tsx:7` | [测得] |
| W11 | `GitHub 仓库` 按钮悬在主卡右上角，归属不明 | 同 W9 截图 | [判断] |
| W12 | 委托详情：顶部空白条只有“已加载 1 项委托”；面板套卡片套卡片三层边框；委托标题比页面 H2 还大，层级倒置 | [截图](../../evidence/material-motion-audit-20261107/screens/missions-desktop-light.jpg) | [测得] |
| W13 | 记忆页：标题和摘要经常一字不差（用户看到同一句话两遍）；类型胶囊即时生效，但项目筛选要点“应用筛选”，两种规则并存；标签内嵌说明“个人记忆 你的协作偏好与背景” | [截图](../../evidence/material-motion-audit-20261107/screens/memory-desktop-light.jpg) | [测得] |
| W14 | `EvidenceText` 把“P95 为118ms”整段设成等宽，汉字“为”也变等宽，读起来断裂 | `components/EvidenceText.tsx:3` | [代码] |
| W15 | 54 个文件用原生 `<details>`，多数显示系统小三角 ▶，和全站 Lucide 图标不搭；原生 `<select>` 和复选框同样出戏 | `grep` | [代码] |
| W16 | 设计 token 分散：单页 13–21 种字号、最多 15 种圆角，≥18 种过渡时长，5 种缓动曲线，官网 `.84rem`、`.82rem`、`.8rem` 并存 | `capture-metrics.json` | [测得] |
| W17 | 旧设计残留：深色下的霓虹光 `rgba(0,210,143,…)`（`app/globals.css:187`）、无引用的 `.dark-glow`、永远为 none 却常驻固定层的 `--bg-mesh`；`ThemeProvider` 已禁用切换过渡，`body` 上 0.4s 过渡空转 | 代码 | [代码] |
| W18 | Windows 下 `Inter` 和 `cv11/ss01` 并不生效：没有 `@font-face`，实际拉丁字来自系统 | `app/globals.css:70-73` | [代码] |
| W19 | 骨架屏 `animate-pulse` 与部分页面 `LoaderCircle` 文字并存；`app/loading.tsx` 和项目详情骨架不是同一形状 | `app/loading.tsx`、`app/projects/[id]/loading.tsx` | [代码] |
| W20 | 手机端没有底部导航，四个全局页全靠汉堡菜单；项目列表筛选表单占去 1/3 屏 | [截图](../../evidence/material-motion-audit-20261107/screens/projects-mobile-light.jpg) | [判断] |

**是否需要加材质或动效**：工作台顶栏不加玻璃。需要的是滚动后出现的紧凑项目条（实体）、列表状态过渡和统一弹层动效。

### 2.5 Agent（对话区与状态）

**当前有什么**：结构做得比视觉好。`AgentMessageBlocks` 已有 10 种语义块，接口有 8 种阶段：`ROUTING`、`READING_SOURCE`、`EVALUATING`、`WAITING_MODEL`、`READY`、`WAITING_USER`、`RECOORDINATING`、`STOPPING`（`components/ConversationPanel.tsx:342`）。没有流式输出，Web 每 1200ms、鸿蒙每 1500ms 轮询进度，所以等待时间是实打实的 **[代码]**。

**实际效果**：渲染结果见 [块样式](../../evidence/material-motion-audit-20261107/screens/agent-desktop-light-blocks1.jpg) 和 [进度状态](../../evidence/material-motion-audit-20261107/screens/agent-desktop-progress-READING_SOURCE.jpg) **[测得]**。块之间的版式清楚，但：

| # | 问题 | 证据 | 标记 |
|---|---|---|---|
| A1 | 所有运行阶段长一个样：一行灰字加 `✓` / `·`，零动效。检索、判断、调工具从视觉上无法区分 | `ConversationPanel.module.css:188` | [测得] |
| A2 | **语义色错位**：品牌规定琥珀表示等待确认，徽标 `WorkStateBadges` 也这么用，但批准卡是青绿边、青绿字“等待你确认”。最需要用户注意的卡，颜色和普通信息一样 | `AgentMessageBlocks.module.css:44-45` | [代码][测得] |
| A3 | 手机端竖向空间被吃掉：品牌栏 + “返回原焦点讨论” + “与忆程协作”三层头部共 195px，输入区 287px，消息区仅 344px（41%）。隐藏常驻上下文和返回行后消息区 518px（61%） | [前](../../evidence/material-motion-audit-20261107/before-after/E3-conversation-mobile-before.jpg) / [后](../../evidence/material-motion-audit-20261107/before-after/E3-conversation-mobile-after.jpg) | [测得] |
| A4 | **文字重叠**：焦点页输入框底部，“长标题与”和“更多”叠在一起 | [截图](../../evidence/material-motion-audit-20261107/screens/focus-desktop-light.jpg)右下，`.composerScope` | [测得] |
| A5 | “调整当前方向”里长目标按钮沿用 `button` 默认居中，出现居中粗体青绿段落，缩进参差 | 同上截图 | [测得] |
| A6 | 深色下输入区分隔线明显偏亮 | [截图](../../evidence/material-motion-audit-20261107/screens/focus-desktop-dark.jpg) | [测得] |
| A7 | `aria-live="polite"` 挂在整个消息区，长回答或历史刷新可能整段朗读 | `ConversationPanel.tsx:288` | [代码][待验证] |
| A8 | 回执的 `结果已保存` 用对勾，`CREATED` 也用同一个对勾。创建和完成是不同状态，视觉上不该接近 | `AgentMessageBlocks.tsx` receipt 分支 | [代码] |
| A9 | 依据和调查过程用原生 `<details>`，瞬开瞬合，看不出内容从哪来 | `AgentMessageBlocks.tsx` | [代码] |

**是否需要加材质或动效**：材质不需要，消息和证据必须实体。动效要加，这里是全产品回报最高的地方，见[第 5 节](#5-动效设计体系)。

### 2.6 项目记忆与证据

**当前有什么**：`ws-state` 已用形状区分状态（实心圆、空心琥珀圆表示 UNKNOWN、红点、横杠表示 SUPERSEDED，`app/globals.css:397-401`），已替代卡片用虚线边。这套形状语言是很好的资产，而且不只靠颜色。

**主要问题**：时间线是静态列表；`最近重要变化` 文案是“尚无已了解的比较基线”，变化本身没有视觉表达；从结论跳到来源靠整页跳转，来源跳回没有高亮落点（只有 `.timeline-entry:target` 一个静态阴影）**[代码]**。

**是否需要加材质或动效**：阅读背景必须保持实体。动效只用在三件事上：来源牵引线、节点状态变化、跳转落点高亮。

### 2.7 弹层、抽屉、通知

| 现状 | 证据 | 标记 |
|---|---|---|
| 至少 6 套弹层实现：`OverlayPanel`、`GlobalSettings`、`ProjectSettings`、`AttachmentInbox`、`EpisodeCheckpointCard` 抽屉、`HomeJourney` 原生 `<dialog>` | `grep` | [代码] |
| 遮罩 5 种：`--ink 26%`、`rgba(16,27,50,.46)`（旧蓝色）、`rgba(15,23,42,.35)`、`bg-black/70`，另有两处带 `backdrop-blur` | 同上 | [代码] |
| `OverlayPanel` 有 Esc 和焦点归还，但没有焦点陷阱和 `aria-modal`，Tab 可跳到背后页面 | `components/OverlayPanel.tsx` | [代码] |
| 只有入场动画，全部直接卸载，没有退场 | 同上 | [代码] |
| 通知只有错误浮窗；成功反馈散落各组件 | `components/ErrorPopupHost.tsx` | [代码] |

### 2.8 HarmonyOS

**当前有什么**：`PMMaterial` 把材质限制在遮罩层，内容卡实心，方向对；`PMMotion` 两档时长；转场只淡入不淡出，并在注释里解释了原因（避免 Tab 切换时压扁）。整体比 Web 更克制。`DesignTokens.ets:152` 关于 SDK 能力的注释经核对准确 **[代码]**。

| # | 问题 | 证据 | 标记 |
|---|---|---|---|
| H1 | 遮罩模糊没有可见效果：`COMPONENT_ULTRA_THICK` + 45% 蓝灰，背后内容完全不可辨，却仍是每帧实时模糊，共 11 处 | `ProjectHome.ets:6225` 等，[截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204356.png) | [代码][截图] |
| H2 | 悬浮“问忆程”遮挡操作（X1 依旧）：盖住“查看原因与恢复条件”“继续推进”“生成新版本”等 | [截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204503.png)，`ProjectHome.ets:6123` | [截图] |
| H3 | 遮罩不覆盖安全区：状态栏和手势条区域留白带，弹层显得像贴上去的。全库没有 `expandSafeArea` | [截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204356.png) | [截图][代码] |
| H4 | 关闭按钮溢出卡片右缘（评委质询、证据透视两个弹层） | [截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204615.png) | [截图] |
| H5 | 面向用户的文案露出内部信息：`Judge Rebuttal`（拼写也错）、`Claim Auditor`、`changeImpactService`、`CardRelation 表`、“功能演示与防幻觉规范” | `JudgeRebuttalModal.ets:35,83`、`ClaimAuditorDrawer.ets:147` | [代码] |
| H6 | 筛选胶囊被右侧排序按钮硬切，“学科”露半个字，没有渐隐 | [截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204127.png) | [截图] |
| H7 | 列表滚动区在底栏上方被硬切，中间留一条空白 | 同上截图底部 | [截图] |
| H8 | 项目 Tab 的“行动”和“成果”图标几乎一样（都是带横线的文档）；全局叫“记忆”，项目内叫“资料” | [截图](../FINAL/NewHMUI/Screenshot_2026-11-04T204503.png) | [截图] |
| H9 | 顶栏两种底色：主 Tab 暖纸色，项目和对话页白色 | 对比截图 | [截图] |
| H10 | “同步未完成”黄条跨多屏常驻，占用高度 | `docs/FINAL/NewHMUI/` 20:44 系列 | [截图] |
| H11 | 字体：只有“忆程”两字有品牌字体，其他标题系统无衬线，与 Web 的宋体标题观感分裂。`PMFontFamily.SERIF` 是逗号回退列表，而 `DesignTokens.ets:9` 自己写明 ArkUI 不解析 | `DesignTokens.ets`，另有 2 处使用 | [代码] |
| H12 | 对话进度同样只有 `LoadingProgress` + `✓ / ·` 文本 | `FocusConversation.ets:705` | [代码] |
| H13 | 无减少动效处理、无共享元素（`sharedTransition` 0 处），`clickEffect` 已铺开、观感不错 | `grep` | [代码] |
| H14 | 与 Web token 漂移：品牌色 `#176B60` vs `#27685D`，底色 `#F7F5EF` vs `#F7F6F2`，墨色 `#213732` vs `#1C2E2C` | `resources/base/element/color.json` | [代码] |

**是否需要加材质或动效**：移除无效模糊（净减负）。唯一值得试的材质是系统级 HDS 悬浮页签。动效补 Agent 状态和项目卡共享元素。

### 2.9 深浅色、响应式、无障碍基线

- **对比度** [测得]：浅色 `--muted` 在纸面上 4.72:1、在白卡上 5.1:1，刚过 AA，没有任何余量。深色全部通过且余量充足。鸿蒙 `INK_TERTIARY` 4.68:1，同样紧。
- **触控** [测得]：Web 主要控件 44px，`pointer:coarse` 规则到位。手机汉堡菜单项 38px，低于自身规范。
- **减少动效**：Web 全局规则和官网专项都有，质量好；`prefers-reduced-transparency` 和 `prefers-contrast` 只覆盖官网顶栏与局部 **[代码]**。
- **深色** [测得]：logo 的白底方块偏刺眼；其余观感良好。

---

## 3. 视觉方向对比

| 方向 | 适合忆程的地方 | 问题 | 结论 |
|---|---|---|---|
| **A. 实体纸卡 / Editorial** | 证据、长文、中文宋体气质都契合；已是现状；零渲染成本 | 单独使用会显得静，缺少“活的 Agent”感 | **基座，保留** |
| **B. 轻毛玻璃** | 悬浮控件压在变化内容上时能保持空间感 | 暖白低彩配色下几乎不可见（E1）；不透明度下限 88% 把可见度吃光；持续 GPU 成本 | **只用于官网顶栏（已有）和鸿蒙系统组件** |
| **C. 液态玻璃** | 仅对沉浸式媒体和系统原生组件有说服力 | Apple 明确不用于内容层；Web 的折射依赖 Chromium 专属路径；Linear 自研时也放弃了折射，理由之一是降低密集界面可读性 | **Web 放弃；鸿蒙只用系统提供的 HDS 版本做实验** |
| **D. 分层材质** | 用“底、纸、控件、遮罩”四层统一思路，比全局玻璃化更稳 | 层数过多反而复杂 | **采用其思想，但层内基本实体** |
| **E. 精致微动效** | 按压、状态切换、展开收起直接提升完成度，成本低 | 无节制会干扰高频操作 | **全面采用，受 token 约束** |
| **F. 叙事型动效** | 把“接续”“依据”“判断变化”变成可见的东西，这是产品独有的 | 容易做成炫技；必须绑定真实状态 | **采用，但只用于 Agent 与证据，以及官网一处** |

**组合推荐：A + E + F，D 作为分层规则，B 仅保留极少点位，C 不做。**

可以这样比较三套完整方案：

| | 方案一：全局玻璃 | 方案二：局部液态 + 玻璃导航 | **方案三：实体纸面 + 语义动效（推荐）** |
|---|---|---|---|
| 品牌契合 | 低，像通用 AI 模板 | 中，偏 Apple，不够“书院” | 高 |
| 可读性风险 | 高 | 中 | 低 |
| 性能风险 | 高 | 中 | 低 |
| 差异化来源 | 无 | 一般 | 状态与证据可视化，别家抄不走 |
| 需要投入 | 大，且要反复调对比度 | 大 | 中，多数只改 CSS |

外部参照（都只借原则，不抄样式）：

- **Apple HIG**：Liquid Glass 属于控件和导航层，明确要求不要用在内容层，自定义控件上要节制，并限于最重要的功能元素。这条直接否定了证据卡和批准卡玻璃化。
- **Linear**：2026 年的改版方向是减少非必要的视觉竞争、让结构靠感知而不是线条；移动端自研玻璃时保留透明和深度，放弃折射。
- **NN/g**（经二手报道，未读到原文）：批评 iOS 26 玻璃因内容透过而损害可读性和可预期性。
- **Material 3**（经第三方文档，官方页未取到正文）：空间移动用弹簧，颜色透明度用时长曲线。第 5 节采用相同切分。
- **Raycast、Notion、Arc**：本轮检索没有拿到可靠的一手实现资料，不作依据。

---

## 4. 组件改造矩阵

材质：实体 / 轻玻璃 / 局部液态 / 不改。复杂度 S≤半天，M≈1–2 天，L≥3 天。

### 官网

| 组件 | 源码 | 现有问题 | 材质 | 动效与触发 | 价值 | 风险 | 复杂度 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 字体子集 | `public/fonts/pm-editorial-serif.ttf` | L1 缺字 | — | — | 标语完整 | 无 | S | **P0** |
| 产品截图 | `public/home/workspace-desktop.jpg` | L2 过期、露枚举 | 实体 | 无 | 可信度 | 需维护流程 | S | **P0** |
| 假按钮 | `HomeResumeCard.tsx:22`、`page.tsx:176` | L3 | 实体 | 改为可点锚点或去按钮样式 | 不骗用户 | 无 | S | **P0** |
| 顶栏 | `SiteHeader.module.css:76` | 顶部也持续合成 | 轻玻璃（保留） | 回到顶部时切实体 | 小 | 低 | S | P2 |
| `HomeMotion` | `components/home/HomeMotion.tsx` | L8、L9 | — | 删视差、删进度条，接续线改为进入视口才计算 | 省主线程 | 无 | S | **P0** |
| 接续线 | `app/home.module.css:566` | 已有，存在感弱 | 实体 | 进入视口时画线、节点依次点亮，回放到“判断改变”停住 | 品牌记忆点 | 需减少动效兜底 | M | P1 |
| 首屏接续卡 | `HomeResumeCard.tsx` | 13px 小字密集 | 实体 | 只在首次加载播一次“原判断划掉 → 新判断” | 一眼看懂产品 | 不能循环 | M | P1 |
| 示例旅程 | `HomeJourney.tsx` | 进度切换没有方向感 | 实体 | 步骤切换用方向滑入（CSS 已存） | 小 | 低 | S | P2 |
| 粒子、3D、大视差 | — | — | — | — | — | — | — | 不建议 |

### Web 工作台

| 组件 | 源码 | 现有问题 | 材质 | 动效与触发 | 价值 | 风险 | 复杂度 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 全局顶栏 | `globals.css:311` | E1 证明玻璃无感 | **不改** | 无 | — | — | — | 不建议玻璃 |
| 紧凑项目条 | 新增，`app/projects/[id]/layout.tsx` | W8 | 实体 | 哨兵元素离开视口时 160ms 淡入，无 scroll 监听 | 始终知道在哪 | 低 | M | P1 |
| 项目头部 | 同上 | W7 | 实体 | 子页折叠为一行 | 首屏内容提前约 150px | 低 | S | **P0** |
| 项目卡 | `globals.css:333` | W4–W6 | 实体 | 悬停只变边框（已有），不要上浮 | 列表焦点 | 低 | S | **P0** |
| 页面切换 | Next App Router | 无转场 | — | 焦点列表 → 详情标题共享元素（渐进增强） | 空间连续 | Next 标注实验 | M | P2，见 6.1 |
| 弹层统一 | `OverlayPanel.tsx` 等 | 2.7 | 实体 + 纯遮罩 | 入退场 180/140ms，补焦点陷阱 | 一致性、无障碍 | 低 | M | P1 |
| 折叠区 | 54 个文件的 `<details>` | W15、A9 | 实体 | `::details-content` 渐进增强，换统一图标 | 精致度 | 不支持时瞬开 | S | P1 |
| 列表增删 | `ActionBoard.tsx` 等 | 状态变化瞬间跳 | 实体 | 完成项高亮后收拢（WAAPI 或 auto-animate 思路） | 反馈明确 | 重排抖动 | M | P2 |
| 命令面板 | 不存在 | — | — | — | 非材质范畴 | 改信息架构 | L | 不在本轮 |

### Agent

| 组件 | 源码 | 现有问题 | 材质 | 动效与触发 | 价值 | 风险 | 复杂度 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 运行进度 | `ConversationPanel.tsx:342` | A1 | 实体 | 接续线 + 节点语义（第 5 节） | **最高** | 不得夸大进度 | M | **P0** |
| 批准卡 | `AgentMessageBlocks.tsx` approval | A2 | 实体，琥珀 | 出现一次淡入，按钮不动 | 不漏确认 | 无 | S | **P0** |
| 回执卡 | 同上 receipt | A8 | 实体 | 仅 `SUCCEEDED` 且服务端确认后，线接回节点 | 闭环感 | 不可乐观更新 | S | P1 |
| 证据卡 | 同上 evidence | A9 | **实体（必须）** | 展开带方向，引文高亮淡出 | 可追溯感 | 无 | M | P1 |
| 判断卡（change） | 同上 change | 无前后对比 | 实体 | 旧判断划线淡去 → 新判断（一次） | 看见变化 | 无 | S | P1 |
| 对比卡 | 同上 comparison | 无选中反馈 | 实体 | 选中态 160ms | 小 | 无 | S | P1 |
| 澄清卡 | 同上 question | 无 | 实体 | 无，稳定优先 | — | — | — | 不建议 |
| 输入区 | `ConversationPanel.module.css:43` | A3–A5 | 实体 | 上下文折叠为一行可展开 | 消息区 +20% | 低 | S | **P0** |
| 问忆程入口（Web） | `.launcher` | 压住内容 | 实体 | 按压反馈 | — | — | — | 不改 |
| 悬浮操作栏（批量） | 不存在 | — | — | — | — | — | — | 不建议 |

### 记忆与证据

| 组件 | 源码 | 现有问题 | 材质 | 动效与触发 | 价值 | 风险 | 复杂度 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 来源牵引线 | `MissionBasisEvidence.tsx` | 结论与来源靠跳转 | 实体 | 悬停或聚焦时画线 + 来源边框高亮，宽屏才画 | **高**，产品核心承诺 | 窄屏改为就地展开 | M | P1 |
| 跳转落点 | `.timeline-entry:target` | 只有静态阴影 | 实体 | 落点背景 1.2s 淡出 | 不迷路 | 低 | S | P1 |
| 时间线节点 | `ProjectDecisionTimeline.tsx` | 静态 | 实体 | 状态改变时节点形状过渡一次 | 看见演化 | 低 | M | P2 |
| 记忆卡 | `.ws-card` | W13、W14 | **实体（必须）** | 无 | 阅读优先 | — | S（修内容） | P1 |

### HarmonyOS

| 组件 | 源码 | 现有问题 | 材质 | 动效与触发 | 价值 | 风险 | 复杂度 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 弹层遮罩 | 11 处 `PMMaterial.SCRIM` | H1 | 纯色遮罩 | 保留现有淡入 | 减负、无视觉损失 | 无 | S | **P0** |
| 遮罩安全区 | 同上 | H3 | — | — | 完整感 | 需真机验证 | S | **P0** |
| 弹层关闭键 | `JudgeRebuttalModal.ets`、`ClaimAuditorDrawer.ets` | H4、H5 | 实体 | — | 可信度 | 无 | S | **P0** |
| 问忆程胶囊 | `FocusAgentLauncher.ets` | H2 | 实体 | 向下滚动收成图标，上滑展开 | 不遮挡 | 需 `onScroll` 节流 | M | P1 |
| 主 Tab 栏 | `Index.ets:838` | 手绘、在布局流内 | **局部液态（系统 HDS）** | 系统提供 | 平台原生感 | 重构 Tab、需兜底 | L | P2 实验 |
| 项目卡 → 项目页 | `Index.ets`、`ProjectHome.ets` | 无连续性 | 实体 | `sharedTransition` 标题，300ms 内 | 空间连续 | `ProjectHome` 首帧重 | M | P1 |
| 对话进度 | `FocusConversation.ets:705` | H12 | 实体 | 与 Web 同一状态语言 | **最高** | 跨端一致 | M | **P0** |
| 筛选胶囊 | `Index.ets` ProjectsTab | H6 | 实体 | 右缘遮罩渐隐（`linearGradient` 蒙版） | 小 | 低 | S | P1 |
| 列表底部 | 同上 | H7 | 实体 | 去空白，内容滚到底栏边 | 小 | 低 | S | P1 |
| Tab 图标 | `PMIcons.ets` | H8 | — | — | 可辨识 | 无 | S | P1 |
| 桌面卡片 | `widget/pages/WidgetCard.ets` | 已验收 | 不改 | — | — | — | — | 不建议 |

---

## 5. 动效设计体系

### 5.1 四条语义规则

1. **动效只说真话。** 只绑定服务端已返回的状态。不做假进度百分比，不做乐观成功动画。
2. **持续运动只属于“正在发生”。** 同屏最多一处持续动效。等待用户时**不动**，因为要动的是用户，不是界面。
3. **变化只动一次。** 状态变化播一次并停在结果上，不循环。
4. **运动从不携带唯一信息。** 动效去掉之后，靠文字和形状仍能读懂。

### 5.2 Token

Web 放在 `app/globals.css`，鸿蒙对齐 `PMMotion`。

| Token | 值 | 用途 |
|---|---|---|
| `--dur-press` | 90ms | 按压 |
| `--dur-state` | 160ms | 颜色、边框、选中 |
| `--dur-enter` | 220ms | 弹层、内容入场（退场约为 0.65 倍） |
| `--dur-settle` | 320ms | 状态落定、批准卡出现 |
| `--dur-trace` | 640ms | 画线、证据牵引（最长档） |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场、落定（代码中已是最常用） |
| `--ease-standard` | `cubic-bezier(.4,0,.2,1)` | 位移过程、画线 |

材质 token：

| Token | 值 | 约束 |
|---|---|---|
| `--bar-alpha` | ≥88%（浅色），≥80%（深色） | 由 [6.3](#63-透明度与对比度实测) 计算得出 |
| `--material-blur` | 10–14px | 只用于透明条 |
| `--scrim` | `color-mix(in srgb, var(--ink) 26%, transparent)` | 替换全部现有 5 种，不带模糊 |

浅色模式的透明条上不能放 `--muted` 文字：96% 时对比度仍只有 4.39。

### 5.3 Agent 状态语言

全部状态共用一条“接续线”，只改变线、节点和一行字。原型：[`docs/design/prototypes/material-motion/index.html`](prototypes/material-motion/index.html)。

| 状态 | 数据来源 | 节点 | 线 | 文字与动效 | 持续？ |
|---|---|---|---|---|---|
| 检索 | `ROUTING` | 空心青绿，内点小幅摆动 | 灰 | 文字缓慢扫光 | 是 |
| 读原文 | `READING_SOURCE` + step `STARTED` | 同上 | 灰 | 扫光；读完来源片以 220ms 落入 | 是 |
| 思考/判断 | `EVALUATING`、`WAITING_MODEL` | 同上 | 灰 | 扫光，无来源片 | 是 |
| 调用工具 | investigation step `READ_EXISTING` | 方形节点（形状区别于读取） | 灰 | 显示工具意图和“只读”范围 | 是 |
| 等待确认 | `WAITING_USER`、approval `PENDING` | **实心琥珀，放大 1.15 后静止** | 青绿停在这里 | 批准卡 320ms 淡入，**之后完全静止** | 否 |
| 执行成功 | receipt `SUCCEEDED`（服务端确认后） | 实心青绿 | 640ms 接回 | 回执底色落定一次 | 否 |
| 已创建未完成 | receipt `CREATED`、`SUBMITTED` | 实心青绿，**无回接** | 不动 | 写“等待执行”，不庆祝 | 否 |
| 失败 | step `FAILED` | 砖红短横（不抖动） | 断在此处 | 说明影响范围，给“重新读取” | 否 |
| 结果未知 | `UNKNOWN` | 空心琥珀（沿用 `ws-state`） | 虚线 | 文案“结果尚不明确”，**不用红色** | 否 |
| 恢复 | `RECOORDINATING` | 恢复为进行态 | 从断点继续 | 保留失败记录，不抹去 | 是 |
| 停止 | `STOPPING`、`STOPPED` | 空心灰 | 灰 | 直接切换 | 否 |

这张表和 `AGENTS.md` 的业务不变量逐条对应：Unknown 不当作 False；创建、排程、完成是不同状态；`isSimulated` 数据不播放成功动效；确认由服务端保证，界面不能先于服务端宣布成功。

**超时诚实**：同一阶段超过 20 秒没有进度更新时，停止扫光，改为静态“仍在处理，已等待 20 秒”并露出“停止本轮调查”。

### 5.4 其他交互

| 场景 | 规则 |
|---|---|
| 按压 | 背景或亮度变化 90ms；鸿蒙沿用现有 `clickEffect` |
| 卡片悬停 | 只变边框颜色，不上浮、不加大阴影（否定当前 `.hover-lift` 的 `translateY(-2px)`，也和现有 `.project-card` 一致） |
| 弹层 | 桌面 scale .98→1 + 淡入 220ms；手机底部滑入 24px；退场 140ms 且不缩放 |
| 抽屉 | 水平滑入 24px，不做全距离滑动 |
| 折叠 | 高度 + 透明度 220ms，长内容不动高度只淡入 |
| 页面切换 | 只淡入不淡出（沿用鸿蒙已验证的做法） |
| 共享元素 | 只用于标题一处，≤300ms |
| 主题切换 | 不动画（`disableTransitionOnChange` 已经如此，保留） |
| 审批按钮 | 出现后不再有任何位移，防止误触；输入期间不插入会造成布局跳动的内容 |
| 减少动效 | 全部转为瞬时切换和静态图形，状态文字保留；Web 已有全局规则，鸿蒙需新增 |

### 5.5 技术映射

| 能力 | Web | ArkUI |
|---|---|---|
| 颜色、透明度过渡 | CSS `transition` | 属性 `.animation()` |
| 入退场 | CSS + `@starting-style`（渐进增强） | `TransitionEffect`（已在用） |
| 画线 | SVG `stroke-dashoffset`，transform `scaleY` | `animateTo` + `Path`/`Line` |
| 文字扫光 | `background-clip:text`（覆盖面小，不是长列表） | 改用节点动效，不做文字扫光 |
| 共享元素 | `<ViewTransition>`（实验） | `sharedTransition`（router 下可用） |
| 弹簧 | 空间移动才用；首轮不需要 | `curves.springMotion`（目前 0 处） |

**依赖结论**：P0、P1 不需要任何新依赖。Web 已有的 CSS 能力足够。

---

## 6. 性能及兼容性

### 6.1 Web

**实测**（`perf-scroll.json`，5 秒 rAF 滚动，每组 3 次取中位）。

**重要限制**：本机是 RTX 4060，headless 下 rAF 不受 vsync 限制（出现 400+ fps），CPU 节流也压不到 GPU。因此**帧时间不能用来判断 `backdrop-filter` 成本**，移动档甚至出现“全卡玻璃 p95 比实体还低”这种反直觉结果，已判定无效，不引用。能用的只有主线程指标：

| 场景 | 主线程耗时/帧 | 样式重算次数 | 说明 |
|---|---|---|---|
| 官网 + 动效，CPU×4 | **5.4ms** | 1126 | 其中样式重算约 1.3ms/帧 |
| 官网 + 减少动效，CPU×4 | 1.8ms | 1 | |
| 官网 + 动效，CPU×6 | **11.0ms** | 594 | 占 16.7ms 帧预算的 2/3 |
| 官网 + 减少动效，CPU×6 | 3.0ms | 1 | |
| 官网顶栏有/无模糊 | 无可见差异 | — | 主线程不反映合成成本 |
| `/projects` 全部卡片玻璃（桌面，RTX 4060） | 3 次中 2 次 p95 从 18ms 升到 27–30ms | — | 连独显都不稳定，仅作方向性信号 |

**[测得]** `HomeMotion` 是全站最大的滚动热点。原因 **[代码]**：`hero.style.setProperty("--hero-shift")` 在祖先上写继承变量，触发子树样式重算；每帧读 `scrollHeight`、`offsetHeight`、`getBoundingClientRect`；英雄区滚出视口后仍在写。换来的效果只是文案移动 10px，几乎察觉不到 **[判断]**。这是**负收益动效**，应当删除。

**外部证据**：Mozilla 一例用 GPU 计时测得 Mali 设备上滚动时 `backdrop-filter` 开启约 24ms、关闭约 2ms（Bug 1732817，单页单设备，不可外推）。根因是固定条无法独立缓存，滚动时整页重绘。这和 sticky 顶栏 + 滚动内容的场景吻合。

**长列表** [代码]：`/projects` 已加载全部卡片，没有虚拟化。当前数据量小，不是问题；若全局玻璃化，每张卡都是独立合成层，才会成问题。

**新能力的兼容性**（都按渐进增强使用，不支持时退化为瞬时切换）：

| 能力 | 状态 | 用法 |
|---|---|---|
| View Transitions（同文档） | 浏览器较广泛；Next 文档仍标 `experimental` | 本机 React 19.2.7 稳定包未导出 `ViewTransition` **[代码]**，需靠 Next 内置的实验通道。**P2，不进主线** |
| `animation-timeline: scroll()` | Chrome、Safari 26、Firefox 159（caniuse 快照） | 可替代进度类滚动脚本 |
| `::details-content` + `interpolate-size` | `interpolate-size` Firefox、Safari 仍未支持（检索结果，来源日期不一，上线前再核） | 不支持时瞬开，可接受 |
| `prefers-reduced-transparency` | Chrome 支持，Safari、Firefox 未支持（caniuse 快照） | 必须同时有不依赖它的实体兜底 |
| SVG 折射玻璃 | `backdrop-filter:url()` 仅 Chromium | **放弃** |

顺带发现：`package.json` 写 Next `16.4.3`，`node_modules` 实际 `16.2.11` **[测得]**。与 UI 无关，但部署前值得核对。

### 6.2 HarmonyOS

**能力** [代码，本机 SDK 6.1.1(24)]：

| 能力 | 结论 |
|---|---|
| `BlurStyle` | 只到 `COMPONENT_ULTRA_THICK`，没有系统材质枚举 |
| HDS 材质 | `@hms.hds.hdsMaterial` 自 `6.1.0(23)` 起；`compatibleSdkVersion` 正好是 23，**不需要抬版本** |
| 开放位置 | 只有 `HdsTabsFloatingStyle.systemMaterialEffect`（`barFloatingStyle`）和 `TitleBarStyleOptions.systemMaterialEffect`，普通组件拿不到 |
| 材质参数 | `MaterialType`：NONE / ADAPTIVE / IMMERSIVE；`MaterialLevel`：EXQUISITE / GENTLE / SMOOTH / ADAPTIVE；有 `thermoCtrl`（随系统温控调节）和 `getSystemMaterialTypes()` 探测 |
| 共享元素 | `sharedTransition` 可用；官方说明只在 `@ohos.router` 跳转时生效。项目正好全用 router（78 处），**不必为此迁移 Navigation** |
| 减少动效 | SDK 声明中检索不到 `isReduceMotion` 类接口；`settings.general.ANIMATOR_DURATION_SCALE` 自 API 21 废弃 **[待验证：查官方文档和真机行为]**。务实做法是在“提醒与偏好”加一个应用内开关 |

**渲染成本** [代码][官方文档]：华为文档明确写 `backgroundBlurStyle`、`backdropBlur`、`blur` 等都是实时模糊，每帧渲染、负载较大，内容和半径不变时应改用静态模糊。

- `ProjectHome.ets` 6837 行、151 个 `@State`，`Index.ets` 66 个 `@State`。挂在根上的 `animateTo` 或频繁状态变化可能引起大范围重建，**动画状态应放到独立 `@Component`，不要加到这两个 struct 上** [判断][待验证]。
- `ForEach` 213 处、`LazyForEach` 0 处。列表短时无所谓，记忆时间线和资料长列表值得单独测 [待验证]。
- 所有性能结论都缺少真机帧数据。验收请用 DevEco Profiler 的帧时间，不要用模拟器。

**不要照搬 Web**：ArkUI 没有 `backdrop-filter` 的语义等价物可以廉价地放进普通 `Row`（`DesignTokens.ets:154` 的注释已说明）。现有导航在布局流里，背后没有滚动内容，模糊无处可透，所以“给 Row 加 blur”没有意义。要玻璃就得改成悬浮页签，让内容真的滚到底栏下面。

### 6.3 透明度与对比度实测

文字压在透明条上，背后全是对比最差的内容（浅色模式 `#1C2E2C`，深色模式 `#E8EEE9`）时的对比度：

| 不透明度 | 浅色 `--ink-soft` | 浅色 `--muted` | 深色 `--ink-soft` | 深色 `--muted` |
|---|---|---|---|---|
| 50% | 1.97 | 1.60 | 2.05 | 1.69 |
| 70% | 3.18 | 2.59 | 3.77 | 3.11 |
| 80% | 3.94 | 3.21 | **5.18** | 4.27 |
| **88%** | **4.63** | 3.78 | 6.73 | **5.55** |
| 92% | 5.00 | 4.07 | 7.56 | 6.23 |
| 96% | 5.39 | 4.39 | 8.51 | 7.02 |

粗体为首个通过 4.5:1 的档位。浅色 `--muted` 在 96% 时仍只有 4.39。未计入模糊的均化效果，这是保守值。

### 6.4 其他影响

| 维度 | 结论 |
|---|---|
| 键盘 | 统一弹层后补焦点陷阱；动效不改变焦点顺序；批准卡出现时不抢焦点 |
| 读屏 | `aria-live` 从整个消息区缩到一行状态，只在阶段变化时朗读，扫光和节点动效 `aria-hidden` |
| 减少动效 | 所有持续动效必须有静态态；Web 全局规则已能兜住时长，但无限循环的动画要显式改 `iteration-count`（原型已示范） |
| 高频操作 | 按压反馈 ≤90ms，操作不等动画结束 |
| 审批判断 | 批准卡静止；同屏无其他持续动效 |
| 长时间阅读 | 消息、证据、记忆全部实体；进度结束后不留任何动效 |
| 统一 token | 可行。Web 用 CSS 变量；鸿蒙扩展 `PMMotion` 和 `PMMaterial`；颜色建议一次性对齐（H14） |
| 依赖 | 不新增。若 P2 做列表重排，先试 WAAPI；`motion`（34.9k★，MIT，活跃）、`auto-animate`（14k★，MIT，活跃）是备选，本轮未读其源码。`liquid-glass-react`（6.6k★，MIT，最后推送 2025-06）依赖 Chromium 路径，排除。对话交互模式可参考 `assistant-ui`（13k★，MIT，活跃），同样未读源码 |

---

## 7. 玻璃之外更值得做的优化

按“投入 / 观感提升”排序，**这一节的回报普遍高于任何材质改造**。

| # | 改动 | 对应问题 | 投入 | 为什么有效 |
|---|---|---|---|---|
| 1 | 重做字体子集，并为工作台标题准备可随页加载的宋体方案 | L1、W2、H11 | S–M | 宋体是品牌识别的主要来源，目前却不受控 |
| 2 | 字重收敛为 400 / 600 两档，删除 `font-black` 和 550/620/650/750 | W3 | M | 一次改动消除大面积“糊”感，这是观感提升最大的单项 |
| 3 | 统一一个主操作色（建议青绿），近黑只留给文字 | W4 | S | 页面立刻有焦点 |
| 4 | 版心统一为一套容器，品牌字号统一 | W1 | S | 切页不再跳，高级感常来自这种不可见的对齐 |
| 5 | 子页头部折叠 + 滚动后紧凑项目条 | W7、W8 | M | 首屏多露内容，始终知道在哪 |
| 6 | 输入区上下文折叠，修文字重叠 | A3–A5 | S | 消息区 +20% **[测得]** |
| 7 | 批准卡改琥珀 | A2 | S | 语义一致，不漏确认 |
| 8 | 进度条轨道、零值隐藏、去卡片多余分隔 | W5、W6 | S | [前](../../evidence/material-motion-audit-20261107/before-after/E2-card-before.jpg) / [后](../../evidence/material-motion-audit-20261107/before-after/E2-card-after.jpg) |
| 9 | 更换官网截图，去假按钮和假窗框，修 H2 断行 | L2–L4、L7 | S | 官网最容易被一眼看穿的地方 |
| 10 | 记忆卡去重复摘要；统一筛选规则；修等宽正则 | W13、W14 | S | 阅读更顺 |
| 11 | 统一 `<details>` 图标和表单控件样式 | W15 | M | 消灭出戏的系统控件 |
| 12 | 委托详情减少一层边框，标题降级 | W12 | S | 卡中卡是廉价感的主要来源 |
| 13 | logo 压到 <10KB（SVG 或小 PNG），字体转 WOFF2 | L10 | S | 首屏省下 800KB 以上 |
| 14 | 清理死代码（27 个类名、旧霓虹、`.dark-glow`） | L8、W17 | S | 防止后续误用 |
| 15 | 鸿蒙清理内部文案，修关闭按钮，统一顶栏底色 | H4、H5、H9 | S | 评审一打开弹层就会看到 |
| 16 | Web 手机端加底部导航（与鸿蒙主 Tab 对齐） | W20 | M | 跨端一致，手机更好用；需确认是否算信息架构变化 |
| 17 | 空状态精修：`最近重要变化` 的“尚无已了解的比较基线”改用户语言 | 2.6 | S | 少一句机器话 |

---

## 8. P0 / P1 / P2 路线图

### P0：第一轮，纯修复 + Agent 状态（约 3–4 人日）

收益最高、风险最低，几乎全部不碰业务逻辑。

- **字体与字重**：补字、字重收敛（第 7 节 #1 的子集部分、#2）。
- **主色与版心**：#3、#4。
- **官网**：换截图、去假按钮、修断行、精简 `HomeMotion`（删视差和进度条）、压 logo。
- **工作台**：项目卡三项修复、子页头部折叠。
- **Agent（Web + 鸿蒙）**：运行进度接续线、批准卡琥珀、输入区折叠、修重叠。
- **鸿蒙**：移除 11 处遮罩模糊、遮罩覆盖安全区、修关闭按钮、清内部文案。
- **Token**：落地 `--dur-*`、`--ease-*`、`--scrim`。

**依赖关系**：字重收敛可能让部分文字变细，需要过一遍视觉回归（可复用 `e2e/`）。Agent 状态需要同时核对 `lib/types/conversation` 和 `harmonyos/.../models/Conversation.ets`，只读不改契约。

### P1：第二轮，证据和连续性（约 4–5 人日）

- 来源牵引线、跳转落点高亮、判断变化动效、回执回接。
- 弹层统一（一套组件、一种遮罩、退场动画、焦点陷阱）。
- 紧凑项目条。
- `<details>` 统一与展开动效。
- 鸿蒙：胶囊滚动收起、项目卡共享元素、筛选渐隐、Tab 图标重绘、减少动效开关。
- 官网：接续线叙事、首屏判断变化。
- 工作台宋体的完整方案。

### P2：第三轮，可选实验（按真机数据决定）

- 鸿蒙主 Tab 改 `HdsTabs` 悬浮材质（唯一的液态玻璃尝试）。
- Web 页面级 View Transitions。
- 列表重排动画。
- 官网顶栏到顶时切实体、示例旅程方向过渡。
- Web 手机底部导航（若不算信息架构变化，可提前）。

---

## 9. 不建议实施清单

| 不要做 | 为什么 |
|---|---|
| 全局玻璃化（卡片、面板、侧栏） | 配色下几乎不可见，下限 88% 吃光效果，持续 GPU 成本 |
| 证据卡、记忆卡、批准卡、回执卡用任何透明材质 | Apple 也明确反对内容层玻璃；这些是读字和做判断的地方 |
| 工作台顶栏玻璃 | E1 证明无感。实体 + 现有分隔线就是答案 |
| Web 液态玻璃、SVG 折射 | 仅 Chromium，Linear 自研时也放弃折射 |
| 把 HDS 材质做成通用组件或手工仿造 | SDK 只开放给页签和标题栏，手工仿造成本高且不随系统适配 |
| 所有 AI 元素持续呼吸发光 | 持续运动失去语义；等待确认时更不能动 |
| Sparkle、彩虹渐变、打字机假流式 | 没有真流式，假打字是欺骗；与“可信”相反 |
| 假进度条、百分比 | 没有数据支撑，违反不变量 |
| 成功时撒花、大幅弹跳 | 与书院气质不符；创建也不等于完成 |
| 官网粒子、蓝紫光晕、3D、滚动劫持、Lenis 平滑滚动 | 炫技，且伤害阅读和键盘滚动 |
| 英雄区视差（当前已有） | 10px 的视差换 3.6ms/帧，应删除 |
| 卡片悬停上浮 | 高频操作区的噪声，也和现有 `.project-card` 冲突 |
| 为动效迁移 `Navigation`、引入 Framer/GSAP | 成本和风险远超收益，CSS 与 `sharedTransition` 够用 |
| 把鸿蒙改成 Web 的视觉细节 | 各用各的平台能力，统一的是语义和 token |
| 现在做命令面板 | 属于信息架构，不在材质动效范围，也没有证据显示需求 |

---

## 10. 最值得尝试的 5 个实验

静态对比和原型已提供，全部通过测试时注入或独立文件实现，**没有改动生产页面**。

### 实验 1：Agent 状态接续线

- **页面**：`ConversationPanel`（Web）、`FocusConversation.ets`（鸿蒙）。
- **路径**：把 `.liveProgress` 改成有序列表 + 节点样式，直接映射现有 `phase` 和 `steps`，加 20 秒超时诚实态。批准卡改琥珀。原型：[index.html](prototypes/material-motion/index.html)。
- **预期**：用户不看文字也能分清“在忙”“等我”“出错了”。
- **验收**：
  - 5 名用户 3 秒内判断当前状态，正确率 ≥90%（当前基线待测）。
  - 减少动效开启时可完整理解。
  - Lighthouse 无新增长任务；中端手机对话页帧时间 P95 ≤20ms。
  - 读屏在一轮调查中只朗读阶段变化。

### 实验 2：字重与字体收敛

- **页面**：全站。
- **路径**：先只改 `globals.css` 全局映射 + 补字，不逐个组件改；Tailwind 的 `font-black/bold` 用覆盖方式映射到 600，稳定后再清理。
- **预期**：不改任何布局，观感明显提升。
- **验收**：Windows、macOS、鸿蒙浏览器各截 6 页对比；≤2 种实际字重；官网标题 `CSS.getPlatformFontsForNode` 只返回 `PM Editorial`；无 Noto Serif SC 的机器上标题不掉到 SimSun。

### 实验 3：对话与项目页的垂直空间

- **页面**：手机端对话抽屉、项目子页。
- **路径**：合并头部、输入区上下文折叠为一行、子页折叠头部。[前](../../evidence/material-motion-audit-20261107/before-after/E3-conversation-mobile-before.jpg) / [后](../../evidence/material-motion-audit-20261107/before-after/E3-conversation-mobile-after.jpg)。
- **预期**：消息区从 41% 提到 ≥60%（注入已测得 61%）；首条行动进首屏。
- **验收**：`/actions` 手机首屏出现第一条行动；上下文折叠后仍可一次点开；现有 `e2e/` 回归通过。

### 实验 4：鸿蒙“减法 + 一处系统材质”

- **页面**：`Index.ets`。
- **路径**：分两步。先移除 11 处遮罩模糊，记录前后帧数据；再单独做分支，把主 Tab 换成 `HdsTabs` + `barFloatingStyle.systemMaterialEffect`（`ADAPTIVE`、`thermoCtrl: true`），用 `getSystemMaterialTypes()` 判断，不支持时走实体。
- **预期**：第一步无视觉损失，弹层打开时帧更稳。第二步才能真正判断液态玻璃是否值得。
- **验收**：DevEco Profiler 真机对比弹层动画帧；中低端机 P95 ≤16.7ms×1.2；第二步需通过 Tab 切换、深色、大字体、桌面卡片跳转回归，且 `harmony:build` 日志含 `BUILD SUCCESSFUL`。**如第二步在中端机出现掉帧或可读性下降，放弃并保留实体。**

### 实验 5：官网接续线

- **页面**：`app/page.tsx` 接续线区块，首屏接续卡。
- **路径**：删除现有视差和进度条。接续线改为进入视口时一次性绘制，节点依次点亮，停在“判断改变”，用 `IntersectionObserver` 或 `animation-timeline`，不写继承变量。首屏只在加载时做一次“原判断划掉 → 新判断”。
- **预期**：一个属于忆程的记忆点，同时滚动主线程开销下降。
- **验收**：CPU×4 下滚动主线程耗时/帧从 5.4ms 降到 ≤2.5ms；无 JS 和减少动效时内容完整可读；不增加依赖；5 名未接触过的用户能复述产品在做什么（当前基线待测）。

---

## 11. 最终判断

**如果只有两到三轮开发时间：**

**最值得引入新动效的界面：**

1. **Agent 运行进度和批准卡**（Web + 鸿蒙）。第一轮就做。
2. **证据和来源的牵引线、落点高亮**。第二轮做。
3. **官网接续线**。第二轮做，并删除现有视差。
4. 项目卡到项目页的共享元素（鸿蒙）。第二轮，低成本。

**最值得引入新材质的界面：只有一处，而且是实验。**

- **鸿蒙主 Tab 的系统 HDS 悬浮材质**，放在第三轮，且以真机数据决定是否保留。
- 官网顶栏已有的轻毛玻璃保留，不扩大。
- 除此以外，**不引入任何新玻璃**。

**应该保持现状的地方：**

- 工作台顶栏、侧栏、卡片的实体材质。
- 消息正文、证据、记忆、批准卡、回执的实体背景。
- 鸿蒙“只淡入”的 Tab 切换、`clickEffect`、桌面卡片。
- `ws-state` 的形状化状态语言。
- 官网的暖纸、墨色、宋体基调。
- 登录页（目前全站完成度最高）。

**哪些非玻璃效果反而更能体现 Agent 产品的高级感：**

1. **一条贯穿始终的接续线**：把“人可以下线，项目别掉线”变成可见的东西。
2. **诚实的状态差异**：等你时静止并变成琥珀，失败时只断一处并告诉你影响范围，未知时绝不伪装成失败。
3. **结论连着来源**：悬停一句话，线画向原文。
4. **变化被看见**：旧判断划掉，新判断落定，只播一次。
5. **受控的排版**：一种主色、两档字重、一个版心、标题字体不再靠运气。

这几项的共同点是：它们都在回答“这个 Agent 现在在做什么、为什么这样判断、接下来等谁”。玻璃回答不了这些问题。

---

## 附录 A：证据索引

新证据目录 `evidence/material-motion-audit-20261107/`（数据来源：隔离 E2E 库副本 + mock 模型；未含密钥和个人数据库）。

| 文件 | 内容 |
|---|---|
| `screens/` | 官网、工作台、Agent 的桌面与手机、深浅色实测截图 |
| `before-after/` | 注入式前后对比（E1 顶栏、E2 项目卡、E3 对话）、官网实际产品图、原型截图 |
| `capture-metrics.json` | 每页字号、圆角、阴影、资源体积、触控统计。触控统计包含折叠菜单内的项，只作参考 |
| `perf-scroll.json` | 滚动性能原始数据和渲染器信息 |
| `platform-fonts.json` | 实际落到的字体 |
| `layout-metrics.json` | 版心、首屏位置、字重墨量、消息区占比 |

原型：`docs/design/prototypes/material-motion/index.html`，可直接用浏览器打开，含深色和减少动效切换。

## 附录 B：未验证项

| 项目 | 缺口 |
|---|---|
| Web `backdrop-filter` 真实 GPU 成本 | 本机 GPU 过强且 headless 无 vsync，需中低端安卓和 iPhone 实测 |
| 鸿蒙全部渲染成本 | 本轮没有跑真机；帧数据为空 |
| 鸿蒙减少动效 API | SDK 声明中未检索到，需查官方文档和真机确认 |
| 遮罩安全区的修复方式 | 截图能确认现象，`expandSafeArea` 是否足够需要真机验证 |
| 鸿蒙截图时效 | 11-04 截图，晚于此的提交未覆盖 |
| Agent 富块内容 | 样式是真实组件，数据为注入；真实模型输出的长度和组合未测 |
| 用户层面的效果 | 实验 1、5 的用户测试基线都没有，表中数字是目标不是测得值 |
| 浏览器支持数据 | 来自 caniuse 快照和检索摘要，部分来源日期不一致，上线前再核 |
| Raycast、Notion、Arc | 未取得可靠一手资料，未作依据 |

## 附录 C：信息来源

**一手文档**

- Apple HIG Materials：<https://developer.apple.com/design/human-interface-guidelines/materials>
- 华为动态模糊文档：<https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/arkts-blur-effect.md>
- 华为共享元素转场：<https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ts-transition-animation-shared-elements>
- Linear Liquid Glass：<https://linear.app/now/linear-liquid-glass>
- Linear 改版：<https://linear.app/now/behind-the-latest-design-refresh>
- Next.js `viewTransition`：本机 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/viewTransition.md`
- HarmonyOS SDK 6.1.1(24)：本机 `hms/ets/api/@hms.hds.hdsMaterial.d.ets`、`@hms.hds.hdsBaseComponent.d.ets`、`openharmony/ets/component/common.d.ts`

**性能与兼容**

- Mozilla Bug 1732817：<https://bugzilla.mozilla.org/show_bug.cgi?id=1732817>
- caniuse `prefers-reduced-transparency`：<https://caniuse.com/wf-prefers-reduced-transparency>
- caniuse `animation-timeline`：<https://caniuse.com/mdn-css_properties_animation-timeline_scroll>
- `interpolate-size`：<https://web-platform-dx.github.io/web-features-explorer/features/interpolate-size/>
- WebKit Safari 26.0：<https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>

**二手资料（已在文中标注）**

- NN/g 评论的转述：<https://www.osnews.com/story/143522/liquid-glass-is-cracked-and-usability-suffers-in-ios-26/>
- Material 3 Expressive 第三方文档：<https://pub.dev/documentation/material_3_expressive/1.0.3/foundations_m3e_motion/M3EMotion-class.html>
- SVG 玻璃限制：<https://github.com/rizroze/liquid-glass>

**开源项目**（2026-11-07 经 GitHub API 查询，均未读源码）：`motiondivision/motion`、`formkit/auto-animate`、`assistant-ui/assistant-ui`、`rdev/liquid-glass-react`。
