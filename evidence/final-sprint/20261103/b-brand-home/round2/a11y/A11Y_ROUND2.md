# Track B 官网 · Round 2 独立复验（热切换 reduced-motion / 阶段状态 / 内嵌播放器 / 回归）

- 审计员：a11y-auditor（独立于实现者；只读 `app/`、`components/`；只写 `evidence/final-sprint/20261103/b-brand-home/round2/a11y/`）
- 工作树：`D:\Projects\hongmen-final-b-brand-home`，分支 `codex/final-b-brand-home`
- **源码基线（最终）：`f06685d84b85c523595f2950b07b07dcdbf4271d`**（= `4b69614` + 决赛演示改为本页内嵌 Bilibili 官方播放器；探针运行时 `git status --porcelain -- app components` 为空）
- 环境：Lead 的 Next dev `http://127.0.0.1:34111`（mock、隔离空库、无 Worker）；Playwright 1.61.1 / Chromium 149；2026-11-03（UTC+8）
- 方法：自动化 DOM/计算样式/网络/偏好媒体取证。**非真实用户测试、非读屏人工验证、非无障碍认证。** 内嵌播放器的真实浏览器播放由用户本人确认（Lead 转述），本报告不宣称自动播放成功。
- 证据：
  - 主探针 [json/probe-round2.json](json/probe-round2.json)（15:16:48–15:21:52 +08，0 error，sha=f06685d）
  - 账号页补充 [json/accounts-round2.json](json/accounts-round2.json)（15:24:37–15:25:15 +08，0 error，服务重启后重跑）
  - 断点补充 [json/breakpoints-round2.json](json/breakpoints-round2.json)（15:25:16–15:25:32 +08，0 error，服务重启后重跑）
  - 视频播放器专项 [json/video-round2.json](json/video-round2.json)（15:25:42–15:26:54 +08，0 error）
  - 脚本：[scripts/probe-round2.mjs](scripts/probe-round2.mjs)、[scripts/probe-round2-accounts.mjs](scripts/probe-round2-accounts.mjs)、[scripts/probe-round2-breakpoints.mjs](scripts/probe-round2-breakpoints.mjs)、[scripts/probe-round2-video.mjs](scripts/probe-round2-video.mjs)、[scripts/check-video-contrast.mjs](scripts/check-video-contrast.mjs)、[scripts/check-collapse-network.mjs](scripts/check-collapse-network.mjs)
  - 截图：[shots/](shots/)；哈希：[MANIFEST.sha256](MANIFEST.sha256)

> 说明：本轮审计中途（主探针完成后、补充探针前）34111 dev server 因同机并发重活崩溃一次，Lead 重启后我重跑了 accounts/breakpoints/video 三个补充探针；主探针在崩溃前已完成且 0 error。所有结论绑定 f06685d 的干净工作树。

---

## 1. 结论摘要

| 维度 | 结论 |
|---|---|
| BLOCKER | **0** |
| MAJOR | **1**：深色主题下视频门面角标“公开视频 · Bilibili”对比度 **4.03:1**（<4.5，WCAG 1.4.3 AA）——见 §6 F-R2-01 |
| MINOR | **1**：同一元素移动端字号 **12.16px**（<12.8px 审计目标，B3 硬底线 12px 满足）——见 §6 F-R2-02 |
| reduced-motion 运行时热切换（3 个来回 + 初始 reduce） | **PASS** |
| Hero 三阶段状态文案（无需操作/核对示例/等你确认） | **PASS** |
| 内嵌视频播放器（点击前 0 外域 / 点击后用户主动加载 / 焦点 / 收起 / 外链 / 文案） | **PASS**（除 F-R2-01/02 的视觉项） |
| 键盘全路径 / skip link / 五步 Tab / dialog / 锚点 / 溢出 / 字号 / 浅色对比度 | **PASS** |
| 账号页 /login /register /forgot-password（浅/深 × 1440/390） | **PASS** |
| A 合并影响 | 未影响官网/账号页（运行时 + 静态 diff 均正常） |

**总体：除深色主题视频角标对比度（MAJOR）与移动端该角标字号（MINOR）外，f06685d 通过本轮自动化验收。** 其余均为非阻断观察。

