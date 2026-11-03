# Track B 官网 · Phase 0 基线交互与无障碍资产清点

- 审计员：a11y-auditor（独立于实现者，只读 `app/`、`components/` 源码；只写 `evidence/final-sprint/20261103/b-brand-home/audit/a11y/`）
- 工作树：`D:\Projects\hongmen-final-b-brand-home`
- 分支：`codex/final-b-brand-home`
- **固定基线 SHA：`485d485378637e1da3280ed092739d441c8cf749`**
- 清点日期：2026-11-03（UTC+8）
- 配套检查表：[A11Y_CHECKLIST.md](A11Y_CHECKLIST.md)（A11Y-01…A11Y-46，Phase 1 逐项填 PASS/FAIL/BLOCKED/NOT_RUN）

> 本文件是**静态源码清点**，不是无障碍认证，也不是真实用户测试。所有“待实测”项在 Phase 1 用 Playwright 在候选 SHA 上采集证据后，才写入 [A11Y_FINDINGS.md](A11Y_FINDINGS.md)。

---

## 0. 结论摘要

1. 基线首页已有**五步 Demo 的完整 Tab 语义**（`role=tablist/tab/tabpanel`、`aria-selected`、roving `tabIndex`、Arrow/Home/End），以及**原生 `dialog.showModal()` 原文弹层**（`aria-labelledby`、Esc/遮罩/关闭按钮、依赖浏览器 focus fixup 回焦）。这两块代码路径清晰，但**没有自动化覆盖**（`e2e/` 无相关用例）。
2. 基线**没有 Hero 三阶段切换**、没有首屏入场动效、没有决赛演示视频外链；这些是 B2 新增，必须在 Phase 1 按 B3 合同重测，不能沿用本清点结论。
3. 最大的已确认风险是**关键说明字号**：基线 CSS 有 47 处 `font-size < 12.8px` 的声明，其中“示例/模拟边界、未启动委托、未核验结果、来源出处”等关键解释落在 **9.6–12.48px**（例如 `.projectIdentity > div > span` 移动端 0.6rem=9.6px、`.storyFooter > p` 移动端 0.64rem=10.24px），直接违反 B3“原 CSS 中 0.65rem 元数据不可继续承担关键解释”。
4. 断点层面基线存在**重复的 `@media (max-width: 700px)`**（`home.module.css:1132` 与 `:1472`）及 1000/1040/900 交叠，靠书写顺序决定胜出，已有 4px 级视觉不一致与后续覆盖风险；B2 正在重构 CSS（工作树新增 `HomeJourney.module.css`、`SiteHeader.module.css`），Phase 1 必须复查新结构。
5. 账号页 `/login` `/register` `/forgot-password` 的页头由 `SiteHeader` 的账号分支渲染，**复用首页 CSS**；基线移动端“返回官网”CTA 字号仅 `0.7rem=11.2px`（`home.module.css:1152`），属于首页样式对账号页的可读性外溢，需在 Phase 1 实测确认。
6. 降级路径：首图 `alt` 存在但图片容器 `overflow:hidden` + 绝对定位 `object-fit:cover`，失败时只剩空白大框（alt 不可读，静态推断）；无 JS 时根级 `app/loading.tsx` + 异步页面使正文落在 hidden 流式块中（静态推断，框架级，非 B2 引入）。
7. 深色主题：首页与账号页**都没有主题切换入口**，`ThemeProvider defaultTheme="light"` 会忽略系统深色；深色对比度只能以“已保存偏好（localStorage theme=dark）”验证。token 静态计算显示浅/深两套均 ≥4.5:1（见 §2.12），但仍须 Phase 1 实测覆盖真实计算色。

---

## 1. 方法与证据边界

### 1.1 为什么基线源码从 git 提取

清点开始时（11:38–11:48）工作树 HEAD 为基线 `485d485`。随后实现者提交了 B1（`4be7a4b`）并在工作树继续 B2 修改（`app/page.tsx`、`app/home.module.css`、`components/HomeJourney.tsx`、`components/SiteHeader.tsx` 等，见 11:51–11:55 的文件时间戳）。由于 Lead 的 dev server（`http://127.0.0.1:34111`）会热加载工作树，**任何动态测量在 B2 编辑期间都会混入未提交实现**。

因此本清点：

- 用 `git show 485d485…:<file>` 把基线文件提取到 [baseline-src/](baseline-src/)，**只读这些固定副本**做行号与规则清点；提取脚本 [scripts/inventory-baseline.mjs](scripts/inventory-baseline.mjs) 产出 [json/baseline-static-inventory.json](json/baseline-static-inventory.json)。
- 11:51 之后跑的一次动态探针（[scripts/probe-a11y.mjs](scripts/probe-a11y.mjs)）因页面已被热更新，数据不可作为基线证据，已整体隔离到 [invalidated/](invalidated/) 并附说明（见 [invalidated/README.md](invalidated/README.md)）。
- 本文件**不引用**那次被污染的动态数据；所有动态结论留到 Phase 1 在 B2 候选 SHA 上重跑。

