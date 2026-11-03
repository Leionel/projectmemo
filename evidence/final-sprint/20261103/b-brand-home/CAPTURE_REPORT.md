# CAPTURE_REPORT — Track B 官网证据采集（task-4）

- 工作树：`D:\Projects\hongmen-final-b-brand-home`（分支 `codex/final-b-brand-home`）
- 源码基线：`485d485378637e1da3280ed092739d441c8cf749`
- 证据根目录：`evidence/final-sprint/20261103/b-brand-home/`
- 采集执行者：evidence-runner（只写证据文件；未修改 app/components/lib/e2e/tests/package.json，未 commit/push）
- 服务：Lead 提供的本地 Next dev `http://127.0.0.1:34111`（隔离 mock：LLM_MODE=mock、空库 `prisma/final-preparation.db`、无 Worker、无 seed；未重启/未另起服务）
- 本机环境：Windows 11（win32 10.0.26300，x64）、Intel Core i7-14700HX ×28、内存 15.78 GiB、Node v24.16.0、Chromium via @playwright/test 1.61.1（headless，deviceScaleFactor=1，locale zh-CN，Asia/Shanghai）、网络=本机回环 localhost。**性能/体积类数字只代表本机本地环境，不宣称代表所有用户体验。**

本文件由证据采集员维护。Lead 的 `B1_COMPARISON.md`、`RECEIPT*.md` 等文件不在此覆盖范围内。

---

## Phase 0 — before 基线（已完成）

状态：**DONE**（6/6 截图已生成并逐张人工查看）

### 采集协议

viewport 固定 1440×900 / 1280×720 / 390×844；每宽 light+dark（含 1280 dark）；`localStorage.setItem('theme', theme)` 后 `reload`；等待 `#home-heading` 可见、`documentElement` 获得对应主题类（light/dark）、`document.fonts.ready`、入场动画 settle；`scrollY=0`；只截页顶（`fullPage:false`）。
脚本：`tools/capture-phase0.mjs`；运行日志：`before/capture-run.log`；源码完整性快照：`before/integrity-at-capture.json`。

### 截图矩阵与关键指标

| 文件 | 字节 | sha256（前 12） | html class | body 背景 | scrollWidth/innerWidth | 水平溢出 | h1 bbox (y–bottom) | 主 CTA bbox | 工作区图 bbox | 字体 | 破图 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `before/homepage-1440-light-before.png` | 248,341 | df4e99cf848e | light | rgb(247,246,242) | 1440/1440 | 否 | 168.6–330.5 | 942,241.9–290.4（156.8×48.5） | 130,362.5–1012.2（1180×649.7） | loaded | 0 |
| `before/homepage-1440-dark-before.png` | 247,034 | 0f5545244d77 | dark | rgb(21,30,28) | 1440/1440 | 否 | 168.6–330.5 | 942,241.9–290.4 | 130,362.5–1012.2 | loaded | 0 |
| `before/homepage-1280-light-before.png` | 173,519 | 117451299cda | light | rgb(247,246,242) | 1280/1280 | 否 | 186.6–330.5 | 942,241.9–290.4 | 130,362.5–1012.2 | loaded | 0 |
| `before/homepage-1280-dark-before.png` | 172,754 | 99d46dcc5246 | dark | rgb(21,30,28) | 1280/1280 | 否 | 186.6–330.5 | 942,241.9–290.4 | 130,362.5–1012.2 | loaded | 0 |
| `before/homepage-390-light-before.png` | 99,130 | 83aa6e45a4f5 | light | rgb(247,246,242) | 390/390 | 否 | 125.0–209.1 | 24,312.0–360.0（156.8×48.0） | 24,419.1–917.5（354×498.5） | loaded | 0 |
| `before/homepage-390-dark-before.png` | 98,889 | c3a42dc5a22a | dark | rgb(21,30,28) | 390/390 | 否 | 125.0–209.1 | 24,312.0–360.0 | 24,419.1–917.5 | loaded | 0 |

- 页面 `title` 六次一致：`忆程 ProjectMemo｜个人项目 Agent`；h1 一致：`项目隔了几天， 再打开也接得上。`
- 主题确实生效：light `html.className=light` / dark `html.className=dark`，body 背景分别 `rgb(247,246,242)` / `rgb(21,30,28)`。
- 六次均 **无水平溢出**（`documentElement.scrollWidth == window.innerWidth`），无元素越界（overflowers=0），无破图（2 张图：`/logo.png`、工作区 jpg 均 complete 且 naturalWidth>0）。
- 字体：`document.fonts.status=loaded`；本地 `PM Brand`、`PM Editorial` 均 loaded；`document.fonts.check('12px "PM Brand"')=true`；无外部字体域请求。
- 首屏结构（1440×900）：header 高 57px；hero section 高 1003px（57–1060），工作区大图 362–1012，**底部越过 900px 视口约 112px**，figcaption 不在首屏；主 CTA 位于右栏 y≈242–290。1280×720 同构。390×844：单列，CTA y≈312–360，工作区图 419–917（底部越出视口约 74px），首屏以“大标题 + 说明 + 双 CTA + 工作区图上半部”为主。
- 结论（仅视觉事实，不做方案裁决）：基线首屏由**整幅工作区大图**主导，未呈现“离开—期间—回来”的当前工作包叙事；Hero 主视觉是静态 jpg（深色主题下图片本身仍为浅色 UI，属素材属性，非渲染失败）。

