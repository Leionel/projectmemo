# BASELINE_CLAIMS — 官网宣传事实、示例边界、CTA 与素材许可基线

- 工作树：`D:\Projects\hongmen-final-b-brand-home`（分支 `codex/final-b-brand-home`）
- 基线 SHA：`485d485378637e1da3280ed092739d441c8cf749`
- 审计人：claims-auditor（独立于实现者；只读源码，只写本目录）
- 审计时间：2026-11-03 11:38–11:52（UTC+8）
- 基线页面文件完整性：`app/page.tsx`、`app/home.module.css`、`components/HomeJourney.tsx`、`components/SiteHeader.tsx`、`app/layout.tsx`、`public/home/`、`public/fonts/` 与 HEAD 无差异（`git diff --stat HEAD` 为空）；工作区仅 `next-env.d.ts` 为 Next dev 自动修改（非提交项），另有 B1 未跟踪原型 `components/home/`、`app/prototype/`。
- 服务环境（Lead 提供，未重启）：`http://127.0.0.1:34111`，Next dev，`LLM_MODE=mock`，空隔离库 `prisma/final-preparation.db`，无 seed，无 Worker。
- 本报告只做**基线事实/边界清点与可复现测量**，不构成 B2 验收；Phase 1 将对 B2 候选 SHA 重新逐项 PASS/FAIL。

---

## 0. 结论速览

| 维度 | 基线结果 |
|---|---|
| 匿名首页网络 | **干净**：本次独立采集 27 条请求，0 条 `/api`，0 条外域 origin，0 条模型调用迹象，0 失败，0 console/page error；另一独立证据任务（`evidence/.../before/network-baseline.json`，186 条请求）结论一致。 |
| 五步 Demo 边界 | 运行期全为本地 React 状态：确认行动、保存模拟回执、回依据页、重置均无网络写；边界文案存在（“不会调用模型或修改个人项目”“模拟数据”“未经过实际操作核验”等）。 |
| 登录态路由 | 未登录 `/focus` 在 **dev** 先返回 HTTP 200（响应内嵌 `NEXT_REDIRECT;replace;/login?from=%2Ffocus;307`），浏览器最终停在 `/login?from=%2Ffocus`（200，登录表单可见）；页头、Hero 次要 CTA、页尾 CTA 三处“进入工作台”最终 URL 一致。 |
| 首屏 CTA 锚点 | `#experience` 未被 sticky header 遮挡：1440×900 下 section top=88.2px，header bottom=57px，标题 top=168.6px（PASS，Phase 1 需覆盖 1280/390/200% 缩放）。 |
| 示例标注 | **有缺口**：首屏可见“下方示例无需登录”“内置示例项目”，但首屏内没有“公开示例/不调用模型/模拟”明确字样；“不会调用模型”说明位于首屏下方（1440×900 下 top≈1911）。B2 必须在 Hero 与 Demo 可见处补齐。 |
| 素材许可 | PM Editorial：Noto Serif SC OFL 1.1 子集，NOTICE + OFL 齐备；PM Brand：Noto Serif SC 子集，仅有目录级 OFL，无单独 NOTICE/来源说明（建议补）；Manrope：OFL 齐备但当前 CSS 未使用；截图来源可查（隔离 E2E 种子项目 + mock），无私隐，但为 **2026-10-23 静态采集**，之后项目详情 UI 有 4 次提交变更，“实际工作区界面”需标注日期/版本或重采。 |
| 总体 | 基线宣传事实**无硬性虚假宣称**，但有 3 个必须在 B2 修补的标注/一致性问题（首屏示例标签、截图时效标注、任务身份统一）；新增的决赛视频外链与 Hero 动效纳入 Phase 1 审计。 |

---

## 1. 首页事实性宣称逐条清点

判定口径：`有依据`＝源码/仓库证据可支持；`需限定`＝成立但缺上下文/标注，B2 必须补；`不得出现`＝与可证明事实冲突或规格明令禁止。

### 1.1 首屏与全局定位

