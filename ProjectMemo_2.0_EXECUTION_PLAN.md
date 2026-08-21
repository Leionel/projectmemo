# ProjectMemo 2.0 当前版执行方案

> 基线日期：2026-08-20  
> 仓库根目录：`D:\Projects\hongmen`  
> 依据：`ProjectMemo_2.0_PLAN.md`、`HARMONYOS_PLAN.md`、`HARMONYOS_PLAN_DETAILED.md` 与当前工作树  
> 状态：审计完成；执行切片待负责人确认后实施  
> 核心目标：先把已经写入工作树的 HarmonyOS 主链变成可重复验收的基线，再逐步交付 Semantic Memory、Project Inbox、Deliverable Gap、系统通知和条件式小艺入口。

---

# 1. 当前进展审计结果

## 1.1 结论

`HARMONYOS_PLAN.md` 对目标架构和页面范围的描述已经在源码层面大体落地，但目前不能直接判定“鸿蒙迁移已经完成”。更准确的状态是：

> **HarmonyOS 数据层与 5 个原生页面的功能骨架已经写入，ArkTS/HAP 构建通过；后端核心闭环已有自动化测试证明。但 UI 设计尚未实施，当前又只有 DevEco 模拟器可用，所以现阶段只能完成模拟器闭环与条件验收；真机专属能力必须保留为未验证项。**

因此本方案不从空白重做 HarmonyOS，也不立即全面启动 2.0 六个 P0。当前正确断点是：

```text
源码落地
  ↓
构建与 DevEco 模拟器验收收口
  ↓
冻结 HarmonyOS MVP 基线
  ↓
进入 ProjectMemo 2.0 纵向增强
```

## 1.2 审计矩阵

| 能力 | 当前证据 | 审计判定 | 下一动作 |
|---|---|---|---|
| Backend 核心闭环 | `tests/database.integration.test.ts` 覆盖 Intervention 接受、Action 完成、Reflection 创建、Intervention RESOLVED | **已验证** | 保持兼容，不重写 |
| Backend 自动化测试 | `node node_modules/vitest/vitest.mjs run`：7 个文件、38 个测试全部通过 | **已验证** | 作为每个切片的回归门 |
| HarmonyOS Data Layer | PATCH、Memory/Intervention/Action Models、3 个 Service、Project detail/evaluate 已存在 | **源码已落地** | 做契约测试与设备联调 |
| HarmonyOS 页面功能骨架 | Index、ProjectHome、MemoryTimeline、InterventionDetail、ActionBoard 已注册 | **功能源码已写入** | 在 DevEco 模拟器逐页验证业务路径 |
| HarmonyOS UI | 当前页面以裸色值、基础 Column/Row/List、白色卡片和文本按钮为主；没有设计 Token、响应式导航、深色主题、无障碍或性能验收；用户确认 UI 尚未实施 | **未完成** | 先做 2 页可交互原型，再扩展到 5 页 |
| Capture | ProjectHome 已有快速记录并回刷记忆计数 | **代码路径存在** | 验证持久化与 MemoryTimeline 刷新 |
| Evidence/Confirm/Action | InterventionDetail 已展示 evidence、接受、稍后、忽略；ActionBoard 已支持 DOING/DONE/resultText | **代码路径存在** | 跑一次非 simulated 的端到端闭环 |
| ArkTS 构建 | Hvigor `assembleHap`：`BUILD SUCCESSFUL` | **已验证** | 纳入仓库统一命令 |
| HAP 安装 | 当前只产出 `entry-default-unsigned.hap`；构建提示没有 signingConfigs | **未完成** | 通过 DevEco Run/本地调试签名安装到模拟器 |
| 设备连接 | 本轮 `hdc list targets` 无输出；用户确认当前只能使用 DevEco 模拟器 | **模拟器待启动验证；无真机条件** | 以模拟器作为当前验收设备，真机项单独标记未验证 |
| 网络配置 | `Constants.BASE_URL = http://10.0.2.2:3000` | **适配当前模拟器** | 先固定模拟器路径；公网/真机地址仅在小艺或部署切片处理 |
| 根工程生产构建 | Next.js 编译成功，但 TypeScript 扫入 `harmonyos/entry/build` 后失败 | **阻塞** | 从根 TypeScript 范围排除鸿蒙生成目录 |
| HarmonyOS 测试 | 仍是模板 Hypium 用例，没有业务断言 | **缺失** | 为 Service 序列化和关键状态增加最小测试 |
| 真实 LLM 主路径 | `.env` 与 `.env.example` 均为 `LLM_MODE="mock"` | **未实现 P0-B** | 接通真实 provider 并保留确定性 fallback |
| AgentRun 可追溯 | Capture 目前记录 `provider: llm-or-mock`，无法区分实际命中 LLM 还是 fallback | **不满足审计要求** | 返回并持久化实际 provider/status/fallbackReason |
| Semantic Memory | `KeywordVectorStore` 仅调用关键词 linker，且默认只载入最近 50 张卡片 | **未实现 P0-C** | 增加真实 embedding、混合检索和 Search API |
| Project Inbox | 目前只有文本 Capture | **未实现 P0-D** | 先交付 Image + PDF/File 纵向切片 |
| Milestone/Deliverable | Prisma 无对应实体，Risk Engine 仍为现有 5 类规则 | **未实现 P0-E** | 只做 Demo 所需的最小结构与 Gap 规则 |
| 系统通知 | HarmonyOS 工程无 NotificationKit 代码 | **未实现 P0-F** | 高风险 Intervention 生成可去重的系统提醒 |
| 小艺 | 仓库只有计划文本，无平台配置或接入代码 | **未实现 P1** | 先做平台准入和 A2A/Skill 探针 |

## 1.3 本轮实际验证记录

### Backend 测试

```powershell
Set-Location 'D:\Projects\hongmen'
node .\node_modules\vitest\vitest.mjs run
```

期望与本轮结果：

