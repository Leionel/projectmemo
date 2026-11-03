# CLAIMS_FINDINGS — B2/B3 官网宣传事实、CTA、网络与构建独立复核（最终候选）

- **最终候选 SHA：`9bae926e9475cedef118deedf5e002ec8365a23b`**（分支 `codex/final-b-brand-home`；B1 `4be7a4b` → B2 `0a09a2e` → B3 `216cf05` → `cc7c19f` → 最终 `9bae926`）
- 浏览器实测基线 SHA：`cc7c19fed573c79a55f727eaa338ab84fd80cc3b`；`cc7c19f → 9bae926` 为**非行为性静态 delta**（CSS 作用域字号覆盖 + 两个 `role="group"`），经静态 diff 核对后结论继承，详见 §0.1。
- 工作树：`D:\Projects\hongmen-final-b-brand-home`
- 审计人：claims-auditor（独立于实现者；只读源码，只写 `evidence/final-sprint/20261103/b-brand-home/audit/claims/`）
- 审计时间：2026-11-03 12:25–12:46（UTC+8）
- 环境：Lead 提供的本地 Next dev `http://127.0.0.1:34111`（`LLM_MODE=mock`、隔离空库 `prisma/final-preparation.db`、无 seed、无 Worker、无真实账号）；另用 `NEXT_DIST_DIR=.next-build` 的生产构建产物在 `http://127.0.0.1:34112` 临时启动 `next start` 做生产模式路由探针（探针后已停止，端口已释放）。
- 工作树完整性（冻结态）：`git rev-parse HEAD=9bae926`；`git status` 中 app/components 源码 0 修改；审计结束时非 `evidence/` 的未跟踪/修改项为空（`next-env.d.ts` 曾被测试/构建工具改写，已回退）；未跟踪项为 `evidence/` 下审计/证据产物。源码哈希快照：`json/candidate-9bae926-integrity.json`。
- 结论：**候选内容通过本审计清单的全部产品性检查（0 个产品 FAIL）**；`tsc`/`lint`/生产构建全部通过；未发现假实时、假数字、虚构用户、夸大 Worker/鸿蒙能力或外部加载请求。剩余项均为 `NOT_RUN`（真实账号/真机/线上部署）与仓库既有残余（字体 NOTICE、旧 logo 体积、构建生成文件需回退），详见 §8。

> 说明：更早对 `0a09a2e`/`216cf05`/混入未提交改动状态的测量只作 provisional。产品结论来自冻结 `cc7c19f` 的浏览器复跑，并经 §0.1 静态 delta 核对绑定到最终 `9bae926`；早前发现并已由实现者修复的 F1/F2/WARN 在 §6 单列验证。

---

## 0.1 最终候选绑定：`cc7c19f → 9bae926` 静态 delta 核对（PASS）

| 项目 | 核对结果 |
|---|---|
| delta 文件 | 仅 3 个：`components/HomeJourney.module.css`（+10）、`components/HomeJourney.tsx`（+6/−1）、`components/home/HomeHeroLens.tsx`（+1）；`git diff --stat` = `3 files changed, 16 insertions(+), 1 deletion(-)` |
| 改动 1 | `HomeJourney.module.css` 末尾新增 `.judgmentPane [class~="text-xs"]` / `.judgmentPane [class~="text-[11px]"]` 两条作用域覆盖（font-size 0.8rem = 12.8px，line-height 1.6/1.65）；`[class~=]` 命中的是共享 `StateDiffView` 内的字面 Tailwind 类（`text-xs`/`text-[11px]`），选择器限定在首页第 3 步 `.judgmentPane` 内；共享组件文件未改 |
| 改动 2 | `HomeJourney.tsx`：`storyFrame` div 增加 `role="group"`（`aria-label="参赛项目交互示例"` 保留） |
| 改动 3 | `HomeHeroLens.tsx`：`lens` div 增加 `role="group"`（`aria-label="公开示例：委托当前工作包"` 保留） |
| 无文案变化 | `app/page.tsx`、`components/home/homeExample.ts`、`components/SiteHeader.tsx` 在 `cc7c19f`/`9bae926` 两版 **blob hash 完全相同**；delta 中无任何中文文案、标题、按钮文字增删 |
| 无链接/CTA/网络变化 | delta 中无 `href`/`http(s)://`/路由/外链改动；首页作用域内唯一外部 URL 仍为用户提供的 Bilibili 常量（1 处）；`/login?from=%2Ffocus`、`/focus`、`#experience` 等 href 未变 |
| 文案关键点复核（HEAD 静态 grep） | “公开示例 · 不调用模型 · 不写入你的项目。”=1；“看一遍决赛演示”=1，“完整讲一遍”=0；“决赛演示（Bilibili，在新窗口打开）”=1；Demo 第 1 步“任务安排、比赛材料和老师建议”=1；全 app/components “参赛要求”=0 |
| 类型检查（9bae926 实跑） | `npm.cmd exec tsc -- --noEmit` **exit 0**（9.1s，无输出；见 `logs/tsc-noEmit-9bae926.log`） |
| 结论 | 该 delta 只影响首页第 3 步内元数据字号与两个分组语义，不改变文案/链接/CTA/网络/动效行为；§2–§7、§9 的浏览器与构建结果（`cc7c19f`）**直接继承有效**，报告结论绑定最终 SHA `9bae926` |

