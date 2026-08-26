# 忆程 ProjectMemo 2.0 阶段实现与交付笔记

## 第一部分｜2026-08-23 现状审计与 2026-08-26 S08 更新

### 结论先行

`HARMONYOS_PLAN.md` 所称“已经落地”只能解释为**代码骨架和部分功能已存在**，不能解释为 S00–S08 全部通过。按 `ProjectMemo_2.0_EXECUTION_PLAN.md` 的 Gate 重新核验后，当前为：S01、S02 已有可复核证据；S02A、S03–S08 均为 `PARTIAL`。只有 DevEco 模拟器，因此真机、正式签名、小艺系统入口和真机 OCR 一律保留为 `UNVERIFIED`，不阻塞模拟器路线，但也不计入完成证明。

| 切片 | 审计状态 | 本轮已核验/修复 | 仍缺的通过证据 |
|---|---|---|---|
| S00 外部探针 | PARTIAL | Pura 90 API 24 模拟器、`hdc`、本机 Backend `10.0.2.2:4400` 可用 | 真实 LLM/embedding 凭据；小艺平台权限；正式签名 |
| S01 可重复构建 | VERIFIED | 后端生产构建、ArkTS build、Hypium、HAP 安装均通过 | Signed HAP 仍 PENDING |
| S02 Demo C | VERIFIED（模拟器） | 延续既有数据库/UI 闭环证据；Backend 已实际联网，不是静态空壳 | 真机不在本切片范围 |
| S02A 原生 UI | PARTIAL | 实机截图审视；压缩品牌栏与卡片密度；增加 Evidence 左脊线、主导航/返回/设置无障碍语义；项目头像用于桌面图标、启动图标和首页品牌栏 | 深色 token 尚未真正接线；大字体、屏幕朗读、键鼠、慢网/乱序和横屏矩阵未完成，禁止写“G0-UI VERIFIED” |
| S03 真实 Capture | PARTIAL | fallback 状态/provider/reason 已可追踪；新增严格 20 样例 Gate 与 JSON 回执 | 未配置真实 provider，脚本未运行；不能把 mock 计入 19/20 |
| S04 Hybrid Search | PARTIAL | Search API、索引/backfill、解释字段存在；修复 provider/model/dimension 漂移；离线哈希不再冒充 semantic；新增 50/100/500/1000 标注 benchmark | 真实 embeddings provider 未配置，Recall/MRR/Evidence Precision/p95 尚无回执，G1 未过 |
| S05 Image/PDF Inbox | PARTIAL | MIME+文件魔数+20MB 校验、写盘前去重、异常清理、真实 `pdftotext`、`NEEDS_OCR`、重试 API；HarmonyOS 图片/PDF Picker 与 multipart 上传已接入 | 模拟器尚未完成图片/PDF 各 5 份；图片视觉/OCR provider 未配置；扫描 PDF 只能如实 `NEEDS_OCR` |
| S06 Deliverable Gap | PARTIAL | Gap 改为只接受与 Deliverable 明确关联且 `confirmed=true` 的证据；新增关联 API；30 个规则 case + 集成测试 | 尚无完整模拟器 UI 选择/确认 Evidence 流；Gap Accuracy 数据集回执未形成 |
| S07 系统通知 | PARTIAL | 改用 NotificationKit；稳定通知 ID；WantAgent 携带 project/intervention；冷/热启动路由；Snooze 使用 `deliveryTime` 重新调度 | 通知权限、去重、点击深链、Snooze 在模拟器的完整验收记录尚未完成；真机待验证 |
| S08 小艺 | PARTIAL | `record_memory` 本地适配层、固定测试项目、Bearer 校验、幂等 request ID、`AgentRun` 回执、3/3 专项测试；香港 ECS 与 `project.luojiatutor.xyz` 已具备 | 尚未部署 HTTPS；平台鉴权字段未核对；插件真实调用、App 同卡片对照、其余三能力和 20 轮测试未完成 |