---

## 2. reduced-motion 运行时热切换（重点）

`page.emulateMedia({ reducedMotion: "reduce" })` 运行时切换 3 个来回 + 初始 reduce（[json/probe-round2.json](json/probe-round2.json) `sections.reducedHotSwitch`）：

| 阶段 | data-motion | --hero-shift | copy/lens translate | 进度线 scaleX | rail progress | data-active | 正文长度 | 动画数 |
|---|---|---|---|---|---|---|---|---|
| normal @scroll632 | `on` | 1.000 | 10px / −18px | 0.1767 | 0.856 | 3 | 1649 | 7 |
| cycle1 → reduce | `reduced` | 0 | none / none | 0 | 0 | 0 | 1649 | 0 |
| cycle1 reduce + 滚动到 1400 | `reduced` | 0 | none / none | 0 | 0 | 0 | 1649 | 0 |
| cycle1 → normal 恢复 | `on` | 1.000 | 10px / −18px | 0.2852 | 1.000 | 4 | 1649 | 3 |
| cycle2 → reduce / 滚动 / 恢复 | `reduced`→`on` | 0→1.000 | none→10/−18px | 0→0.3188 | 0→1.000 | 0→4 | 1649 | 0→4 |
| cycle3 → reduce / 滚动 / 恢复 | `reduced`→`on` | 0→1.000 | none→10/−18px | 0→0.3523 | 0→1.000 | 0→4 | 1649 | 0→4 |
| normal 恢复后 scroll400 | `on` | **0.778** | 7.78px / −14.004px | 0.1225 | 0.425 | 2 | 1649 | 5 |
| normal 恢复后 scroll1200 | `on` | **1.000** | 10px / −18px | 0.3261 | 1.000 | 4 | 1649 | 5 |

补充断言（均 PASS）：
- 每次 reduce 后 `document.getAnimations()` = 0；恢复 normal 后正常。
- 内容完整：必需文案缺失 `[]`；五步 tab=5、阶段 tab=3；切换后第 3 步面板标题正常；阶段 chip 正常；查看依据 `aria-expanded=true`、3 条原文、焦点在按钮。
- 恢复 normal 后滚动重新更新（shift 0.778→1.000、progress 0.1225→0.3261、rail 0.425→1.000、active 2→4），无重复监听副作用。
- **初始 reduce**：`data-motion=reduced`、shift 0、translate none、进度线 scaleX(0)、rail 0、active 0、正文长度 1649、缺失 `[]`；reduced 下滚动仍全 0；阶段切换（期间→“核对示例”）正常。

**结论：PASS。**

---

## 3. Hero 三阶段状态文案

| 阶段 | 期望 chip | 实测 chip | aria-selected | panel aria-labelledby | roving tabindex | 状态消息节点 |
|---|---|---|---|---|---|---|
| 离开时 | 无需操作 | **无需操作** | `stage-tab-away` | `stage-tab-away` | 仅选中项 0 | 无 |
| 期间 | 核对示例 | **核对示例** | `stage-tab-during` | `stage-tab-during` | 仅选中项 0 | 无 |
| 回来后（默认） | 等你确认 | **等你确认** | `stage-tab-back` | `stage-tab-back` | 仅选中项 0 | 无 |

- `statusMatch` 三阶段均 `true`；chip 为 `span`（非交互、不可聚焦），无 `role=status`/`aria-live` 节点 → 不构成重复播报源。
- 键盘：ArrowLeft→期间（核对示例）、ArrowLeft→离开时（无需操作）、ArrowRight→期间、End→回来后、Home→离开时；焦点随选中 tab，panel `aria-labelledby` 同步。
- 证据：`sections.stageStatus`、`shots/round2-stage-{away,during,back}.png`。

**结论：PASS。**

---

## 4. 内嵌视频播放器（f06685d 新功能）

来源：用户 2026-11-03 明确要求“把视频放在那里可以播放，不必要跳转 b 站”，Lead 确认该需求优先于旧“只做外链”约束。组件 `components/home/DemoVideoPlayer.tsx`（点击门面 → 挂载 `player.bilibili.com` iframe；提供“收起播放器”与“在 Bilibili 打开（新窗口）”）。