证据：`json/candidate-9bae926-integrity.json`、`logs/delta-cc7c19f-to-9bae926.patch`、`logs/copy-link-invariants-9bae926.json`、`logs/tsc-noEmit-9bae926.log`。

---

## 1. 逐项判定总表（对照 task-6 Phase 1 要求）

| 编号 | 检查项 | 判定 | 证据 |
|---|---|---|---|
| P1-a | 匿名完整旅程网络审计：无 POST/PUT/PATCH/DELETE `/api`、无外部域（点击视频外链前）、无模型调用 | **PASS** | `json/network-audit.json`；`logs/phase1-network-cc7c19f.log` |
| P1-b | CTA：`#experience` 不被 sticky header 遮挡（多断点/200% 等效）；未登录“进入工作台”三处最终 URL/状态码一致且可达登录；页尾 CTA 与 Hero 一致 | **PASS** | `json/cta-audit.json`；`logs/phase1-cta-cc7c19f.log`；`json/production-route-probe.json` |
| P1-c | 文案事实：Hero 与 Demo 同一任务/来源/缺口/回执边界；所有示例有可见模拟标注；无夸大/假实时/假数字/虚构用户/假时间戳 | **PASS** | `json/claims-check.json`（41/41）；`logs/phase1-claims-cc7c19f.log` |
| P1-d | 简体中文规范与反 AI-slop（规格 05 §8） | **PASS** | `json/claims-check.json` C-17/C-18/C-19/C-40 |
| P0 | 最终候选绑定：`cc7c19f → 9bae926` 静态 delta 仅 CSS 作用域字号 + 2 个 `role="group"`，无文案/链接/CTA/网络/动效行为变化 | **PASS** | §0.1；`json/candidate-9bae926-integrity.json`、`logs/delta-cc7c19f-to-9bae926.patch`、`logs/copy-link-invariants-9bae926.json` |
| P1-e | `npm.cmd exec tsc -- --noEmit` / `npm.cmd run lint` | **PASS**（tsc exit 0；lint exit 0，0 error/9 条仓库既有 warning，均不在首页文件） | `logs/tsc-noEmit-cc7c19f.log`、`logs/tsc-noEmit-9bae926.log`、`logs/lint-cc7c19f.log` |
| P1-f | 生产构建 `NEXT_DIST_DIR=.next-build`（Start-Track 同款 mock/隔离环境），记录退出码/耗时/产物/OOM | **PASS**（exit 0，52.9s，43 页，无 OOM；6 条与本页无关的 Turbopack warning） | `logs/build-cc7c19f.log`、`json/build-summary.json` |
| V1 | 决赛演示视频外链：存在、语义正确、加载时 0 外部请求、点击 URL 正确、文案不超用户信息 | **PASS** | `json/claims-check.json` C-11a/b/c、C-14/C-15/C-36、C-35；`json/network-audit.json`；`json/claims-check.json`（C-37 加载期） |
| V2 | Hero/滚动动效不制造实时/Worker 假象；Public 示例标识首屏可见；进入工作台路由行为不变；reduce-motion 内容等价 | **PASS** | `json/claims-check.json` C-01/C-16/C-26/C-27/C-37/C-38/C-39；`json/cta-audit.json` |
| N1 | 已登录态 CTA（“回到我的工作台”→`/focus`）实际点击 | **NOT_RUN** | 环境无账号、注册未开放；未创建账号（避免写入隔离库/伪造 session）。服务端 session 分支已源码核对（`app/page.tsx:68-71`），建议实现者/Lead 用隔离测试账号补验 |
| N2 | 真实手机/鸿蒙客户端与真实后端联调、线上域名部署 | **NOT_RUN** | 设备/部署条件不在本审计范围；本页仅发“界面示意·实际可用范围取决于部署与授权”的条件句 |
| N3 | 生产 HTTPS 域名下路由行为 | **NOT_RUN**（已用生产构建本地 `next start` 做等价探针） | `json/production-route-probe.json` |