### 本轮可复核回归

| 检查 | 结果 |
|---|---|
| Vitest | 12 files，79/79 PASS（含 S08 适配层 3/3） |
| TypeScript | `tsc --noEmit` PASS |
| ESLint | PASS（HarmonyOS 生成目录已排除） |
| Next.js production build | PASS；Turbopack 仍报告 1 条附件存储路径 NFT tracing 警告，不影响产物，但应在 Freeze 前清零 |
| HarmonyOS Hypium | 23/23 PASS |
| HarmonyOS HAP | BUILD SUCCESSFUL；unsigned HAP SHA-256 `9d4da5783bad824a60c91ad890d5f7b7861e249aeaaa856cbc0e47887b17718f` |
| 模拟器联网 UI | Pura 90 API 24；Backend `127.0.0.1:4400`；首页与 ProjectHome 均读取真实数据 |

### 重要纠偏

- 旧文档的“后端 38/38”和“G0-UI VERIFIED”已过时；当前自动化为 79/79，但测试数量增加并不自动证明外部 provider、UI 矩阵或平台 Gate。
- `com.example.projectmemo` 仍是开发占位 bundleName；本轮仅更换品牌头像和显示名称，未擅自决定正式应用标识。
- S03/S04 的验证脚本会在缺少真实 provider 时拒绝计分；S04 benchmark 还要求显式 `--confirm-provider-cost`，避免无意产生 1,000 卡 embedding 调用费用。
- S05 失败文件只保留 Attachment 和错误状态，不再用文件名/元数据拼出“成功 Memory”。
- S06 不能再由项目中任意同类型卡片自动满足交付物；证据必须显式关联并确认。

---

## 【历史交付记录；状态以第一部分审计为准】HarmonyOS 手机端 UI 修订 (P0-P2)
- **品牌名称统一**：全 App 统一为 **“忆程 ProjectMemo”**。
- **全面移除 Emoji**：全 App 替换为原生 20vp 统一风格线性矢量图标库（`components/PMIcons.ets`）。
- **枚举与术语本地化**：通过 `common/TextFormatters.ets` 彻底清洗所有内部枚举（`MATERIAL_GAP` -> `作品材料缺口`，`P2` -> `高优先级` 等）。
- **Evidence Spine 证据脊线重塑**：彻底修复空白与单调规则名展示，形成紧凑的“时间 — 来源 — 事实 — 判断”链。
- **Human Decision 补全三大决策**：提供明确的 `[ 创建行动 ]`、`[ 明天提醒 ]`、`[ 忽略 ]`（支持理由输入）。
- **驾驶舱围绕“三个问题”收敛**：Checklist 明确区分“已具备”与“当前缺口”，动态单行摘要无 0 KPI 杂音。
- **成果中心与问忆程重构**：去除重复 CTA，增加项目上下文看板与结构化证据回答。
- **最新回归**：HarmonyOS 构建成功，Hypium 23/23 PASS，后端 76/76 PASS；这不替代第一部分列出的 UI/外部能力 Gate。

> 依据 `ProjectMemo_2.0_EXECUTION_PLAN.md` 第 7 节执行纪律维护。
> 所有偏离计划的地方记录“计划要求、代码实际、采取方案、验证结果”。

---

## S00｜模拟器与外部能力一次性探针

**日期：** 2026-08-21
**执行人：** Claude Code（代理执行；需要人工账号/GUI 的项已标注）

### 探针记录