### 1.2 基线文件与 blob

| 文件 | 基线行数 | git blob（485d485） |
|---|---|---|
| `app/page.tsx` | 276 | `8d2c1364e072c040b75074adc7e46e3c5bae566b` |
| `app/home.module.css` | 1496 | `6fa7a1767f1797c18954bd37158f8aa0cd208919` |
| `components/HomeJourney.tsx` | 488 | `75c71fb6fcb96defd25f0077ab004a840b816921` |
| `components/SiteHeader.tsx` | 54 | `793c506fede2e07ceaa673cbb79e35e9b27d1f57` |
| `app/layout.tsx` | 70 | `11210f7405e383bc3f5291e8d4e5ab5772530fbf` |
| `app/globals.css` | 308 | `caa379d52769c76e213da5f4c663443f4f80bbb7` |
| `components/StateDiffView.tsx` | 50 | `ac6145c1e734e48ed5e23d91ebb2eb8df79aa8d7` |
| `app/auth.module.css` | 352 | `ec822569131dad7b68241938a13998baff0b315e` |

> 证据源码副本一律使用 `.txt` 后缀（`app/page.tsx.txt` 等）：仓库 `tsconfig.json` 的 `include` 含 `**/*.tsx`，证据目录若保留 `.tsx` 会被 `tsc --noEmit` 收进类型检查（曾导致一次 `tsc` exit=2）。`scripts/inventory-baseline.mjs` 会自动回退读取 `.txt` 副本；[MANIFEST.sha256](MANIFEST.sha256) 已按 `.txt` 名称更新。

### 1.3 px 换算口径

`html` 未设置 `font-size`（默认 16px），`body { font-size: 14px }` 不影响 `rem`。因此 **0.65rem=10.4px、0.7rem=11.2px、0.8rem=12.8px**。Phase 1 一律以浏览器 `getComputedStyle().fontSize` 实测为准，不拿本表换算值代替测量。

---

## 2. 交互资产清点

### 2.1 Hero 区（基线）

| 资产 | 位置 | 现状 | B3 判据 | 风险 |
|---|---|---|---|---|
| Hero 三阶段（离开/期间/回来） | 基线**不存在** | 首屏为静态主张 + 整张工作区截图 | B2 新增：`tab`/`button` 语义、`aria-selected` 与可见状态一致、方向键/Home/End、减少动画内容等价、快速切换 20 次不丢状态、切换不抢焦点/不重复播报 | 新代码必须全量实测（A11Y-10…14、A11Y-25） |
| 主 CTA | `app/page.tsx:44-47` | `<a href="#experience">体验项目接续</a>`，原生锚点 | 键盘可达、焦点可见、44×44、滚动后 `#experience` 不被 sticky header 遮挡 | 见 §2.11 |
| 次 CTA | `app/page.tsx:48-51` | `Link` → `/login?from=%2Ffocus`（未登录）/`/focus`（已登录） | 服务端 session 分支不新写客户端判断 | 低 |
| Hero 边界说明 | `app/page.tsx:53-55`，`.heroNote` `app/home.module.css:214-219`（≤700 覆写 `:1185-1187`） | “下方示例无需登录。个人项目在工作台中管理。” **0.72rem=11.52px**，移动端 **0.68rem=10.88px** | 关键说明 ≥12.8px（B3） | **高风险**（A11Y-20） |
| Hero 产品截图 | `app/page.tsx:58-79` | `<picture>`：≤700 用 `workspace-mobile.jpg`，否则 `next/image` `workspace-desktop.jpg`；`alt` 在 `:70`；`<figcaption>` 在 `:78`；`priority unoptimized` | 图失败/弱网仍可读正文与 CTA，无永久 loading 遮罩；装饰/说明性图像处理正确 | 见 §2.9 |
| 图片工具条/图注 | `.imageToolbar` `:230-238`（0.65rem=10.4px）、“内置示例项目” `.projectIdentity > div > span` `:335-338`（0.65rem，≤700 `:1251-1253` 0.6rem=9.6px）、`figcaption` `:261-266`（0.66rem，≤700 `:1202-1204` 0.65rem） | 这三处承担“这是示例数据”的披露 | 关键说明 ≥12.8px | **高风险**（A11Y-21） |

### 2.2 五步 Demo Tab（`components/HomeJourney.tsx`）

