# Track B 官网 · Phase 1 可执行无障碍与交互检查表（A11Y-01…A11Y-46）

- 适用对象：B2 候选 SHA 的生产首页（`/`）+ 五步 Demo + 账号页（`/login`、`/register`、`/forgot-password`）
- 基线：`485d485378637e1da3280ed092739d441c8cf749`（清点见 [BASELINE_INVENTORY.md](BASELINE_INVENTORY.md)）
- 环境：Lead 的 Next dev `http://127.0.0.1:34111`（mock、隔离空库、无 Worker）；Playwright 1.61.1 / Chromium 149
- 执行脚本：[scripts/probe-a11y.mjs](scripts/probe-a11y.mjs)（只读页面；只写 `audit/a11y/`）
- 结果文档：Phase 1 产出 [A11Y_FINDINGS.md](A11Y_FINDINGS.md)；Lead 修复后复验并更新为最终结论

## 状态与判定

| 状态 | 含义 |
|---|---|
| `PASS` | 实测满足判据，附测量值与截图 |
| `FAIL` | 实测不满足判据，附选择器、测量值、复现步骤、截图 |
| `BLOCKED` | 环境/权限/依赖导致无法执行，写明阻塞条件与已尝试步骤 |
| `NOT_RUN` | 未执行（写明原因） |
| `NOT_SUPPORTED` | 能力本身不成立且非本轮回归（如框架级无 JS），附原因与影响范围 |

严重度：`BLOCKER`（阻断 B3 签收/无法完成主路径）、`MAJOR`（违反 B3 明文或 WCAG AA）、`MINOR`（一致/体验问题）。不得把“看起来没问题”写成 PASS；不得声称做过真实用户测试或无障碍认证。

证据命名：`shots/after-<检查项或状态>.png`、`json/probe-after.json`；报告引用 `file:line`、选择器、测量值、命令。

---

## A. 环境与基线绑定

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-01 | 候选 SHA 与环境绑定 | `git rev-parse HEAD`、`git status --porcelain`；记录 dev server 模式、浏览器/Playwright 版本、时间 | 报告与截图对应同一候选 SHA；工作树无与候选不一致的未提交改动（或有明确说明） | `json/probe-after.json.meta` | NOT_RUN |

## B. 键盘与焦点

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-02 | 跳过链接 | 加载后直接 `Tab`（不要先点击页面）；读 `document.activeElement`、rect、outline；`Enter` 后记录 hash/scrollY/首行位置 | 首个 Tab 命中“跳到主要内容”且可见（transform 归位）、焦点环可见；激活后目标可达 | `shots/after-skip-link.png` | NOT_RUN |
| A11Y-03 | 首页页头与首屏 tab 顺序 | 连续 `Tab` 25 次，记录每步 tag/name/href/outline/是否在视口 | 顺序符合 DOM 与视觉顺序（品牌→页头导航/CTA→Hero CTA…）；每步 `:focus-visible` 有 2px teal 焦点环；无 `tabindex>0` | `json/probe-after.json` keyboard | NOT_RUN |
| A11Y-04 | 五步 Demo Tab 键盘 | 聚焦 tab0；`ArrowRight/ArrowLeft/Home/End`；读 `aria-selected`、`tabindex`、`aria-labelledby`、面板 h4 | 方向键/Home/End 改变选中并移动焦点；选中项唯一；roving tabIndex 正确；面板 `aria-labelledby` 跟随；内容同步 | `json/probe-after.json` tabs | NOT_RUN |
| A11Y-05 | Hero 三阶段 Tab 语义（B2 新增） | 在首屏 section 内检测“离开时/期间/回来后”控件；读 role/aria-selected/aria-current/aria-controls/tabindex/可见选中样式 | 用 `tab`/`button` 语义（不得 div+click 伪装）；`aria-selected`（或 `aria-current`）与可见选中态一致（颜色/背景/边框可测差异）；有可访问组名 | `json/probe-after.json` heroStage | NOT_RUN |
| A11Y-06 | Hero 三阶段键盘 | tab 语义：`ArrowRight/Left/Home/End`；button 语义：`Tab` + `Enter/Space` | 键盘可完成三阶段切换，焦点不丢失 | `json/probe-after.json` heroStage.keyboard | NOT_RUN |
| A11Y-07 | Hero 切换不抢焦点、不跳滚动 | 点击/键盘切阶段后读 `document.activeElement`、`scrollY` | 焦点留在触发的 tab/button；滚动位置不变；不把焦点移到面板或页面顶部 | `json/probe-after.json` heroStage | NOT_RUN |
| A11Y-08 | 阶段切换不重复播报 | 统计切换前后 `[role=status]`/`[aria-live]` 节点数与文本 | 一次切换不产生多次播报节点；无逐帧 live 更新；不播报纯装饰变化 | `json/probe-after.json` heroStage | NOT_RUN |
| A11Y-09 | 快速切换 20 次不丢状态 | 连续点击 20 次（循环三阶段），每次读选中项/内容签名/console | 最终选中项唯一且内容与选中一致；无 console error；无重复提交/网络请求 | `json/probe-after.json` heroStage.rapid | NOT_RUN |