| # | 探针项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DevEco 模拟器启动、`hdc list targets` 可见 | VERIFIED | 本机已部署 4 个 AVD：Pura 90（phone）、Mate X7（foldable）、MatePad Pro 13（tablet）、MateBook Pro（2in1），均为 HarmonyOS 6.1.1 / API 24（`%LOCALAPPDATA%\Huawei\Emulator\deployed\lists.json`）。CLI 启动方式：`Emulator.exe -start "Pura 90"`（`-m` 参数无效，会报 `Unknown option 'm'`）。`hdc list targets` 返回 `127.0.0.1:5555`。App 已安装并启动到模拟器。 |
| 2 | 调试签名 / DevEco Run 安装流程 | PARTIAL | `harmonyos/build-profile.json5` 中 `signingConfigs: []` 为空，构建提示 `No signingConfigs profile is configured`，产出 unsigned HAP。自动签名需要 DevEco GUI 登录华为开发者账号，无头环境无法完成。验证路径改为“unsigned HAP + `hdc install` 到模拟器”（实测成功）。未把任何证书/密钥写入仓库。 |
| 3 | `/chat/completions` 与 `/embeddings` 最小验证 | NOT AVAILABLE | `.env` 中 `LLM_MODE="mock"`，未配置 `LLM_API_KEY` / `LLM_BASE_URL`。无凭据无法发起真实调用，未伪造结果。需要负责人提供 OpenAI-compatible 端点与密钥后在 S03 前补测。 |
| 4 | 小艺开放平台 Agent/Skill 创建与调试权限 | NOT AVAILABLE（需人工） | 需要浏览器登录华为账号，代理无法执行。S08 仍为条件切片。 |
| 5 | 复赛 Backend 运行位置决策 | IN PROGRESS | 本地回归仍使用模拟器经 `10.0.2.2:4400` 访问宿主；S08 目标改为香港 ECS 上的 `https://project.luojiatutor.xyz`，但尚无部署回执。 |
| 6 | 附件二进制存储决策 | DECIDED | 本地 Demo 使用仓库外目录（S05 实施）：环境变量 `ATTACHMENT_DIR` 指定，默认 `D:\Projects\projectmemo-storage\attachments`。无状态部署时切换对象存储，该切换点在 S05 保留为可配置项。 |

### 环境发现的机器级问题（重要）

**端口 3000-3100 段被本机安全软件拦截监听。** 原计划固定 `Constants.BASE_URL = http://10.0.2.2:3000`，但本机（Windows 11，装有三方安全软件）拒绝在该段绑定监听 socket（`listen EACCES` / `WSAEACCES`）。8 月 21 日曾使用 4000；8 月 23 日复核时 4000 也出现 `EACCES`，4400 可稳定绑定。

**当前方案：** BASE_URL 单一来源 `Constants.ets` 为 `http://10.0.2.2:4400`，后端以 `next dev -H 127.0.0.1 -p 4400` 运行。README 记录该环境差异。这是环境适配，不是功能降级。

### STOP 条件对照

- DevEco 模拟器：可用（未触发阻塞）。
- 无真机：确认。Core Vision OCR、小艺系统入口、真机通知一律标记“未验证”。
- 无小艺平台权限：确认。只交付 Backend capability 与接入文档。
- Provider `/embeddings`：无 provider 可测，S04 启动前必须先补 S00-3 探针；不得用关键词冒充 semantic。
- 部署形态：已决定本机，允许进入附件存储设计（S05）。

---

## S01｜仓库可重复构建并产出可安装 HAP

**日期：** 2026-08-21

```text
Task              根构建排障 + 统一命令 + 鸿蒙契约测试 + 基线提交
Priority          P0（G0 前置）
Core Loop Impact  不触碰 Backend 主链；在鸿蒙侧抽取纯逻辑契约层并修复一个 App 崩溃
Files to Change   tsconfig.json、package.json、README.md、scripts/harmony-build.ts（新增）、
                  scripts/harmony-test.ts（新增）、
                  harmonyos/entry/src/main/ets/common/ApiContract.ets（新增）、
                  harmonyos/entry/src/main/ets/services/ApiClient.ets、
                  harmonyos/entry/src/main/ets/services/{Action,Intervention,Memory}Service.ets、
                  harmonyos/entry/src/main/ets/common/Constants.ets、
                  harmonyos/entry/src/test/{List.test.ets,ApiContract.test.ets}
API Changes       无（Backend API 未改动）
Data Migration    无
How to Verify     vitest 38 tests；next build；hvigor assembleHap；Hypium 单测；hdc install + 启动
Demo Impact       ActionBoard 崩溃修复；BASE_URL 当前端口 4400
Rollback          git revert 基线提交
```