### 逐张人工查看记录（read_image 实看）

- 1440 light：顶部营销页头（忆程 ProjectMemo / 产品体验 / 长期委托 / 使用场景 / 进入工作台）；左栏大标题两行、右栏说明与双 CTA；下方工作区截图卡片（含“忆程工作区 / 内置示例项目”工具栏），卡片内容为项目概览与“发现尚未闭环的项目风险”。左下角可见 Next dev 工具按钮“N”（dev-only 覆盖物）。
- 1440 dark：深墨背景、浅色文字与浅色 CTA 正常；工作区截图仍为浅色 jpg；其余与 light 一致。
- 1280 light/dark：布局同 1440（左标题右说明+CTA），工作区图在首屏下半部被视口裁切，属页顶截图预期。
- 390 light/dark：移动端隐藏桌面导航，仅品牌 + “进入工作台”；单列标题、说明、双 CTA 并排；下方为移动版工作区图（workspace-mobile.jpg）上半部。无横向滚动条、无文字被裁。

### 网络审计（`before/network-baseline.json`）

- 采集窗口：warmup + 6 次 reload，共 **186 条请求记录 / 28 个唯一 URL**。
- **非 127.0.0.1 origin：0 条**（全部本机回环）。
- **/api 写请求（method≠GET）：0 条**；无模型调用、无业务库写入迹象。
- **图片/字体失败：0**；所有 document/image/font 响应 200（或 304 缓存重验）。
- 请求构成：`/`（document 200）、21 个 Next dev 静态 chunk（HMR/dev-only）、`/logo.png`、`/home/workspace-desktop.jpg`、`/home/workspace-mobile.jpg`、本地字体 `/fonts/pm-serif-brand.ttf`、`/fonts/pm-editorial-serif.ttf`、`/__nextjs_font/geist-latin.woff2`（本机服务）。
- 失败 2 条（良性）：`capture-1440-dark` 期间 2 条 `GET /?_rsc=…`（fetch）`net::ERR_ABORTED`，为 reload 打断进行中的 RSC 预取；文档请求本身 200，非图片/字体/页面失败。
- console error 0、page error 0。

### 完整性/并发说明

- 采集时 `git rev-parse HEAD` = 基线 `485d485`；`app/page.tsx`、`app/layout.tsx`、`app/home.module.css`、`components/SiteHeader.tsx` mtime 均为基线检出时间 10:56:33，before 采集期间未被改写；`next-env.d.ts` 为工具自动生成修改。
- 采集期间另一实施者在同树并发新增**未跟踪**文件：`components/home/`（homeExample.ts、prototype.module.css、PrototypeHeroA/B.tsx，11:41:59）与 `app/prototype/hero-a|hero-b/page.tsx`（11:41:44）。这些属于 B1 原型工作，不影响 `/` 首页基线截图；Phase 2 采 after 前须复核首页文件的新 SHA。
- 首页 `/` 的 header 由 `SiteHeader` 在 pathname==='/' 时渲染营销页头，不渲染 layout 的“演示模式”徽标；因此 `headerBadge=null` 属预期，provider 模式由环境说明 + 网络审计（0 模型调用）佐证，不用截图冒充。

### 本阶段文件清单

| 路径 | 说明 |
|---|---|
| `before/homepage-{1440,1280,390}-{light,dark}-before.png` | 6 张 before 截图（1440/1280/390 × light/dark） |
| `before/metrics/homepage-<w>-<theme>.json` | 每张截图的完整指标（主题类、标题、h1、scrollWidth/innerWidth、溢出扫描、首屏元素 bbox、字体状态、图片状态、网络摘要） |
| `before/network-baseline.json` | 全量请求/响应/失败、外域、写请求、图片字体失败、console/page error |
| `before/MANIFEST.json` | 矩阵、文件大小与 sha256、环境、协议、异常、caveats |
| `before/capture-run.log` | 采集运行输出 |
| `before/integrity-at-capture.json` | 采集时 HEAD/分支/脏文件快照 |
| `tools/capture-phase0.mjs` | Phase 0 采集脚本（可重跑） |
| `tools/probe-header-badge.mjs` | 顶部徽标可见性一次性诊断（解释 headerBadge=null） |

### Phase 0 异常/限制

- 截图左下角含 Next dev 工具按钮“N”（开发模式覆盖物，非产品 UI）；before/after 同一 dev 环境，保持一致，报告中注明。
- Next dev 资源（21 个 dev chunk）不代表生产构建体积；生产体积/性能在 Phase 2 用同一环境口径记录并注明“本机、本地回环、非生产构建”。
- 深色主题只改变页面 chrome，不改变静态工作区 jpg（素材为浅色截图）。