| # | 检查项 | 结果 | 测量/证据（[json/video-round2.json](json/video-round2.json)） |
|---|---|---|---|
| V-01 | 点击前 0 外部请求、0 iframe | **PASS** | 页面加载 27 请求、外部 origin **0**、bilibili **0**；`iframe=null`；主探针 `networkOnLoad` 同结论 |
| V-02 | 门面按钮语义/尺寸/名称 | **PASS** | `<button>` 572×321、`tabIndex=0`、aria-label“在本页加载 2026 C4-AI 决赛演示视频的 Bilibili 官方播放器”；键盘可聚焦、Enter 激活（`:focus-visible` 2px 内描边） |
| V-03 | 点击后 iframe 可访问名 | **PASS** | `title="2026 C4-AI 决赛演示视频（Bilibili 官方播放器）"`；`allow="autoplay; fullscreen; picture-in-picture; encrypted-media"`；`loading=lazy` |
| V-04 | 点击后外部请求属用户主动 | **PASS** | 点击后出现 22 个 bilibili 域名请求（player.bilibili.com 文档 + hdslb 静态资源 + api.bilibili.com XHR），均发生在点击之后；帧列表包含 `https://player.bilibili.com/player.html?...` |
| V-05 | P-01 焦点进入 iframe（修复复验） | **PASS** | 点击前 activeElement=门面按钮；点击并等待 2.6s 后 `document.activeElement` = **IFRAME**，`title` = “2026 C4-AI 决赛演示视频（Bilibili 官方播放器）”（180/900/1800ms 兜底 + onLoad 生效） |
| V-06 | 「收起播放器」卸载并恢复 | **PASS** | 收起按钮可见、`<button>`、tabIndex 0；点击后 `iframe=null`、门面恢复、焦点回到门面按钮（aria-label 匹配）；收起后 2.5s 内 bilibili 请求 **0**（`check-collapse-network.mjs`：before 6 / after 0） |
| V-07 | P-02 外链名称（修复复验） | **PASS** | 可见文案“在 Bilibili 打开（新窗口）”、aria-label“在 Bilibili 打开 2026 C4-AI 决赛演示视频（新窗口）”、`target=_blank`、`rel="noopener noreferrer"`、165×44；页脚同名链接“决赛演示（Bilibili，在新窗口打开）”不变 |
| V-08 | 键盘收起 | **PASS** | 收起按钮 `:focus-visible` 可见，Enter 收起后焦点回门面；无隐藏内容 |
| V-09 | 文案真实性 | **PASS** | 门面文案“点击加载播放器 · 在播放器内播放”；页面文案“点击后在本页加载其官方播放器，加载前不请求外部站点”；无“自动播放成功”宣称 |
| V-10 | 无 JS | **PASS（降级）** | 无 JS 时门面按钮为 SSR 渲染（点击无效，符合无 JS 预期）、无 iframe、两个外链（含“新窗口”说明）可用；首页仍为框架级加载骨架（既有 NOT_SUPPORTED，见 §7） |
| V-11 | autoplay 策略（观察项，不判失败） | 观察 | embed URL 含 `autoplay=1`、`allow` 含 autoplay；iframe 跨域（`contentDocument` 为 null），Playwright 无法内省播放状态；Lead 转述用户本人已确认内嵌播放器可正常使用。是否二次点击/有无声音取决于浏览器自动播放策略与 Bilibili 播放器行为，**不据此判失败**；页面未宣称自动播放成功。 |
| V-12 | 深色主题视频角标 | **FAIL（MAJOR）** | 见 §6 F-R2-01：深色 `.videoFacadeCorner` 对比度 4.03:1 |
| V-13 | 移动端视频角标字号 | **FAIL（MINOR）** | 见 §6 F-R2-02：390/320 下 12.16px |

---

## 5. 回归（f06685d）