---

## 2. 网络审计（匿名完整旅程；实测于 `cc7c19f`，经 §0.1 非行为性 delta 继承至 `9bae926`）

旅程覆盖：加载 → Hero 三阶段切换（含 20 次快速切换）→ 查看/收起依据 → 主 CTA 锚点 → 五步 Demo 越级到第 5 步验证门槛 → 确认示例行动 → 保存模拟回执 → 回依据页 → 重置 → 原文 dialog/Esc → 滚动动效扫描 → 05/页脚 Bilibili 外链点击。

| 指标 | 结果 | 判定 |
|---|---|---|
| 总请求 | 116 | — |
| `/api` 请求 | **0** | PASS |
| `/api` 写（非 GET/HEAD） | **0** | PASS |
| 视频点击前的外域请求 | **0**（含加载、Hero/Demo 全部交互、滚动扫描） | PASS |
| 模型调用迹象 | **0** | PASS |
| 旧 `workspace-desktop/mobile.jpg` 请求 | **0**（旧主视觉已删除；DOM 无 figure/figcaption/workspace 图） | PASS |
| 图片请求 | 加载期仅页头 `logo.png`（既有 BrandLink，4 条含 preload 重复）；点击 Bilibili 后另有外部站自身图片 3 条 | 说明性 |
| 请求失败 / page error | 0 / 0 | PASS |
| console warning | 3 条，均为 `logo.png was preloaded ... but not used`（既有 `BrandLink` 的 `priority unoptimized` 预加载告警；与本次 B2/B3 文案无关，见 §8-R1） | 残余 |
| 外链点击后 | 主页面 URL 不变；新窗口 URL 与给定 URL 一致（Bilibili 规范化为 `.../BV1Qaxb6PE7G/?vd_source=...`，仅补 `/`，参数保留）；外部站自身产生 61 条请求（含其自身 2 条 POST 遥测） | PASS（属显式点击后的外部站行为） |

关键步骤实测（节选）：Hero 默认“03 回来后”；离开/期间/回来三阶段文案真实变化且 20 次快速切换后状态一致（`finalMatchesBack=true`）；依据展开 3 条原文；Demo 未确认时第 5 步显示“先确认行动…不会把行动标为完成”；确认后保存模拟回执并回依据页可见“新增模拟回执”；重置提示“示例已重置，未修改任何个人项目”；dialog Esc 关闭且焦点回到“查看原文”按钮。

---

## 3. CTA / 锚点 / 路由（实测于 `cc7c19f`，经 §0.1 非行为性 delta 继承至 `9bae926`）

### 3.1 `#experience` 锚点与 sticky header

| 视口 | section top | header bottom | 标题 top | 遮挡 | 判定 |
|---|---|---|---|---|---|
| 1440×900 | 79.6px | 57px | 202.6px | 否 | PASS |
| 1280×720 | 79.6px | 57px | 193.1px | 否 | PASS |
| 1024×768 | 80.0px | 57px | 193.0px | 否 | PASS |
| 390×844 | 79.7px | 57px | 160.4px | 否 | PASS |
| 360×780 | 80.0px | 57px | 160.7px | 否 | PASS |
| 320×780 | 80.5px | 57px | 161.1px | 否 | PASS |
| 720×450（1440@200% 等效） | 80.3px | 57px | 161.0px | 否 | PASS |
| 640×360（1280@200% 等效） | 80.3px | 57px | 161.0px | 否 | PASS |

直接访问 `/#experience` 同样不被遮挡；8/8 通过；各视口无水平溢出。

### 3.2 未登录三处“进入工作台”