---

## Phase 1 — 两款 Hero 原型对照（已完成）

状态：**DONE**（8 张主图 + 5 张交互图，13/13 已逐张 read_image 实看）
路由：`/prototype/hero-a`（原委托四问工作包，默认“回来后”）、`/prototype/hero-b`（来源变化→判断变化→等你，默认完整链）。产出目录 `b1/`；脚本 `tools/capture-phase1.mjs`；运行日志 `b1/capture-run.log`。

### 源码状态与提交说明

- 基线 `485d485`；B1 原型源码已由 Lead 提交为 **`4be7a4b`「官网：B1 两款 Hero 原型与信息结构裁决」**（提交时间 2026-11-03 11:50:05 +08:00）。原型文件 mtime 11:40:35–11:41:59，Phase 1 两轮采集（约 11:48:30 与 11:50:49–11:51:07）期间原型源码未再改动，两轮截图对应同一源码内容。
- Lead 的 `4be7a4b` 提交包含 Phase 1 第一轮快照；第二轮（去除 dev “Compiling…” 覆盖物、新增 `-evidence-full` 辅助视图、补解释字段与 `metrics/summary.json`）发生在提交之后，**当前工作树中的 b1 证据较该提交更新，需重新暂存/提交**。
- 并发改动：B2 首页工作在原型采集后开始（`components/SiteHeader.tsx` 11:51:38、`components/HomeJourney.tsx` 11:52:30 有改动）；原型页 pathname 非 `/` 时 SiteHeader 透传 layout header，两原型页不受首页营销页头改动影响。

### 同条件说明（fair）

- 同一 dev server、同一浏览器/视口/主题/等待条件；两页使用同一套 app 全局 header（pathname 非 `/` 时 SiteHeader 透传 layout header，两页完全相同），顶部均有相同的“B1 隔离原型 A/B · 仅本地对照”小字（仅字母 A/B 不同）。
- 同一套示例素材（`components/home/homeExample.ts`）、同一 h1「人可以下线，项目别掉线。」、同一副标题、同一双 CTA 文案、同一“公开示例·不调用模型·不写入你的项目”说明。
- 默认态：A=“03 回来后”；B=完整四步链（无阶段切换）。
- 协议：`localStorage.setItem('theme', theme)` 后 reload；等 h1 可见、主题类生效、`document.fonts.ready`、动画 settle、scrollY=0；截整视口（1440×900 / 390×844）非全页。截图前等待 Next dev 覆盖物（“Compiling…”）消失。

### 8 张主图与关键指标

| 文件（`b1/screens/`） | 字节 | sha256（前 12） | class | 水平溢出 | 默认选中 Tab | lens 文字量 | panel 文字量 | hero 文字量 |
|---|---|---|---|---|---|---|---|---|
| `proto-a-1440-light.png` | 111,190 | 359808cfe7d3 | light | 否 | 03 回来后 | 208 | 131 | 330 |
| `proto-a-1440-dark.png` | 106,453 | a63e09a7fcb9 | dark | 否 | 03 回来后 | 208 | 131 | 330 |
| `proto-a-390-light.png` | 51,746 | fee4064291f0 | light | 否 | 03 回来后 | 208 | 131 | 330 |
| `proto-a-390-dark.png` | 51,234 | 7f765d268785 | dark | 否 | 03 回来后 | 208 | 131 | 330 |
| `proto-b-1440-light.png` | 120,162 | 98a492653f87 | light | 否 | —（无 Tab） | 271 | 207 | 393 |
| `proto-b-1440-dark.png` | 115,108 | 1377b614357f | dark | 否 | — | 271 | 207 | 393 |
| `proto-b-390-light.png` | 57,113 | d37186065a43 | light | 否 | — | 271 | 207 | 393 |
| `proto-b-390-dark.png` | 56,333 | aa7f80365aff | dark | 否 | — | 271 | 207 | 393 |

- 13 个状态全部 **无水平溢出**（scrollWidth == innerWidth），无元素越界；`title` 分别为「B1 原型 A｜原委托四问工作包」「B1 原型 B｜来源变化因果镜头」；`document.fonts.status=loaded`，PM Brand/PM Editorial 本地字体 loaded，无外部字体域。
- 主题生效：light/dark 的 `html.className` 与 body 背景（rgb(247,246,242) / rgb(21,30,28)）正确，两主题布局一致。
- header：1440 可见“演示模式”徽标（mock 环境佐证）；390 移动端折叠后不可见（badge=null 属预期）。
- 首屏结构：1440 下两页左文案+右工作包卡均在 900 视口内（A 卡 148.8–719.8，B 卡 148.8–786.0）；390 下工作包卡自 y=439 开始、A 卡 bottom=1107 / B 卡 bottom=1215，**均越过 844 视口**，首屏只见卡片顶部（A 见 Tab+四问开头，B 见 01 来源+chips 顶部）。
- 公平性：B 可见文字量比 A 多——hero 区 393 vs 330（+63）、右卡 271 vs 208（+63）、主内容 207 vs 131（+76）。差异来自信息组织（A 四问紧凑、B 四步因果链），非刻意拉大文案量；比较时需连同结构一起看。

