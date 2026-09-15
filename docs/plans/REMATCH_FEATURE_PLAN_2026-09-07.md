# ProjectMemo 2026 复赛增量功能实施计划文档 (A + B + E + 鸿蒙特色)

> **文档定位**：复赛决胜阶段增量功能技术实施计划方案  
> **指导原则**：先规划不执行、严谨细化到文件与接口、紧扣鸿蒙原生能力、适配 3 分钟可信答辩演示  
> **制定日期**：2026-09-07  

---

## 一、 整体目标与架构蓝图

### 1. 核心目标
将 ProjectMemo 从一个“可靠的项目过程手账”，升级为“**首个具备时态决策影响分析、评委质询可溯源闭环、多模态原文纠错与鸿蒙桌面主动触达的学术决策智能体**”。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ProjectMemo 2.1 创新功能矩阵                           │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ 模块 A: 决策变更影响预览与闭环   │ 突发方案变更 -> 时态冲突识别 -> 待办/成果影响预览 -> 一键确认与回溯 │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 模块 B: 答辩证据核验与质询透视镜 │ 成果段落引用 -> 溯源至真实实验与时间戳 -> 评委质询确凿拒答           │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 模块 E: 可纠错多模态项目收件箱   │ PDF/图片导入 -> 原文坐标与片段定位 -> 人工纠错数值 -> 交付物可信关联 │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ 模块 HM: 鸿蒙桌面服务卡片与导出  │ FormExtensionAbility 倒计时与要务微卡片 -> 带证据链学术报告导出      │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

---

## 二、 详细技术方案与子模块设计

### 模块 A：决策变更影响预览与闭环 (Change Impact Preview & Temporal Ledger)

#### 1. 业务流程与时序图
```
[用户输入变更事实] (例如: "原方案A显存超标，改为方案B，截止提前2天")
        │
        ▼
[后端决策分析引擎] (/api/projects/[id]/decisions/impact-preview)
        ├─ 1. 时态账本检测: 识别方案 A 对应的活跃 Card，标记为待 SUPERSEDE
        ├─ 2. 待办影响分析: 检索关联方案 A 的 ActionItem，标记为待作废/重规划
        ├─ 3. 成果影响分析: 检索引用方案 A 的 Artifact 章节，标记为需重新生成
        └─ 4. 返回完整结构化变更影响预览单 (ChangeImpactProposal)
        │
        ▼
[鸿蒙工作台弹层: 变更影响评估卡] (ChangeImpactModal)
        ├─ 呈现: 原决策 vs 新决策、作废待办清单、受影响成果章节
        ├─ 用户操作: 逐项确认 / 一键采纳变更 / 取消放弃
        │
        ▼
[后端原子执行提交] (/api/projects/[id]/decisions/confirm-change)
        └─ 在事务中: 创建新记忆 -> 写入时态取代关系 -> 更新待办状态 -> 归档成果版本
```

#### 2. 数据契约与模型定义
- **文件**：`lib/types/decisionImpact.ts` / `harmonyos/entry/src/main/ets/models/DecisionImpact.ets`
```typescript
export interface ChangeImpactItem {
  id: string;
  type: 'ACTION' | 'ARTIFACT' | 'CARD';
  targetId: string;
  title: string;
  impactReason: string;
  proposedAction: 'CANCEL' | 'UPDATE' | 'REGENERATE';
  confirmed: boolean;
}

export interface ChangeImpactProposal {
  proposalId: string;
  projectId: string;
  newFactText: string;
  supersededCardId: string | null;
  supersededCardTitle: string | null;
  impactedActions: ChangeImpactItem[];
  impactedArtifacts: ChangeImpactItem[];
  summary: string;
}
```

---

### 模块 B：答辩证据核验与评委质询透视镜 (Claim Auditor & Evidence Peek)

#### 1. 业务流程
1. **成果带引用渲染**：成果 Markdown 中的核心断言（如“性能提高 1.8%”、“采用 SQLite 事务”）自动解析由 `[ref:card_id]` 绑定的引用标记，呈现轻量可点击的高亮微徽标 `[依据]`；
2. **证据透视抽屉 (Evidence Peek Drawer)**：
   - 点击该断言，右侧/底部呼出抽屉卡片，展示：
     - **原始证据文本**（采集碎片的原文）
     - **采集时间戳与来源**（导师会话、实验代码输出）
     - **时态状态标签**（🟢 当前有效 / 🔴 已被新决策取代 / 🟡 证据链不完整）