| 资产 | 位置 | 现状 | 备注 |
|---|---|---|---|
| tablist | `HomeJourney.tsx:156-160` | `role="tablist" aria-label="项目故事步骤"` | 未设 `aria-orientation`；布局始终横向（≤700 时按钮内部改为纵向堆叠，tablist 仍 `flex-direction:row`），默认横向语义成立 |
| tab | `:161-194` | 每步 `<button role="tab" id="story-tab-N" aria-selected tabIndex={active?0:-1} aria-controls="story-panel">`；序号 `<span aria-hidden="true">` | 可访问名=步骤文字（“查看记录”…），无冗余数字 |
| 键盘 | `:174-189` | 处理 `ArrowRight/ArrowLeft/Home/End`，`preventDefault`，`setActive` 后 `document.getElementById(...).focus()` | 逻辑完整；`ArrowUp/ArrowDown` 不处理（横向 tablist 可接受）。无自动化测试覆盖 |
| tabpanel | `:196-202` | `role="tabpanel" id="story-panel" aria-labelledby={"story-tab-"+active} tabIndex={0}` | 单一面板复用、`aria-labelledby` 随选中项更新；面板可聚焦（可接受） |
| 选中态样式 | `.storyTabs > button[aria-selected="true"]` `home.module.css:387-392` | 文字 teal、背景 teal-pale、底部 2px 边框、字重 600 | `aria-selected` 与可见状态一致（静态） |
| Tab 字号 | `.storyTabs > button` `:375` 0.8rem=12.8px；≤700 `:1261-1267` **0.67rem=10.72px** | 移动端功能标签小于 12.8px | 中风险（A11Y-22） |
| 上一步/下一步 | `HomeJourney.tsx:439-456`；`.storyFooter button` `:764-773`（44×44），≤700 `:1357-1360`（**40×44**） | `aria-label="上一步/下一步"`，禁用态正确 | 移动端宽度 40<44（B3 明确“不能用只有小箭头的窄目标”），A11Y-17 |
| 重置 | `:151-154`，`.resetButton` `:344-355`（min-height 44） | 可见文字“重置示例” | 移动端字号 0.65rem=10.4px（A11Y-22 观察项） |
| 状态消息 | `:430-434` | `role="status"` 单节点；切 Tab 时 `setNotice("")` 清除 | 低频、非逐帧；无重复播报风险（静态） |
| 底部边界说明 | `:435-438`，`.storyFooter > p` `:754-758` **0.7rem=11.2px**，≤700 `:1351-1353` **0.64rem=10.24px** | “不会调用模型或修改个人项目” | **高风险**（A11Y-20） |

### 2.3 原文 dialog（`components/HomeJourney.tsx:458-485`）

| 资产 | 位置 | 现状 |
|---|---|---|
| 打开/关闭 | `:111-115` `useEffect`：`sourceId` 变化时 `element.showModal()` / `element.close()` | 原生模态；`:modal` 生效，背景 inert |
| 可访问名称 | `:461` `aria-labelledby="source-title"`；`:478` `<h3 id="source-title">{title}</h3>` | 名称来自当前原文标题；关闭时 h3 为空但 dialog `display:none`，不进入可访问树 |
| Esc | `:462` `onCancel={() => setSourceId(null)}` | 取消事件后由 state 驱动 `close()` |
| 遮罩点击 | `:464-466` `onClick` 判断 `event.target === event.currentTarget` | 点击 dialog 外区域关闭 |
| 关闭按钮 | `:470-477` `aria-label="关闭原始记录"`，`.dialogHeader > button` `:805-813` 44×44 | 44×44 |
| 焦点返回 | 依赖原生 dialog focus fixup（`close()` 后回焦触发按钮） | **必须实测**：Esc/遮罩/关闭按钮三条路径都要回到原触发按钮（A11Y-12） |
| 长文滚动 | `.sourceDialog` `:781-791`：`max-height: calc(100dvh - 48px)`，**未显式写 `overflow`** | 依赖 UA `dialog { overflow:auto }`；500 字回执 + 720×450（200% 缩放）必须实测可内部滚动（A11Y-13） |
| 描述关联 | 无 `aria-describedby` | 非必需；名称足够 |
| 出处说明 | `.dialogProvenance` `:829-833` 0.75rem=12px | 关键说明偏小（A11Y-20） |

### 2.4 焦点与键盘规则

| 规则 | 位置 | 覆盖对象 |
|---|---|---|
| 焦点环 | `home.module.css:18-26`：`outline: 2px solid var(--teal); outline-offset: 4px` | `.home a/button/summary/textarea`、`.storyBody`、`.siteHeader a` |
| 焦点环（通用） | `globals.css:112` `.focus-ring:focus-visible`（2px teal，offset 3px） | 工作台/公共组件；首页品牌链接 `BrandLink.tsx:10` 使用 |
| 跳过链接 | `app/layout.tsx:29` `<a href="#main-content" class="skip-link">跳到主要内容</a>`；`globals.css:113-114`（fixed，`translateY(-160%)`，`:focus` 归位） | 首个可聚焦元素；**未套用项目焦点环**（仅 UA 默认） |
| 跳到主要内容的目标 | `app/page.tsx:27` `<main id="main-content">` | **没有 `scroll-margin-top`**，sticky header 56px 会遮住首行（静态推断，A11Y-09） |
| 正向 tabindex | 无（基线） | 顺序=DOM 顺序 |
| 可见焦点 | 首页与账号页链接/按钮由 `.home a:focus-visible`/`.siteHeader a:focus-visible` 覆盖 | 账号页按钮另有 `auth.module.css:288-289` |

