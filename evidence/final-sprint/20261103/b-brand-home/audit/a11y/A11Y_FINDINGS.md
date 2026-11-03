# Track B 官网 · Phase 1 独立无障碍与交互审计结论（最终候选 SHA `9bae926`）

- 审计员：a11y-auditor（独立于实现者；只读 `app/`、`components/` 源码，只写 `audit/a11y/`）
- 工作树：`D:\Projects\hongmen-final-b-brand-home`，分支 `codex/final-b-brand-home`
- **审计对象 SHA：`9bae926e9475cedef118deedf5e002ec8365a23b`**（最终冻结候选，= `cc7c19f` + F-01 字号作用域修复 + `role="group"`；`git status --porcelain -- app components` 为空）
- 环境：Lead 的 Next dev `http://127.0.0.1:34111`（mock、隔离空库、无 Worker）；Playwright 1.61.1 / Chromium 149；Windows；2026-11-03（UTC+8）
- 方法：自动化 DOM/计算样式取证（Playwright 探针 + 计算对比度 + 键盘路径 + 偏好媒体模拟）。**不是真实用户测试，不是读屏软件人工验证，不构成无障碍认证。**
- 证据：[json/probe-after.json](json/probe-after.json)（主探针，12:44:14–12:47:15 UTC+8，sha=9bae926）、[json/supplement-after.json](json/supplement-after.json)（判断页小字/展开依据/字体放大/320 滚动/尺寸）、[json/f01-reverify-after.json](json/f01-reverify-after.json)（F-01 复验：1440/390/320/深色 + role=group）、[json/after-static-inventory.json](json/after-static-inventory.json)（候选 CSS 静态扫描）、[shots/](shots/) 截图、[scripts/probe-a11y.mjs](scripts/probe-a11y.mjs)、[scripts/probe-supplement.mjs](scripts/probe-supplement.mjs)、[scripts/probe-f01-reverify.mjs](scripts/probe-f01-reverify.mjs)、[MANIFEST.sha256](MANIFEST.sha256)。

> 复验口径：本报告最终结论只绑定 `9bae926`。`cc7c19f` 的审计发现 F-01（MINOR）已在 `9bae926` 修复并复验通过；更早基于 `0a09a2e`/`216cf05`/混合工作树的 provisional 结论已作废，不作为签收依据。

---

## 1. 结论摘要

| 维度 | 结论 |
|---|---|
| BLOCKER | **0** |
| MAJOR | **0** |
| MINOR | **0**（`cc7c19f` 的 F-01 已在 `9bae926` 修复并复验：judgment 区 11–12px 文本清零，全部 12.8px） |
| 核心交互（Hero 三阶段 / 五步 Tab / dialog / 键盘 / 焦点） | 全部 PASS |
| 动效与偏好（入场 / 阶段切换 / 滚动进度 / rail / 减少动画） | 全部 PASS（内容等价、无动画依赖） |
| 对比度（浅色/深色 × 1440/390） | 0 处低于 4.5:1（自动计算） |
| 320 / 360 / 390 / 768 / 1024 / 1280 / 1440 / 720×450(200%) | 全部无水平溢出 |
| 账号页 /login /register /forgot-password（浅/深 × 1440/390） | 全部 PASS（无泄漏、无溢出、CTA 12.8px/44px） |
| 决赛演示 Bilibili 外链（名称/target/rel/键盘/焦点/网络） | 全部 PASS；加载期 0 个外部请求、无自动播放 |
| 无 JS | `NOT_SUPPORTED`（框架级：根 `loading.tsx` + 异步页面，仅显示加载骨架；非 B2/B3 回归，详见 §5） |

**总体判定：B3 无障碍与交互合同在最终候选 `9bae926` 上通过自动化验收：BLOCKER 0 / MAJOR 0 / MINOR 0。** 剩余项均为已记录的非阻断观察（§5）。

---

## 2. 对 Lead 指定项的复验

### 2.0 终验修复复验（`9bae926` = `cc7c19f` + 2 处修复）