### 交互图与状态记录（1440 light）

| 文件（`b1/screens/`） | 字节 | 状态 | 关键指标 |
|---|---|---|---|
| `proto-a-1440-light-during.png` | 110,235 | A 点击“02 期间”后 | `aria-selected` 切到 `proto-a-tab-during`（02 期间）且唯一选中；panel 可见文字 131→129 字且内容变化（任务身份不变 / 冻结的示例状态，不连接服务器 / 发现缺口…）；焦点留在被点 Tab；scrollHeight 930 |
| `proto-a-1440-light-evidence.png` | 117,762 | A 回“回来后”展开“查看依据”后 | 按钮 `aria-expanded=true`、文本变“收起依据”；`#proto-a-evidence` 可见，panel 文字 131→314；依据面板 bbox y=669.9–935.3（高 265.4），**bottom 超出 900 视口 35px（scrollY=0 下被裁）**；焦点留在触发按钮 |
| `proto-a-1440-light-evidence-full.png` | 119,408 | A 依据辅助全览（scrollY=60） | 辅助视图，使三条原文完整可见；主对照仍以 scrollY=0 的 `-evidence.png` 为准 |
| `proto-b-1440-light-evidence-materials.png` | 121,150 | B 点开“比赛材料”原文后 | `#proto-b-source-requirements` 可见（63 字），chip `aria-expanded=true`；panel 文字 207→273；行内引用面板 bbox y=361.4–466.2 完整可见；焦点留在 chip |
| `proto-b-1440-light-evidence-task.png` | 121,601 | B 点开“任务安排”原文后 | `#proto-b-source-task` 可见（71 字），chip `aria-expanded=true`，前一 chip 收起；panel 文字 273→281；焦点留在 chip |

- 两页交互均只改变页面本地 state，无网络写请求；点击不产生导航（除 CTA/锚点外）。
- 布局位移（用户触发重排，非自动动画）：展开依据/原文会拉高右栏，左栏文案在网格中垂直居中随之位移——A 依据展开 h1 下移 +139.9px，B 原文展开 h1 下移 +57.2px；B 展开后卡片 bottom=900.3，基本贴视口下缘。
- 触控目标：A 的 Tab/查看依据/回到原委托 44px、CTA 48px（390 时 CTA 46px）；B 桌面 chips 高 **40px（低于项目 44×44 目标）**，390 时 44px。此为 B3 需关注项。

### 逐张人工查看记录（read_image 实看，13/13）

- A 1440 light/dark：左侧大标题与双 CTA，右侧四问工作包卡（01 离开时 / 02 期间 / 03 回来后 Tab，默认“回来后”）；四问行“变化”“等你”有暖色强调底，“等你确认”徽标在卡右上；底部“查看依据 / 回到原委托”与“与下方五步示例使用同一份素材·本页交互不调用模型”。深浅主题均正常，无低对比/串色。
- A 390 light/dark：单列，品牌 + 汉堡菜单 header；“B1 隔离原型 A”小字 → 标题 → 说明 → 双 CTA → 边界说明 → 工作包卡（Tab 与四问开头可见，其余在首屏下）。
- B 1440 light/dark：右侧为四步因果链 01 来源（3 个 chips）→ 02 变化（强调节点）→ 03 判断改变（原来/现在对照）→ 04 等你；原文 chips 行内展开引用面板。深浅主题均正常。
- B 390 light/dark：单列；chips 换行为 2+1；首屏同样只到 01 来源/02 变化开头。
- 交互图：A during 显示“02 期间”选中态与冻结示例文案；A evidence 显示三条原文（scrollY=0 时第三条详情被视口裁掉，另有 full 视图补全）；B materials/task 分别显示“比赛材料”“任务安排”引用面板与对应 chip 展开态。
- 肉眼问题：① 左下角 Next dev 工具“N”为 dev-only 覆盖物，390 时覆盖面板左下文字；② 展开依据时左栏明显下移（+139.9px）；③ A 依据面板在 1440×900 页顶视图被裁 35px；④ 390 首屏看不到工作包主体内容；⑤ B 桌面 chips 40px 高偏小。以上均记入 `b1/MANIFEST.json` 的 `interpretation`/`visualReview`。

### 网络审计（`b1/network-proto.json`）