### 2.5 动效与用户偏好（基线）

| 规则 | 位置 | 内容 | 风险 |
|---|---|---|---|
| 减少动画 | `home.module.css:1424-1431` | `.home *`、`.siteHeader *`：`transition:none!important; animation:none!important; scroll-behavior:auto` | 基线首页无动画，等价性天然成立；**B2 引入 `heroRise`/`lensRows*` 后**若新元素不在 `.home` 内、或静态样式依赖动画 fill，会隐藏内容 → A11Y-23/25 |
| 减少动画（全局） | `globals.css:232` | `*`：`transition-duration:0.01ms!important; animation-duration:0.01ms!important; scroll-behavior:auto!important` | 与模块规则叠加；对 `.home` 内元素以 `none` 为准 |
| 高对比 | `home.module.css:1440-1449` | `prefers-contrast: more`：仅 `.storyFrame/.storyContent/.missionPreview/.heroProduct/.sourceDialog` 的边框改 `--ink-soft`、去阴影 | B2 新增容器（Hero lens、视频块、rail 强调）不在覆盖内 → A11Y-26 |
| 减少透明度 | 基线**不存在** | — | B2 新增页头半透明/backdrop-filter 后应补（当前工作树已有 `prefers-reduced-transparency`，Phase 1 复查） |
| 入场动画 | 基线**不存在** | — | B2 新增，见 A11Y-23 |
| `scroll-behavior` | `globals.css:64` `html { scroll-behavior: smooth }` | 减少动画下由两条 reduced-motion 规则改 `auto` | 低 |

### 2.6 重复断点与级联风险（基线 `home.module.css`）

媒体查询出现顺序（`app/home.module.css`）：

| 行 | 查询 | 说明 |
|---|---|---|
| 1095 | `(max-width: 1000px)` | 首次 |
| 1132 | `(max-width: 700px)` | 首次（36px 页边距等） |
| 1424 | `(prefers-reduced-motion: reduce)` | 位置在第二个 700px 块之前 |
| 1432 | `(max-width: 380px)` | 隐藏 `.projectIcon` |
| 1440 | `(prefers-contrast: more)` | 5 个容器边框 |
| 1451 | `(max-width: 1040px)` | 追加块 |
| 1460 | `(max-width: 900px)` | 追加块 |
| **1472** | `(max-width: 700px)` | **重复的 700px 追加块**（1451–1496 为“末尾追加”段） |

已确认的级联覆盖（同特异性、后者胜出）：

| 选择器 | 首次声明 | 追加声明 | 结果 |
|---|---|---|---|
| `.siteHeaderInner` 宽度 | `:1141-1143` `calc(100% - 36px)` | `:1473-1475` `calc(100% - 40px)` | 移动端页头比正文窄 4px（视觉不对齐） |
| `.homeHeader .headerCta` 高度 | `:78-87` `height:40px; min-height:40px` | `:1476-1479` ≤700 时 `44px` | 移动端达标 44；**701–1024 触屏仍为 40px** |
| `.hero h1` | `:1103-1105` 3.25rem（≤1000） | `:1456-1458` `clamp(2.5rem,4.5vw,3.25rem)`（≤1040） | ≤1000 时实际取 clamp，1001–1040 取 clamp，两者不同来源 |
| `.heroSupporting` margin-top | `:1465-1467` 1.25rem（≤900） | `:1490-1492` 1rem（≤700） | 移动端 1rem |
| `.positioning` margin-bottom | `:1161-1164` 0.65rem | `:1480-1483` 0.85rem | 移动端 0.85rem |

风险：后续 B2 若继续“文件末尾追加断点”，同一属性会出现更多顺序依赖；`prefers-reduced-motion` 位于追加块之前，靠 `!important` 才保持生效——任何新动效若写在 `.home` 之外或新 CSS module 中，不会自动被覆盖（A11Y-25）。

> 工作树中的 B2 已把 CSS 拆为 `app/home.module.css` + `components/HomeJourney.module.css` + `components/SiteHeader.module.css`（未提交，Phase 1 以候选 SHA 为准）。本表的“重复断点”结论只对基线有效；Phase 1 需对候选重新扫描（脚本已支持）。

### 2.7 关键说明小字清单（基线，`< 12.8px`）