3. **评委质询模式 (Judge Rebuttal Mode)**：
   - 成果右上角提供【评委质询】入口，内置常见竞赛评委刁钻质询样例（如：“有低功耗实测证据吗？”、“方案相比去年开源项目优势何在？”）；
   - 知识库中无证据时，**严守真实性原则**，直接拒答：“经查验，当前档案中无低功耗实测记录，无法提供断言依据，建议发起实测补充。”

---

### 模块 E：可纠错多模态项目收件箱 (Multimodal Inbox with Correction)

#### 1. 业务流程
1. **持久收件箱集成**：扩展此前完成的“待处理附件收件箱”，新增“多模态预览与人工纠错”模式；
2. **段落与坐标定位**：
   - 附件在 OCR / 文本提取后，后端保存段落列表（`ParagraphSnippet: { index, text, confidence }`）；
3. **人工校对弹窗 (AttachmentCorrectionDialog)**：
   - 展示原图/PDF 缩略图与提取文本对照；
   - 允许用户直接在移动端修改识别错误的实验指标（例如将识别错的 `98.2%` 修改为正确的 `99.2%`）；
   - 点击【修正并沉淀为记忆】，直接生成纠错后的结构化卡片，并自动关联到目标里程碑交付物。

---

### 模块 HM：鸿蒙原生特异性功能 (Form 元服务微卡片 + 学术报告导出)

#### 1. 鸿蒙桌面服务微卡片 (FormExtensionAbility · 备赛倒计时与每日第一要务)
* **卡片规格**：2×2 极简卡片、2×4 详细卡片；
* **内容承载**：
  - 项目名称 + 备赛倒计时天数（逾期呈红色告警）；
  - 准备度环形进度（如 50%）；
  - **今日唯一最重要待办行动**（如“完成消融实验”）；
  - 点击“完成”或“进入”，通过 `action: 'router'` 一键直达对应项目的“待办”Tab。
* **开发落点**：
  - `harmonyos/entry/src/main/ets/entryformability/EntryFormAbility.ets`
  - `harmonyos/entry/src/main/ets/widget/pages/WidgetCard.ets`
  - `harmonyos/entry/src/main/resources/base/profile/form_config.json`

#### 2. 带学术证据附录的成果一键导出 (Export with Provenance)
* **输出内容**：完整的 Markdown/HTML 评审报告，文章末尾自动附带由系统自动编制的《过程决策与证据存证目录》；
* **操作体验**：点击成果右上角【复制带存证全文】或【分享到系统剪贴板】，支持直接粘贴到学术论文或提交材料中。

---

## 三、 详细任务拆解与实施路线图 (Task Breakdown)

### 阶段一：模块 A · 决策变更影响预览闭环 (预计 4 个 Task)
- [ ] **Task A1: 后端影响分析服务与接口**
  - **文件**：`lib/services/changeImpactService.ts`, `app/api/projects/[id]/decisions/impact-preview/route.ts`
  - **内容**：实现 `analyzeChangeImpact(projectId, changeText)`，基于时态账本计算受影响的 Actions 和 Artifacts。
  - **测试**：`tests/changeImpact.test.ts`
- [ ] **Task A2: 后端变更原子提交接口**
  - **文件**：`app/api/projects/[id]/decisions/confirm-change/route.ts`
  - **内容**：事务内创建新 Card、写入 `SUPERSEDES` 关系、变更旧 Action 状态为 `CANCELLED` 并创建新 Action。
- [ ] **Task A3: 鸿蒙端变更分析 API 客户端**
  - **文件**：`harmonyos/entry/src/main/ets/services/DecisionService.ets`
  - **内容**：实现 `previewChangeImpact` 与 `confirmChange` 方法。
- [ ] **Task A4: 鸿蒙端变更影响评估弹窗与工作台交互**
  - **文件**：`harmonyos/entry/src/main/ets/components/ChangeImpactDialog.ets`, `ProjectHome.ets`
  - **内容**：在“问忆程”或工作台提供“方案变更演练”入口，呼出对比卡片与逐项确认。