- 采集窗口：20 次文档加载（10 次 goto + 10 次 reload）+ 交互，共 **590 条请求记录 / 29 个唯一 URL**。
- **非 127.0.0.1 origin：0 条**；**/api 写请求（method≠GET）：0 条**；无模型调用。
- **图片/字体失败：1 条**（`/fonts/pm-editorial-serif.ttf` 在 reload 打断旧页面加载时 `net::ERR_ABORTED`；重载后字体 loaded，页面字体渲染正常）——属导航打断，不是资源缺失。
- 失败/报错解释：99 条 failures 全部是 fetch —— 74 条 `GET /api/auth/me` 401（匿名访客预期，非写请求）+ 21 条导航打断的 RSC/静态资源 `ERR_ABORTED` + 4 条 401 且被中断；console error 78 条均为该 401 的资源加载提示（浏览器对 401 的控制台记录），无 page error。
- 观测：每次页面加载约 4–5 次 `GET /api/auth/me` 401（存在重复匿名探测）；不阻塞页面，header 正确显示“登录”。
- 资源：`/logo.png`、本地字体 2 个、`/__nextjs_font/geist-latin.woff2`、dev 静态 chunk（dev-only）；无图片失败、无外域。

### 本阶段文件清单

| 路径 | 说明 |
|---|---|
| `b1/screens/proto-{a,b}-{1440,390}-{light,dark}.png` | 8 张同条件主图 |
| `b1/screens/proto-a-1440-light-{during,evidence,evidence-full}.png` | A 交互 3 张 |
| `b1/screens/proto-b-1440-light-evidence-{materials,task}.png` | B 交互 2 张 |
| `b1/metrics/*.json` | 13 个状态指标（aria-selected、panel 文字前 80、依据可见性、溢出、bbox、字体、目标尺寸等） |
| `b1/phase1-metrics.json` | 汇总 + 公平性文字量 + 交互解释 + 源码状态 |
| `b1/metrics/summary.json` | B1_COMPARISON.md 引用的两款文字量与关键差异汇总（A/B 文字量、默认态、交互、布局、目标尺寸） |
| `b1/network-proto.json` | 网络审计（外域/写请求/失败/console） |
| `b1/MANIFEST.json` | 文件清单、sha256、同条件说明、解释与视觉复核 |
| `b1/capture-run.log` | 采集运行输出 |
| `tools/capture-phase1.mjs` / `tools/patch-phase1-metrics.mjs` | 采集与汇总修正脚本 |

---

## Phase 2 — after 六图、断点/缩放、滚动动效、状态图、录屏、性能取证（已完成，最终候选 9bae926）

状态：**DONE**（最终候选 SHA `9bae926e9475cedef118deedf5e002ec8365a23b`，`git status --porcelain -- app components` 为空；dev server 服务该状态）

**SHA 绑定说明**：全部截图/录屏采集于 `cc7c19f`（12:31–12:40，当时树干净）；Lead 确认最终候选为 `9bae926`（= cc7c19f + 终验修复：`.judgmentPane` 作用域字号覆盖 + 两个 `role="group"`，均不改变已采状态）。第 3 步判断页已按 `9bae926` 定向补拍验证。
说明：对 `0a09a2e` 与 `216cf05` 及中间态的采集**一律作废**，本目录 after/ 与 b3/ 已全部在 `cc7c19f` 下重跑覆盖，不混用。
**采集后源码变动（证据边界，已由 Lead 收口）**：全部截图/录屏在 12:31–12:40 完成，采集时 `git status` 仅证据目录未跟踪（干净，HEAD=cc7c19f）。12:40:44 之后出现的改动——`components/home/HomeHeroLens.tsx`（+`role="group"`）、`components/HomeJourney.module.css`（第 3 步“查看判断”StateDiffView 的 11–12px 元数据提升到 12.8px）、`components/HomeJourney.tsx`——已由 Lead 提交为 **9bae926「B3 终验修复」**。本目录证据采集于 `cc7c19f`，经 Lead 确认绑定到 `9bae926`（上述改动不影响已采状态）；第 3 步判断页已按 `9bae926` 定向补拍 `b3/states/judgment-step-1440-light.png` 直接验证 12.8px。详见 `after/integrity-at-capture.json` 的 `binding` 字段。
脚本：`tools/capture-phase2-after.mjs`（after 六图 + Hero 状态 + 滚动动效 + 性能/资源）、`tools/capture-phase2-b3.mjs`（断点/缩放、rail-390、状态、录屏）、`tools/finalize-phase2.mjs`（汇总收口）、`tools/phase2-lib.mjs`；日志 `after/capture-run.log`、`b3/capture-run.log`。

### after 六图（1440/1280/390 × light/dark，页顶 scrollY=0）

| 文件（`after/`） | 字节 | class | scrollWidth/innerWidth | 水平溢出 | heroCopy top | 最小可见字号 | <img> |
|---|---|---|---|---|---|---|---|
| `homepage-1440-light-after.png` | 119,851 | light | 1440/1440 | 否 | 111.72 | 12.8px | 1（logo） |
| `homepage-1440-dark-after.png` | 115,298 | dark | 1440/1440 | 否 | 111.72 | 12.8px | 1（logo） |
| `homepage-1280-light-after.png` | 101,268 | light | 1280/1280 | 否 | 105.63 | 12.8px | 1（logo） |
| `homepage-1280-dark-after.png` | 97,113 | dark | 1280/1280 | 否 | 105.63 | 12.8px | 1（logo） |
| `homepage-390-light-after.png` | 65,248 | light | 390/390 | 否 | 77.00 | 12.8px | 1（logo） |
| `homepage-390-dark-after.png` | 64,880 | dark | 390/390 | 否 | 77.00 | 12.8px | 1（logo） |