| # | 修复内容 | 结果 | 实测证据（[json/f01-reverify-after.json](json/f01-reverify-after.json)） |
|---|---|---|---|
| F-01 | `components/HomeJourney.module.css` 新增首页作用域覆盖：`.judgmentPane [class~="text-xs"]`、`.judgmentPane [class~="text-[11px]"]` → `font-size:0.8rem`（共享 `StateDiffView.tsx` 未改） | **PASS（已清零）** | 第 3 步 `#story-panel` 内 <12.8px 文本：**1440=0、390=0、320=0、深色 1440=0**；6 类关键文本全部 **12.80px**：比较基线（contrast 6.26/深色 8.25）、待确认（6.26/8.25）、依据 2 项（5.10/6.80）、主判断摘要（14.22/12.76）、变化文本（6.26/8.25）、记忆·原文（6.51/7.84）；judgment 区无水平溢出 |
| ARIA | 两个普通 div 补 `role="group"`（Hero 工作包、五步示例框；`components/home/HomeHeroLens.tsx:143`、`components/HomeJourney.tsx:132`） | **PASS** | `[role=group]` 2 个：`group "公开示例：委托当前工作包"`、`group "参赛项目交互示例"`；aria 快照显示组名并对读屏生效（组内 tablist/tabpanel/heading 结构完整）；`aria-label` 用于无 role 普通元素的扫描结果 = **0** |

### 2.1 上轮 provisional FAIL 候选的复验

| # | 上轮候选问题 | 冻结版结果 | 测量/证据 |
|---|---|---|---|
| 1 | 页脚 Bilibili 外链名称仅“决赛演示”，未说明外部站/新窗口 | **PASS** | `app/page.tsx:360` 加 `aria-label="决赛演示（Bilibili，在新窗口打开）"`；aria 快照：`link "决赛演示（Bilibili，在新窗口打开）"`；主视频块名称：`link "2026 C4-AI 决赛演示视频 忆程 ProjectMemo · Bilibili · 新窗口打开"` |
| 2 | ≤720/≤380 关键文本 <12.8px | **PASS** | 候选 CSS 静态扫描：`home.module.css`/`HomeJourney.module.css`/`SiteHeader.module.css` 已无 <12.8px 声明（[json/after-static-inventory.json](json/after-static-inventory.json)）；实测 320 全页小字扫描 **0 条**；390/1440 均为 0；五步 Tab 标签 320=12.80px、360=12.80px；heroNote/lensKicker/lensRow dt/rowMeta/videoMeta/footerMeta 均 12.80px |
| 3 | 「先看一段示例」链接高 21.6px | **PASS** | 实测 86.4×**44.0**px（`home.module.css` `.closingLink` 已 `inline-flex + min-height:44px`） |
| 4 | 品牌/页脚品牌链接 <44px | 按 WCAG 2.5.8 例外记录（PASS） | 品牌链接 179.4×28.0、页脚品牌 148×25.5；均 ≥24px，且相邻目标间距 ≥24px（页头 justify-between、页脚 gap 24px），不满足项目 44×44 目标但属次要导航；项目 44 目标只针对主要操作（Lead 裁决） |

### 2.2 B3 新增滚动/进度/深度动效（Lead 消息第 1–4 条）