### 执行结果

1. **tsconfig**：从根 TS/Next 范围排除 `harmonyos`、`.hvigor`、`.preview`、`.trae` → `next build` 退出码 0（修复了审计发现的根构建失败）。
2. **统一命令**：`harmony:backend`（`next dev`）、`harmony:build`（hvigor assembleHap + SHA-256 凭证）、`harmony:test`（Hypium 单测）。构建脚本自动设置 `DEVECO_SDK_HOME` 与 `JAVA_HOME`（DevEco 自带 jbr，`PackageHap` 阶段需要 JDK）。
3. **BASE_URL**：单一来源 `Constants.ets` → `10.0.2.2:4400`（8 月 23 日复核后的端口环境适配，见 S00）。
4. **安装流程**：`hdc install -r <unsigned.hap>` 成功安装到模拟器（绝对路径会被 hdc 拼接错误，需用相对路径）；启动用 `hdc shell aa start -a EntryAbility -b com.example.projectmemo`。签名状态：PENDING（需 DevEco GUI 登录华为账号）。
5. **契约层与测试**：新建 `common/ApiContract.ets`（请求体构造、200/201/204 判定、错误映射、状态枚举），ApiClient 与三个 Service 复用。Hypium 本地单元测试 23/23 通过（覆盖请求体、序列化、成功码、错误映射回退、状态枚举）。

### 验证命令与结果

```powershell
# Backend 单测
node .\node_modules\vitest\vitest.mjs run
#   Test Files  7 passed (7)     Tests  38 passed (38)

# Next.js 生产构建
node .\node_modules\next\dist\bin\next build
#   退出码 0

# HarmonyOS 构建（统一命令，含 SHA-256 凭证）
npm.cmd run harmony:build
#   BUILD SUCCESSFUL
#   HAP: harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
#   sha256: da50922e2c3b81d4fc7d93884facc98df3d9c8dc945c8534df2d1e887caadace

# HarmonyOS 本地单测（统一命令）
npm.cmd run harmony:test
#   Tests run: 23, Failure: 0, Error: 0, Pass: 23, Ignore: 0

# 安装与启动（模拟器）
hdc list targets                                        # 127.0.0.1:5555
hdc install -r harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
hdc shell aa start -a EntryAbility -b com.example.projectmemo
```

### 基线提交

已创建独立基线提交，包含：后端不动，鸿蒙侧契约层/崩溃修复/测试/构建脚本/文档（见 git log）。

---

## S02｜HarmonyOS 模拟器在真实 Backend 完成 Demo C

**日期：** 2026-08-21

### 计划要求
不打开 Web UI，在 HarmonyOS App 中真实完成 Evaluate → Evidence → Accept → Action → DONE → Reflection → RESOLVED；Accept 重复点击不产生重复 Action；DONE 少于 5 字被拒绝；App 重启后数据仍在；3 分钟内完成；`scenario` 为空。

### 实际执行（DevEco 模拟器 + 本机 Backend；当前地址 `10.0.2.2:4400`）

全流程通过 `hdc shell uitest`（dumpLayout / uiInput）驱动真实 App UI：