## C. dialog（原文/模拟回执）

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-10 | dialog 可访问名称 | 打开原文 dialog；`locator("dialog").ariaSnapshot()`；读 `aria-labelledby` 解析结果 | 名称非空且等于当前原文标题；标题可见 | `json/probe-after.json` dialog | NOT_RUN |
| A11Y-11 | 打开后焦点进入、背景 inert | 打开后读 activeElement；连续 `Tab` 8 次记录是否越出 dialog | 焦点在 dialog 内；背景内容不可聚焦（modal 生效）；首个焦点合理 | `json/probe-after.json` dialog.focusTrap | NOT_RUN |
| A11Y-12 | Esc/遮罩/关闭按钮 + 焦点返回 | 三条路径分别关闭，读 activeElement 与触发按钮 aria-label | 三条路径均关闭；焦点回到原触发按钮（`查看原文：<标题>`） | `json/probe-after.json` dialog.afterEsc/afterBackdrop/afterCloseButton | NOT_RUN |
| A11Y-13 | 长文内部滚动（含 200% 缩放） | 填 500 字回执 → 打开回执 dialog；在 1440×900 与 720×450 读 clientHeight/scrollHeight，设置 `scrollTop` 验证 | 内容超出时可内部滚动（scrollHeight>clientHeight 且 scrollTop 可变），不被裁切；dialog 不出视口 | `shots/after-dialog-long-*.png` | NOT_RUN |
| A11Y-14 | 回执 dialog 内容真实性 | 读标题/正文/出处文字 | 明确“本页模拟/未作为真实项目数据保存”；不出现虚假成功声明 | `json/probe-after.json` dialog | NOT_RUN |

## D. 触控目标（44×44 CSS px）

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-15 | 主要操作 44×44 全量 | 1440/1024/768/390/320 扫描可见 `a/button/summary/[role=tab]` 的 rect；重点：Hero 主/次 CTA、页头 CTA、五步 Tab、上一步/下一步、查看原文、重置、依据展开、dialog 关闭、视频块 | 主要操作宽高均 ≥44×44（或有明确等效间距例外并说明） | `json/probe-after.json` targets* | NOT_RUN |
| A11Y-16 | 决赛演示视频块触控目标（Lead 新增） | 测视频块链接与页脚外链 rect | 主视频块 ≥44×44；页脚外链若小于 44 记录并评估 2.5.8 例外 | `shots/after-targets-390.png` | NOT_RUN |
| A11Y-17 | 上一步/下一步（移动端） | 390 宽测 `.storyFooter button` rect | 宽高均 ≥44；**基线为 40×44，预期修复或记 MAJOR** | `json/probe-after.json` targetsMobile390 | NOT_RUN |
| A11Y-18 | 页头 CTA（701–1024 触屏） | 1024/768 宽测页头 CTA 高度 | ≥44（基线 40px，触屏场景风险） | `json/probe-after.json` targets* | NOT_RUN |
| A11Y-19 | 品牌/页脚链接（WCAG 2.5.8） | 测品牌链接、页脚三个链接 rect 与相邻间距 | ≥24×24，或满足“24px 圆不与其他目标相交”的间距例外并记录 | `json/probe-after.json` targets* | NOT_RUN |