| 入口 | href | 最终 URL | 登录表单 | 判定 |
|---|---|---|---|---|
| 页头 CTA | `/focus` | `…/login?from=%2Ffocus` | 可见（h1“登录忆程”） | PASS |
| Hero 次要 CTA | `/login?from=%2Ffocus` | `…/login?from=%2Ffocus` | 可见 | PASS |
| 终局（页尾）CTA | `/login?from=%2Ffocus` | `…/login?from=%2Ffocus` | 可见 | PASS |

三处最终 URL 一致、均可达登录；Hero 主 CTA 保持 `#experience`；页尾无第二套不同认证入口。生产模式（`.next-build` + `next start`，端口 34112）：页头 CTA 与直接 `/focus` 的浏览器最终 URL 均为 `/login?from=%2Ffocus`、登录表单可见、加载期外域请求 0。

> 路由状态码说明：本仓库 Next 16.4.3 在 **dev 与生产** 下对 `/focus`/`/projects` 的匿名文档请求均返回 **HTTP 200**，响应体内嵌 `NEXT_REDIRECT;replace;/login?from=%2Ffocus;307`，浏览器最终落到登录页（实测两环境一致）。因此不能把 HTTP 200 解读为匿名可访问工作台；以浏览器最终 URL 为准。生产探针证据：`json/production-route-probe.json`。

---

## 4. 文案事实与示例边界（实测于 `cc7c19f`；`9bae926` 静态复核无文案变更，41 项全 PASS）

| 检查 | 结果 |
|---|---|
| 首屏 Public 示例标识 | “公开示例 · 不调用模型 · 不写入你的项目。”在 1440/1280/390 首屏可见（top≈526 等）；Hero 卡片 kicker“公开示例 · 忆程参赛作品开发”、卡片 footer“冻结示例 · 不调用模型 · 与下方五步示例使用同一份素材”可见 |
| Hero 与 Demo 同一任务 | 项目“忆程参赛作品开发”出现于 Hero kicker 与 Demo 头部；委托“整理阶段汇报”一致（Hero/截图删除后仅同一示例） |
| 同一来源 | Hero 依据面板与 Demo 原始记录均逐字使用 `components/home/homeExample.ts` 三源（比赛材料/任务安排/老师建议），与 `prisma/seed.ts` 原文一致 |
| 同一缺口 | “演示流程的实际结果/没有完成回执”在 Hero 三阶段与 Demo“当前状态待确认”中一致 |
| 回执边界 | 门槛（先确认再填回执）、保存后“模拟回执已加入本页示例”“结果由你在本页填写，未经过实际操作核验”、回依据页可见“新增模拟回执”、重置清空并提示未修改个人项目 |
| Demo 标注 | 步骤内“本页模拟操作/预设示例/模拟数据/只影响本页示例”；底部“已有记录取自内置素材；建议与回执为本页演示。不会调用模型或修改个人项目。”；第 1 步已统一为“任务安排、比赛材料和老师建议”（全页无“参赛要求”残留） |
| 冻结示例说明 | 01 节：“这一段是冻结的示例状态：不连接服务器，也不代表任务此刻正在执行。”条件 details 保留：启用委托/配置模型/Worker/单独授权/创建行动仍需确认/服务端重新检查授权预算材料 |
| 假实时/假数字扫描 | 无“正在执行/实时跟进/Worker 在线/刚刚检查”等非否定表述；无成功率/百分比/节省时间/播放量/点赞/观看数/用户评价；无“更新于/观察于/采集于”式假时间戳 |
| 反 AI-slop | 无“重新定义/赋能/无限可能/未来已来/一站式/颠覆/改变世界”等空话；信息密度由内容承载 |
| 旧截图问题 | 旧 `workspace-*.jpg` 已不被首页引用；DOM 无 figure/figcaption；无“实际工作区界面/图注缺日期”风险 |
| 长期委托与鸿蒙 | 保留条件式说明（Worker/授权/结构化材料/创建行动需确认）；鸿蒙仅写“同一服务/同一项目/同一条任务，换设备后仍从原位置继续”，旁注“界面示意 · 实际可用范围取决于部署与授权”，未宣称安装/小艺/Intents/离线；与源码与历史验收证据相容（真机仍属 NOT_RUN） |

示例逐项依据与基线对比见 `BASELINE_CLAIMS.md`；本次 B3 未改变上述事实口径（仅视觉/动效/字号）。

---

## 5. 新需求 V1（Bilibili 外链）复核