1. **Evaluate**：进入种子项目 ProjectHome 时页面渲染自动触发 `evaluateProjectContext`，规则引擎生成非 simulated 介入（DEADLINE_NEAR、MATERIAL_GAP，`scenario` 为空）。
2. **Evidence**：点击"查看依据 →"进入 InterventionDetail，展示触发类型、evidence facts、建议行动。
3. **Accept**：点击"接受建议" → App 发送 `PATCH /interventions/:id {status:ACCEPTED}` → 创建 action `锁定最小可交付版本并列出提交清单`，介入状态 → ACCEPTED。
4. **Action → DONE → Reflection → RESOLVED**：进入 ActionBoard → 点击"完成" → 输入结果"已锁定最小可交付版本并核对完提交清单" → 提交 → Backend 事务内创建 reflection 卡片、行动 → DONE、介入 → RESOLVED。
5. **App 重启后**：卡片数 10→11、ActionBoard 显示"已完成（2）"及"复盘：已锁定..."链接，数据持久。

### S02 通过标准逐项核对

| 标准 | 结果 | 证据 |
|---|---|---|
| Evaluate → Evidence → Accept → Action → DONE → Reflection → RESOLVED 闭环 | PASS | 见上；DB 状态 DEADLINE_NEAR=RESOLVED、action=DONE、reflection 卡片生成 |
| `scenario` 为空 | PASS | 未注入任何 demo scenario |
| Accept 重复点击不产生重复 Action | PASS | 二次 PATCH accept 返回同一 action（后端幂等），actions 数量不增 |
| DONE 少于 5 字由 Backend 拒绝 | PASS | `PATCH {status:DONE, resultText:"完成"}` → HTTP 422 |
| App 重启后数据仍在 | PASS | force-stop + 重启后 Index 统计、ActionBoard 复盘均正确 |
| 数据库状态和 UI 状态一致 | PASS | 接受后 Index"进行中行动 0→1"；完成后"活跃提醒 2→1" |
| 3 分钟内完成闭环 | PASS | 单次闭环操作耗时 < 3 分钟（不含调试阶段） |
| 保存 Demo receipt | PASS | 见下 |

### Demo receipt

```text
模拟器:      Pura 90（phone，API 24，HarmonyOS 6.1.1，OpenHarmony-6.1.1.125，1320x2856，density 560）
HAP:         entry-default-unsigned.hap
HAP sha256:  da50922e2c3b81d4fc7d93884facc98df3d9c8dc945c8534df2d1e887caadace
项目:        人工智能创意赛 忆程 ProjectMemo 作品开发 (cmt0t5eh50000gk8odb1b2tqa)
介入:        cmt0t5emh000bgk8od0yja7u1 (DEADLINE_NEAR)
行动:        cmt2cnnn10001448oin8uaism (DONE)
复盘卡片:    ff76ce31-… (reflection)
开始/结束:   2026-08-21 约 10:40–11:10（本地时间）
截图:        .trae/pm_detail.jpeg / demo_done.jpeg 等（未提交到 Git）
后端:        本机 Next dev，当前端口 4400（端口 3000 与 4000 被安全软件拦截，见 S00）
```

### 过程中发现并修复的 App 崩溃 Bug（重要）

**根因：** `ActionBoard.ets` 第 165 行 `action.resultCard.title` 在 `resultCard` 为 `null` 时崩溃（后端对无复盘的行动返回 `null`，而 ArkTS 下 `null !== undefined` 为真，原 `!== undefined` 检查挡不住 null）。打开 ActionBoard 渲染任意 TODO 行动即触发 JS 崩溃，App 退回桌面（`jscrash`，三份日志均同一行）。

**修复：** ActionBoard 的 `sourceIntervention`/`resultCard` 检查与 InterventionDetail 的 `description` 检查改为同时排除 `null` 与 `undefined`。修复后 ActionBoard 正常渲染（这是 Demo C 闭环在 App 内完成的前置条件）。

### 未解决风险

- HAP 无正式签名（`signingConfigs` 为空），模拟器安装 OK，真机安装/上架需要签名（需在 DevEco 登录华为账号，无法无头完成）。
- 真实 LLM / Embedding provider 未验证（无凭据，S03 前需补 S00-3 探针）。
- 真机能力（Core Vision OCR、小艺系统入口、真机通知）一律标记"未验证"。
- 模拟器 `snapshot_display` 在本机会返回滞后帧，UI 自动化以 `uitest dumpLayout` 为准（本机已知环境现象，不影响验收真实性，截图仅作辅助）。