- 六图均无水平溢出、无破图；页面唯一 `<img>` 是 header 品牌 logo `/logo.png`（无产品截图/内容图，B2 已移除整幅工作区大图）。
- 字体：`document.fonts.status=loaded`，本地 PM Brand / PM Editorial 均加载，无外部字体域。

### 字号取证（回应 B3 字号要求，1440 light 计算值）

| 元素 | 计算字号 | 元素 | 计算字号 |
|---|---|---|---|
| lensKicker | 12.8px | lensFoot | 12.8px |
| rowMeta | 13.12px | heroNote | 13.44px |
| storyFooter | 12.8px | paneHeading | 15.2px |
| railLabel | 12.8px | railText | 15px |
| sectionKicker | 13.12px | boundary | 14.4px |
| videoMeta | 13.44px | footerMeta | 13.12px |

- **最小可见字号 = 12.8px（六图与全部断点一致，含 390/360/320）**；12.8px 样本为“公开示例 · 不调用模型 · 不写入你的项目。”等说明文字。原 0.65rem/0.7rem/0.72rem 元数据在 `cc7c19f` 已全部消除；`closingLink` 另加 44px 最小触控高度。

### Hero 状态（1440 light，同页面状态链）

| 状态 | 文件 | 关键指标 |
|---|---|---|
| 默认“03 回来后” | `after/homepage-1440-light-after.png` | 选中 tab `stage-tab-back`，panel 144 字 |
| 切“02 期间” | `b3/hero-states/hero-during.png`（117,615B） | `aria-selected` 切到 `stage-tab-during` 且唯一选中；panel 144→130 字且内容变化（任务身份不变 / 冻结示例不连接服务器 / 发现缺口）；焦点留在 Tab |
| 回“回来后”+ 展开依据 | `b3/hero-states/hero-evidence.png`（125,826B） | 按钮 `aria-expanded=true`；`#hero-evidence` 可见，panel 144→325 字；依据面板 bottom=868.27，**完整在 900 视口内**；焦点留在触发按钮 |

- **左栏 top 不变**：默认与展开依据时 `heroCopy.y` 均为 **111.72**，delta=0.00（与 Lead 要求“应恒为 112 左右”一致；216cf05 起不再像 B1 那样随右栏拉高而下移）。

### 216cf05/cc7c19f 新增滚动动效（已入镜 + 运行时数值）

| 动效 | 证据 | 运行时指标 |
|---|---|---|
| 顶部阅读进度线（固定页头下 56px） | `b3/hero-states/scroll-progress-mid.png`（89,390B） | `[data-scroll-progress]` bbox y=56、高 2px；scrollY=1506 时 `transform: matrix(0.45,0,0,1,0,0)`（=页面滚动进度 45%），`data-visible=true`；scrollY=0 时 scaleX=0 |
| 01 节 rail 进度（桌面横向） | `b3/rail-1440-mid.png`（102,568B） | `--rail-progress=0.5`；进度线 `matrix(0.5,0,0,1,0,0)`；active 圆点 **2 个**（来源、变化）；滚动进度线 scaleX≈0.14 |
| 01 节 rail 进度（390 竖排，左侧纵向） | `b3/rail-390-mid.png`（49,040B） | `--rail-progress=0.5`；纵向进度线 `matrix(1,0,0,0.5,0,0)`，bbox 高 268.2 / rail 高 536.4；active 圆点 **2 个**（来源、变化） |
| 章节 kicker 细线首次入视口展开 | `b3/hero-states/kicker-draw.png`（91,576B） | 01 kicker `data-drawn=true`、`::after transform: matrix(1,0,0,1,0,0)`；02–05 kicker 仍为 scaleX=0（首次进入才展开） |
| Hero 轻微深度离场 | `b3/hero-states/hero-depth-exit.png`（117,090B） | scrollY=180 时 `--hero-shift=0.320`；copy `translate: 0px 3.2px`、lens `translate: 0px -5.76px`；copy/lens 的 `offsetTop` 与 scrollY=0 时一致 → **布局不变，仅合成层位移** |

### 断点 / 200% 缩放巡检（浅色）

| 视口 | 文件（`b3/breakpoints/`） | 字节 | 水平溢出 | 标题裁切 | CTA 裁切 | CTA 首屏可见 |
|---|---|---|---|---|---|---|
| 1024×768 | `1024x768.png` | 97,327 | 否 | 否 | 否 | 是 |
| 768×1024 | `768x1024.png` | 86,322 | 否 | 否 | 否 | 是 |
| 360×780 | `360x780.png` | 59,508 | 否 | 否 | 否 | 是 |
| 320×720 | `320x720.png` | 46,177 | 否 | 否 | 否 | 是 |
| 720×450（200% 等效） | `zoom200-720x450.png` | 42,438 | 否 | 否 | 否 | 是 |
| 640×360（200% 等效） | `zoom200-640x360.png` | 34,238 | 否 | 否 | 否 | 是 |