| ID | 位置 | 宣称原文 | 类型 | 源码/证据依据 | 判定 | B2 要求 |
|---|---|---|---|---|---|---|
| C01 | `app/page.tsx:30-33` | “面向大学生的 / 个人项目 Agent” | 产品定位 | `AGENTS.md:3`（面向大学生项目学习）；`app/layout.tsx` 元数据 | 有依据 | 保留；“Agent”须与后文“建议需你确认”一致，不得写成“全自动 Agent” |
| C02 | `app/page.tsx:34-38` | “项目隔了几天，再打开也接得上。” | 核心能力 | `lib/continuity/handoff.ts`（绑定原 Mission 不派发）、`lib/mission/readback.ts`、`lib/server/globalFocus.ts`（Focus 主上下文）；当前空库/mock 无法端到端演示 | 需限定（源码有依据，环境未证明） | 可保留为主标题；不得补“实时/正在接续” |
| C03 | `app/page.tsx:40-42` | “会议记录、实验结果、方案调整，都留在项目里。” | 能力 | capture 类型含 `meeting_note`/`experiment_log`（`lib/types.ts:43`）、会议状态变化 `lib/services/meetingStateDiffService.ts`、方案调整 `lib/services/changeImpactService.ts:283` | 有依据 | 保留；不得列举未实现的信息类型 |
| C04 | `app/page.tsx:41` | “先看上次的进展与判断依据，再决定下一步。” | 能力 | Focus `primaryContext`、Mission 读回/责任视图；建议需用户确认（`AGENTS.md:41`） | 有依据 | 保留 |
| C05 | `app/page.tsx:53-55` | “下方示例无需登录。个人项目在工作台中管理。” | 示例边界+导航 | 实测：Demo 全程无登录、无 `/api`；匿名 `/projects`、`/focus` 均最终跳转登录页 | 有依据 | 保留；需另加“公开示例，不调用模型”明确标注（见 A1） |
| C06 | `app/page.tsx:58-79` | 图注“实际工作区界面，使用内置示例数据。”；工具栏“忆程工作区 / 内置示例项目”；alt“忆程实际工作区：项目风险状态、记录依据与下一步入口” | 素材事实 | 截图来源：`evidence/pre-r4/20261023-home-story/capture-workspace.pw.txt`（隔离 E2E 库种子项目“人工智能创意赛 忆程 ProjectMemo 作品开发”、mock、仅测试账号登录、无项目写入）；已人工查看图片内容与 alt 相符；但该页自 `c93da46`（2026-10-23 引入截图）后已有 4 次提交（`ce537cf`/`c8194ea`/`0b289a2`/`fae6995`，`app/projects/[id]/page.tsx` +21/−11） | **需限定** | 要么重采当前 UI，要么在图注/alt 标明“2026-10-23 采集的内置示例项目截图”；不得写“当前/实时工作区” |
| C07 | `app/page.tsx:89-100` | “先用一段项目经历试试看 / 准备参赛作品，上次做到哪里了？ / 示例取自项目自带的参赛素材。” | 示例来源 | `prisma/seed.ts:11-13` 三条原文与 `HomeJourney.tsx:19-35` 逐字一致（commit `6decd85` 起） | 有依据 | 保留“示例”定性；若改文案，须同步改 `seed.ts` 或标注为改编 |
| C08 | `app/layout.tsx:13-16`、`app/page.tsx:16-20` | 元数据：“个人项目 Agent”“留住过程、找回依据、看清变化、接续行动”“…留下完成回执” | 元数据宣称 | 同上 C02–C04；完成回执链见 `ActionBoard` `resultCardId`/`lib/mission/readback.ts` | 有依据 | 保留；不得加“已通过测试/最先进”等 |

### 1.2 五步 Demo（`components/HomeJourney.tsx`）