---

## S02A｜五个功能页成为可展示的 HarmonyOS 原生体验

**日期：** 2026-08-21
**执行人：** Claude Code

```text
Task              建立 Evidence Ledger 设计系统 Token 与组件库，重构 5 个核心 ArkUI 页面
Priority          P0（G0-UI 前置）
Core Loop Impact  全面提升 5 个页面的视觉品质、信息层次与证据链表达，不破坏已有业务状态机
Files to Change   harmonyos/entry/src/main/ets/common/DesignTokens.ets (新增),
                  harmonyos/entry/src/main/ets/components/PMAppBar.ets (新增),
                  harmonyos/entry/src/main/ets/components/MetricBadge.ets (新增),
                  harmonyos/entry/src/main/ets/components/AsyncStateView.ets (新增),
                  harmonyos/entry/src/main/ets/components/EvidenceSpineView.ets (新增),
                  harmonyos/entry/src/main/ets/components/ProjectStatusCard.ets (新增),
                  harmonyos/entry/src/main/ets/pages/Index.ets,
                  harmonyos/entry/src/main/ets/pages/ProjectHome.ets,
                  harmonyos/entry/src/main/ets/pages/InterventionDetail.ets,
                  harmonyos/entry/src/main/ets/pages/MemoryTimeline.ets,
                  harmonyos/entry/src/main/ets/pages/ActionBoard.ets
API Changes       无（后端 API 契约保持完全兼容）
Data Migration    无
How to Verify     hvigor assembleHap 编译；Hypium 23 单测；Next.js build；Vitest 38 单测
Demo Impact       5 个页面具备 Evidence Ledger 学术手账与证据脊线质感，告别模板化 AI Slop
Rollback          git checkout 恢复 pages / components
```

### 多次审查执行记录

1. **第 1 轮审查：设计隐喻与反模板化自检**
   - 确立 `Evidence Ledger`（证据档案）冷峻严谨的学术手账视觉风格。
   - 提炼唯一标志性元素 `Evidence Spine`（证据脊线），在 `InterventionDetail` 与 `ProjectHome` (Insight) 连贯表达“规则 → 事实 → 建议 → 决策”。
   - 消除所有通用 AI 渐变、发光球与无意义装饰，确保每个组件服务于证据闭环与学术研究场景。

2. **第 2 轮审查：Token 与组件体系规范**
   - 提取 `DesignTokens.ets`，统一色彩语义（`MEMORY` 深青绿、`EVIDENCE` 琥珀金、`RISK` 深绯红、`SUCCESS` 森林绿、`INK` 沉稳墨色体系）。
   - 统一间距（8vp 网格）、圆角规范与排版字阶。
   - 封装 `PMAppBar`, `MetricBadge`, `AsyncStateView`, `EvidenceSpineView`, `ProjectStatusCard` 5 个高可复用组件。

3. **第 3 轮审查：五页状态机与边缘场景审查**
   - `Index.ets`：增强品牌工作台标头、四维指标矩阵、备赛健康度进度条与下一步行动引导条。
   - `ProjectHome.ets`：重构项目驾驶舱，展示状态看板、Insight 脊线摘要、手账式 Capture 输入台与导航中枢。
   - `InterventionDetail.ets`：完整呈现 Evidence Spine 事实脉络、建议方案单选与人类决策矩阵（接受/稍后/忽略）。
   - `MemoryTimeline.ets`：时序流呈现知识卡片、类型色标、原始碎片展开与出入度图谱关联。
   - `ActionBoard.ets`：看板分流展示 TODO/DOING/DONE、复盘弹窗（至少5字限制）、复盘卡片深链及严格的空安全防御。