| # | 检查项 | 结果 | 实测 |
|---|---|---|---|
| 1 | 顶部阅读进度线 `[data-scroll-progress]` | **PASS** | 元素存在；`position:fixed; top:56px; height:2px; z-index:39`；`aria-hidden="true"`、`pointer-events:none`、`tabIndex=-1`、文本为空、不可聚焦、不在 Tab 序（键盘序列 32 步无它）；`transform: scaleX(0)→0.1972→0.9295` 随滚动变化；a11y 快照不含该元素 |
| 2 | 因果 rail 滚动进度 `[data-rail]` | **PASS** | `--rail-progress` 0.000→0.918→1.000；`[data-rail-step][data-active]` 从 0 增至 4（桌面）/3（320 中段）；`railProgress` 元素 `aria-hidden`、`pointer-events:none`、无文本；4 条步骤文本（label/title/text）在 320 与 720×450 下全部可见、完整、无重叠、无溢出；**reduced-motion**：`data-motion="reduced"`、`--rail-progress` 未设置 → 计算 `matrix(1,0,0,1,0,0)`（进度线满）、无过渡/动画、文字等价 |
| 3 | 章节 kicker 细线 `[data-draw]` | **PASS** | 5 个 `[data-draw]`，全部不可聚焦；仅 `::after` 伪元素装饰。正常模式未绘制时 `scaleX(0)`、进入视口后 `scaleX(1)`；reduced-motion / 无 JS 时 `::after` 计算 `transform:none`（完整细线），不影响任何文本 |
| 4 | Hero `translate` 深度 | **PASS** | 正常模式滚动后 `heroCopy translate: 0px 10px`、`heroLens translate: 0px -18px`（仅视觉位移，opacity=1、display=block）；320 宽滚动后 copy 1.9px / lens −3.42px；**Tab 顺序不变**（Hero CTA → 选中 stage tab → stage panel → 查看依据 → 回到原委托）；聚焦环 solid 2px、未被 overflow 祖先裁切；320 宽无横向溢出（scrollWidth=320） |
| 5 | 修复项复验 | **PASS** | `main tabIndex=-1` + skip link：Enter 后 `document.activeElement === main#main-content`、hash=#main-content、首行文本 top=120（1440）/77（390、720×450）> header bottom 57，**未被 sticky header 遮挡**；`main` 无 outline（`.home:focus{outline:none}`）；dialog `overflow:auto` 显式声明（`HomeJourney.module.css:585`）；账号页“返回官网” 12.8px/44px；页头 CTA 44px（1440/1024/768/390 全部 44px）；“等你确认”徽标 12.8px |
| 6 | 账号页回归 + reduced-motion 正文 | **PASS** | 账号页浅/深 × 1440/390：header 57px sticky、main top=57、无水平溢出、无首页样式泄漏（`main[class*=home-module]`、hero/lens/storyFrame 均不存在；正文链接 outline 未被 `.home` 作用域规则命中）；`prefers-reduced-motion` 下 `main[data-motion="reduced"]`，正文无 `display:none`/`opacity:0` 隐藏（隐藏列表为空），五步 5 状态全部 opacity=1、可见 |

---

## 3. 逐项结果（A11Y-01…A11Y-46）

状态：PASS / FAIL / NOT_SUPPORTED；括号内为关键测量值或证据引用。