```text
Test Files  7 passed (7)
Tests      38 passed (38)
```

### HarmonyOS 构建

```powershell
Set-Location 'D:\Projects\hongmen\harmonyos'
$env:DEVECO_SDK_HOME = 'D:\Program Files\Huawei\DevEco Studio\sdk'
node 'D:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js' `
  assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

期望与本轮结果：

```text
BUILD SUCCESSFUL
WARN: No signingConfigs profile is configured
```

### 根工程生产构建

```powershell
Set-Location 'D:\Projects\hongmen'
node .\node_modules\next\dist\bin\next build
```

本轮结果：失败。直接原因是根 `tsconfig.json` 的 `**/*.ts` 把 `harmonyos/entry/build/...` 生成文件纳入 Next.js 类型检查；这不是 Web 业务代码编译错误，但仍会阻塞统一生产构建。

## 1.4 风险排序

### P0：进入 2.0 前必须解决

1. 根工程生产构建失败。
2. HAP 尚未通过 DevEco 安装并运行在模拟器，也没有模拟器运行凭证。
3. BASE_URL 只适用于模拟器。
4. App 端核心闭环只有代码证据，没有非 simulated 的端到端运行证据。
5. 当前 HarmonyOS 新增代码仍在未提交工作树中，尚无可回退基线。
6. 当前只有功能骨架，没有可以用于复赛展示的 UI 设计与体验验收。

### P1：2.0 第一轮技术硬伤

1. 真实 LLM 未启用，Capture 的 AgentRun 不能准确区分真实调用和 fallback。
2. 长期记忆仍是最近 50 条候选上的关键词关联。
3. 没有公开、可复用的 `/cards/search` 检索契约。

### P2：改变产品感知的能力

1. Image + PDF/File Project Inbox。
2. Milestone / Deliverable Gap。
3. 系统级通知。
4. 小艺自然语言入口（条件能力，不阻塞 P0 Candidate）。

---

# 2. 执行边界与关键决策

## 2.1 本轮必须交付

```text
可重复构建和安装的 HarmonyOS MVP
+
完整的 HarmonyOS UI 基线与 5 页原生体验
+
真实 LLM + 可审计 fallback
+
真实 Semantic Search
+
Image / PDF Project Inbox
+
Milestone / Deliverable Gap
+
系统通知
+
小艺共享 Backend（平台条件具备时）
+
可复现 Benchmark 与提交凭证
```

## 2.2 明确不做

本轮不做社区、群聊、完整 Kanban、复杂 Gantt、番茄钟、多人权限、企业项目管理、完整文件云盘、高级 Memory Graph、GitHub/Calendar Connector、Meeting Mode、服务卡片/实况窗和跨设备深度协同。

Scheduling 只保留为缓冲任务：只有全部 P0 Gate 在 2026-09-18 前通过，才允许启动；否则不做。

## 2.3 技术决策

1. **不改写现有 Backend 主链。** 新输入最终进入现有 Capture/KnowledgeCard；新风险仍进入 AgentIntervention；高影响写操作继续经过确认。
2. **先做纵向切片。** 每个切片必须同时交付必要的数据、API、HarmonyOS 入口、测试和 Demo，不先铺一整层 schema 或 UI。
3. **Semantic Memory 先满足 1,000 条规模。** SQLite 内保存 embedding 元数据与向量 JSON，进程内计算 cosine；不在复赛前引入独立向量数据库。
4. **Project Inbox 不是文件仓库。** 二进制只作为可追溯证据，提取文本进入统一 Memory。
5. **Milestone/Deliverable 只做目标差距判断。** 不扩成通用工作流、Gantt 或团队协作系统。
6. **通知先做本地系统提醒。** P0 证明“App 关闭后仍能出现、点击可回到 Evidence”；云推送和持续后台同步不在当前承诺内。
7. **小艺复用现有 API。** 不新建第二套 Memory、Risk Engine 或 Action 状态机。
8. **所有完成声明绑定凭证。** 至少保留命令、完整输出、HAP hash、关键 ID、截图/录屏和 benchmark 原始结果。
9. **UI 不做最后一周换皮。** 先建立 Product Context、信息架构、Token 和两页原型；后续每个功能切片直接复用。
10. **状态真实优先于视觉效果。** 按下只表示收到输入；Capture、Accept、Complete 的成功反馈只能由 Backend 成功响应触发。

---

# 3. Gate 顺序

| Gate | 通过条件 | 未通过时禁止 |
|---|---|---|
| G0 HarmonyOS Baseline | 根 build、38 tests、ArkTS build、模拟器安装和模拟器 Demo C 均通过 | 禁止宣布模拟器版 HarmonyOS 基线已完成；禁止大规模 2.0 UI 开发 |
| G0-UI HarmonyOS Experience | 两页原型通过后扩至 5 页；模拟器上的手机窗口、浅/深主题、大字体、焦点与无障碍通过 | 禁止把功能骨架用于正式视频；真机缺失时只能给出“模拟器有条件通过” |
| G1 Real Memory | 真实 LLM 可用且 fallback 可追踪；Hybrid Search 达到基准 | 禁止接小艺 Recall；禁止用“长期语义记忆”答辩 |
| G2 Goal-aware Intelligence | Image/PDF 入库；Deliverable Gap 从真实 Evidence 产生 | 禁止系统通知以硬编码风险演示 |
| G3 HarmonyOS-native Agent | 模拟器中系统通知可去重、可深链；真机行为明确标记待验证 | 禁止进入 Candidate Freeze |
| G4 Evaluation | 检索、Risk、Gap、Evidence、安全指标达标 | 禁止冻结复赛版本 |
| G5 Submission Freeze | HAP、Backend、Demo 数据、文档、视频和哈希一致 | 禁止提交 |

Gate 必须按证据通过，后置 Gate 的成功不能覆盖前置 Gate 的失败。

---

# 4. 拟定执行切片