| 断言 | 结果 |
|---|---|
| 链接数量/URL | 2 条（05 决赛演示区、页脚）；`href` 精确等于 `https://www.bilibili.com/video/BV1Qaxb6PE7G?vd_source=eaf1b5590706fdf5d967f5f1d697db8b` |
| 语义 | 两条均 `target="_blank"`、`rel="noopener noreferrer"`；无 `iframe`/`video`/`audio`/`autoplay` |
| 可感知外部/新窗口 | 05 区可见文案“2026 C4-AI 决赛演示视频 / 忆程 ProjectMemo · Bilibili · 新窗口打开”，区块说明“视频托管在 Bilibili，点击后在新窗口打开外部站点”；页脚链接补 `aria-label="决赛演示（Bilibili，在新窗口打开）"` |
| 加载期外域 | 0（含 Hero/Demo 交互与滚动全程）；外域请求仅发生在用户显式点击后，且为 Bilibili 自身页面行为 |
| 点击跳转 | 两处点击均打开新窗口，URL 正确（外部站归一化为 `.../BV1Qaxb6PE7G/?vd_source=...`）；主页面不跳转/不滚动 |
| 文案范围 | 仅使用用户提供的“2026 C4-AI 决赛演示视频”“忆程 ProjectMemo”与 URL 域事实；无时长/播放量/内容细节；05 区标题已从“完整讲一遍”改为“看一遍决赛演示。” |

---

## 6. 早前 provisional 问题的最终状态（均已修复并复验）

| 编号 | 早前问题 | `cc7c19f` 状态 | 复验证据 |
|---|---|---|---|
| F1 | 页脚“决赛演示”外链无可感知外部/新窗口线索 | **已修复** | `aria-label="决赛演示（Bilibili，在新窗口打开）"`；C-11c PASS |
| F2 | Demo 第 1 步“参赛要求”与来源标题“比赛材料”不一致 | **已修复**；全页已无“参赛要求” | C-24/C-25 PASS |
| WARN | 05 区“在比赛里，完整讲一遍。”超出用户提供信息 | **已修复**：改为“看一遍决赛演示。” | C-36/C-14 PASS |

旧 `0a09a2e` 遗留风险项：Hero 旧大图/图注问题在 B3 已随主视觉删除而消失；demo 身份与来源统一已在 B2 完成并在 B3 保持。

---

## 7. 动效复核（B3 新增）

| 断言 | 结果 |
|---|---|
| 不制造实时/Worker 假象 | 动效仅由滚动/一次性入场所驱动（`components/home/HomeMotion.tsx` 只用 `IntersectionObserver` + `scroll` + `rAF`，无 timer/时钟文本/进度百分比）；全文扫描“正在执行/实时/刚刚/Worker 在线”均处于否定或条件语境；顶部阅读进度线 `aria-hidden` 且无文字 |
| 不改变事实/CTA | 动效不隐藏内容（各 section opacity=1/height>0）；三阶段与 Demo 文案、CTA href、任务身份均与静态一致（本报告 §3/§4） |
| 加载期网络 | 滚动扫描阶段外域请求 0、`/api` 0 |
| reduce-motion | `data-motion="reduced"`；`animation-name:none`、`transition-duration:0s`；内容与交互等价可读；rail 不点亮但正文完整 |
| 无 JS | 服务端 HTML 含 H1/边界/示例/收尾/rail 文案（`bytes=68783`），内容可读 |
| 20 次 Hero 快速切换 | 状态不丢、最终“回来后”与默认一致 |
| 键盘 | Hero 方向键/End、Demo End 正常切换；dialog Esc 焦点返回触发按钮 |

---

## 8. 残余项 / 需 Lead 处理（非产品 FAIL）