| ID | 检查项 | 结果 | 关键证据 |
|---|---|---|---|
| A11Y-01 | 候选 SHA 与环境绑定 | PASS | HEAD=cc7c19f；`git status --porcelain -- app components` 为空；probe meta.sha=cc7c19f |
| A11Y-02 | 跳过链接 | PASS | 首 Tab 命中“跳到主要内容”（10,10 116×44，可见）；Enter 后 activeElement=main#main-content（tabIndex=-1）、hash=#main-content、scrollY=0；首行文本 top 120/77 > header 57，未遮挡；`main` scroll-margin-top=80px。观察：skip link 焦点环为 UA `auto 1px`（非项目 2px teal），截图可见 |
| A11Y-03 | 页头与首屏 Tab 顺序 | PASS | 顺序：跳到主要内容 → 品牌 → 产品体验 → 长期委托 → 使用场景 → 决赛演示 → 进入工作台 → 体验一段项目接续 → 进入工作台(次) → stage tab → stage panel → 查看依据 → 回到原委托 → summary…；除 skip link 外焦点环均为 `solid 2px` teal |
| A11Y-04 | 五步 Tab 键盘/ARIA | PASS | `role=tablist` “项目故事步骤” + 5×`role=tab`；roving tabIndex（选中 0，其余 −1）；ArrowRight→tab1、End→tab4、Home→tab0、ArrowLeft 回绕→tab4；panel `aria-labelledby` 跟随；选中态 color rgb(39,104,93)/border-bottom teal/weight 650 vs 未选中 muted/无边框/400 |
| A11Y-05 | Hero 三阶段 Tab 语义 | PASS | `role=tablist` “委托阶段：离开时、期间、回来后”；3×`role=tab` + `#stage-panel` `role=tabpanel` `aria-labelledby` 跟随；默认选中 `03回来后`；tabIndex 仅选中项为 0；选中项有可见选中样式 |
| A11Y-06 | Hero 三阶段键盘 | PASS | ArrowLeft/ArrowRight/End/Home 均改变选中并聚焦对应 tab；从 Hero CTA Tab 进入：选中 tab → stage panel → 查看依据 → 回到原委托 |
| A11Y-07 | 切换不抢焦点/不跳滚动 | PASS | 点击切换后 activeElement=被点击 tab（如 stage-tab-away）、scrollY 保持 0 |
| A11Y-08 | 切换不重复播报 | PASS | 页面无 `role=status`/`aria-live` 节点（切换前后均 0）；无逐帧播报 |
| A11Y-09 | 快速切换 20 次 | PASS | 20 次点击后 `aria-selected=true` 恰 1 个；最终面板文本与选中阶段一致；console 无错误；阶段动画 `lensRowsNext/lensRowsPrev` 240ms |
| A11Y-10 | dialog 可访问名称 | PASS | `aria-labelledby=source-title` → aria 快照 `dialog "任务安排"`，标题可见 |
| A11Y-11 | dialog 焦点进入/背景 inert | PASS | `dialog.matches(":modal")=true`；打开后焦点在“关闭原始记录”；连续 Tab 只在 dialog 与浏览器 chrome 间循环，不进入页面背景内容 |
| A11Y-12 | Esc/遮罩/关闭按钮 + 焦点返回 | PASS | 三条路径均关闭，activeElement 均回到触发按钮 `查看原文：任务安排` |
| A11Y-13 | dialog 长文内部滚动 | PASS | `overflow-y:auto`（显式 CSS）；720×450：clientHeight 400 / scrollHeight 479，`scrollTop` 可到 79；1440×900 内容 543/543 不裁切 |
| A11Y-14 | 回执 dialog 内容真实性 | PASS | “本页模拟记录/没有作为真实项目数据保存”，无虚假成功声明 |
| A11Y-15 | 主要操作 44×44 | PASS（次要链接按例外） | 页头 CTA 123×44（390 时 112×44）；Hero CTA 157×49/142×49；stage tabs 100.9×44 / 320 时 87.6×44；五步 tabs 54×60 / 360 时 62.5×60.4；上一步/下一步 44×44；查看原文 44 高；重置 44 高；依据展开 44 高；dialog 关闭 44×44；视频块 574×96；页脚外链 72×44。仅品牌链接 28px、页脚品牌 25.5px 未达 44（见 A11Y-19） |
| A11Y-16 | 决赛演示视频块触控目标 | PASS | 主视频块 574×96；页脚同名外链 72×44 |
| A11Y-17 | 上一步/下一步（移动端） | PASS | 320/360/390 均 44×44（B3 已从 40×44 修复） |
| A11Y-18 | 页头 CTA（701–1024 触屏） | PASS | 1024/768 均 44px 高（B3 从 40px 修复） |
| A11Y-19 | 品牌/页脚链接 WCAG 2.5.8 | PASS（间距例外） | 品牌 179.4×28.0（≥24）；页脚品牌 148×25.5（≥24）；相邻目标间距 24px，24px 圆不与其他目标相交 → 2.5.8 例外成立；项目 44×44 目标只针对主要操作 |
| A11Y-20 | 关键说明 ≥12.8px | **PASS**（`9bae926` 复验） | 1440/390/320/深色 全页扫描 0 条 <12.8px；第 3 步 judgment 区 <12.8px 文本 **0**（1440/390/320/深色 1440 均为 0）；6 类关键文本字号全部 **12.80px**（比较基线/待确认/依据 2 项/主判断摘要/变化文本/记忆·原文；对比度 5.10–14.22，深色 6.80–12.76）。证据 [json/f01-reverify-after.json](json/f01-reverify-after.json) |
| A11Y-21 | 示例/模拟披露字号 | PASS | 展开依据区 12.80–13.76px；hero lens “公开示例/冻结示例” 12.8px；`projectKicker` 12.8px |
| A11Y-22 | 功能文本字号 | PASS | 五步 Tab 标签 320/360=12.80px；账号页“返回官网”12.8px；“等你确认”徽标 12.8px；重置按钮 12.8px |
| A11Y-23 | 首屏入场动效 | PASS | `heroRise 620ms`，delay 40ms/140ms；动画中 opacity 0.894/0.683、translate 1.27/3.81px；结束后 opacity=1、transform 归零、无隐藏内容、无无限循环；`prefers-reduced-motion` 下 animationName=none、opacity=1 |
| A11Y-24 | 阶段切换动效 | PASS | `lensRowsNext/lensRowsPrev` 240ms + `data-direction`；文字不交叠、页面不整体跳动（scrollY 0） |
| A11Y-25 | reduced-motion 内容等价 | PASS | `data-motion="reduced"`；所有采样元素 transition 0s / animation none；`document.getAnimations()` 空；五步 5 状态 opacity=1 可见；Hero 三阶段键盘/快速切换正常且无动画；rail 进度线满、kicker 细线完整、hero translate none；scroll-behavior:auto |
| A11Y-26 | prefers-contrast: more | PASS | `.storyFrame/.storyContent/.lens/.videoLink/.sourceDialog` 边框 `#D9E1DB→#53645E`、阴影 none；`.railStep[data-emphasis]` 边框保持 ink；文本对比度不下降 |
| A11Y-27 | 图片/字体失败降级 | PASS | 阻断 logo.png + 3 个字体文件：品牌文字可见、h1 可见、Hero CTA 可见、无 loading 遮罩；首页已无 Hero 内容大图（仅 `alt=""` 的装饰 logo）；字体回退列表可读 |
| A11Y-28 | 无 JS 可读性 | **NOT_SUPPORTED** | 无 JS 时仅见 `main[aria-label="页面正在加载"]` 骨架（h1 不可见、body innerText 67 字符），正文在 hidden 流式块中；根因是 `app/loading.tsx` + 异步页面（框架级），非 B2/B3 引入；已记录为残余风险，不判回归 |
| A11Y-29 | 浅色主题文本对比度 | PASS | 1440：0 处 <4.5:1；320：0 处；关键文本最低 4.57（`待用户确认` 徽标，AA 达标） |
| A11Y-30 | 深色主题文本对比度 | PASS | `localStorage.theme=dark`：1440/390 均 0 处 <4.5:1；0 条 <12.8px。观察：首页/账号页无主题切换入口（toggle=0），系统深色首访仍为 light（`defaultTheme="light"`），深色仅对已保存偏好用户生效 |
| A11Y-31 | 320 无水平溢出 | PASS | 320/360/390/768/1024/1280/1440 全部 `scrollWidth==clientWidth`，无越界元素 |
| A11Y-32 | 200% 缩放（720×450）可用 | PASS | 无水平溢出；Hero/CTA/Tab 可达；dialog 内部可滚动（见 A11Y-13）；rail 文本完整无重叠；skip link 后首行未被遮挡；账号页表单可用 |
| A11Y-33 | 断点巡检 | PASS | [shots/](shots/) 含 320/390/720×450 等截图；主动作不裁切、不重叠 |
| A11Y-34 | 文字放大 200% | PASS | root font-size 32px：无水平溢出、无裁切元素；heroNote 26.88px、五步 Tab 26.24px 随字号放大 |
| A11Y-35 | 页内锚点不被 sticky header 遮挡 | PASS | `#experience/#missions/#moments/#demo` 均 `scroll-margin-top:80px`，落点 top=80，header bottom=57 → 23px 净空；直接访问与点击 CTA 一致 |
| A11Y-36 | 页脚“回到顶部” | PASS | 点击后 hash=#home-heading、scrollY=57、h1 top=110 可见（首行文本未被 header 遮挡） |
| A11Y-37 | 账号页页头渲染 | PASS | /login /register /forgot-password：header 57px sticky、nav“返回官网”、main top=57、无首页 hero/lens/storyFrame |
| A11Y-38 | 首页 CSS 不泄漏到账号页 | PASS | 账号页 `main` 为 auth 模块类、无 home 模块类；body 背景为 token `rgb(247,246,242)`（深色 `rgb(21,30,28)`）；`#main-content` 存在；正文链接 outline 未被 `.home` 规则命中 |
| A11Y-39 | 账号页移动端可用性 | PASS | 390 浅/深：无溢出、CTA 12.8px/44px、表单字段 2/4/1 个可见、label 关联存在。观察（既有、非本轮）：`auth.module.css` 帮助文本 11.52–12.48px（`.field > p`、`.help`、`.passwordToggle`），属主控/账号页既有样式 |
| A11Y-40 | 视频外链 accessible name | PASS | 主块 `2026 C4-AI 决赛演示视频 忆程 ProjectMemo · Bilibili · 新窗口打开`；页脚 `决赛演示（Bilibili，在新窗口打开）`；两者均含外部站与新窗口说明 |
| A11Y-41 | 外链 target/rel/键盘/焦点 | PASS | `target="_blank"`、`rel="noopener noreferrer"`；两个外链均在 Tab 序内；焦点环 `solid 2px rgb(39,104,93) offset:3px` |
| A11Y-42 | 加载不自动播放/不请求外部媒体 | PASS | 首页加载 27 个请求，外部 origin 请求 **0**；无 `video/audio/iframe`；无 bilibili 域名请求；无自动播放 |
| A11Y-43 | 结构与 ARIA | PASS（`9bae926` 复验） | 无标题层级跳跃、无重复 id、无失效 `aria-controls/aria-labelledby`；`lang=zh-CN`；viewport 允许缩放；装饰元素 `[data-scroll-progress]/[data-rail-progress]/[data-draw]` 均 aria-hidden 或纯伪元素且不可聚焦。`9bae926` 已为 Hero 工作包、五步示例框补 `role="group"`：aria 快照为 `group "公开示例：委托当前工作包"`、`group "参赛项目交互示例"`；`aria-label` 用于无 role 普通元素的扫描结果 **0**。关闭态 dialog 的空 `h3` 不在可访问树（既有，非缺陷） |
| A11Y-44 | 状态消息 | PASS | 重置后 `role=status` 出现“示例已重置，未修改任何个人项目。”且可见；切换 Tab 后清除；无逐帧播报 |
| A11Y-45 | 重复断点/级联复查 | PASS | 5 个候选 CSS 文件**每文件内无重复 `@media`**（此前基线 `home.module.css` 的重复 700px 已消除）；reduced-motion 覆盖新动效（实测无动画）；prefers-contrast 覆盖新容器；prefers-reduced-transparency 规则存在 |
| A11Y-46 | 证据与复现完整性 | PASS | 脚本可重跑、JSON/截图/SHA/命令齐全；[MANIFEST.sha256](MANIFEST.sha256)；本报告无“真实用户测试/认证”宣称 |