以下切片是当前建议粒度。正式实施前只需确认一次粒度和依赖关系；确认后可拆成独立任务文件执行。

## S00｜模拟器与外部能力一次性探针

**时间：** 2026-08-20，0.5 天  
**Blocked by：** 无  
**交付结果：** 在写业务代码前确认 DevEco 模拟器、调试安装、小艺平台、真实 LLM/Embedding Endpoint 和附件存储方案是否可用。

执行项：

1. 启动 DevEco 模拟器，确认 `hdc list targets` 可见且可以安装/启动当前应用。
2. 配置模拟器所需的本地调试签名或 DevEco Run 流程，不把证书或密钥提交到 Git。
3. 用最小请求验证 `/chat/completions` 与 `/embeddings`；记录模型名、维度、超时和错误响应。
4. 登录小艺开放平台，确认当前账号可以创建 Agent/Skill、配置调用能力并使用平台调试工具；真机调试单独标记不可用。
5. 决定复赛 Backend 运行位置：本机局域网或公网 HTTPS。小艺接入必须使用公网 HTTPS。
6. 决定附件二进制存储：本地 Demo 使用仓库外 `storage/attachments`；若部署为无状态/Serverless，则改用对象存储。

验收：输出一页探针记录，逐项标记 `VERIFIED / BLOCKED / NOT AVAILABLE`，不得用计划或截图说明代替一次真实调用。

STOP 条件：

- DevEco 模拟器无法启动或 `hdc` 不可见：阻塞所有 HarmonyOS 运行验收。
- 无真机：不阻塞模拟器主线，但 Core Vision OCR、小艺系统入口和真实设备通知只能标记“未验证”，不能宣称完成。
- 无小艺平台权限：只完成 Backend capability 与接入文档，不伪造“小艺已接入”。
- Provider 不支持 `/embeddings`：先选择独立 Embedding Provider，不能用关键词结果冒充 semantic。
- 尚未决定部署形态：不得创建 Attachment 二进制持久化实现。

## S01｜仓库可重复构建并产出可安装 HAP

**时间：** 2026-08-20 至 2026-08-21，1 天  
**Blocked by：** 无  
**交付结果：** 同一工作树可以稳定通过 Backend 测试、Next.js 生产构建和 HarmonyOS 构建，并产出可安装调试 HAP。

执行项：

1. 从根 TypeScript/Next.js 构建范围排除 `harmonyos/**/build`、`.hvigor`、`.preview` 等生成目录。
2. 在根 `package.json` 增加统一的 HarmonyOS Backend 启动和构建命令；README 先写清 PowerShell + DevEco 模拟器路径。
3. 保留一个 BASE_URL 来源，当前固定模拟器 `10.0.2.2`；公网 HTTPS 配置只在小艺/部署切片增加，不先做设置页。
4. 配置 DevEco 模拟器安装流程；能生成 signed debug HAP 时记录签名产物，不能时保留 unsigned HAP 与 DevEco Run 记录，不伪造签名完成。
5. 把当前未提交的 HarmonyOS 批次在通过验证后形成独立基线提交，便于后续回退。
6. 为 HarmonyOS Service 增加最小 Hypium 测试：请求体、200/201/204、错误映射和状态枚举。

主要文件：

- `tsconfig.json`
- `package.json`
- `README.md`
- `harmonyos/build-profile.json5`
- `harmonyos/entry/src/main/ets/common/Constants.ets`
- `harmonyos/entry/src/test/`

验收命令：

```powershell
node .\node_modules\vitest\vitest.mjs run
node .\node_modules\next\dist\bin\next build

Set-Location .\harmonyos
$env:DEVECO_SDK_HOME = 'D:\Program Files\Huawei\DevEco Studio\sdk'
node 'D:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js' `
  assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

通过标准：38 个现有测试继续通过；Next.js build 退出码 0；ArkTS build 退出码 0；HAP 记录 SHA-256；应用通过 DevEco 安装并启动到模拟器。

## S02｜HarmonyOS 模拟器在真实 Backend 完成 Demo C

**时间：** 2026-08-21 至 2026-08-22，1.5 天  
**Blocked by：** S01  
**交付结果：** 不打开 Web UI，在 HarmonyOS 中真实完成 Evaluate → Evidence → Accept → Action → DONE → Reflection → RESOLVED。

执行项：

1. 固定一个非 simulated Demo 项目和可稳定触发现有规则的种子数据。
2. 逐页验收 Index、ProjectHome、MemoryTimeline、InterventionDetail、ActionBoard 的 Loading/Empty/Error/Retry。
3. 验证 Accept 重复点击不产生重复 Action；DONE 少于 5 字由 Backend 拒绝；完成后 App 刷新仍可看到 Reflection 与 RESOLVED。
4. 在 DevEco 模拟器运行，Backend 使用 `10.0.2.2:3000`；保存模拟器型号、API、窗口和运行时间。
5. 保存 Demo receipt：HAP hash、projectId、interventionId、actionId、resultCardId、开始/结束时间、关键截图。

通过标准：3 分钟内完成闭环；`scenario` 为空；数据库状态和 UI 状态一致；App 重启后数据仍在。

## S02A｜五个功能页成为可展示的 HarmonyOS 原生体验

**时间：** 2026-08-23 至 2026-08-25，2.5 天，可与 S03 后端工作并行  
**Blocked by：** S02  
**交付结果：** 建立统一的视觉、导航、组件、状态和适配基线；先验证 ProjectHome + InterventionDetail，再扩展 Index、MemoryTimeline、ActionBoard。

### Product Context Card