| ID | 位置 | 宣称/标注原文 | 判定 | 说明 |
|---|---|---|---|---|
| C09 | `:18` 注释 | “Verbatim demonstration material from prisma/seed.ts; no private project data.” | 有依据 | 三条材料逐字来自 seed；无私人数据 |
| C10 | `:140`、`:147-149` | “参赛项目交互示例”“内置示例项目 / 忆程参赛作品开发” | 有依据（身份别名） | 种子项目全名为“人工智能创意赛 忆程 ProjectMemo 作品开发”；此处为展示短名，B2 需与 Hero 截图身份统一表述 |
| C11 | `:40-42` | “这份示例项目保留了任务安排、参赛要求和老师建议。” | **需限定** | 三条记录标题为“任务安排/比赛材料/老师建议”，第一条正文含初赛要求；把“比赛材料”改称“参赛要求”造成标签/指称不一致，B2 统一用同一标题 |
| C12 | `:45-50` | “历史记录和当前状态分别看。没有找到新的完成结果，不能据此断言功能现在仍未完成。” | 有依据 | 认识论上谨慎；与 `demoDiff` 的 UNCERTAIN 一致 |
| C13 | `:51-57` | “这里展示预设的建议读法，不进行实时模型推理。” | 有依据 | 网络实测 0 模型调用；`demoDiff` 为本地常量 |
| C14 | `:58-64` | “建议还不是待办……这里的操作只影响本页示例。” | 有依据 | 实测无 API 写 |
| C15 | `:65-71` | “完成了什么，由实际结果来说明……保存后回到依据页，可以看到这段结果和原记录放在一起。” | 有依据 | 实测保存后回依据页可见“新增模拟回执” |
| C16 | `:217`、`:235` | “3 条内置素材”“示例整理” | 有依据 | 页面确展示 3 条 |
| C17 | `:247-253` | “当前状态待确认……上述任务现在是否已经完成？现有素材没有提供新的完成回执。” | 有依据 | 不把 Unknown 当 False（符合 `AGENTS.md:39`） |
| C18 | `:264-268`、`:285-287` | “判断与建议 / 预设示例”“这里没有断言当前功能未完成；判断仍需要新的结果记录。” | 有依据 | 与 C12 一致 |
| C19 | `:296-302` | “待用户确认 / 本页示例已确认” | 有依据 | 实测状态切换且提示“没有创建真实待办” |
| C20 | `:356-361` | “完成回执 / 模拟数据” | 有依据 | 实测 |
| C21 | `:362-366` | “先确认行动，再填写模拟回执。单纯切换到这一步，不会把行动标为完成。” | 有依据 | 实测门槛生效 |
| C22 | `:377-383` | “模拟回执已加入本页示例”“结果由你在本页填写，未经过实际操作核验。” | 有依据 | 实测 |
| C23 | `:402-405` | “填写一段模拟完成结果……不要填写私人资料；这不会成为真实项目的完成证明。” | 有依据 | 输入提示有边界 |
| C24 | `:430-434` | `role=status` 通知：“已在本页示例中确认行动，没有创建真实待办。”/“模拟回执已保存在本页，刷新页面后不会保留。”/“示例已重置，未修改任何个人项目。” | 有依据 | 实测三条均出现 |
| C25 | `:436-438` | “已有记录取自内置素材；建议与回执为本页演示。不会调用模型或修改个人项目。” | 有依据 | 但位于 Demo 底部（首屏外） |
| C26 | `:469-484` | 弹层：“示例原始记录”“原文取自项目自带的演示素材，不是在线用户的个人记录。”“这是你在本页填写的模拟回执，没有作为真实项目数据保存。” | 有依据 | 实测弹层与 Esc 关闭 |

### 1.3 长期委托 / 平台 / 边界段

| ID | 位置 | 宣称原文 | 判定 | 说明 |
|---|---|---|---|---|
| C27 | `app/page.tsx:111-116` | “长期委托会保留进度，需要你时停下来。” | 有依据（能力） | 委托/暂停/等待状态见 `lib/mission/workState.ts`、`missionService.ts`；当前空库/mock 无法演示端到端 |
| C28 | `app/page.tsx:117-122` | “比如‘用已有材料整理阶段汇报’。你可以回看执行步骤和草稿；缺材料时补充来源，需要批准时先核对提案。”“暂停后不会从头另建一个任务。继续前，服务端会重新检查授权、预算和材料是否仍然适用。” | 有依据 | `continuationService.ts:91-98` 重新核对预算、`llmContextApproved`、材料充分性；注释“budgets are never reset”（`investigationDelegation.ts:249`） |
| C29 | `app/page.tsx:123-129` | 条件说明：“实际执行需要启用委托功能、配置模型并授权使用相关资料。默认由你确认继续；后台自动接续还需要运行 Worker、单独授权，并满足结构化材料等条件。这里的自动接续仅限读取与分析，创建行动仍需用户确认。” | 有依据（边界齐全） | `MISSION_ENABLED`、`MISSION_AUTO_CONTINUATION_ENABLED` 默认 false、`lib/mission/workerCycle.ts`/`workerPresence.ts`、创建行动需批准；**不得删弱此段** |
| C30 | `app/page.tsx:135-168` | “界面示例 / 等待补充材料 / 这是界面说明，未启动委托或执行模型任务。” | 有依据 | 静态展示，无交互/无请求 |
| C31 | `app/page.tsx:177-203` | “竞赛备赛 / 科研训练 / 课程设计”三类用途 | 有依据（泛化场景） | 不含量化承诺 |
| C32 | `app/page.tsx:212-245` | “Web 与鸿蒙客户端使用同一项目后端。客户端连到同一服务并登录相应账号后，可以接着查看项目资料与行动。” | 有依据（源码） | `AGENTS.md:3` 共享后端；`harmonyos/.../Constants.ets` 真实后端地址；`ProjectHome.ets` 有资料/行动页；历史验收证据 `evidence/pre-r4/20261022-harmony-b2-b4/`（模拟器/构建证据）。**当前候选真机未验（NOT_RUN）**，不得扩写为“已安装/已上架/手机完全离线” |
| C33 | `app/page.tsx:249-258` | “来源可以回看；没有依据的内容会标明缺口。建议需要你判断，重要操作在确认后才应用。模型分析和委托执行取决于实际配置。” | 有依据（边界） | 与 `AGENTS.md` 业务不变量一致；保留 |
| C34 | `app/page.tsx:259-268` | “从自己的项目开始。已有账号可以直接进入工作台。” | 有依据 | 登录页可达；匿名点击最终到登录 |
| C35 | `app/page.tsx:269-273` | “竞赛 · 科研 · 课程项目”“回到顶部 ↑” | 有依据 | 无外部链接 |

