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

## Phase 1 — 两款 Hero 原型对照（PENDING）

状态：**NOT_STARTED**（等待 Lead 通知“原型就绪”后采集 `/prototype/hero-a`、`/prototype/hero-b` 的 1440×900、390×844 × light/dark 共 8 图 + 交互态与 aria-selected 记录）。

## Phase 2 — after 六图、断点/缩放、状态图、15s 录屏、性能取证（PENDING）

状态：**NOT_STARTED**（等待 Lead 通知“B2 候选 SHA”）。