```yaml
目标设备: 当前验收为 DevEco 手机模拟器；代码目标仍覆盖手机、平板
窗口形态: 当前先验收手机竖屏/横屏；平板横屏与分屏保留为待验证
主要输入: 模拟器触摸/鼠标映射
次要输入: 键盘与焦点；真实触摸、平板触控板待设备验证
API_Level: 24 / HarmonyOS 6.1.1
主题与字号: 浅色、深色；默认字号和系统放大字号
任务入口: 项目列表、系统通知、小艺入口
主任务: 查看项目状态 → 理解 Evidence → 确认行动 → 完成并回写 Memory
项目人格: 冷静、可信、研究手账与证据档案感；强调证据链，不使用泛 AI 渐变或炫技玻璃效果
可用证据: ArkTS 源码和功能路径；当前没有完整设计稿、目标机截图或录屏
假设: UI 视觉方向尚未冻结，先以可交互原型验证，不一次性重写全部页面
```

### 设计参考边界

本切片同时参考 Apple Design 与 Frontend Design，但只吸收跨平台原则，不复制平台外观：

- 从 Apple Design 吸收即时反馈、空间一致、可打断、状态真实、克制和用户控制；所有落点仍使用 ArkUI 系统组件和目标 API 24 可验证能力。
- 不复制 iOS 导航、SF Symbols、毛玻璃层级、具体弹簧参数或手势习惯；没有拖拽/甩动任务时不为“高级感”添加弹性运动。
- 从 Frontend Design 吸收明确视觉人格、排版角色、单一标志性元素和反模板化自检；不把 Web CSS 做法直接翻译成 ArkTS。
- 设计目标情绪是“冷静、确信、事情可追溯”，愉悦来自闭环完成和证据清晰，不来自彩带、发光或连续弹跳。

### 视觉方向：Evidence Ledger

**核心隐喻：** ProjectMemo 是项目过程的证据档案，不是聊天机器人，也不是普通 Todo 看板。

建议调色板（Project Overlay / House Style，最终以模拟器对比度验证为准）：

| Token | 浅色 | 深色 | 语义 |
|---|---|---|---|
| `background` | `#F3F6F8` | `#0E151E` | 冷静的工作底色 |
| `surface` | `#FFFFFF` | `#17212C` | 主内容面 |
| `ink` | `#13243A` | `#EAF0F4` | 标题与正文主色 |
| `memory` | `#2D6F6D` | `#64AAA6` | Memory 与已关联 Evidence |
| `evidence` | `#A87528` | `#D8AD63` | 证据节点、来源和时间 |
| `risk` | `#C44738` | `#EF786B` | 风险与错误；必须同时有文字/形状 |

字体角色：

- Display：HarmonyOS 系统字体的较重字重，仅用于项目名、关键状态和页面主标题；不引入装饰字体。
- Body：HarmonyOS 系统字体常规/中等字重，负责说明、Evidence 和表单。
- Utility：系统等宽或数字友好的回退样式，仅用于时间、百分比、短 ID 和指标；不用于大段正文。
- 字体、行高与间距一起定义 Token；标题收紧、正文保持舒适行高，大字体时允许布局增高而非裁剪。

唯一标志性元素：

> **Evidence Spine（证据脊线）**：在 InterventionDetail 和 MemoryTimeline 中，用一条克制的纵向轨迹连接“时间—来源—事实—行动—结果”，让“为什么提醒我”和“行动如何回写记忆”在视觉上成为同一条链。

Evidence Spine 只用于真正有时序/因果的内容，不扩散成所有卡片的装饰线；其余页面保持安静，避免视觉主题泛滥。

反模板化自检：

- 删除通用“AI 渐变光球”、发光边框、无意义 Sparkle、玻璃卡片堆叠和大面积数据仪表盘。
- 避免所有信息都放进同等白卡；使用空间、分组、标题层级和 Evidence Spine 表达结构。
- 不把首页做成“大数字 + 三个统计 + 渐变 CTA”的模板；首屏主角是当前项目判断及其证据。
- 视觉 boldness 只花在 Evidence Spine；其他位置优先系统控件和精确排版。

### 首个原型线框

手机 ProjectHome：

```text
┌─────────────────────────────┐
│ ←  项目名              截止日 │
│ 当前判断：消融实验存在延期风险 │
│ 下一步：今晚完成最小对照实验   │
├─────────────────────────────┤
│ ProjectMemo Insight          │
│ ● 8/15 导师要求完成消融       │
│ │ 8/17 Action 仍为 TODO       │
│ ● 当前未找到实验结果           │
│                 查看完整依据 → │
├─────────────────────────────┤
│ 记录项目进展…                 │
│ [图片] [文件]     [保存记录]   │
├─────────────────────────────┤
│ 记忆        项目        行动    │
└─────────────────────────────┘
```

手机 InterventionDetail：

```text
┌─────────────────────────────┐
│ ←  为什么提醒我               │
│ 消融实验可能影响本周汇报        │
├─────────────────────────────┤
│ Evidence Spine               │
│ ● 8/15 会议记录               │
│ │ 导师要求本周完成             │
│ ● 8/17 行动状态               │
│ │ 尚未开始                     │
│ ● 今天 项目检查               │
│   未找到实验结果               │
├─────────────────────────────┤
│ 建议行动：完成最小消融实验       │
│ [创建行动] [明天提醒] [忽略]    │
└─────────────────────────────┘
```

### 信息架构与导航

手机：

```text
Index 项目列表
  ↓
ProjectHome 项目驾驶舱
  ├─ MemoryTimeline
  ├─ InterventionDetail
  └─ ActionBoard
```

- ProjectHome 是项目内唯一主入口，首屏优先显示“当前状态、最高优先 Evidence、下一步行动”。
- Memory、Insight、Action 是同级任务；手机使用清晰的项目内导航，InterventionDetail 作为父子层级 Push 页面。
- 返回后保留项目、列表位置、输入草稿和已展开 Evidence，不因重建页面丢状态。

平板：

- 不等比放大手机页面；项目内采用导航栏/侧栏 + 主内容，Memory 列表与详情可用双栏。
- 窄窗口退化为手机 Push 路径；分栏选择态、空详情态和键盘焦点必须明确。