### 1.4 明确“不得出现”的表述（规格 05 §10、06 §4/§8、02 B2）

- 假实时/假 Worker：不得出现“服务器正在执行/Worker 在线/刚刚检查成功/正在后台自动处理/持续实时跟进”等无后台事实支撑的标签；页面无 Worker 时不得用静态预览伪装在线服务。
- 假数字/效率：不得写未经量测的“节省 80% 时间”“99% 正确”“3 倍效率”等任何成功率/效率/百分比数字；不得出现倒计时、假心跳、假进度条。
- 假用户/假证据：不得虚构用户评价、头像、使用人数、案例署名；不得把示例数据写成“真实用户/真实运行”。
- 能力夸大：不得写“永久免费后台”“自动完成所有任务”“无需配置即可自动接续”“已接入小艺/Intents/系统分享”“手机完全离线可用”“通过无障碍/安全认证”。
- 结果夸大：不得把“本页模拟回执”称为真实结果/已写入数据库；不得出现“模型处理完成/已成功写入”等与实际状态不符的 toast。
- 反 AI-slop（05 §8）：不得用“重新定义效率/赋能梦想/One platform for everything”等空话；不得堆英文大写小标题/渐变/发光/粒子；每个画面要能回答“用户下一步点哪里”。

---

## 2. 示例边界说明清单（现状）

| 边界说明 | 位置 | 首屏可见？ | 判定 |
|---|---|---|---|
| “下方示例无需登录。个人项目在工作台中管理。” | `page.tsx:53-55` | 是（1440/1280/390 top≈306/306/372） | 有，但未说明“不调用模型/公开示例” |
| “内置示例项目”（图内工具栏） | `page.tsx:59-62` | 是（top≈376/376/428） | 有 |
| “实际工作区界面，使用内置示例数据。”图注 | `page.tsx:78` | 否（top≈973/973/878.6） | 有，但首屏外且缺采集日期 |
| “示例取自项目自带的参赛素材。” | `page.tsx:97-99` | 否 | 有 |
| “这是界面说明，未启动委托或执行模型任务。” | `page.tsx:166-168` | 否 | 有 |
| Demo 内“不进行实时模型推理/只影响本页示例/模拟数据/未经过实际操作核验” | `HomeJourney.tsx:55,62,301,383,399` | 否（需进入 Demo 步骤） | 有 |
| Demo 底部“不会调用模型或修改个人项目。” | `HomeJourney.tsx:436-438` | 否（top≈1911/1904/1978） | 有，首屏外 |
| 首屏“公开示例 / 不调用模型 / 不写私人业务数据”明确标签 | — | **无** | **缺口 A1，B2 必须补** |

---

## 3. CTA 与登录态路由实测

### 3.1 原始 HTTP（匿名、无 cookie；dev 服务）

| 请求 | 状态码 | 最终 URL | 备注 |
|---|---|---|---|
| `GET /` | 200 | `/` | 正常 |
| `GET /focus` | **200** | 浏览器最终 `/login?from=%2Ffocus` | dev 响应内嵌 `NEXT_REDIRECT;replace;/login?from=%2Ffocus;307`；另含 dev 专用调试文本“Switched to client rendering because the server rendering errored: NEXT_REDIRECT”。**不能**把 200 解读为匿名可访问 `/focus` |
| `GET /focus?from=%2Fhome` | 200 | 浏览器最终 `/login?from=%2Ffocus` | 服务端固定 `from=%2Ffocus` |
| `GET /login?from=%2Ffocus` | 200 | 同 URL（`from=%2Ffocus` 保留） | 登录表单可见，h1“登录忆程” |
| `GET /login` | 200 | 同 URL | 正常 |
| `GET /projects`（补充） | 200 | 浏览器最终 `/login?from=%2Fprojects` | 说明“个人项目在工作台中管理”需登录 |

证据：`json/routes-baseline.json`、`json/routes-ui-baseline.json`、`logs/route-probe.log`、`logs/route-ui.log`。dev 模式 200+客户端跳转是 Next dev 行为；生产构建的 307 语义在 Phase 1 若启动生产服务再复核（否则记 NOT_RUN/注明 dev 口径）。

### 3.2 三处“进入工作台”点击（匿名）

| 入口 | 源码 href | 点击后最终 URL | 状态码 | 登录表单 |
|---|---|---|---|---|
| 页头导航 CTA | `/focus`（`SiteHeader.tsx:44-47`） | `http://127.0.0.1:34111/login?from=%2Ffocus` | 200 | 可见 |
| Hero 次要 CTA | `/login?from=%2Ffocus`（`page.tsx:24,48-51`） | 同上 | 200 | 可见 |
| 页尾 CTA | `/login?from=%2Ffocus`（`page.tsx:259-267`） | 同上 | 200 | 可见 |