### 5.1 键盘 / skip link / 五步 Tab
- 键盘全路径：首 Tab=“跳到主要内容”（可见、UA auto 1px 环）；品牌 → 页头 4 导航 + CTA → Hero 主/次 CTA → 选中阶段 tab → stage panel → 查看依据 → 回到原委托 → 自动接续 summary → 重置 → 五步 tab → story panel → 3×查看原文 → 下一步 → 视频门面按钮；除 skip link 外焦点环均 `solid 2px`。**PASS**
- skip link：1440/390/720×450 三档 Enter 后 `activeElement=main#main-content`、首行文本 top 120/77 > header 57 → 未遮挡。**PASS**
- 五步 Tab：ArrowRight×2→tab2、End→tab4、Home→tab0、ArrowLeft 回绕→tab4；roving tabindex、panel labelledby 跟随。**PASS**

### 5.2 dialog / 锚点 / 溢出
- dialog：名称“任务安排”、`:modal`、初始焦点关闭按钮；Esc/遮罩/关闭三路径回焦 `查看原文：任务安排`；720×450 长回执内部滚动（client 400/scroll 479，scrollTop 79）。**PASS**
- 锚点：`#experience/#missions/#moments/#demo` 均 80px 落点 vs header 57。**PASS**
- 溢出：320/360/390/768/1024/1280/1440/720×450(200%) 全部无水平溢出、无越界元素。**PASS**

### 5.3 字号 / 对比度
- 浅色 1440/390/320：`<12.8px` **0**、`<4.5:1` **0**；第 3 步 judgment 区 1440/390/320 均 0 条 <12.8px。
- 深色 1440/390：`<12.8px` **0**；`<4.5:1` **1**（= F-R2-01，视频角标）；其余文本通过（标题 12.69、meta 5.46、页脚/正文等）。
- 断点补充（360/320/720×450）：0 小字、0 溢出；五步 tab 62.5×60.4 / 54.5×60.4 / 134.5×60.4（12.8px）；阶段 tab ≥44 高；上一步/下一步 44×44；页头 CTA 44 高；Hero CTA 46 高；查看原文 44 高；视频外链 157.7×44；页脚外链 69.3×44。**PASS**

### 5.4 账号页（浅/深 × 1440/390）
`/login` `/register` `/forgot-password` 六组合全部 PASS：html light/dark 正确、body 背景 token 正确、header 57 sticky、main top 57、CTA 12.8px/44px、无溢出、无首页泄漏、表单字段 2/4/1、console error 0。证据 [json/accounts-round2.json](json/accounts-round2.json)。

### 5.5 外链 / 网络 / A 合并影响
- 外链：主视频外链与页脚外链名称均说明 Bilibili + 新窗口；`target=_blank`、`rel="noopener noreferrer"`；均 44 高。**PASS**
- 网络（点击前）：27 请求、外部 origin **0**、bilibili **0**、无 iframe/自动播放。**PASS**
- A 合并影响：运行时官网各 section/五步/阶段/账号页正常、console error 0；静态 `git diff --name-only 4b69614..f06685d -- app components` = 3 个官网文件（home.module.css、page.tsx、DemoVideoPlayer.tsx）；A 相关 layout/globals/SiteHeader/AuthScreen 未变。**未发现 A 代码影响官网/账号页。**

---

## 6. 需要实现者处理的 FAIL（一次列全，仅 1 个元素的 2 个属性）

### F-R2-01（MAJOR，WCAG 1.4.3 AA）深色主题视频门面角标对比度 4.03:1

- **位置**：`components/home/DemoVideoPlayer.tsx:62-64` → `app/home.module.css:868-874` `.videoFacadeCorner`；文本“公开视频 · Bilibili”（`aria-hidden="true"`，但可见文本仍适用 WCAG 对比度）。
- **实测（深色主题，1440/390/320 一致）**：`color: color-mix(in srgb, var(--paper) 60%, transparent)`（深色主题下 `--paper`=#151E1C）叠加在视频台 `background: color-mix(in srgb, var(--ink) 94%, #000)`（深色主题下计算为浅色 `rgb(218,224,219)`）→ 有效对比度 **4.03:1**（<4.5）。
- **对照**：浅色主题同元素 **5.89:1**（PASS）；同区域标题 12.69:1、meta 5.46:1（PASS）。
- **复现**：`localStorage.theme=dark` 加载 `/` → 读 `.videoFacadeCorner` 的 `color` 与视频台有效背景 → 计算对比度；或运行 [scripts/check-video-contrast.mjs](scripts/check-video-contrast.mjs)。
- **建议修复**：深色主题下把该角标颜色提升到 ≥4.5:1（例如 `color-mix(in srgb, var(--paper) 72%, transparent)` 或使用全色 `--paper`），或给深色主题视频台换深底；修复后我复验 1440/390/320 深色与浅色。
- **说明**：该文本 `aria-hidden`（读屏不播报），且“公开视频/Bilibili”信息在标题与“在 Bilibili 打开（新窗口）”外链中重复；若 Lead 认为其属“纯装饰/附带文本”可按 WCAG 例外记录 WAIVER（需明确写入），否则建议修复。