## E. 字号（关键说明 ≥12.8px）

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-20 | 关键说明计算字号 | 逐项读 `getComputedStyle().fontSize`（1440/390）：Hero 边界说明、示例披露、五步底部边界、委托脚注、执行列表限制、条件说明、回执帮助、已保存回执说明、建议依据脚注、dialog 出处、状态消息 | 全部 ≥12.8px；<12.8 即 FAIL 并给出选择器/测量值/截图 | `json/probe-after.json` keyText* | NOT_RUN |
| A11Y-21 | 示例/模拟披露字号 | 测“内置示例项目”“实际工作区界面，使用内置示例数据。”等披露文本 | ≥12.8px（B3 明确 0.65rem 元数据不得承担关键解释） | 同上 | NOT_RUN |
| A11Y-22 | 功能文本字号 | 测五步 Tab 标签、账号页“返回官网”、状态消息、重置按钮 | ≥12.8px（记录实际值；<12.8 记 MAJOR/MINOR 并说明是否关键） | 同上 | NOT_RUN |

## F. 动效与用户偏好

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-23 | 首屏入场动效（B2 新增） | 记录加载后 `document.getAnimations()`（rAF 采样）；读 hero 元素 animationName/Duration、opacity/transform；结束后再读 | 仅一次性 opacity/translate 入场，时长克制（约 ≤700ms），不阻塞阅读；结束后 opacity=1；无无限循环 | `shots/after-hero-entrance-normal.png` | NOT_RUN |
| A11Y-24 | 阶段切换动效 | 切阶段读面板 transition/animation 时长与方向（data 属性/动画名）；观察是否整屏跳动 | 220–360ms；方向感明确；文字不交叠；不触发页面整体位移 | `shots/after-hero-stage-normal.png` | NOT_RUN |
| A11Y-25 | reduced-motion 内容等价 | `reducedMotion:'reduce'` 下：Hero 入场、三阶段切换、五步 5 状态、依据展开、dialog 全部执行；读 computed animation/transition、元素 opacity、`document.getAnimations()` | 无动画/过渡（或 ≤1ms）；所有内容可见且与正常模式文字一致；无 `opacity:0`/`visibility:hidden` 残留；`scroll-behavior:auto` | `shots/after-reduced-motion.png` | NOT_RUN |
| A11Y-26 | prefers-contrast: more | `emulateMedia({contrast:'more'})` 前后读新容器（hero lens、视频块、强调 rail、dialog）边框/阴影/背景 | 关键容器有可见增强（边框改 ink-soft 等）；文本对比度不下降 | `shots/after-prefers-contrast-more.png` | NOT_RUN |