### 视觉与组件基线

1. 把页面散落的裸色值、字号、圆角、间距抽成语义资源或 Token：`surface/background/text/brand/risk/success/divider`、字体层级、8vp 网格、圆角、阴影。
2. 优先系统 Button、TextArea、List、Dialog、Navigation 等能力；自定义不能丢失 pressed/disabled/focus/hover/selected 状态。
3. 建立最小复用组件：AppBar、ProjectStatusHeader、InsightCard、EvidenceTimeline、ActionCard、MemoryCard、AsyncStateView、EmptyState、ErrorState。
4. 信息层级不依赖颜色单独表达：Risk 同时使用文字、图标/形状和无障碍语义。
5. ProjectHome 不堆成通用卡片墙；首屏只保留一个主 Insight 和一个主行动入口，次要统计下沉。
6. 操作文案从用户结果出发：使用“保存记录”“创建行动”“明天提醒”“完成并生成复盘”，不用“提交”“确认”“接受建议”等泛词。

### 异步状态与反馈

统一状态：

```text
Idle → Pending → Confirmed | Failed
```

- 按下反馈即时，但不提前显示“已记录”“已创建行动”“已完成”。
- 优先保留 ArkUI 系统 Button 的按下反馈；如需自定义，只改变局部明度/尺度并在按下时开始，抬起时提交，移出目标可取消。
- Pending 阶段禁止重复提交；超时/失败保留输入和重试入口。
- Capture、Evaluate、Accept、Snooze、Dismiss、Complete 各自具有独立 pending/error，不用全页 loading 遮住其他任务。
- 乱序响应只能由最新有效 requestId 更新最终状态。

### Motion 基线

- 使用系统默认页面转场；只有 Evidence 展开、状态切换和确认完成使用局部短过渡。
- 出现/消失优先 `transition`，同参数多属性变化合并到一个 `animateTo`；不使用动画结束回调驱动业务。
- 页面进入和返回保持对称路径；EvidenceDetail 从 Insight 来源进入，返回时回到原滚动位置和焦点。
- 当前没有需要 1:1 跟手、速度继承或动量投射的核心任务，因此不引入自定义拖拽/弹簧。将来若加入可拖拽面板，必须从当前显示值继续、允许中断，并在 ArkUI 真正验证速度衔接。
- 高频列表刷新不做错峰瀑布；不为每次保存加入大面积弹跳。
- 提供低运动替代：位移改短淡化，状态语义不能只靠运动表达。

### 无障碍与适配

1. 图标按钮提供 `accessibilityText`；状态提供准确 role/selected/description。
2. Evidence 卡片合理分组，但接受、稍后、忽略保持独立可操作节点。
3. 大字体下标题、按钮、Dialog 可换行/滚动，不能靠禁止字号缩放解决。
4. 手机触摸目标、平板 hover/focus、键盘顺序和 Esc/返回语义分别验证。
5. 浅色、深色和高对比下，文字、Risk、禁用和焦点状态可辨认。

### 实现顺序

1. 第一遍输出 2–3 个真正不同的低保真任务流方向和一页视觉方向板；选择 Evidence Ledger 后做反模板化自检。
2. 建立 Token、资源和 AsyncStateView。
3. 做 ProjectHome + InterventionDetail 首个可交互原型。
4. 第二遍用真实 Demo 文案、长标题、空状态、失败状态和 Pending 状态批判原型；删除一个最像模板的装饰或组件。
5. 在 DevEco 模拟器验证核心路径、慢网、失败、快速连续点击、大字体和屏幕朗读；所有触感、真实触摸和设备性能结论标记待真机验证。
6. 原型通过后扩展 Index、MemoryTimeline、ActionBoard。
7. 最后加入克制的局部动效和品牌细节，不改变已验证的业务状态机。

主要文件：

- `harmonyos/entry/src/main/resources/base/element/`
- `harmonyos/entry/src/main/resources/dark/element/`
- `harmonyos/entry/src/main/ets/common/`
- `harmonyos/entry/src/main/ets/components/`
- `harmonyos/entry/src/main/ets/pages/Index.ets`
- `harmonyos/entry/src/main/ets/pages/ProjectHome.ets`
- `harmonyos/entry/src/main/ets/pages/MemoryTimeline.ets`
- `harmonyos/entry/src/main/ets/pages/InterventionDetail.ets`
- `harmonyos/entry/src/main/ets/pages/ActionBoard.ets`

### UI Acceptance Matrix

| 检查项 | 通过条件 |
|---|---|
| 主任务 | 新用户能在 3 分钟内完成 Demo C，无需解释页面层级 |
| 手机 | 竖屏完整；横屏无关键控件截断 |
| 平板 | 通过模拟器宽窗口或 Preview 验证分栏/缩进；真实平板待验证 |
| 分屏 | 最小支持窗口仍可完成 Capture、Evidence、Accept、Complete |
| 主题 | 浅色/深色均无不可读文字、丢失边界或错误状态 |
| 大字体 | 系统放大字号下核心任务仍可完成 |
| 屏幕朗读 | 页面标题、Insight、Evidence、三个决策动作和完成 Dialog 可理解 |
| 键鼠 | 核心操作可聚焦；焦点态与选中态不混淆 |
| 异步真实性 | 慢网、500、timeout、重复点击和乱序不产生虚假成功 |
| 动效 | 快速连续操作可打断；无输入锁死；低运动替代可用 |
| 性能 | 模拟器列表滚动、页面转场和 Dialog 无明显长帧；记录 Profiler 结果，但不把模拟器数据当真机性能结论 |

通过标准：先由 ProjectHome + InterventionDetail 原型通过任务、状态和模拟器适配评审，再扩展到 5 页；模拟器无 UI Blocker 和未关闭 Major后，G0-UI 记为“有条件通过（真机待验证）”。

## S03｜真实模型处理 Capture，失败时可审计回退