完整机器清单见 [json/baseline-static-inventory.json](json/baseline-static-inventory.json) 的 `smallFontDeclarations`（47 条，`home.module.css`）。下表只列**承担解释/边界/状态含义**的条目（B3 明确点名 0.65rem 元数据不可继续承担关键解释）：

| # | 内容（承担的含义） | 选择器 | 行 | 桌面 | ≤700 | 风险 |
|---|---|---|---|---|---|---|
| 1 | “下方示例无需登录。个人项目在工作台中管理。” | `.heroNote` | 214-219 / 1185-1187 | 11.52px | 10.88px | 高 |
| 2 | “内置示例项目”（图片工具条） | `.imageToolbar` | 230-238 | 10.4px | 10.4px | 高 |
| 3 | “实际工作区界面，使用内置示例数据。” | `.heroProduct figcaption` | 261-266 / 1202-1204 | 10.56px | 10.4px | 高 |
| 4 | “内置示例项目”（项目身份） | `.projectIdentity > div > span` | 335-338 / 1251-1253 | 10.4px | **9.6px** | 高 |
| 5 | “已有记录取自内置素材；建议与回执为本页演示。不会调用模型或修改个人项目。” | `.storyFooter > p` | 754-758 / 1351-1353 | 11.2px | **10.24px** | 高 |
| 6 | “目前没有完成回执，不能确认流程已跑通” | `.executionList > li > div > span` | 927-933 | 11.52px | 11.52px | 高 |
| 7 | “这是界面说明，未启动委托或执行模型任务。” | `.previewFootnote` | 958-964 | 11.2px | 11.2px | 高 |
| 8 | “实际执行需要启用委托功能…创建行动仍需用户确认。” | `.conditions > p` | 868-873 | 12.48px | 12.48px | 中 |
| 9 | “哪些条件会影响执行？”（控件名） | `.conditions summary` | 853-861 | 12.48px | 12.48px | 中 |
| 10 | 原文出处“不是在线用户的个人记录” | `.dialogProvenance` | 829-833 | 12px | 12px | 中 |
| 11 | “不要填写私人资料；这不会成为真实项目的完成证明。” | `.receiptPane form > p` | 690-695 | 12.48px | 12.48px | 中 |
| 12 | “结果由你在本页填写，未经过实际操作核验。” | `.savedReceipt > p:not(...)` | 731-736 | 12px | 12px | 中 |
| 13 | “这里没有断言当前功能未完成…” | `.detailNote` | 620-625 | 11.52px | 11.52px | 中 |
| 14 | “当前状态待确认”“等待补充材料”“本页示例已确认”等状态徽标 | `.waitingBadge/.exampleBadge/.confirmedBadge` | 535-544 | 10.56px | 10.56px | 中 |
| 15 | “记录中提到/已有任务安排”（证据类型） | `.factMark` | 515-518 | 10.88px | 10.88px | 中 |
| 16 | 面板元数据“3 条内置素材/示例整理/预设示例” | `.paneHeading > span` | 461-464 | 10.4px | 10.4px | 中 |
| 17 | 步骤上下文“已有示例素材” | `.contextLabel` | 408-413 / 1279-1282 | 11.2px | 10.4px | 低-中 |
| 18 | 状态消息（重置/保存/确认） | `.storyNotice` | 737-744 / 1361-1364 | 12.32px | 11.68px | 中 |
| 19 | 五步 Tab 标签（功能导航） | `.storyTabs > button` | 365-386 / 1261-1267 | 12.8px | **10.72px** | 中 |
| 20 | “查看原文”按钮及提示 | `.sourceButton` / `.sourceButton > span` | 489-505 | 11.52px / 10.4px | 同左 | 中 |
| 21 | “重置示例” | `.resetButton` | 344-355 / 1254-1257 | 11.52px | 10.4px | 低-中 |
| 22 | 页脚元信息 | `.footer` | 1080-1089 / 1419-1422 | 11.2px | 10.4px | 低 |
| 23 | 使用边界 aside | `.boundaryNote p` | 1056-1060 / 1407-1409 | 12.8px | 12px | 中 |
| 24 | 判断面板内的变化摘要/依据数（Tailwind） | `StateDiffView.tsx:23,25,31,32,34,35,41,44,48` `text-xs`(12px)/`text-[11px]`(11px) | — | 11–12px | 同左 | 中 |
| 25 | 账号页头部 CTA“返回官网”（首页 CSS 外溢） | `.homeNav .headerCta` | 1151-1155 | — | **11.2px** | 中 |