结论：**最终 URL 一致且可达登录**（PASS）。页头走 `/focus` 中转、Hero/页尾直达登录 URL，形式不同但结果一致；Labels 在匿名态一致为“进入工作台”。

### 3.3 `#experience` 锚点与 sticky header（1440×900，匿名）

- 点击“体验项目接续”后：`location.hash=#experience`、`scrollY=972`；`#experience` section top=88.17px，header bottom=57px，`story-heading` top=168.56px → **标题未被遮挡**（PASS）。
- 依据：`.storySection { scroll-margin-top:5.5rem }`（`app/home.module.css:299-303`）、header 高 56px（`:38-46`）。Phase 1 需复验 1280×720、390×844 与 200% 缩放。

### 3.4 全部 CTA/anchor 清单（匿名）

页头：`/`（品牌）、`#experience`、`#missions`、`#moments`、`/focus`；Hero：`#experience`、`/login?from=%2Ffocus`；页中无 CTA；页尾：`/login?from=%2Ffocus`；footer：`/`、`#home-heading`。**当前首页不存在任何外部链接**（`externalAnchors=[]`）。

---

## 4. 基线网络审计（独立复核）

本次 Playwright 匿名旅程（加载 → Hero 主 CTA → 五步 Tab → 查看原文/Esc → 确认示例行动 → 填写并保存模拟回执 → 回依据页 → 重置）：

- 请求总数 **27**；`/api` 请求 **0**；`/api` 写（非 GET/HEAD）**0**；非本机 origin **0**；模型调用迹象（URL 含 model/llm/chat/openai/…）**0**；失败请求 **0**；console error/warning **0**；page error **0**。
- 请求构成：`/` 文档、Next dev 静态/HMR chunk（本机）、`/home/workspace-desktop.jpg`、`/fonts/pm-serif-brand.ttf`、`/fonts/pm-editorial-serif.ttf`、`/logo.png` 等，全部 127.0.0.1。
- 证据：`json/baseline-network.json`、`logs/homepage-network.log`、截图 `shots/baseline-home-1440x900.png`。
- 交叉印证：独立证据任务同环境采集 186 条请求，0 外域、0 写请求、0 模型调用、0 图片/字体失败（`evidence/final-sprint/20261103/b-brand-home/before/network-baseline.json`、`CAPTURE_REPORT.md §Phase 0`）。
- CSS 无外部 `url()`/`http(s)` 引用；字体均本地托管。

> 说明：本次与证据任务的请求数差异来自采集窗口（本次为单次会话 27 条；证据任务为 warmup+6 次 reload 186 条），结论一致。

---

## 5. 字体与图片许可

### 5.1 字体

| 资产 | 大小/字形 | 引入 | 来源/许可证据 | 判定 |
|---|---|---|---|---|
| `public/fonts/pm-editorial-serif.ttf` | 162,052B；528 字形 | `c93da46`（2026-10-23） | Noto Serif SC（Adobe © 2017-2023）wght=500 子集改名；`PM-Editorial-NOTICE.txt`、`OFL.txt`（SIL OFL 1.1）齐备；生成脚本 `evidence/pre-r4/20261023-home-story/subset-font.py`；字体 name 表保留 OFL 声明 | **可用于官网**；必须随包保留 NOTICE + OFL.txt |
| `public/fonts/pm-serif-brand.ttf` | 3,012B；12 个 cmap 码位（空格 M P c e j m o r t 忆 程） | `3c3d577`（2026-10-22） | name 表：Noto Serif SC ExtraLight / © 2017-2023 Adobe / OFL 文本位于同目录 `OFL.txt`（无 Reserved Font Name 声明）；**无单独 NOTICE/来源说明**；nameID 13/14 未内嵌 | **可用于官网**；建议补 NOTICE（生成方式/字符范围/日期）；字符覆盖“忆程 ProjectMemo”实测无缺字 |
| `public/fonts/manrope-variable.ttf` | 164,700B；742 字形 | `ac04330`（2026-10-22） | Manrope Project Authors，`Manrope-OFL.txt` 齐备；`evidence/pre-r4/20261022-web-home/ACCEPTANCE.md:11` 记录来自 Google Fonts 官方仓库本地托管 | 许可齐全；**当前 CSS 未引用**（冗余资产，可保留但应记录） |
| `public/fonts/OFL.txt`、`Manrope-OFL.txt`、`PM-Editorial-NOTICE.txt` | 4,447B / 4,480B / 592B | 见上 | OFL 1.1 全文；版权行分别为 Adobe / Manrope Authors；未声明 Reserved Font Name | 必须保留并随站点分发 |
| 站点字体使用 | — | — | `home.module.css:1-6`（PM Editorial）、`globals.css:3`（PM Brand）、回退栈含 Noto Serif SC/Songti/SimSun；无外部字体请求 | PASS |