**时间：** 2026-08-23 至 2026-08-24，1.5 天  
**Blocked by：** S00  
**交付结果：** 演示 Capture 默认走真实 OpenAI-compatible 模型；超时、非 JSON、schema 错误时走确定性 fallback，并准确写入 AgentRun。

执行项：

1. 让 `structureCapture` 返回 `draft + provider + status + fallbackReason + durationMs`，不再由调用方猜测 provider。
2. Capture、Copilot、Artifact 使用统一 provider 结果协议。
3. `.env.example` 补全模型、超时与 fallback 配置说明，不写真实密钥。
4. 增加 provider 健康检查脚本和 20 条固定 Capture 样例。
5. App 中不额外增加“AI 动画”；只在调试/审计页或日志中显示 provider 状态。

主要文件：

- `lib/agent/index.ts`
- `lib/agent/llmAgent.ts`
- `lib/services/captureService.ts`
- `lib/services/copilotService.ts`
- `lib/services/artifactService.ts`
- `tests/`
- `.env.example`

通过标准：真实模式 20 条样例至少 19 条产生合法结构；强制超时后 fallback 仍成功；AgentRun 的 provider/status/fallbackReason 与实际路径一致。

## S04｜用户可以通过 Hybrid Search 找回长期记忆

**时间：** 2026-08-24 至 2026-08-27，2.5 天  
**Blocked by：** S03  
**交付结果：** `/api/projects/:id/cards/search` 对同一项目的卡片执行 embedding + keyword + recency + importance 混合检索，并返回可解释 Evidence。

最小数据结构：

```text
CardEmbedding
├─ cardId (unique)
├─ provider
├─ model
├─ dimensions
├─ vectorJson
├─ contentHash
└─ updatedAt
```

执行项：

1. 增加 additive migration，不修改现有 KnowledgeCard 主键和关系。
2. 新增 EmbeddingProvider；Capture/Reflection 保存后异步或事务后索引。
3. 对历史卡片提供可恢复的 backfill 命令；按 contentHash 幂等。
4. 实现 Hybrid score；P0 只包含 semantic、keyword、recency、importance，graph rerank 延后。
5. Search API 返回 `cardId/score/reason/source/retrievalMode`；semantic 不可用时明确 `retrievalMode=keyword_fallback`。
6. Copilot 和 HarmonyOS Memory Search 复用同一 API，不各自实现搜索。
7. 用 50/100/500/1000 条数据测 Recall@8、MRR、Evidence Precision 与 p95 latency。

通过标准：标注集 Recall@8 ≥ 0.80、MRR ≥ 0.65、Evidence Precision ≥ 0.90；1,000 条时本机 p95 < 500 ms；provider 故障时 fallback 可用但 Gate 保持未通过，不能把 fallback 计入 semantic 指标。

回滚：关闭 `SEMANTIC_MEMORY_ENABLED` 后恢复现有关键词路径；新增表可保留，不影响旧闭环。

## S05｜图片和 PDF 进入同一 Project Memory

**时间：** 2026-08-28 至 2026-09-02，3.5 天  
**Blocked by：** S00、S02A  
**交付结果：** 用户从 HarmonyOS 选择一张图片或一个 PDF，系统保存 Attachment、提取文本、生成 KnowledgeCard，并保留可追溯源文件。

最小数据结构：

```text
Attachment
├─ id
├─ projectId
├─ type
├─ storageKey
├─ fileName
├─ mimeType
├─ size
├─ sha256
├─ extractedText
├─ extractionStatus
├─ extractionError
└─ createdAt
```

执行项：

1. 新增 multipart Attachment API，限制 MIME、大小和项目归属；拒绝可执行文件和路径穿越。
2. 图片入口使用官方 PhotoAccessHelper Picker；文档入口使用 DocumentViewPicker。
3. P0 图片文本提取走 Backend OCR/视觉模型，使 DevEco 模拟器可以完成全链；HarmonyOS Core Vision Kit 只作为有真机后的增强，官方文档明确该 OCR 能力不支持模拟器。
4. PDF 在 Backend 提取文本；先用 5 份真实中文/英文/扫描型 PDF 做依赖探针，扫描型 PDF 进入 Backend OCR 或 `NEEDS_OCR`，不能返回假文本。
5. 提取成功后调用现有 Capture Pipeline；失败仍保留 Attachment 与错误状态，允许重试。
6. ProjectHome 增加“图片/文件”入口，MemoryTimeline 展示来源、文件名和提取状态，不新增文件管理页面。
7. 同 SHA-256、同项目重复上传时提示并复用，避免重复 Memory。

官方能力依据：

- [HarmonyOS PhotoAccessHelper 图片选择](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V13/photoaccesshelper-photoviewpicker-V13)
- [HarmonyOS 用户文件选择](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/select-user-file-V13)
- [HarmonyOS Core Vision Kit 通用文字识别](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/core-vision-text-recognition-V5)

通过标准：DevEco 模拟器中 Image 与可提取 PDF 各完成 5 个样例；Attachment、Capture、KnowledgeCard 三者可追溯；App 重启后仍可查看；异常文件不会创建伪造 Memory。Core Vision 真机 OCR 不计入本 Gate。

## S06｜Deliverable Gap 从真实 Evidence 产生 Intervention

**时间：** 2026-09-03 至 2026-09-07，3 天  
**Blocked by：** S04、S05  
**交付结果：** Demo 项目可以展示 Milestone、Deliverable、Expected Evidence 与实际 Evidence 的差距，并产生可解释的 DELIVERABLE_GAP。

最小结构：

```text
Milestone
├─ title / targetDate / status
└─ dependencies

Deliverable
├─ milestoneId
├─ title / status
└─ expectedEvidence[]

DeliverableEvidence
├─ deliverableId
├─ cardId or attachmentId
├─ evidenceType
└─ confirmed
```

执行项：