> 说明：`≤0.7rem`（≤11.2px）的严格子集包括 `.imageToolbar`(0.65)、`figcaption`(0.66/0.65)、`.projectIdentity span`(0.65/0.6)、`.paneHeading span`(0.65)、`.sourceButton span`(0.65)、`.factMark`(0.68)、徽标(0.66)、`.storyFooter p`(0.7/0.64)、`.previewLabel`(0.7)、`.previewFootnote`(0.7)、`.footer`(0.7/0.65)、`.contextLabel`(0.7/0.65)、`.contextPosition span`(0.7)、`.storyTabs span`(0.7/0.6，装饰序号已 `aria-hidden`)、`.homeNav .headerCta`(0.7)。另有 0.72–0.78rem（11.52–12.48px）仍低于 12.8px 的：`.heroNote`(0.72/0.68)、`.resetButton`(0.72)、`.sourceButton`(0.72)、`.storyNotice`(0.77/0.73)、`.receiptPane form > p`(0.78)、`.conditions`(0.78)、`.evidenceDetails > div > p`(0.76)、`.dialogHeader > p`/`.dialogProvenance`(0.75)、`.savedReceipt > p`(0.75)、`.detailNote`(0.72)、`.sectionHeading > p` 移动端(0.78) 等。完整 47 条见 JSON。

### 2.8 触控目标（基线声明与风险）

| 目标 | 位置 | 声明尺寸 | 风险 |
|---|---|---|---|
| 页头导航链接 | `.homeNav > a` `:54-58` | `min-height:44px` | 宽度随文字，≥44 高 |
| 页头 CTA“进入工作台” | `.homeHeader .headerCta` `:78-87` | 桌面 `height:40px;min-height:40px`；≤700 `:1476-1479` 44px | 701–1024 触屏 40px（A11Y-18） |
| Hero 主/次 CTA | `.heroActions .primary/.secondary` `:165-170` | `min-height:48px` | 达标 |
| 通用按钮 | `.primary/.secondary` `:171-188` | `min-height:44px` | 达标 |
| 五步 Tab | `.storyTabs > button` `:365-386` | `min-height:52px`；≤700 按钮内部纵向堆叠，实测宽度约 54px（320 宽） | 达标 |
| 上一步/下一步 | `.storyFooter button` `:764-773` / `:1357-1360` | 44×44 → ≤700 **40×44** | 不达标（A11Y-17） |
| 查看原文 | `.sourceButton` `:489-500` | `min-height:44px` | 高度达标 |
| 重置示例 | `.resetButton` `:344-355` | `min-height:44px` | 达标 |
| 依据展开 summary | `.evidenceDetails summary` `:595-602`、`.conditions summary` `:853-861` | `min-height:44px` | 达标 |
| dialog 关闭 | `.dialogHeader > button` `:805-813` | 44×44 | 达标 |
| 品牌链接（首页） | `BrandLink.tsx:7-17` | 内容高约 28px | <44，WCAG 2.5.8 例外需按间距评估（A11Y-19 观察） |
| 页脚链接 | `.footer` `:1080-1089` | 文字行高约 17–20px | <24，需按 2.5.8 间距例外评估（A11Y-19 观察） |
| 账号页“返回官网” | `.homeNav .headerCta` `:1151-1155` | 高度 44（`.homeNav > a`），字号 11.2px | 触控达标、字号风险 |

### 2.9 Hero 大图失败与无 JS 降级（静态判断，Phase 1 实测）

- **图失败**：`alt` 存在（`app/page.tsx:70`），但 `.heroProduct picture`（`:243-251`）`overflow:hidden` + `aspect-ratio:2.05`，`.heroProduct img`（`:252-260`）`position:absolute; inset:0; width/height:100%; object-fit:cover`。图片加载失败时 alt 文本被限制在该绝对定位框内并裁切，实际可读性存疑；`<figcaption>`（`:78`，10.56px）仍可见。页面无 loading 遮罩，正文与 CTA 不受影响。→ Phase 1 A11Y-27。
- **无 JS**：`app/layout.tsx` 挂载 `SiteHeader`（client）与 `ThemeProvider`；`app/loading.tsx` 存在且首页 `Home()` 为 async（`getSessionUser`），Next 会先输出 loading 骨架、正文在 hidden 流式块中由 JS 替换。因此**禁用 JS 时首页很可能只显示“页面正在加载”骨架**。这是框架级既有行为，不是 B2 引入；Phase 1 记录实测结果，若确认则标 `NOT_SUPPORTED`（附框架原因），不当作 B2 回归。→ A11Y-28。

### 2.10 账号页 `SiteHeader` 分支与 CSS 复用（基线）

`components/SiteHeader.tsx:17-26`：

- `accountPage` = pathname ∈ {`/login`,`/register`,`/forgot-password`,`/reset-password`,`/verify-email`,`/resend-verification`}（`:18-25`）。
- `if (pathname !== "/" && !accountPage) return children;`（`:26`）：其它页面渲染 `app/layout.tsx:30-64` 的工作台页头。
- `"/"` → 渲染营销页头，`className` 加 `homeHeader`（`:28-30`）；账号页 → 渲染同一 `siteHeader`（无 `homeHeader`），导航仅“返回官网”CTA（`:34-37`）；首页导航含 `#experience/#missions/#moments` 锚点与“进入工作台”CTA（`:39-48`），`registrationEnabled` 时加“注册”（`:43`）。