---

## 4. 已关闭问题：F-01（MINOR，`cc7c19f` 发现 → `9bae926` 修复 → 复验 PASS）

### F-01 五步第 3 步“判断与建议”内 11–12px 文本

- **位置（发现时）**：共享组件 [components/StateDiffView.tsx](../../../../../../components/StateDiffView.tsx)（Tailwind `text-xs`=12px / `text-[11px]`=11px），渲染在首页五步 Demo 第 3 步 `#story-panel` 的 `.judgmentPane` 内。
- **`cc7c19f` 实测（1440，第 3 步）**：

| 文本 | 计算字号 | 选择器（实测路径） | 行 |
|---|---|---|---|
| 比较基线：已有记录 → 本页核对 | **12.00px** | `#story-panel .judgmentPane p.mb-2.break-all` | StateDiffView.tsx:25 |
| 待确认（状态标签） | **11.00px** | `.judgmentPane ul li span.rounded-md.bg-[var(--paper-strong)]` | :31 |
| 依据 2 项 | **12.00px** | `.judgmentPane ul li span.text-xs.font-bold` | :32 |
| 演示流程的当前完成情况还需要核对（**主判断摘要**） | **12.00px** | `.judgmentPane ul li p.mt-1.5.text-xs` | :34 |
| 已有任务记录，但没有新的完成回执；当前状态待确认 | **12.00px** | `.judgmentPane ul li p.mt-1.text-xs > span.font-bold` | :35 |
| 记忆 · 原文（证据类型标签） | **11.00px** | `.judgmentPane ul li p.mt-1.5.flex span.rounded` | :41 |

