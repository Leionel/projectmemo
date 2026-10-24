# P3-A 实施与本地验收

基线：`d618f8c37a91ab11e3bc073a4da3964aa46d4655`（P2 已上线版本）。日期：2026-10-24。所有新增数据均来自隔离测试库；本轮真实模型调用 0 次，提炼与注入全部为规则实现。不宣称"越用越好"：真实任务效果对照未执行，保持未验收。

## 已实施

- **轨迹索引**（`lib/experience/trajectoryIndex.ts`）：对项目内最近 20 个委托建立带结果标签的只读投影。四层结果严格区分：工程执行成功（`status=SUCCEEDED`）、用户采用（`MissionArtifactReceipt` 计数）、行动完成（批准步骤 `effectKey=dedupeKey` 回链 `ActionItem.status/resultCardId`，`isSimulated` 不计）、用户自述效果（回执卡存在记 `USER_ATTESTED`，绝不记"实测效果"）。步骤按 ordinal 去重，重试次数只是属性。
- **候选提炼**（`lib/experience/extract.ts`）：纯规则。WORKFLOW = 工程成功且成果被采用的成功工具序列；GUARDRAIL = 失败后同工具修复成功的 (tool, reasonClass)。样本只按 missionId 去重计数，同一次重试不重复计样本。反例：同序列工程成功但未采用 / 同因失败未修复。每条经验记录适用条件、工具/协议版本、来源委托、反例与撤销状态（`AgentExperience` 表）。
- **状态机**：CANDIDATE →（≥2 个不同支持委托自动）SHADOW →（仅用户显式操作）ACTIVE；REVOKE 对该模式长期生效。同步只并集样本、上调状态，不删除、不降级；服务端永不自动激活。
- **注入是建议不是权限**（`lib/experience/injection.ts` + `contextBuilder.ts`）：仅 ACTIVE 经验以 `experienceAdvisories` 文本进入模型上下文（≤3 条、注明"不改变权限"），SHADOW 只在 UI 观察。停注入条件：已撤销、工具版本不兼容、协议 schemaVersion 不兼容、反例计数追平支持样本——停止的是新注入，`AgentExperienceUse` 历史使用记录保留且同委托同阶段只记一次。开关 `PROJECT_EXPERIENCE_ENABLED` 关闭时全部停用。
- **接口与展示**：`GET/POST /api/projects/[id]/experiences[/[experienceId]]`；委托详情 `missionDetail` 增加 `experience` 块。Web 在委托详情 DecisionScenarios 下就近展示适用条件/来源样本/激活/停用，完整历史（含 CANDIDATE/REVOKED）放委托区末尾折叠的二级列表，无新一级导航。鸿蒙侧 `models/Experience.ets`、`services/ExperienceService.ets`、`ExperiencePanel` 同步，状态文案契约 `common/ExperienceContract.ets` 双端一致。
- **隔离**：经验按 projectId+ownerUserId 归属，跨用户/跨项目访问返回 404；不做跨项目迁移。

## 迁移

`20261024090000_experience` 只新增 `AgentExperience` / `AgentExperienceUse` 两张表与索引，不改写既有表；已验证可从空库全量重放（见 evidence/p3a）。生成客户端目录不变。

## 验证

- 全量 Vitest：105 文件、857 项通过（P2 基线 835 + 新增 22：experienceReuse 15、experienceNativeContract 1、既有文件计入 6）。含：四层标签不混淆、模拟行动不计、用户/项目隔离、重试去重、样本门槛与不自动激活、GUARDRAIL 反例、版本/协议/撤销/反例停注入且历史保留、CANDIDATE 不可激活、越权 404、开关关闭不注入。
- **冻结任务对照探针**（规则/mock）：同一委托 fixture 切换无经验/结构化经验——建议内容全部来自真实样本轨迹且含适用条件；goal/successCriteria/constraints/planRevision 与无经验版本逐字段一致（不阻断、不改权限）；负迁移防护（协议不匹配已被抑制、建议不含禁止式指令）；成本上限（≤3 条、建议块 ≤2000 字符、上下文总增量 ≤2200 字符）。**没有真实模型对照与真实任务成功率，效果保持未验收。**
- ArkTS `ExperienceService` 经真实 Next 路由往返（列表→激活→读回 ACTIVE）通过；鸿蒙 Hypium 新增 experienceContract 3 项（含影子不注入断言）。
- tsc、ESLint 通过。鸿蒙单测/HAP 构建结果见 evidence/p3a/validation.json（构建通过不等于签名/设备/平台验收）。

## 范围与开放 Gate

- 提炼规则只覆盖两类模式（工具序列工作方法、失败防护）；反例语义是"同模式未达成采用"，不是因果证明。WORKFLOW 建议文本中的目标摘引自样本委托，属适用提示而非事实断言。
- 轨迹索引在列表读取时同步（有界 20 委托），未做 Worker 定时提炼；超过 20 个委托只统计最近部分（响应中 `truncated` 标明）。
- 真实模型下的建议有效性、任务成功率、过度拒答率与负迁移率需要真实留出任务，本轮未执行——只证明工程可提炼、可检索、可控停用。
- P3-B（单仓库只读感知）未实施：无授权仓库凭据，且路线图要求先由用户小测证实录入负担是主障碍；本轮仅保留评估，不新增外部请求代码。

## 部署

沿用 safe-update.sh（先 typegen+tsc 再构建的 2026-10-24 修复版）。迁移 `20261024090000_experience` 增量执行；不运行 seed/reset。见 deploy/alibaba-cloud-linux/P3_UPDATE.md。