**B2 字体风险**：PM Editorial 是 2026-10-23 按当时 `page.tsx`/`HomeJourney.tsx`/`SiteHeader.tsx`/`AuthScreen.tsx` 文本生成的子集（实测覆盖当前全部标题文案）。若 B2 新增中文标题字符，可能出现“部分字回退到系统宋体”的混排；需用 `subset-font.py` 同法重生成或确认回退可接受。

### 5.2 图片/截图素材

| 资产 | 大小/尺寸 | 引入 | 来源与事实 | 判定 |
|---|---|---|---|---|
| `public/home/workspace-desktop.jpg` | 94,169B；1280×760 | `c93da46`（2026-10-23） | `evidence/pre-r4/20261023-home-story/capture-workspace.pw.txt`：隔离 E2E 数据库、既有 seed 项目“人工智能创意赛 忆程 ProjectMemo 作品开发”、mock 模型、仅测试账号登录、无项目写入。人工查看：页头“学科竞赛/更新于 2026/10/23”、项目概览、风险卡“发现尚未闭环的项目风险”、最近重要变化/最近记录；**无邮箱/用户名/私人材料**；无 EXIF | 来源可查、可公开；但为 10-23 静态截图，须标注采集时间/版本或重采，不得称“当前实时界面” |
| `public/home/workspace-mobile.jpg` | 37,953B；390×680 | 同上 | 同源移动端裁切；无私人信息 | 同上 |
| `public/logo.png` | 830,149B；1254×1254（页面按 28×28 显示） | `c65fe9b`（2026-08-19） | 项目品牌 Logo；无独立来源/授权记录 | 项目自有品牌素材，风险低；若由外部生成工具产出应补来源；**830KB 用于 28×28 显示，建议压缩（视觉/性能项，B3）** |
| `public/logo-v2.png` | 830,149B | 同 commit | 与 `logo.png` **SHA256 完全相同**，未被任何代码引用 | 冗余重复资产，可清理 |
| `.github/assets/projectmemo-focus.png` | 193,999B | 历史 | 规格诊断引用；当前首页未使用 | 非官网上线资产 |

“来源不明资产”结论：**没有发现无来源的第三方版权素材用于首页**；唯一证据缺口是 `pm-serif-brand.ttf` 的生成 NOTICE 与 `logo.png` 的外部来源说明。

---

## 6. 基线异常 / 风险清单（给 Lead 与 B2 实施者）

| ID | 级别 | 问题 | 证据 | 最小修复建议 |
|---|---|---|---|---|
| A1 | 中 | 首屏没有“公开示例/不调用模型/不写私人业务数据”的明确可见标注；仅有“下方示例无需登录”和“内置示例项目” | `json/first-screen-labels.json`（三条边界文案均在首屏外） | Hero 内（CTA 附近或图注工具栏）加一行可见标注，如“公开交互示例 · 不调用模型 · 不写私人业务数据”；Demo 顶部/底部保留现有说明 |
| A2 | 中 | Hero 图注“实际工作区界面”无采集日期/版本；截图为 2026-10-23，项目详情 UI 之后变更 4 次 | `capture-workspace.pw.txt`；`git log c93da46..HEAD -- 'app/projects/[id]/page.tsx'`（+21/−11） | 重采当前 UI，或在图注/alt 写“内置示例项目截图（采集于 2026-10-23，示例数据）”；不要写“当前/实时工作区” |
| A3 | 低 | 任务身份/标签不统一：Demo 短名“忆程参赛作品开发” vs 截图种子项目全名；Demo 把记录“比赛材料”称“参赛要求”；Hero 截图的缺口（风险卡未闭环）与 Demo 缺口（演示流程完成情况待核对）、委托示例缺口（演示流程实际结果）表述不同 | `page.tsx`、`HomeJourney.tsx:42,148`、`prisma/seed.ts` | B2 统一一个示例任务身份（项目名/来源 3 条/缺口 1 条/回执边界）并在 Hero 与 Demo 用同一措辞 |
| A4 | 低 | `pm-serif-brand.ttf` 无单独 NOTICE；`logo.png` 无来源说明；`logo-v2.png` 冗余 | 第 5 节 | 加最小 NOTICE（生成方式、字符范围、日期、OFL 指向）；压缩/清理 logo；或说明保留原因 |
| A5 | 信息 | dev 模式 `/focus` 返回 HTTP 200 并在响应中内嵌 307 重定向（浏览器最终正确到登录页）。生产语义应以构建服务复核 | `json/routes-ui-baseline.json`、`logs/route-probe.log` | Phase 1 若启动生产服务则记录 307；否则在报告中注明“dev 口径”，不得把 200 当匿名可访问证据 |
| A6 | 信息 | 基线无任何外部链接/外域请求；B2 若新增 bilibili 外链，加载阶段必须保持 0 外域请求 | 第 4 节、Lead 新增要求 | 见 7.1 视频外链约束与 Phase 1 断言 |
| A7 | 信息 | 当前空库、无账号、注册未开放 → 已登录态 CTA（“回到我的工作台”/`/focus` 直达）无法本审计实测 | `routes-baseline` 仅匿名 | 记 NOT_RUN；由实现者/Lead 用隔离测试账号在 B2 验收时覆盖；不得用客户端伪造 session 验绿 |
| A8 | 信息 | 本树有并发未跟踪 B1 原型与 `next-env.d.ts` 修改；Phase 1 必须以 B2 候选 SHA 为准并重做完整性快照 | `git status`；`CAPTURE_REPORT.md` | Phase 1 开始记录候选 SHA、相关文件哈希与脏文件清单 |