| 编号 | 事项 | 影响 | 最小处理 |
|---|---|---|---|
| R1 | dev console 3 条 warning：`/logo.png was preloaded ... but not used`（既有 `BrandLink` `<Image priority unoptimized>` 预加载策略；页头 logo 830KB/1254px 按 28px 显示） | 仅性能/告警；不阻断发布，不影响事实/CTA | 后续可去掉 `priority` 或压缩 logo / 改用优化尺寸；不属 B2/B3 回归 |
| R2 | 生产构建曾自动改写 `next-env.d.ts`/`tsconfig.json`；二者均已回退，审计结束时 `git status` 非 `evidence/` 项为空 | 若误提交生成路径会污染候选；当前已清理 | 最终提交前确认 `git status` 仅 `evidence/` 未跟踪；`.next-build` 已被 `.gitignore` 的 `.next-*/` 忽略，未提交 |
| R3 | `pm-serif-brand.ttf` 缺独立 NOTICE；`public/logo.png` 无外部来源说明、`logo-v2.png` 重复未引用 | 仓库既有许可/素材文档缺口（Phase 0 已记录） | 补最小 NOTICE/来源说明；压缩/清理冗余 logo；不属 B2 回归 |
| R4 | 已登录 CTA（“回到我的工作台”→`/focus`）未实测 | 匿名/服务端路由已 PASS；登录后分支 `NOT_RUN` | 用隔离测试账号补验（不写真实库）；不影响匿名官网发布，但签收表需记 NOT_RUN |
| R5 | 真实鸿蒙设备/真实后端/线上 HTTPS 部署未验 | 页面仅用条件句，无“已验”宣称 | 由 D/E/主控在各自证据轨覆盖；官网文案层面不阻塞 |
| R6 | 点击外链后 Bilibili 页面自身发起 61 条请求（含 2 条 POST 遥测） | 外部站行为，非本页发起；主页面不变 | 说明性记录即可 |
| R7 | 构建 6 条 Turbopack warning（`lib/mission/workerPresence.ts`、`lib/services/attachmentService.ts` 动态 fs 追踪） | 与首页无关，既有代码；构建仍 exit 0 | 非本 Track 修复范围；记录 |
| R8 | lint 9 条 warning（`app/api/me/memory/route.ts`、`NewProjectForm.tsx`、`RepoSignalsCard.tsx`、`UserNav.tsx`、`lib/memory/personalMemoryService.ts`、3 个测试文件） | 0 error；均为仓库既有项，首页文件无 warning | 不阻塞；记录 |
| R9 | 外链点击后 URL 被 Bilibili 归一化补“/” | 非缺陷 | 说明性记录 |

---

## 9. 命令与构建实测

| 命令 | 退出码 | 耗时 | 结果摘要 | 日志 |
|---|---|---|---|---|
| `npm.cmd exec tsc -- --noEmit`（`cc7c19f`） | **0** | 10.9s | 无输出（0 error） | `logs/tsc-noEmit-cc7c19f.log` |
| `npm.cmd exec tsc -- --noEmit`（最终 `9bae926`） | **0** | 9.1s | 无输出（0 error；静态 delta 后复跑） | `logs/tsc-noEmit-9bae926.log` |
| `npm.cmd run lint`（`cc7c19f`） | **0** | 41.2s | 0 error，9 个既有 warning（均不在首页文件） | `logs/lint-cc7c19f.log` |
| `npm.cmd run build`（`NEXT_DIST_DIR=.next-build`，Start-Track 同款 mock/隔离库环境；构建于 `cc7c19f`，delta 为非行为性，产物对 `9bae926` 有效） | **0** | 52.9s | Next 16.4.3 Turbopack；编译 12.7s；TypeScript 24.4s；43/43 静态页；6 条与本页无关的 warning；**无 OOM**；产物 3,758 文件 / 221.7MB（`.next-build`，gitignored） | `logs/build-cc7c19f.log`、`json/build-summary.json` |

构建环境（逐项）：`DATABASE_URL=file:D:/Projects/hongmen-final-b-brand-home/prisma/final-preparation.db`、`ATTACHMENT_DIR=…\tmp\final-preparation\attachments`、`LLM_MODE=mock`、`FOCUS_AGENT_ENABLED=true`、`FOCUS_AGENT_R4_ENABLED=true`、`FOCUS_CONTINUITY_ENABLED=true`、`FOCUS_ASYNC_ENABLED=false`、`FOCUS_WEB_ENABLED=true`、`MISSION_ENABLED=true`、`MISSION_UI_ENABLED=true`、`MISSION_WRITES_ENABLED=true`、`MISSION_WEB_ENABLED=false`、`MISSION_AUTO_CONTINUATION_ENABLED=false`、`NEXT_DIST_DIR=.next-build`；未设置 `PROJECTMEMO_BUILD_SKIP_TYPECHECK`。构建产物未提交。

生产模式路由探针（临时 `next start` on 34112，探针后已停止）：首页 200、边界标识可见、加载期外域 0、2 条 Bilibili 链接；页头 CTA/直接 `/focus` 最终 URL 均 `/login?from=%2Ffocus`、登录表单可见；文档状态码 200（响应内嵌 NEXT_REDIRECT）。

