# 补齐非创作 Skill 交付路径

基线 `9776f9b`。复现：`这次只做计划，报告不要动` / `先研究，不开始写报告` / `只复盘，不创建行动` 在旧实现中只能停在 `REVIEW_REQUIRED`，没有可查看成果；`save_mission_output` 只有创作阶段可用。

## 领域方案（不新增表、不新增 Agent 引擎）

- 终态的规划/研究/复盘阶段把 `save_mission_output` 解释为**阶段成果**：写入 `AgentMission.planJson.skillArtifacts`，不写 `AgentMissionOutput`，因此不产生报告版本；不创建行动/外部写入。
- 阶段成果必须通过原 `outputSchema`、`validateResearchOutput` 与 `validateSources`：正文至少一段绑定真实来源，引用需可解析且与所引段落相关；未知项保留。
- 交付后 Mission 进入 `PAUSED + pauseReason=SKILL_DELIVERABLE_READY`，`lastErrorJson=null`，WorkState 返回 `SKILL_DELIVERABLE_READY`（“阶段成果已备好；原报告与业务行动未改动”）；工作台显示阶段成果、来源定位、未知项，并提供“继续跟进”。
- “继续跟进”不再重复跑同一阶段：恢复为 `WAITING_INPUT + waitingFor=OBSERVATION`，等待新资料/新指令；后续指令走原 Directive/控制路径。原报告版本与业务行动保持原状。
- 路由补强：`不开始写报告` 等否定动作不再被当成创作请求；“先研究”按研究路由；新增研究/调研动词。

## 验证

```powershell
npm.cmd test -- tests/v2SkillArtifacts.test.ts
```

- 4/4：三种场景都生成 1 个阶段成果（skillId 正确、来源绑定、引用可解析）、报告版本保持 1 版、行动 0 个、暂停原因与 WorkState 正确、工作台可见、resume 后可恢复；无来源的阶段成果被拒绝且不落库。
- 浏览器（正常项目入口 → 委托预览/确认 → 工作台）：4 项检查通过，`browser-check.log`、`browser/receipt.json`、桌面/移动截图；只做计划时 `outputs=0`、`stageArtifacts=1`、来源可定位、resume 可恢复、360px 无溢出。
- 回归与构建：见 `full-tests.log`、`build.log`、`tsc.log`、`eslint.log`。

## 迁移与兼容

- 无新增 Schema/Migration；阶段成果存放在既有 `planJson`。
- 旧 v1 finish、V2 持续责任边界、原报告 Output 版本链未改；工作台快照新增 `stageArtifacts/reasonCode` 字段，旧客户端可忽略。

## 剩余

- 阶段成果目前只读展示，不进入采纳/外发流程（本轮有意保持“不改报告、不创建行动”）。
- 未用真实模型验证该路径（本轮无付费授权）。