---

## 7. B2 文案与实现硬约束（可勾选）

### 7.1 新增需求（Lead 2026-11-03 转达的用户授权）

**V1 决赛演示视频外链（Phase 1 复核）**
- 只能做可点击外链，URL 精确为 `https://www.bilibili.com/video/BV1Qaxb6PE7G?vd_source=eaf1b5590706fdf5d967f5f1d697db8b`；不得改写/裁剪/加参数。
- 必须 `target="_blank"` 且 `rel` 含 `noopener noreferrer`；用户可感知“外部站/新窗口”（可见文字或无障碍名称，如“外部视频/新窗口打开/B 站”）。
- 禁止 iframe、自动播放、预加载、embed、`preload`/`link rel=prefetch` 外部资源；**页面加载阶段不得请求 bilibili 或任何外域**。
- 文案只能用用户提供的信息（“2026 C4-AI 决赛演示视频”“忆程 ProjectMemo”）；不得编造时长、播放量、视频内容、录制日期、奖项结果。
- Phase 1 断言：无交互阶段外域请求=0；外链 anchor 的 href/target/rel 精确；点击后新页 URL 与给定 URL 一致（显式点击后才允许外域请求）；首页其他外链=0。

**V2 Hero 入场/阶段切换动效（Phase 1 复核）**
- 动效只能由用户触发或一次性弱入场；不得用时钟驱动“正在执行/正在检查/实时 Worker”的假象；不得出现假心跳、假进度条、倒计时、无限 spinner。
- 三阶段（离开/期间/回来）若实现：必须真实改变内容与 `aria-selected/aria-current`，阶段身份/来源/缺口一致；不得只有标签变色。
- “公开示例，不调用模型，不写私人业务数据”标识必须在首屏可见，且不因入场动效延迟出现/淡出到不可读。
- `prefers-reduced-motion: reduce` 下内容等价可读、无依赖动画的信息；动效不得造成 CLS、遮挡标题或挡住 CTA。
- “进入工作台”路由行为保持不变：页头 `/focus`、Hero/页尾匿名 `/login?from=%2Ffocus`，服务端 session 判断，不新增客户端认证判断；三处最终 URL 一致。

### 7.2 事实一致性约束

1. **同一示例**：Hero 三阶段、五步 Demo、长期委托示例必须使用**同一任务身份**（展示名/简称统一）、**同一来源**（任务安排、比赛材料、老师建议三条原文，逐字取自 `prisma/seed.ts` 或明确标注改编）、**同一缺口**（演示流程/完成结果待核对）、**同一回执边界**（本页模拟、刷新即失、未经过实际操作核验）。不得各段换项目。
2. **回执链**：只有用户确认示例行动并保存后，才可展示模拟回执；不得自动确认、不得把切换 Tab 当作完成；回执必须可从依据页回看，重置后清空。
3. **示例边界可见**：Hero 首屏 + Demo 均须有可见“公开示例/不调用模型/不写私人业务数据”标注；保留现有边界文案（不得因改版删除“不会调用模型或修改个人项目”等句）。
4. **委托/Worker**：只能按现状条件表述（启用开关、配置模型、授权资料；自动接续需 Worker + 单独授权 + 结构化材料；自动接续仅读取/分析，创建行动仍需确认）；不得写“已在线运行/实时跟进/后台全自动”。
5. **鸿蒙**：只写已验范围（ArkUI、Form Kit 卡片、Ability/Calendar 接续等源码与历史验收可支持的能力）；不得写“已接入小艺/Intents/系统分享/已上架/手机完全离线”；不得把模拟器地址当评审设备证明。
6. **数字/人物/时间**：不出现未经量测的效率/成功率/百分比；不出现虚构用户/评价/头像/人数；页面不出现时钟驱动的“刚刚/今日已检查”时间戳；静态示例日期必须与“示例数据/采集日期”标注同时出现。
7. **元数据**：title/description 与页面主张一致，不加“最先进/已认证/冠军”等不可证表述。