1. 只支持当前项目的一层 Milestone 和 Deliverable，不做通用工作流 DSL。
2. 提供最小 CRUD 与 Demo seed；HarmonyOS 在 ProjectHome 中展示当前 Milestone 和缺口。
3. Gap Engine 只在 Expected Evidence 有定义时判断；缺少定义时不猜测。
4. 增加 `DELIVERABLE_GAP` 规则，Evidence 必须列出期望项、已找到项、缺失项和对应 Card/Attachment。
5. 复用现有 dedupe、Snooze、Dismiss、Accept 和 Action 完成闭环。
6. 增加至少 30 个标注 Gap case，覆盖完整、部分缺失、误关联、无计划四类情况。

通过标准：Gap Detection Accuracy ≥ 0.85；无计划项目不产生 Gap；同一缺口重复 evaluate 不产生重复 Intervention；接受建议后仍必须由用户完成 Action。

## S07｜高风险 Intervention 在 App 关闭后以系统通知出现

**时间：** 2026-09-08 至 2026-09-10，2 天  
**Blocked by：** S02A、S06  
**交付结果：** High severity Intervention 生成可去重的 HarmonyOS 系统提醒；点击通知进入对应 InterventionDetail 并展示 Evidence。

执行项：

1. 新增 NotificationService，使用官方 `@kit.NotificationKit`。
2. 使用 interventionId 派生稳定 notification id/label；同一 Intervention 更新而不是重复刷屏。
3. 只对 High severity 触发系统提醒；Medium/Low 留在 App 内。
4. Snooze 重新安排提醒；Dismiss/Resolved 取消提醒。
5. 点击通知 deep link 到 `projectId + interventionId`；参数非法时回到 ProjectHome 并给出错误状态。
6. P0 使用本地系统提醒证明系统级触达；云推送、持续后台同步和实况窗不在本切片内。

官方能力依据：