### F-R2-02（MINOR）移动端视频角标字号 12.16px

- **位置**：`app/home.module.css:1402-1405` `.videoFacadeCorner { font-size: 0.76rem }`（≤720px）。
- **实测**：390/320 下计算 **12.16px**（桌面 12.8px）。满足 B3“不低于 12px”硬底线，但低于本审计 12.8px 目标，且与本轮其它文案统一 ≥0.8rem 的做法不一致。
- **建议**：移动端改为 `0.8rem`（与 `.videoFacadeMeta` 一致）。

---

## 7. 环境与数据完整性

1. **dev server 中途崩溃/重启**：主探针（15:16:48–15:21:52）完成后，34111 因同机并发重活崩溃；Lead 重启后我重跑 accounts（15:24:37–15:25:15）、breakpoints（15:25:16–15:25:32）、video（15:25:42–15:26:54），均 0 error。主探针数据在崩溃前完成且工作树干净，仍有效。
2. **本地工具文件**：`next-env.d.ts`、`tsconfig.json` 有构建产物型修改（非 `app/components`、非本次审计改动），未纳入结论；`evidence/.../b3/video-frames/` 未跟踪目录按 Lead 要求保留。
3. 未做：真实用户测试、读屏人工验证、无障碍认证；内嵌播放器的真实浏览器播放由用户本人确认（Lead 转述），本报告不宣称自动播放成功；无 JS 首页骨架（根 `loading.tsx` + 异步页面）为框架级既有 `NOT_SUPPORTED`。
4. autoplay 策略：跨域 iframe 无法内省，仅记录 `autoplay=1`/`allow=autoplay` 与页面无“自动播放成功”宣称；不据此判失败。

---

## 8. 复跑命令（绑定 f06685d）

```powershell
cd D:\Projects\hongmen-final-b-brand-home
git rev-parse HEAD   # f06685d84b85c523595f2950b07b07dcdbf4271d
git status --porcelain -- app components   # 空
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/probe-round2.mjs `
  --base http://127.0.0.1:34111 --label round2 --sha f06685d84b85c523595f2950b07b07dcdbf4271d
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/probe-round2-accounts.mjs `
  --base http://127.0.0.1:34111 --label round2 --sha f06685d84b85c523595f2950b07b07dcdbf4271d
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/probe-round2-breakpoints.mjs `
  --base http://127.0.0.1:34111 --label round2 --sha f06685d84b85c523595f2950b07b07dcdbf4271d
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/probe-round2-video.mjs `
  --base http://127.0.0.1:34111 --label round2 --sha f06685d84b85c523595f2950b07b07dcdbf4271d
# 视频角标对比度与收起网络专项
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/check-video-contrast.mjs
node evidence/final-sprint/20261103/b-brand-home/round2/a11y/scripts/check-collapse-network.mjs
```

## 9. 证据文件

- 主探针 [json/probe-round2.json](json/probe-round2.json)（`meta.sha=f06685d`，0 error）
- 账号页 [json/accounts-round2.json](json/accounts-round2.json)
- 断点 [json/breakpoints-round2.json](json/breakpoints-round2.json)
- 视频专项 [json/video-round2.json](json/video-round2.json)
- 截图：[shots/](shots/)（`round2-*`：stage-*、hot-*、viewport-*、account-*、dark-*、video-*、f01 等）
- 哈希清单：[MANIFEST.sha256](MANIFEST.sha256)