### 7.3 CTA / 路由约束

1. 匿名：Hero 次要、页尾、页头三处“进入工作台”最终必须可达 `/login?from=%2Ffocus`（允许页头经 `/focus` 中转），最终 URL 与状态码一致；Hero 主 CTA 保持 `#experience` 且标题不被 sticky header 遮挡。
2. 已登录：服务端 session 判断，Hero/页尾显示“回到我的工作台”直达 `/focus`；不得新写客户端认证判断；不得在匿名态泄露工作台内容。
3. 锚点：`#experience` 的 `scroll-margin-top` 应 ≥ header 高度 + 余量；1280/390/200% 缩放复验。
4. 外部链接（视频）不得抢占主 CTA 层级；主 CTA 仍为体验/进入工作台。

### 7.4 视觉/字体约束

1. 新增标题中文若使用 PM Editorial，必须重生成子集或确认回退；不得引用站外字体。
2. 新增图片必须本地、有来源/尺寸/字节/授权记录；不得引入第三方版权图/假头像/无关 3D。
3. logo 830KB 建议压缩；`logo-v2.png` 冗余可清理（非阻塞）。
4. 反 AI-slop：删无实义空话；不堆英文大写眉题/渐变/发光；每个画面能回答“下一步点哪里”。

---

## 8. Phase 1 复核计划（待 Lead 通知“B2 候选 SHA 已提交”）

1. 记录候选 SHA、相关文件哈希、脏文件/未跟踪清单；确认审计对象为 B2 候选。
2. 匿名完整旅程网络审计：加载 → Hero 三阶段切换（若有）→ 查看依据 → 五步 Demo 切 Tab → 确认示例行动 → 填写并保存模拟回执 → 回依据页 → 重置。断言：无 POST/PUT/PATCH/DELETE `/api`、无外域 origin、无模型调用；输出 `network-audit.json`。
3. CTA：`#experience` boundingBox vs header 高度（1440/1280/390/200%）；三处“进入工作台”最终 URL/状态码一致且可达登录；页尾 CTA 与 Hero 一致；已登录分支按环境条件记录 PASS/NOT_RUN。
4. 文案事实逐条核对：Hero 与 Demo 任务身份/来源/缺口/回执边界一致；所有示例有可见模拟标注（首屏含）；无夸大/假实时/假数字/虚构用户/假时间戳；中文规范与 05 §8 反 AI-slop。
5. 新需求：视频外链 V1（href/target/rel/可感知外链/加载 0 外域/点击 URL/文案不超范围）；动效 V2（不制造实时假象/首屏标签仍可见/减弱动效等价/CTA 路由不变）。
6. 命令：`npm.cmd exec tsc -- --noEmit`、`npm.cmd run lint`，记录退出码与输出摘要。
7. 生产构建：按 `tmp/final-preparation/Start-Track.ps1` 同款环境变量（本树 `prisma/final-preparation.db`、`tmp/final-preparation/attachments`、`LLM_MODE=mock`、各 `FOCUS_*`/`MISSION_*` 开关），`$env:NEXT_DIST_DIR='.next-build'` 后 `npm.cmd run build`，记录退出码/耗时/产物/OOM/失败；不删断言、不改代码、不提交构建产物。
8. 产出 `CLAIMS_FINDINGS.md`（逐项 PASS/FAIL/BLOCKED/NOT_RUN + 证据文件 + FAIL 最小修复建议）与 `network-audit.json`；Lead 修复后复验并给最终结论。

---

## 9. 证据索引（本目录）

| 文件 | 内容 |
|---|---|
| `json/routes-baseline.json` | 原始 HTTP（无 cookie）重定向链 |
| `json/routes-ui-baseline.json` | 浏览器最终 URL/登录页/三处 CTA 点击结果 |
| `json/baseline-network.json` | 匿名首页 + 五步 Demo 全量请求、写请求、外域、模型迹象、错误 |
| `json/first-screen-labels.json` | 1440/1280/390 首屏边界文案、图注、外链可见性 |
| `json/font-metadata.json` | 三款字体的 name 表/OFL 字段/表/字形数 |
| `json/font-cmap.json` | 三款字体码位覆盖 |
| `logs/*.log` | 各脚本原始输出 |
| `scripts/*.mjs`、`scripts/*.py` | 可重跑脚本（只读环境、匿名、无凭据） |
| `shots/baseline-home-1440x900.png` | 基线首页全页截图（本次审计） |
| `../before/*`（证据任务） | 六张 viewport 基线截图、MANIFEST、独立网络基线 |
| `../CAPTURE_REPORT.md` | 证据任务的采集协议与结论（交叉引用） |