- **修复（`9bae926`，`components/HomeJourney.module.css:844-851`）**：首页作用域覆盖 `.judgmentPane [class~="text-xs"]`、`.judgmentPane [class~="text-[11px]"]` → `font-size:0.8rem`；共享 `StateDiffView.tsx` 未改，C 轨页面不受影响。
- **复验（PASS）**：1440/390/320/深色 1440 第 3 步 `#story-panel` 内 <12.8px 文本 **0**；上述 6 类文本字号全部 **12.80px**；对比度 5.10–14.22（浅）/ 6.80–12.76（深）；judgment 区无水平溢出。证据 [json/f01-reverify-after.json](json/f01-reverify-after.json) 与截图 `shots/after-f01-judgment-1440x900.png`、`after-f01-judgment-390x844.png`、`after-f01-judgment-320x640.png`、`after-f01-judgment-dark-1440.png`。
- **状态**：**CLOSED（修复并复验通过）**。

---

## 5. 残余风险与限制（不阻塞本轮签收）

1. **无 JS 时首页不可读（A11Y-28 NOT_SUPPORTED）**：根 `app/loading.tsx` + 异步 `Home()` 使初始 HTML 为骨架、正文在 hidden 流式块中，需 JS 替换。属框架级既有行为，非 B2/B3 引入；若要求无 JS 可读，需移除/改造根 loading 或改为非流式渲染（超出 B 文件所有权，登记风险）。
2. **深色主题可达性**：首页与账号页无主题切换按钮，`ThemeProvider defaultTheme="light"` 忽略系统深色；深色对比度仅对已保存偏好用户生效（对比度本身 0 失败）。
3. **skip link 焦点环**：使用 UA 默认 `auto 1px`，未套项目 2px teal 规则；截图可见但视觉一致性弱（MINOR 观察）。
4. **dialog 单一可聚焦元素**：仅有关闭按钮时，Tab 会在 dialog 与浏览器 chrome 间循环（原生 modal 行为，背景 inert，未进入页面内容）；如需完整焦点陷阱需额外实现（当前不违反 WCAG）。
5. **账号页既有小字**：`auth.module.css` 的 `.field > p`(11.52px)/`.help`(11.52px)/`.passwordToggle`(11.68px)/`.resendLink`(11.2–12.48px) 仍 <12.8px；属账号页既有样式（主控/公共入口），非本轮 B3 改动，未纳入 FAIL。
6. **ARIA 观察（已部分关闭）**：`9bae926` 已为 2 个普通 div 补 `role="group"`（A11Y-43 复验 PASS，`aria-label` 误用扫描为 0）；装饰符号“✓/?”由相邻文本覆盖（既有，低风险）。
7. 本审计为自动化 DOM/计算样式取证：**未**做 NVDA/JAWS/VoiceOver 人工验证、未做真实用户测试、未做无障碍认证；dev server 为 mock/隔离空库/无 Worker 环境。