- 6 个断点均无水平溢出、标题与主 CTA 均未被裁切；200% 缩放用 CSS viewport 720×450 / 640×360 模拟（1440/2×900/2、1280/2×720/2），非浏览器 zoom 设置；该视口下首屏只到 Hero 文案与 CTA，工作包卡在首屏下。
- 肉眼小问题：360×780 主 CTA 文案折成两行（按钮内，未裁切、无溢出，略拥挤）；320×720 双 CTA 改为上下堆叠单行；左下 Next dev “N” 为 dev-only 覆盖物（before/after 一致）。

### 状态图（异常、无障碍与关键流程）

| 状态 | 文件（`b3/states/`） | 关键断言 |
|---|---|---|
| reduced-motion 切“期间” | `reduced-motion-during.png`（117,775B） | `prefers-reduced-motion:reduce=true`；`data-motion="reduced"`；内容变化且 tab 切换；点击→内容更新 **81ms**、展开依据 **102ms**（无动画等待）；running animations=0 |
| reduced-motion 展开依据 | `reduced-motion-evidence.png`（123,211B） | 依据完整可读；无动画 |
| reduced-motion rail | `reduced-motion-rail.png`（106,729B） | **rail 进度线为满**（`--rail-progress` 未设置=默认 1；进度线 bbox 宽=rail 宽）；active 圆点 0（无动画状态）；顶部进度线隐藏（scaleX=0）；主内容文字完整（>1000 字） |
| 字体失败（替代图片失败） | `font-failure.png`（119,532B） | abort `/fonts/*` 与 `*.ttf`（3 个字体 URL，ERR_FAILED）：h1 可见、主 CTA 可见、模拟边界说明可见、正文 1,640 字、无 `aria-busy`/无限 loading；字体回退 `"PM Editorial","Noto Serif SC",…`；`document.fonts.status=loaded`、PM Brand 不可用（预期） |
| 五步 Demo 原文 dialog | `dialog-open.png`（119,181B） | `dialog[open]`、`aria-labelledby=source-title`、标题“任务安排”；Esc 关闭后焦点**回到触发按钮**（`aria-label=查看原文：任务安排`） |
| 未确认回执门槛 | `receipt-gate.png`（87,899B） | 第 5 步未确认时显示“先确认行动，再填写模拟回执”，无 textarea |
| 已保存模拟回执 | `receipt-saved.png`（90,140B） | “模拟回执已加入本页示例”+ 用户填写原文 + “结果由你在本页填写，未经实际操作核验”；`role=status` 提示“刷新页面后不会保留” |
| #experience 锚点 | `anchor-experience.png`（92,029B） | 点击主 CTA 后 scrollY=1274；header 高 57px；`#experience-title` top=202.6 > header bottom=57 → **标题未被 sticky header 遮挡** |
| 五步第 3 步「查看判断」字号（9bae926 定向补拍） | `judgment-step-1440-light.png`（102,073B） | 选中 `story-tab-2`；比较基线 12.8px / 待确认 12.8px / 依据 2 项 12.8px / 主判断摘要 12.8px；pane 最小可见字号 12.8px；Hero lens `role="group"` 生效 |

### 15–20 秒动效录屏

- 文件：`b3/interaction-20s.webm`（2,155,752B，1440×900，**实际 20.52s**，wall-clock 20,310ms；Lead 允许 15–20s 并注明，未剪辑）。
- 路径：加载 → Hero 三阶段（期间→离开时→回来后）→ 展开依据 → 收起 → 平滑滚动到 01 节（rail 进度≈50%，前两个圆点点亮）→ 继续滚动到五步 Demo → 打开“查看原文：任务安排” dialog → Esc 关闭。
- 关键帧（`b3/video-frames/`，Chromium 播放截帧并逐帧查看）：1.5s 加载态、5.5s “02 期间”、10.5s 依据展开、13.8s rail 进度≈50%（圆点点亮）、15.5s 五步 Demo、19.5s dialog 关闭后焦点回触发按钮。
- 录屏期间网络：`b3/network-b3.json` 内 video 捕获 0 外域、0 bilibili、0 `/api` 写。

### 资源与性能（本机 dev + 本地回环，不代表线上/所有用户）

- Navigation Timing（1440 light，`b3/performance-after.json`）：TTFB 220.7ms、DOMContentLoaded 235.8ms、loadEventEnd 304.5ms、document transferSize 18,507B / decodedBodySize 74,480B。**dev 环境波动大（同脚本多次运行 TTFB 131–581ms），仅作本机参考。**
- 资源（`b3/resources-after.json`）：26 条 resource，transferSize 合计 6,600B、decodedBodySize 358,120B（含字体）；字体 resource 4 条（pm-serif-brand、pm-editorial-serif、manrope-variable、geist-latin.woff2，后两者 decodedBodySize=0 表示未实际使用/命中缓存）；**外域资源 0、bilibili 资源 0**。
- 口径：Next dev（非生产构建）含 HMR/dev chunk，缓存使 transferSize 常为 0；**不得据此宣称生产性能**。