- [HarmonyOS NotificationManager](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V13/js-apis-notificationmanager-V13)
- [HarmonyOS 通知设计原则](https://developer.huawei.com/consumer/cn/doc/doccenter-ux-design/system-features-notification-0000001793074217)

通过标准：DevEco 模拟器中关闭 App 后通知仍出现；点击到达正确 Evidence；连续 evaluate 10 次只保留一条同源通知；Snooze/Dismiss/Resolved 行为与 Backend 状态一致。结论标记为“模拟器通过、真机待验证”。

## S08｜小艺平台接入（条件切片）

**时间：** 2026-09-11 至 2026-09-15，3 天  
**Blocked by：** S00、S04、S06  
**交付结果：** 在小艺平台调试环境中验证 record_memory、query_memory、inspect_project 和确认后 create_action；若 DevEco 模拟器不提供小艺系统入口，只交付平台侧证据并明确真实入口未验证。

执行项：

1. 在小艺开放平台选择一个最小接入方式；优先使用平台当前支持的 Agent/Skill + A2A/工具调用，不自建第二套对话状态机。
2. 为外部入口增加最小认证、速率限制、审计和项目授权；当前无认证的本地 API 不直接暴露到公网。
3. 四个 capability 只映射现有 Backend：Capture、Hybrid Search、Project State/Intervention、Confirmed Action。
4. create_action 必须采用两步确认；未确认时只返回 proposed action，不写数据库。
5. 每次调用写 AgentRun，并记录来源 `xiaoyi`、provider、tool、confirmed 与关联 ID。
6. 做 20 轮平台调试环境 ↔ DevEco App 一致性测试：平台写入后 App 可见；App 的 Risk 在平台查询中一致；平台确认 Action 后 App 可见。

官方平台依据：

- [Harmony Intelligence Agent 与 Skill 开放能力](https://developer.huawei.com/consumer/cn/harmonyos-ai)
- [小艺开放平台](https://developer.huawei.com/consumer/cn/doc/distribution/service/introduction-0000001193306784)

通过标准分两级：A 级为平台调试环境四场景通过、Unauthorized Action Rate = 0；B 级为真实小艺系统入口通过。当前只有 DevEco 模拟器时最多宣称 A 级，不能用普通 App 内聊天或平台调试截图替代 B 级。

## S09｜Benchmark、Candidate Freeze 与提交冻结

**时间：** 2026-09-16 至 2026-09-26  
**Blocked by：** S02、S02A、S03、S04、S05、S06、S07  
**交付结果：** 功能、评测、HAP、Backend、Demo、视频和文档形成一套哈希一致、可复现的复赛候选版本。

执行项：

1. 固化 benchmark 数据集、schema、seed 和运行脚本。
2. 输出原始 JSON/CSV，再生成图表；图表不得手工改数字。
3. 指标至少包括：Recall@K、MRR、Evidence Precision、Risk Recall/FPR、Gap Accuracy、Duplicate Reminder Rate、Unauthorized Action Rate、p95 latency。
4. 2026-09-20 Candidate Freeze：只允许 Bug、UI、文档、视频修复，不再新增功能。
5. 做 5 次完整 5 分钟演示，记录每次是否成功、耗时、失败点和恢复方式。
6. 生成 release manifest：Git commit、DB migration、模型/provider、配置、HAP hash、Backend build hash、benchmark hash、文档/视频 hash。
7. 2026-09-26 Submission Freeze：所有提交物从同一个 release manifest 生成。

通过标准：

```text
Backend tests                 100% pass
Next.js production build     PASS
ArkTS build                  PASS
DevEco emulator install/run PASS
Signed HAP                  VERIFIED / PENDING（按实际签名条件披露）
Demo success                 5/5
Recall@8                     >= 0.80
MRR                          >= 0.65
Evidence Precision           >= 0.90
Risk Recall                  >= 0.85
Risk False Positive Rate     <= 0.10
Gap Detection Accuracy       >= 0.85
Duplicate Reminder Rate      0
Unauthorized Action Rate     0
```

---

# 5. 依赖关系与推荐日程

```text
S00 外部探针 ──────┬────→ S03 真实 LLM ─→ S04 Semantic Search ─┐
                   │                                           ├─→ S06 Deliverable Gap ─→ S07 系统通知 ─┐
S01 可重复构建 ─→ S02 模拟器闭环 ─→ S02A UI 基线 ─→ S05 Image/PDF Inbox ──────────────────────┘
                                         │                                                      ├─→ S09 Freeze
S00 ───────────────┴──────────── S04 + S06 ─→ S08 小艺平台（条件项，不阻塞 Freeze）
```

| 日期 | 主任务 | Gate |
|---|---|---|
| 8/20 | S00 外部探针；S01 开始 | 前置风险显性化 |
| 8/21–8/22 | S01、S02 | G0 |
| 8/23–8/25 | S02A UI 原型与 5 页基线；与 Backend 工作并行 | G0-UI |
| 8/23–8/27 | S03、S04 | G1 |
| 8/28–9/2 | S05 | G2 前半 |
| 9/3–9/7 | S06 | G2 |
| 9/8–9/10 | S07 | G3 前半 |
| 9/11–9/15 | S08 小艺平台条件切片；若权限/入口不可用则回收时间做回归 | 不阻塞 G4 |
| 9/16–9/19 | S09 Benchmark 与缺陷清零 | G4 |
| 9/20 | Candidate Freeze | 功能冻结 |
| 9/21–9/26 | 视频、文档、答辩、最终回归 | G5 |

若由单人串行开发，以上工期已接近上限。任何 S00 阻塞超过 1 天，优先砍掉 Scheduling、服务卡片/实况窗、Meeting Mode 和跨设备，不得压缩 G0/G1/G4 的验证时间。

---

# 6. 数据迁移、回滚与兼容策略

1. 所有 2.0 schema 先 additive migration：新增表、新枚举值、新可空字段，不删除或重命名初赛字段。
2. 每次 migration 前备份 SQLite DB，并记录文件 hash；迁移后运行现有 38 tests 与 Demo C。
3. Embedding backfill 必须幂等，可中断后继续；失败不能阻塞原有关键词检索。
4. Attachment 提取失败不回滚原文件元数据，但不得创建内容为空或伪造的 KnowledgeCard。
5. Deliverable Gap 通过 feature flag 开启；关闭后保留数据但不产生新 Intervention。
6. 系统通知关闭时，Intervention 仍在 App 内可见。
7. 小艺不可用时，HarmonyOS App 和 Backend 仍完整可用；不得形成反向依赖。

建议 feature flags：

```text
SEMANTIC_MEMORY_ENABLED
PROJECT_INBOX_ENABLED
DELIVERABLE_GAP_ENABLED
SYSTEM_NOTIFICATION_ENABLED
XIAOYI_ENABLED
```

---

# 7. 执行纪律

每个切片开始前必须在实现记录中写：

```text
Task
Priority
Core Loop Impact
Files to Change
API Changes
Data Migration
How to Verify
Demo Impact
Rollback
```

实现期间维护 `ProjectMemo_2.0_IMPLEMENTATION_NOTES.md`：所有偏离本计划的地方记录“计划要求、代码实际、采取方案、验证结果”。

每个切片结束必须同时给出：

1. 修改文件；
2. migration；
3. 实际运行命令；
4. 完整通过/失败结果；
5. Demo receipt；
6. 未解决风险；
7. 是否允许解除下一切片的 blocker。

禁止事项：

- 不用 mock 结果冒充真实 LLM、Semantic Search、OCR、小艺或系统通知。
- 不用页面存在、ArkTS 构建或模拟器通过冒充真机闭环完成。
- 不用 `ok=true` 覆盖前置 Gate 失败。
- 不写死 Risk、Evidence、Milestone 或 benchmark 数字用于演示。
- 未经用户确认不创建高影响 Action。

---

# 8. 假设与 STOP 条件

## 当前假设

1. 由一名主要开发者/Coding Agent 串行推进；当前唯一 HarmonyOS 运行环境是 DevEco 模拟器，没有真机。
2. 初期 Backend 继续使用 Next.js + Prisma + SQLite；复赛前不迁移数据库技术栈。
3. 现有 38 个测试是回归基线，DevEco 模拟器是当前 App 验收基线；二者都不是未来真机验收的替代品。
4. 截止节点沿用现有计划：9 月 20 日 Candidate Freeze、9 月 26 日 Submission Freeze。
5. 当前没有已冻结的 UI 设计稿；S02A 的两页原型是视觉方向确认门，不允许未确认就批量重写五页。

## 必须停止并报告，不得自行猜测

1. 任何 migration 会破坏现有 Capture → Intervention → Action → Reflection 数据。
2. 真实 LLM 或 Embedding Provider 的 API 契约与 OpenAI-compatible 假设不一致。
3. Backend 将部署到无状态环境，但 Attachment 仍计划写本地磁盘。
4. 小艺平台账号、A2A/Skill 权限、真机调试或上架审核不可用。
5. Core Vision OCR 在目标真机/API 24 上不可用。
6. 系统通知无法在 App 关闭后出现或无法 deep link 到 Evidence。
7. 到 9 月 18 日仍有任一 P0 Gate 未通过：立即砍掉所有 P1/P2 增强，转入稳定性与提交收口。

---

# 9. 方案验证

```text
Answers the request
  第 1 节给出基于当前工作树和实际命令的审计；第 4–5 节给出从当前断点开始的具体执行切片与日程。

Scope gate
  保留现有 Backend；先冻结 HarmonyOS MVP；2.0 按纵向切片推进；Scheduling 及扩展能力明确延后。

Assumptions explicit
  第 8 节列出人员、技术栈、测试边界、截止节点和所有 STOP 条件。

Verification
  每个切片均有可观察的通过标准；第 3 节规定 Gate；第 4 节 S09 给出最终量化阈值。

Rollback
  第 6 节规定 additive migration、feature flag、backfill 与入口降级策略。
```