---

## 6. 复现命令

```powershell
cd D:\Projects\hongmen-final-b-brand-home
# 确认最终冻结候选
git rev-parse HEAD          # 9bae926e9475cedef118deedf5e002ec8365a23b
git status --porcelain -- app components   # 空
# 主探针（约 2.5 分钟）
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-a11y.mjs `
  --base http://127.0.0.1:34111 --label after --sha 9bae926e9475cedef118deedf5e002ec8365a23b
# 补充探针（判断页小字/展开依据/字体放大/320 滚动/尺寸）
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-supplement.mjs `
  --base http://127.0.0.1:34111 --label after --sha 9bae926e9475cedef118deedf5e002ec8365a23b
# F-01 复验（第 3 步 judgment 字号 × 1440/390/320/深色 + role=group）
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-f01-reverify.mjs `
  --base http://127.0.0.1:34111 --label after --sha 9bae926e9475cedef118deedf5e002ec8365a23b
# 候选 CSS 静态扫描（断点重复/小字号/焦点/偏好媒体/触控声明）
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/inventory-after.mjs `
  --sha 9bae926e9475cedef118deedf5e002ec8365a23b
```

## 7. 证据文件

- 主探针 JSON：[json/probe-after.json](json/probe-after.json)（`meta.sha=9bae926`，0 error）
- 补充探针 JSON：[json/supplement-after.json](json/supplement-after.json)
- F-01 复验 JSON：[json/f01-reverify-after.json](json/f01-reverify-after.json)（judgment 字号 × 1440/390/320/深色 + `role=group` 可访问名）
- 候选 CSS 静态扫描：[json/after-static-inventory.json](json/after-static-inventory.json)
- 截图：[shots/](shots/)（`after-*` 前缀；F-01 对应 `after-f01-judgment-*.png`、`after-judgment-step.png`；另含 `after-scroll-motion-normal/reduced.png`、`after-rail-320x640.png`、`after-hero-scroll-320.png`、`after-font-zoom-200.png`、`after-account-*-1440/390.png`、`after-dark-1440/390.png`、`after-dialog-*`、`after-no-js.png` 等）
- 哈希清单：[MANIFEST.sha256](MANIFEST.sha256)