基线样式来自 `app/home.module.css`（B2 工作树已迁移到 `components/SiteHeader.module.css`，Phase 1 以候选为准）。外溢点：

- 账号页头部“返回官网”使用 `.homeNav .headerCta`（`home.module.css:62-69`），≤700 时字号 `0.7rem=11.2px`（`:1151-1155`）→ 可读性风险（A11Y-22/A11Y-39）。
- `.home *` 规则不影响账号页正文（账号页 `main` 用 `auth.module.css`），但 `.siteHeader *` 的 box-sizing/reduced-motion 规则会作用到账号页页头——需回归确认（A11Y-38）。
- 账号页 `auth.module.css:7-13` `.auth { min-height: calc(100svh - 69px) }` 按 69px 页头预留，而实际页头 56/57px → 多出约 12px 空白（视觉，非阻断；A11Y-39 记录）。
- 账号页与首页**都没有主题切换按钮**（`ThemeToggle` 只在 `app/layout.tsx` 的工作台页头里）；账号页因此无法切深色（A11Y-30 观察）。

### 2.11 锚点与 sticky header（基线）

- sticky 页头：`.siteHeader` `home.module.css:31-37`（`position:sticky; top:0; z-index:40`），`.siteHeaderInner` 高 56px（`:38-46`）。
- `scroll-margin-top: 5.5rem`（=88px）只在 `.storySection` `:302`、`.missionSection` `:841`、`.scenarios` `:971`；`#principles` aside（`:249-258`）无 margin（页面内没有指向它的链接，风险低）。
- 预期 `#experience` 落点距页头底部 88−56=32px（Phase 1 实测，A11Y-35）。`#missions`、`#moments` 同理。
- 页脚“回到顶部 ↑”指向 `#home-heading`（Hero 顶部，无需 margin）。
- **跳过链接目标 `#main-content` 没有 scroll-margin**：激活后 `main` 顶边贴到视口顶，被 56px sticky 页头遮住首行（Hero 首行 padding 在 ≤700 时更小）→ 静态推断 A11Y-09 需实测。

### 2.12 主题与对比度（静态 token 计算）

`app/globals.css:6-33`（浅色）/ `:35-61`（深色）语义 token。按 WCAG 相对亮度公式静态计算（脚本 [scripts/inventory-baseline.mjs](scripts/inventory-baseline.mjs)）：

| 前景/背景 | 浅色 | 深色 | AA 正文 4.5 |
|---|---|---|---|
| ink/paper | 13.15 | 14.45 | PASS |
| ink/paper-strong | 14.22 | 12.76 | PASS |
| ink-soft/paper | 5.79 | 9.34 | PASS |
| ink-soft/paper-strong | 6.26 | 8.25 | PASS |
| muted/paper | 4.72 | 7.70 | PASS（浅色余量小） |
| muted/paper-strong | 5.10 | 6.80 | PASS |
| teal/paper | 6.02 | 8.87 | PASS |
| teal/teal-pale | 5.60 | 5.93 | PASS |
| amber/paper-strong | 6.10 | 9.48 | PASS |
| rule-strong/paper（边框） | 3.76 | 5.73 | 非文本；深色更好 |

注意：这只是 token 组合的静态计算，**不等于**页面实测；实际元素可能叠加 `color-mix`、半透明页头（`backdrop-filter`）与图片背景。Phase 1 用 `getComputedStyle` 的 `color` + 逐层合成后的有效背景逐元素计算（A11Y-29/30）。

### 2.13 结构与 ARIA 其他观察（基线）

| 观察 | 位置 | 判定 |
|---|---|---|
| `aria-label` 用在无 `role` 的普通 `div` 上（ARIA 1.2 不允许命名 generic） | `HomeJourney.tsx:140`（`.storyFrame` “参赛项目交互示例”）、`app/page.tsx:131-134`（`.missionPreview`） | 低风险；建议 `role="group"`/`<figure>` |
| 装饰性状态符号“✓”“?”直接作为文本 | `app/page.tsx:145`、`:152`、`:159` | 会被读屏读出；建议 `aria-hidden` + 文字已在相邻 span 中 |
| dialog 内 `<h3 id="source-title">` 关闭时为空 | `HomeJourney.tsx:478` | 低（关闭时 `display:none`，不进入可访问树；需实测确认） |
| 标题层级 | `h1`→`h2`→`h3`→`h4`/`h5`（页面） | 基线无层级跳跃（静态） |
| 地标 | 1×`main#main-content`、1×`nav[aria-label=首页导航]`、1×`footer`、1×`aside[aria-label=使用边界]`；`<header>` 出现 2 次（页头 + section 内 header） | 合法；section 内 header 不构成 banner |
| `role=status` | 仅 `HomeJourney.tsx:430-434` | 低频、无逐帧播报 |
| `html lang` / viewport | `app/layout.tsx:21` `lang="zh-CN"`；Next 默认 `width=device-width, initial-scale=1` | 允许 200% 缩放，无 `user-scalable=no` |
| 图片 alt | 首页仅 Hero 一张内容图，有 alt；`BrandLink` 图标 `alt=""` | 达标 |
| 重复 id / `aria-controls` 失效 | 基线静态扫描未发现 | 达标 |
| 页内锚点无 `aria-current` | `SiteHeader.tsx:40-42` | 低（非必须） |