### 阶段二：模块 B · 成果证据透视镜与评委质询 (预计 3 个 Task)
- [ ] **Task B1: 成果引用语法增强与 Claim 解析**
  - **文件**：`lib/services/artifactService.ts`, `lib/llm/prompts.ts`
  - **内容**：生成成果草稿时附带 `[claim:id]` 锚点。
- [ ] **Task B2: 鸿蒙端断言高亮与证据透视抽屉**
  - **文件**：`harmonyos/entry/src/main/ets/components/ClaimAuditorDrawer.ets`, `ProjectHome.ets`
  - **内容**：点击段落弹出卡片展示原始依据与时间戳。
- [ ] **Task B3: 评委质询模式（确凿拒答交互）**
  - **文件**：`harmonyos/entry/src/main/ets/components/JudgeRebuttalModal.ets`
  - **内容**：内置评委典型提问列表，演示无依据时准确拒答。

### 阶段三：模块 E · 多模态收件箱校对纠错 (预计 2 个 Task)
- [ ] **Task E1: 附件识别片段提取与校对更新 API**
  - **文件**：`app/api/projects/[id]/attachments/[attachmentId]/correct/route.ts`
  - **内容**：允许修改提取后的结构化内容并重新触发生成记忆。
- [ ] **Task E2: 鸿蒙端多模态校对弹窗**
  - **文件**：`harmonyos/entry/src/main/ets/components/AttachmentCorrectionModal.ets`
  - **内容**：原件预览 + 文本校对 + 一键修正沉淀。

### 阶段四：模块 HM · 鸿蒙桌面服务卡片与学术导出 (预计 3 个 Task)
- [ ] **Task H1: 鸿蒙 FormExtensionAbility 与 2×2/2×4 卡片开发**
  - **文件**：`harmonyos/entry/src/main/ets/entryformability/EntryFormAbility.ets`, `form_config.json`
  - **内容**：桌面微卡片展示倒计时、准备度与下一个待办，实现桌面拉起直达。
- [ ] **Task H2: 带证据附录的成果导出工具**
  - **文件**：`harmonyos/entry/src/main/ets/common/ExportFormatter.ets`
  - **内容**：生成带引用目录与时间戳的完整学术 Markdown 文本。
- [ ] **Task H3: 离线免网演示保护模式**
  - **文件**：`harmonyos/entry/src/main/ets/services/OfflineDemoProvider.ets`
  - **内容**：提供一键离线演示数据集，断网状态下全部交互 100% 可用。

---

## 四、 3 分钟复赛可信演示脚本（适配新功能）

- **0:00–0:45【初始状态与证据核验（模块 B）】**
  - 打开成果“作品说明大纲”，点击“消融实验提升 1.8%”的断言；
  - 侧边弹出【证据透视抽屉】，清晰看到 8 月 20 日的原始实验记录，展示真实可信。
- **0:45–1:45【突发变更与影响预览（模块 A 主推）】**
  - 模拟突发变故：“显存超标，方案 A 改为方案 B，截止时间提前”；
  - 呼出【决策变更影响评估单】：实时展示原方案 A 作废、关联的待办行动自动标记受影响、成果需重写；
  - 点击“确认变更”，系统自动完成时态交替，再次点击原成果断言，状态自动变为“🔴 已被新方案取代”。
- **1:45–2:20【多模态收件箱纠错（模块 E）】**
  - 导入一份带有识别偏差的测试 PDF，打开【校对弹窗】；
  - 现场修改数值为真实值并确认，直接闭环沉淀为新记忆并关联交付物。
- **2:20–3:00【鸿蒙桌面生态与质询（模块 HM）】**
  - 退回鸿蒙桌面，展示 2×4 服务微卡片已同步更新为最新倒计时与唯一要务；
  - 触发一次评委质询：“有没有做极端功耗测试？”，Agent 明确拒答，赢得评委极高信任。

---

## 五、 状态说明
- **当前状态**：计划已细化完毕并写入文档，**处于静默待命状态，尚未触动任何源代码**。
- **后续触发**：当您审核确认后，可随时指定分阶段执行（例如：“开始执行阶段一”）。