4. **第 4 轮审查：构建与自动化测试验证**
   - `hvigor assembleHap`：`BUILD SUCCESSFUL`（产出 HAP sha256: `b3697e15cc5b873e9f465a73c9cf2310fdf076f08f71078ebd1046b62fc302c2`）。
   - `npm run harmony:test`：Hypium 单测 23/23 全部 PASS。
   - `vitest run`：后端 38 个集成与单元测试 100% PASS。
   - `next build`：Next.js 生产构建退出码 0，类型检查通过。

### G0-UI 历史判定纠偏

- 此处原写 **VERIFIED**，但当时只提供了源码与构建证据；2026-08-23 审计已降级为 **PARTIAL**。
- 深色、大字体、屏幕朗读、键鼠、慢网/乱序和横屏矩阵仍需完成；真机专属行为继续标记“待真机验证”。

---

## 2026-08-21 移动端全功能工作台与底部导航 Bar 升级 (S02A+)

### 升级背景与目标
参考原 Web Demo 的完整业务矩阵，将手机端重构升级为**带 5-Tab 底部导航 Bar 的一体化移动工作台**，彻底补齐手机端缺失的核心能力（包括新建项目、备赛 6 项清单、问忆程 Copilot、成果中心、多来源捕获、记忆检索与演示控制）。

### 交付物矩阵
1. **双层底部导航 Bar 体系**：
   - **主页大厅 (`Index.ets`)**：项目档案 (📁) / 待办提醒 (⚡) / 全局记忆 (🧠) / 工作台设置 (⚙) 4 大全局视图。
   - **项目工作台 (`ProjectHome.ets`)**：驾驶舱 (🎛) / 记忆脉络 (🧠) / 待办行动 (📋) / 问忆程 (🤖) / 成果中心 (📦) 5 大项目业务视图。
2. **新建项目与项目设置**：
   - `Index.ets` 顶部支持“+ 新建项目”，支持竞赛、课题、课设场景类型；
   - `ProjectHome.ets` 支持一键呼出项目设置，修改名称与目标。
3. **跨项目待办提醒聚合**：
   - 主页支持集中浏览所有项目的主动干预提醒与待办行动，一键直达处理。
4. **全局跨项目记忆库**：
   - 主页支持跨项目知识检索与论文/实验/复盘分类过滤。
5. **备赛 6 项 Checklist**：
   - 完整展示需求分析、代码实验、闭环行动、参赛大纲、答辩PPT、README 就绪度，支持一键直达对应 Tab 补齐。
6. **问忆程 Copilot**：
   - 真实对话气泡流、证据卡片引用 (Citations)、工具建议 (两步确认行动/成果草稿)、快捷推荐提问。
7. **成果交付中心 (Artifacts)**：
   - 参赛大纲、答辩PPT、项目周报、README 4 大成果一键生成新版本，支持正文渲染与复制到剪贴板。
8. **记忆检索与多类型过滤**：
   - 实时搜索框与 7 种类型过滤胶囊。
9. **多来源碎片捕获**：
   - 7 种来源选择器（随手记录/论文笔记/代码报错/实验记录/会议纪要/老师建议/比赛材料）。

10. **OpenAI 兼容 API Key 接入与实时探针**：
    - 主页设置中提供 `Base URL`、`API Key`、`Model Name` 与引擎模式切换配置；
    - 支持一键测试 API 连通性 (Ping Probe)，直连大模型端点测量毫秒级网络延迟并回显握手结果。

### 验证证据
- **Hvigor 构建**：`BUILD SUCCESSFUL`（产出 HAP sha256: `4e70b2509399bebca5d042ce1e4b10e0d55166be70ba20e36a5c88d09072e722`，1.00 MB）。
- **HarmonyOS 测试**：23/23 全部通过。
- **后端测试**：历史记录为 38/38；2026-08-23 最新回归为 76/76。