## G. 对比度与主题

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-27 | 首图失败降级 | 拦截 `**/home/workspace-*.jpg`；读 img naturalWidth、alt 文本是否可见、figcaption、页面是否有 loading 遮罩 | 正文/CTA/示例边界仍可读；无永久 loading；图片区域有可理解降级（alt/图注/占位） | `shots/after-image-failed.png` | NOT_RUN |
| A11Y-28 | 无 JS 可读性 | `javaScriptEnabled:false` 加载 `/`；读可见正文、`main` 标签、h1 可见性 | 正文/CTA/模拟边界可读；若仅骨架 → 记 `NOT_SUPPORTED` + 框架原因（根 `app/loading.tsx` + 异步页面），不判 B2 回归 | `shots/after-no-js.png` | NOT_RUN |
| A11Y-29 | 浅色主题文本对比度 | 1440/390 扫描全部可见文本：computed color + 逐层合成有效背景；正文 ≥4.5、大字（≥24px 或 ≥18.66px 粗体）≥3 | 无低于阈值的正文文本；记录失败项选择器/测量值 | `json/probe-after.json` contrast | NOT_RUN |
| A11Y-30 | 深色主题文本对比度 | `localStorage.theme=dark`（等价用户已保存偏好）加载；1440/390 同法计算；另记录首页/账号页是否有主题切换入口、系统深色首访是否生效 | 正文 ≥4.5、大字 ≥3；可达性事实单独记录（无切换入口为 MINOR 观察，不混同为对比度失败） | `shots/after-dark-1440.png`、`after-dark-390.png` | NOT_RUN |

## H. 响应式与缩放

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-31 | 320 宽无水平溢出 | 320/360/390/768/1024/1280/1440 逐档读 `scrollWidth` vs `clientWidth`，列出越界元素；含五步全状态与 dialog | `scrollWidth ≤ clientWidth+1`；无裁切主动作 | `shots/after-viewport-320x640.png` | NOT_RUN |
| A11Y-32 | 200% 缩放（720×450）可用 | 720×450 下执行 Hero/CTA/Tab/dialog/账号页/skip link 路径 | 无水平溢出；主 CTA 与 Tab 可点；dialog 可内部滚动；表单可用；首行不被 sticky header 完全遮挡 | `shots/after-viewport-720x450(200% zoom).png` | NOT_RUN |
| A11Y-33 | 断点巡检 | 1024/768/360/320 截图（light，可含 dark） | 主动作不裁切、不重叠、不被遮挡 | `shots/after-viewport-*.png` | NOT_RUN |
| A11Y-34 | 文字放大 | root font-size 32px（等价 200% 字体）下检查关键说明/CTA/Tab 是否裁切或重叠 | 文字不裁切、不重叠；布局可重排 | `shots/after-font-200.png` | NOT_RUN |

## I. 锚点与 sticky header

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-35 | 页内锚点不被 sticky header 遮挡 | 直接 `/#experience` 与点击 Hero CTA；读 `#experience` rect.top vs header rect.bottom；`#missions/#moments/#demo` 同 | target.top ≥ header.bottom（建议 ≥ header.bottom+16）；标题/首行完整可见 | `shots/after-anchor-experience.png` | NOT_RUN |
| A11Y-36 | 页脚“回到顶部” | 点击页脚链接；读 hash、scrollY、h1 位置 | 回到顶部，h1 可见 | 截图 | NOT_RUN |

## J. 账号页回归

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-37 | 账号页页头渲染 | `/login` `/register` `/forgot-password` 1440/390：header 存在、sticky、高度、导航“返回官网”、无首页 hero/storyFrame 泄漏 | 账号分支正确渲染；页头不遮挡正文；无首页组件泄漏 | `shots/after-account-*-1440/390.png` | NOT_RUN |
| A11Y-38 | 首页 CSS 不泄漏到账号页 | 读账号页 `main` 类名/计算样式、body 背景 token、skip link 目标；对比首页 `.home` 作用域 | `.home` 作用域规则不作用于账号正文；`siteHeader` 样式正常；`#main-content` 存在 | `json/probe-after.json` accountPages | NOT_RUN |
| A11Y-39 | 账号页移动端可用性 | 390/320：无溢出；CTA 字号/触控；表单 label/input 可用；`main` 不被 sticky header 遮挡 | 无溢出；CTA ≥12.8px 且 ≥44 高；表单可完成；无遮挡 | 截图 + JSON | NOT_RUN |

