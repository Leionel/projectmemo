# S2 后续实现 Agent 执行 Prompt

直接将下面的内容交给负责实施的 Agent。使用现有 S2 worktree，由一个实施 Agent 写入；审查者可以只读，不让多个 Agent 同时改这棵树。

---

请接手 ProjectMemo S2 后续实现，直接推进代码、两端适配、验证与本地提交。先核实最新状态，再沿原 Roadmap 完成有价值的纵向增量，不重新规划 R4，不重写已经完成的 S1 或 S2 首批。

## 工作位置与起点

使用现有目录 `D:/Projects/hongmen-s2`，分支 `codex/s2-product-enhancements`。不要在主目录 `D:/Projects/hongmen` 或原 S1/PM 树实施，也不要从 master 新开一个缺少修复的分支。

已知检查点：

- `63e19bb`：S1 独立审查核心修复。
- `fd4f754`：指引跨期限、引文词边界和真实日期保护。
- `24004cf`：S1 修复和证据冻结。
- `6a90423`：S2 第一批业务，用量投影与鸿蒙 `classes` 字段修复。
- `a9ab78c`：S2 第一批验收记录。之后可能有交接文档提交，读取实际 HEAD。

启动时执行并记录：

```powershell
Set-Location D:/Projects/hongmen-s2
git status --short
git branch --show-current
git log -6 --oneline
git merge-base --is-ancestor a9ab78c HEAD
git worktree list
```

祖先检查应退出 0。遇到未知 dirty 文件先识别归属并保留，不 reset/clean/stash 掉别人的改动。若发现其他实施者正在写这棵树，先协调唯一写入者，不能同时开工。

## 必须先读

以下路径均位于 `D:/Projects/hongmen-s2/`：

1. `AGENTS.md`。
2. `docs/FINAL/Competition/COMPETITION_SPRINT_ROADMAP.md`，特别是 S2 原五包及最新增量。
3. `docs/FINAL/Competition/S1_INDEPENDENT_REVIEW_2026-11-02.md`。
4. `docs/FINAL/Competition/S2_IMPLEMENTATION_HANDOFF_2026-11-02.md`。
5. `docs/FINAL/Competition/S2_IMPLEMENTATION_2026-11-02.md`。
6. `evidence/s1-independent-review/20261102/ACCEPTANCE.json`。
7. `evidence/s2-resource-readback/20261102/ACCEPTANCE.json`。
8. `docs/FINAL/Competition/S1_FINALS_ACCEPTANCE_GUIDE_2026-11-02.md`。

按实际变更补读原 PM、Continuity、Attention、Experience 和 CT 实施记录。用源码判断能力现状，不用旧 Roadmap 的状态替代当前代码。

## 已完成内容，保留并复用

`lib/mission/resourceUsage.ts` 从原 `budgetUsedJson` 做只读投影，通过原 `/api/missions/:id/readback` 给 Web/鸿蒙展示。缺失或非法计数保持 null，UNKNOWN 不藏掉；费用为 null/UNPRICED，因为尚未绑定费率和账单。这个增量不是完整任务计价。

鸿蒙 `MissionReadback.ets` 和 `MissionReadbackView.ets` 已改为消费后端原有的 `reviewProgress.classes`；不要改回 `divisions` 或新造转换别名。新用量字段 optional，保留旧后端兼容。

第一批证据为定向 4 文件/28 项、类型/lint、setup 1＋业务 1 的任务 E2E、鸿蒙 103 项及 unsigned HAP 构建。S1 的全量属于较早源码；不得写成 S2 已通过全量。真实模型、设备、自然日仍未签收。

## 推进顺序与交付范围

### 1. 先补真实材料覆盖提示

目前 Intake 模型输入每份最多 20,000 字符、总计 24,000 字符，按顺序截取；上传完整 PDF 不等于模型已读全文。

检查 `lib/services/projectIntakeService.ts` 的 `materialTextFor`、Intake 共享合同/Prompt、Web Intake 页面和鸿蒙对应模型/页面。沿原预览 DTO 增补实际送入的范围、总量/截取或未包含状态，Web/鸿蒙一致呈现。统计必须与实际发送正文一致；不要把所有已上传字数当成已读字数。

长 PDF、后续材料因预算未送入、没有可读文本、撤回同意、材料修订和重新理解都要有明确结果。旧模型版本与最新待处理材料覆盖分开，避免更新上传后仍把旧覆盖标成当前。

提供自然的原文核对与继续深读入口。保留原项目复杂调查和动态工具选择，不能靠降低 Agent 能力或要求用户自行裁好全部材料解决覆盖问题。

### 2. 继续结果与成本包

复用原 Mission/Step/AgentRun/Conversation/ResultReceipt、预算预占和结算。先核对 call 身份与累计计数的真实覆盖，再判断哪些费用可核算。

有来源、适用时间、模型/工具版本、币种与计价条件的费率才能估价；估算与实际账单分开。请求失败、重试、repair/judge、缓存和 UNKNOWN 不丢失、不重复计算。混合币种不未经依据换算，未知费用不填零。没有完整记录时交付部分覆盖与明确未知，不能声称完整账单或虚构节省时间/ROI。

若当前真实记录不足以支持跨 Intake/Conversation/Mission 的任务费用，先沿原身份补必要计量和关联，不建第二套结果或计费账本，也不从当前环境模型名追溯猜历史请求的模型/价格。

### 3. Personal/Adaptive 协作

