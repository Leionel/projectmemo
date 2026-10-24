# P3-A / P3-B 实施与本地验收

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

沿用 safe-update.sh（先 typegen+tsc 再构建的 2026-10-24 修复版）。迁移增量执行；不运行 seed/reset。见 deploy/alibaba-cloud-linux/P3_UPDATE.md 与 P3B_UPDATE.md。

---

# P3-B 单仓库只读感知（最小版）

实施状态（2026-10-24）：单类公开仓库 commits 信号已实现；ECS 到 api.github.com 连通性、匿名配额（60/h 满额）已实测。**生产链路已验收（2026-10-24，evidence/p3b/prod-acceptance，14/14）**：演示账号新建「洛加数学技能仓库跟踪」项目，连接 Leionel/luojia-math-tutor-skill@main 首刷拉到 30 条真实提交候选，ETag 二次刷新 NOT_MODIFIED，两条采纳各写入一条 Capture（其一关联 TODO 行动且行动状态保持不变），幂等重采纳零新增，错误路径 401/404/409 全符合，第二连接撤销后刷新 409 且 30 条历史保留。本轮零模型调用、零凭据。

## 已实施

- **连接与信号分层**（迁移 `20261024100000_repo_sensing`，两张新表）：`SourceConnection`（repo/ref/ETag/游标/状态，每项目最多 3 个活跃连接）+ `ExternalSignal`（CANDIDATE/ADOPTED/DISMISSED）。按项目与用户严格隔离。
- **按需刷新**（`lib/sensing/repoSource.ts`）：仅用户显式触发时匿名请求 `api.github.com`（无轮询守护、无凭据）；带 If-None-Match 的 304 不计限额；403/429/404 只记录状态不产生信号；重叠扫描在游标 sha 处停止，同 sha 重复到达靠唯一约束去重；单页 30 条上限。
- **不可信文本处理**：commit 标题只保留首行、去控制字符、限长 200；内容只作资料存储与展示，绝不执行其中指令（prompt 注入无执行面）。
- **采纳语义**：采纳须用户确认，只写入一条 `Capture`（sourceType=仓库信号）并可关联一个本项目未完成、非模拟的行动作为资料指引——不改变行动状态、不生成完成回执；commit/CI 不构成现实完成证明，行动完成仍由用户回执决定。未采纳/忽略零事实写入。跨项目行动、模拟行动、已完成行动一律拒绝。
- **撤销**：立即停止一切新请求（测试断言零请求），游标与历史信号保留；同 repo+ref 撤销后不可重建。开关 `REPO_SENSING_ENABLED` 关闭时全接口拒绝。
- **双端展示**：Web 资料页折叠卡片"仓库信号（外部候选）"（连接状态/刷新/撤销/新建、候选采纳/忽略、可选关联行动下拉、提交外链）；鸿蒙记忆列表页 `RepoSignalPanel` 同步。无新一级导航。

## 验证（本地）

- `tests/repoSensing.test.ts` 12 项：游标推进与重叠停止、304/403/429/404、重复 sha 去重、恶意标题清洗、非法 repo（含 `../` 前导点路径穿越防护）/ref、连接数上限、幂等建连、采纳幂等与行动状态不变、错/跨项目/模拟/已完成 actionId 拒绝、忽略零写入、跨用户 404、撤销后零请求且历史保留、开关关闭拒绝。
- `tests/repoSignalNativeContract.test.ts`：真实 ArkTS `RepoSignalService` 经真实 Next 路由（全局 fetch 以 Response fixture 替换）完成创建→列表→采纳→读回，Capture 恰好 1 条。
- 鸿蒙 `RepoSignalContract` 3 项（候选非事实、撤销保留历史、请求体契约）。
- 全量回归、tsc、ESLint、Hypium、HAP 构建与部署预检结果见 evidence/p3b/validation.json。

## 范围与开放 Gate

- 只支持 GitHub 公开仓库 commits 一类信号；PR/CI/Issue、多连接器、私有凭据、周期订阅全部未做（路线图后置项）。
- 服务器向 GitHub 发请求依赖 ECS 出口网络与匿名配额；被限流时只记录状态，不会自动重试或加压。
- 焦点页按价值展示信号、与 P2-A 影响链的深度联动未做：采纳产生的 Capture 是普通资料记录，卡片化（涉及模型）不在本轮。
- 增量刷新（新提交推送后 created>0）与 GitHub 403/429 分支未在生产实测（本地 fixture 已覆盖）；下次该仓库有新提交时刷新即可自然验证。