## K. 外链 / 决赛演示视频（Lead 新增授权项）

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-40 | 视频外链 accessible name | `ariaSnapshot`/accessible name 读取主视频块与页脚同名外链 | 名称说明“Bilibili/外部站点”与“在新窗口打开”（或 `aria-label` 补充）；页脚链接同样需要说明 | `json/probe-after.json` externalLinks | NOT_RUN |
| A11Y-41 | 外链 target/rel/键盘/焦点 | 读 `target`、`rel`；`Tab` 可达；读焦点环 | `target="_blank"`；`rel` 含 `noopener`（建议 `noreferrer`）；键盘可达；焦点可见 | 同上 | NOT_RUN |
| A11Y-42 | 加载不自动播放/不请求外部媒体 | 网络监听：外部 origin 请求数、media/iframe 类型、bilibili/bilivideo 域名；DOM 中 `video/audio/iframe` | 无外部媒体请求、无自动播放、无 iframe 嵌入；纯外链 | `json/probe-after.json` networkOnLoad | NOT_RUN |

## L. 结构、状态与证据完整性

| ID | 检查项 | 方法 | PASS 判据 | 证据 | 状态 |
|---|---|---|---|---|---|
| A11Y-43 | 结构与 ARIA | 扫描 landmarks、heading 顺序、duplicate id、`aria-controls/labelledby` 目标、`aria-label` 误用、装饰符号 `aria-hidden`、空 heading | 无层级跳跃；无失效引用；`aria-label` 不用于 generic；装饰符号不播报；关闭态 dialog 不进入可访问树 | `json/probe-after.json` structure | NOT_RUN |
| A11Y-44 | 状态消息与动态反馈 | 重置/确认/保存/切 Tab 后读 `[role=status]`/`[role=alert]` 节点与文本 | 低频播报；消息出现与清除符合状态；不逐帧；错误用 alert | `json/probe-after.json` statusMessages | NOT_RUN |
| A11Y-45 | 重复断点/级联复查（候选 CSS） | 扫描候选 CSS 的 `@media` 重复与同属性覆盖；检查移动端页头与正文宽度一致性；新增动效是否被 reduced-motion/contrast 覆盖 | 无重复断点顺序依赖；移动端页头与正文对齐；新动效/新容器被偏好媒体覆盖 | `json/baseline-static-inventory.json`（基线对照）+ 候选扫描 | NOT_RUN |
| A11Y-46 | 证据与复现完整性 | 校验脚本可重跑、JSON/截图齐全、命令与退出码、SHA 绑定；报告无“真实用户测试/认证”宣称 | 任一检查均有可复现证据；结论只覆盖实测范围 | 本目录全部文件 | NOT_RUN |

---

## Phase 1 执行步骤

1. Lead 通知“B2 候选 SHA 已提交”后，确认 `git rev-parse HEAD` == 候选 SHA 且工作树干净（`git status --porcelain` 仅允许既有未跟踪证据）。
2. 运行探针（约 3–5 分钟）：
   ```powershell
   cd D:\Projects\hongmen-final-b-brand-home
   node evidence/final-sprint/20261103/b-brand-home/audit/a11y/scripts/probe-a11y.mjs `
     --base=http://127.0.0.1:34111 --label=after --sha=<候选SHA>
   ```
3. 逐项把 `json/probe-after.json` 与截图映射到本表，填 PASS/FAIL/BLOCKED/NOT_RUN；FAIL 项写选择器、测量值、复现步骤、期望。
4. 输出 [A11Y_FINDINGS.md](A11Y_FINDINGS.md)（严重度分级 + 证据 + 残余风险），发 Lead。
5. Lead 修复后：重跑同一脚本 → diff 前后 JSON → 更新 FINDINGS 为最终结论（复验不改判据、不删失败记录）。

## 明确不做 / 不宣称

- 不做真实用户测试、不做读屏软件人工验证、不宣称 WCAG 认证。
- 不修改实现代码、不 commit/push、不启动/停止/重启任何服务进程。
- 不以“上一轮通过”替代当前候选证据；不以单张截图替代可复现测量。