核对当前 PM4/入口 Gate，复用已有 Personal Memory、Continuity 和 Attention。完成明确偏好的保存/局部覆盖/手机纠正/到期/撤回，以及两个项目间的正确作用域。

用户说“少问我”“安静一点”不等于批准更多工具、联网、外部写入或提高预算。偏好调整不能关闭必要的权限澄清、UNKNOWN 处理或重要失败说明；不新增自动画像或平行偏好系统。

### 4. 失败改进

先检查原 trace/Experience/评测能力，复用本次真实发现的工程失败与获准用户纠正。脱敏、样本同意、独立标签、开发集/留出集、重放与版本边界要清楚。

先交付可重放的失败与负例；实模比较沿现有评测配置做条件匹配的 Experience 适用/关闭/拒用，保留负结果。合成样本只证明工程行为；不能冒充真实用户价值。禁止自动修改生产 Prompt 或扩大经验权限。

### 5. 系统分享与小艺/Intents

尽早检查实际 SDK/API、注册、签名、设备与原 Capture/Attachment/Want/Handoff 能力。先做有界探针，再按原计划实现真正能用的入口；不要等其他四包都结束才发现平台不可用。

系统分享应完成：受支持材料→可取消的项目归属核对→原 Intake 或 Capture/Attachment→同一回执，并覆盖重复投递、URI 到期、换账号、离线恢复。收到 URL 不自动 Fetch，不借预览同意外发材料。

小艺只在真实平台条件满足后签收查询/打开原任务/已授权只读接续；审批回 App 重新鉴权与校验。模拟器、mock adapter、HAP 编译不能证明平台注册、推送或真机后台能力。

平台或设备缺失只阻塞相关设备验收，继续其他可验证的服务、交互和恢复路径；缺条件项写明证据和恢复条件，不做假入口，也不直接删掉原目标。

## 实现边界

- 沿原服务与对象实施，不新建 Runner、Planner、Memory、通知系统、结果账本或复杂 Agent 框架。
- 不改固定的“搜索→论文→浏览器”流程；Agent 保留自主调查、原文核对、最小必要提问、停止与合法恢复。
- 必须保留 owner/session/revision/hash、Directive Admission、指引到期、SUPPRESS_USE 与来源链、lease/generation、累计预算、UNKNOWN、STOP、幂等、批准及原 `resultCardId`。
- 预览的模型处理同意不自动授权额外 OCR/embedding/搜索/后台执行。原文、模型推断和用户指令不能互相升级权限。
- 不复活过期/撤回结果；旧成功和旧失败都不能覆盖新目标。清理失败保留原文件身份和重试责任。
- 主目录原有签名/UI 修改和并行 PM 树保留，不复制 `.env`、真实库、附件或私钥。不得以 `db:setup`/seed/reset 修复真实环境。
- Web/鸿蒙沿原入口、组件和 Token 改进，控制信息负担；不统一重绘，不新增技术概念堆砌的控制台。桌面截图已有固定导航遮挡上边缘的问题，要分清截图定位与真实布局问题后修复/重拍。
- 新平台能力按 AGENTS 查官方文档及活跃、许可证明确的同类实现，注明版本与适用限制，不发明 ArkUI/Intents API。

## 费用与外部操作

已存在“不要太贵”的本地实模评测授权，按操作指南的小批次上限、逐调用计量与停止条件执行；先核对所有接手者累计，不能每换 Agent 就重置预算。没有计量就先完成 mock/隔离工程验证，不能靠多次付费尝试排查配置。

不新增付费服务或训练，不部署生产，不迁移/删除真实库，不发起外部写入，不自行合并 master 或 push。本地目标文件提交可以直接完成。

## 验证与交接

先用受影响测试确认每个纵向切片，再在阶段汇总时跑适用的全量/Gate。Vitest 文件串行，写入探针在导入 `lib/db.ts` 前设置独立库；E2E 使用原隔离脚本。

```powershell
npm.cmd test -- tests/s2ResourceReadback.test.ts tests/missionReadbackPanel.test.ts tests/s1ResultProgress.test.ts tests/copilotContinuation.test.ts
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd run test:e2e -- e2e/missions.spec.ts
npm.cmd run harmony:test
npm.cmd run harmony:build
```

这些是现有切片的起始回归集，按修改新增真正覆盖负例的测试；不是完成整个 S2 的固定充分条件。涉及材料还需原 Intake/附件与清理/指令并发回归；涉及偏好/经验还需 PM、Source Policy、失效、跨项目及模型边界回归。最终整合补全量测试和 Web E2E，必要时设置实际 Poppler 路径。不要增加 skip、放宽断言、隐藏失败或将旧报告换个名字当新证据。

新证据建独立目录，不覆盖旧日志/截图，不提交 auth state、真实数据库、含 cookie 的 trace、API Key 或签名文件。工程、首次真实用户、实模质量、模拟器、真机、自然日、现实结果分别记账。

持续更新原 S2 实施记录与 Roadmap，每批本地提交目标文件。交接包含 Issue、Owner、worktree、修复 Commit、Security/Functional/Evidence Gate、证据及剩余风险。

完成时报告用户现在从哪里能用、实际行为变化、执行的验证、仍未知或被平台条件阻塞的部分。不要只列文件和技术名词，也不要把其中一个小批次说成全部 S2 已完成。

请现在先核对工作树，简述当前真实进度和本批切入点，然后直接实施。