---

## 10. 复跑方法

```powershell
# 需 Lead 提供 dev server（mock/隔离库）
$env:AUDIT_BASE_URL='http://127.0.0.1:34111'
$env:AUDIT_SHA='9bae926e9475cedef118deedf5e002ec8365a23b'  # 浏览器脚本实测于 cc7c19f；9bae926 为静态 delta 继承
node evidence/final-sprint/20261103/b-brand-home/audit/claims/scripts/phase1-network.mjs
node evidence/final-sprint/20261103/b-brand-home/audit/claims/scripts/phase1-cta.mjs
node evidence/final-sprint/20261103/b-brand-home/audit/claims/scripts/phase1-claims.mjs
# 生产构建与探针（构建产物 .next-build 不提交）
$env:NEXT_DIST_DIR='.next-build'   # + §9 环境变量
npm.cmd run build
```

---

## 11. 证据索引（本目录）

| 文件 | 内容 |
|---|---|
| `json/network-audit.json` | 候选 cc7c19f 匿名全旅程 116 请求全量、0 写/0 外域/0 模型断言、外链点击后外部请求、视频 URL、滚动动效阶段 |
| `json/cta-audit.json` | 8 视口锚点遮挡测量、三处 CTA 点击最终 URL、页头 sticky/导航清单 |
| `json/claims-check.json` | 41 项文案/边界/ARIA/键盘/reduce-motion/no-JS/动效/外链检查明细（0 failed） |
| `json/production-route-probe.json` | `.next-build` 生产模式首页/页头 CTA/`/focus` 路由与加载期外域 |
| `json/build-summary.json` | 构建退出码/耗时/环境/产物/警告/OOM/生成文件 |
| `json/candidate-cc7c19f-integrity.json` | 浏览器实测基线候选 SHA、分支、脏文件、源码哈希 |
| `json/candidate-9bae926-integrity.json` | **最终候选 SHA**、分支、工作树状态、delta 文件/统计、源码哈希 |
| `logs/delta-cc7c19f-to-9bae926.patch`、`logs/copy-link-invariants-9bae926.json`、`logs/tsc-noEmit-9bae926.log` | 最终 delta 静态核对、文案/外链不变量 grep、9bae926 tsc 输出 |
| `json/routes-baseline.json`、`json/routes-ui-baseline.json`、`json/baseline-network.json`、`json/first-screen-labels.json`、`json/font-metadata.json`、`json/font-cmap.json` | Phase 0 基线证据（见 `BASELINE_CLAIMS.md`） |
| `json/worktree-integrity-snapshot.json`、`json/candidate-216cf05-integrity.json`、`logs/worktree-uncommitted-diff.patch` | 审计过程中间态快照（仅追溯用；最终结论以 cc7c19f 为准） |
| `logs/phase1-network-cc7c19f.log`、`logs/phase1-cta-cc7c19f.log`、`logs/phase1-claims-cc7c19f.log`、`logs/tsc-noEmit-cc7c19f.log`、`logs/lint-cc7c19f.log`、`logs/build-cc7c19f.log`、`logs/prod-route-probe-34112.log` | 原始输出 |
| `shots/phase1-*.png` | 首屏 3 视口、Demo 回执/依据、reduce-motion、no-JS、全页截图 |
| `scripts/phase1-*.mjs`、`scripts/font-*.py` | 可重跑只读脚本 |

---

## 12. 最终结论

在最终冻结候选 **`9bae926e9475cedef118deedf5e002ec8365a23b`** 上，官网首页的**宣传事实、示例边界、CTA/路由、视频外链、网络行为、动效真实性、类型/lint/生产构建**均通过独立复核；**没有需要 Lead 修复的产品性 FAIL**。浏览器实测在 `cc7c19f` 完成，`cc7c19f → 9bae926` 经逐行静态 diff 证明只含 CSS 作用域字号覆盖（首页第 3 步 11–12px→12.8px）与两个 `role="group"`，不改变文案/链接/CTA/网络/动效，故结论绑定最终 SHA。可发布性剩余项为：已登录分支/真机/线上部署属 `NOT_RUN`；`next-env.d.ts` 工具生成修改与 `.next-build` 产物不得提交；PM Brand NOTICE 与 logo 体积/告警为仓库既有残余。若 Lead 需要，我可在最终提交后对 commit 内容再做一次静态比对（不重跑浏览器）。