### 网络审计与断言

- after 运行：431 请求 / 27 唯一 URL；**外域 0、bilibili 0、`/api` 写请求 0、console error 0、page error 0**；4 条失败均为 goto+reload 打断的 dev 脚本 ERR_ABORTED（良性）。B2 首页未出现 `/api/auth/me`（与 B1 原型页不同）。
- b3 运行：636 请求 / 27 唯一 URL；**外域 0、bilibili 0、`/api` 写请求 0、page error 0**；83 条 failures 主要为导航打断的 dev 脚本/字体 ERR_ABORTED + font-failure 状态按设计注入的 6 条 ERR_FAILED（对应 6 条 console error），非产品错误。
- **Bilibili 断言成立**：页面加载全程无 bilibili 请求（`network-after.json` / `network-b3.json` 的 `assertions.noBilibiliRequestDuringLoad=true`，bilibiliRequests=0）；该链接为 `href=https://www.bilibili.com/video/BV1Qaxb6PE7G…`、`target=_blank`、`rel="noopener noreferrer"` 的外链，本轮未点击外链（未做外部网络访问）。
- `/api` 写请求 = 0、外域 = 0 在两个运行中均成立。

### 逐张人工查看记录（read_image 实看）

- 已查看：after 六图、Hero 三阶段 2 图、滚动动效 4 图、断点 6 图、rail-390、9 张状态图（含第 3 步判断页）、录屏 6 关键帧，共 **28 张截图 + 6 帧**。
- 观感：新 Hero 首屏为“左文案+右工作包卡”，CTA 与“等你确认”状态在首屏；浅/深主题均正常，无低对比或串色；390 首屏可见标题/说明/双 CTA/工作包卡顶部（卡自 y≈388 起）。
- 新动效：顶部进度线在滚动后可见且按页高比例增长；01 节 rail 中线在桌面横向、390 纵向，均随滚动填充且圆点按顺序点亮；kicker 细线首次入视口展开；Hero 滚动有轻微深度差（copy 下移/lens 上移）但布局不跳。
- 肉眼问题：① 左下 Next dev “N” 覆盖物（dev-only，390 时覆盖面板左下文字）；② 360 主 CTA 折两行（未裁切）；③ 200% 等效视口首屏只到 CTA、工作包在首屏下；④ 深色主题由 after 的 1440/1280/390 dark 六图覆盖（b3 不重复）。

### 本阶段文件清单

| 路径 | 说明 |
|---|---|
| `after/homepage-{1440,1280,390}-{light,dark}-after.png` | 6 张 after 截图 |
| `after/metrics/*.json` | 6 张截图完整指标（主题、h1、scrollWidth/innerWidth、溢出、Hero/lens/copy bbox、字号、motion 状态、图片、字体） |
| `after/MANIFEST.json` | after 汇总（矩阵、Hero 状态、滚动动效断言、字号、性能/资源/网络、异常） |
| `after/integrity-at-capture.json` | 最终候选 SHA 与干净树快照（含作废说明） |
| `b3/hero-states/{hero-during,hero-evidence,hero-depth-exit,kicker-draw,scroll-progress-mid}.png` | Hero 状态与滚动动效（1440 light） |
| `b3/rail-1440-mid.png`、`b3/rail-390-mid.png` | 01 节 rail 中段（桌面横向 / 390 纵向） |
| `b3/breakpoints/*.png` | 1024/768/360/320 与 200% 等效 720×450、640×360 |
| `b3/states/*.png` | reduced-motion（3）、字体失败、dialog、回执门槛、已保存回执、锚点、第 3 步判断页（9bae926 定向补拍） |
| `b3/metrics/*.json` | 各状态指标 |
| `b3/interaction-20s.webm` + `b3/video-frames/*.png` | 20.52s 动效录屏与 6 关键帧 |
| `b3/performance-after.json`、`b3/resources-after.json`、`b3/network-after.json`、`b3/network-b3.json`、`b3/network-judgment.json` | 性能、资源、网络审计 |
| `b3/MANIFEST.json`、`b3/video-meta.json` | b3 汇总与录屏元数据 |
| `tools/phase2-lib.mjs`、`tools/capture-phase2-after.mjs`、`tools/capture-phase2-b3.mjs`、`tools/capture-judgment-step.mjs`、`tools/extract-video-frames.mjs`、`tools/finalize-phase2.mjs`、`tools/finalize-9bae926.mjs` | 采集/截帧/收口/最终绑定脚本 |

### 未验 / NOT_RUN（不在本轮证据范围）

- 真人 10 秒理解测试：**NOT_RUN**（属 Lead/E 的用户理解 Gate，未用开发代理冒充受试者）。
- 生产构建（`npm run build`）与线上性能：**NOT_RUN**（本轮为 Next dev 本机取证，不代表生产）。
- 真机/手机安装与跨端联调：**NOT_RUN**（属 D/E 设备轨道）。