---

## 3. 风险登记（Phase 1 验证映射）

| ID | 风险 | 初判 | Phase 1 检查 |
|---|---|---|---|
| R-01 | 关键说明字号 9.6–12.48px（示例/模拟边界/未核验/出处） | **MAJOR→BLOCKER 待测**（B3 明文） | A11Y-20/21/22 |
| R-02 | 移动端五步 Tab 标签 10.72px（功能导航） | MINOR-MAJOR | A11Y-22 |
| R-03 | 账号页头部 CTA 移动端 11.2px（首页 CSS 外溢） | MINOR-MAJOR | A11Y-22/39 |
| R-04 | 移动端上一步/下一步 40×44（B3 明确窄目标） | MAJOR | A11Y-17 |
| R-05 | 页头 CTA 在 701–1024 触屏为 40px 高 | MINOR | A11Y-18 |
| R-06 | 品牌/页脚链接 <24px（WCAG 2.5.8 例外需评估） | MINOR | A11Y-19 |
| R-07 | skip link 目标无 scroll-margin，首行被 sticky header 遮挡 | MINOR | A11Y-09 |
| R-08 | 重复 700px 媒体查询与追加块级联（B2 已拆 CSS，需重扫） | MINOR（维护/回归） | A11Y-45 |
| R-09 | reduced-motion 选择器与新 CSS module/新动效覆盖关系；`animation-fill-mode:both` + 初始 opacity 0 的隐藏风险 | **MAJOR 待测**（B3） | A11Y-23/24/25 |
| R-10 | prefers-contrast 只覆盖基线 5 容器，B2 新容器未覆盖 | MINOR | A11Y-26 |
| R-11 | dialog 长文内部滚动依赖 UA overflow，未显式声明 | MINOR-MAJOR | A11Y-13 |
| R-12 | 原生 dialog 焦点返回依赖浏览器实现；B2 若改渲染方式可能丢失 | MAJOR 待测（B3 明文） | A11Y-12 |
| R-13 | 无 JS 时首页为 loading 骨架（框架级既有行为） | MINOR（非 B2 回归） | A11Y-28 |
| R-14 | 首图失败时 alt 被裁切、留大块空白（无永久遮罩） | MINOR | A11Y-27 |
| R-15 | 首页/账号页无主题切换入口；`defaultTheme=light` 忽略系统深色 | MINOR（可达性/产品决策） | A11Y-30 |
| R-16 | `aria-label` 用于 generic div（2 处） | MINOR | A11Y-44 |
| R-17 | 装饰符号未 `aria-hidden`；关闭态空 h3 | MINOR | A11Y-44 |
| R-18 | B2 把页头 CSS 迁到独立 module 后账号页回归 | MAJOR 待测（B3 明文） | A11Y-38/39 |
| R-19 | B2 新增 Bilibili 外链：主视频块名称含“Bilibili·新窗口打开”，页脚同名链接名称仅“决赛演示” | MINOR-MAJOR | A11Y-40/41/42 |
| R-20 | 无 JS/弱网、首图失败、字体失败下正文与 CTA 可读 | 待测 | A11Y-27/28 |

---

## 4. 本清点没有做的事（避免过度声明）

- 没有对基线做完整动态测量（原因见 §1.1，被污染的一次已隔离）；基线行为结论均来自源码静态阅读，已在文中标注“静态/待实测”。
- 没有做真实用户测试、没有做读屏软件（NVDA/JAWS/VoiceOver）人工验证、没有做无障碍认证。
- 没有修改任何实现代码、没有 commit/push、没有启动/停止任何服务进程。
- 没有验证 B2 新增内容（Hero 三阶段、入场动效、视频外链）——这些属于 Phase 1 候选 SHA。

## 5. 复现

```powershell
# 基线源码提取（只读 git 固定 SHA）
git -C D:\Projects\hongmen-final-b-brand-home show 485d485378637e1da3280ed092739d441c8cf749:app/home.module.css
# 静态清点
cd D:\Projects\hongmen-final-b-brand-home
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/inventory-baseline.mjs
# Phase 1 动态探针（B2 候选提交后）
node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-a11y.mjs --base=http://127.0.0.1:34111 --label=after --sha=<候选SHA>
```
