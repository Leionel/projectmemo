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

## Phase 2 — after 六图、断点/缩放、状态图、15s 录屏、性能取证（PENDING）

状态：**NOT_STARTED**（等待 Lead 通知“B2 候选 SHA”）。

已预登记 Lead 的新要求：B2 预计新增“决赛演示视频”外链区块与更精细动效，届时网络审计须确认**页面加载不会自动请求 bilibili/外部视频域**（仅用户点击外链才离开），并把外部域名清单写入 `b3/` 下 JSON。
