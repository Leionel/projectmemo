# R4 CT-8 实施记录（2026-10-30）

## 基线与环境

- 实施工作树：`D:\Projects\hongmen-ct8`，基线 `96429cb`（UX-2 已验收 UI 对齐提交）。
- 分支实际为 `codex/ct8-outcome-experience-impl`。请求的 `codex/ct8-outcome-experience` 已被主工作树占用（主目录 HEAD `fa58dce`、含 UX-3 未提交修复）；未 reset、stash、切换或复制主目录业务代码。
- 主目录缺少 UX-2 已使用的两条 additive 迁移：`20261030120000_ux2_context_digest`、`20261030123000_ux2_project_input_version`。不引入它们，任何迁移重放测试都无法建出 `AgentContextDigest` 与 `Project.contextRevision`。本次作为“基线前置修复”单独提交；不包含 UX-3 业务代码。
- 本工作树独立执行 `npm install`、`prisma generate`、`ohpm install`；未复制主目录 `.env`、真实数据库、凭据或签名私钥。

## 实际增量

### 1. 数据契约

新增迁移 `20261030190000_ct8_conditional_experience`（additive + 经验表重定义）：

- `AgentExperience`：`conditionKey`、`version`、`evidenceVersion`、`evidenceJson`、`eligibilityJson`、`originJson`、`resultLabelsJson`、`lastSyncedAt`、`lastSyncFingerprint`、`validUntil`、`activatedByUserId`、`revokedByUserId`；唯一键改为 `(projectId, ownerUserId, kind, patternHash, conditionKey)`。旧行 `conditionKey=LEGACY`，读取时按旧条件契约降级为 UNKNOWN。
- `AgentExperienceUse`：`missionId` 可空，新增 `conversationId/turnId/scopeKey/actorKind/experienceVersion/contentHash/conditionKey/matchState/outcomeJson/updatedAt`；唯一键 `(experienceId, scopeKey, stage)`，旧行回填 `mission:<id>`。
- 新增 `AgentExperienceEvent`：用户操作幂等回执与版本审计，唯一 `(ownerUserId, requestId)`、`(experienceId, seq)`。
- `AgentMissionStep.failureJson`：失败原因绑定具体 Step/operation，不再用委托最后一条全局错误推断所有失败步骤。
- 历史迁移 `20261024120000_p3_review_boundaries` 的旧索引删除改为 `DROP INDEX IF EXISTS`，允许旧库升级测试在 CT-8 之后重放。

### 2. 轨迹与提炼

- `lib/experience/trajectoryIndex.ts`：结果分层为工程完成、草稿、采用、行动创建、带 resultCardId 行动完成、用户自述、独立固定核算、明确负结果；独立性键绑定原任务/目标/来源/成果内容/行动，而不是新 UUID；指纹只包含有真实结果的任务。
- `lib/experience/conditions.ts`（新增）：从原 Mission 的研究范围、指标 mapping/job、资源约束、工具/协议版本生成条件 facets、`conditionKey`、覆盖与 MATCH/MISMATCH/UNKNOWN；数据/划分/单位/环境/目标不一致不合并，条件缺失降为案例参考。
- `lib/experience/extract.ts`：未采用保持 UNKNOWN，不自动成反例；只有明确负结果计 COUNTER；同 run/同来源/同内容的复制样本不虚增支持；GUARDRAIL 只读取 Step 绑定的 `failureJson`，后来成功只记 `FAILURE_OBSERVED_RETRY_UNVERIFIED`，不宣称原因已解决；同步重算当前证据，失效支持保留为历史但不计数。

### 3. 注入、消费与失效

- `lib/experience/injection.ts`：只有条件 MATCH + ACTIVE + 当前来源有效 + 未撤销/未到期 + 工具可用/版本与协议匹配才注入；显式区分 RETRIEVED、INJECTED、MODEL_DECISION、USER_FEEDBACK；有界 3 条/2200 字符并记录裁剪；`experienceReadSet` 在决策、工具执行、批准与业务效果前复核。
- `lib/mission/contextBuilder.ts`、`runner.ts`、`approvalService.ts`、`metricVerification.ts`：Mission 路径注入、记录模型决策、Step 保存读集并复核。
- `lib/conversation/investigationService.ts`、`promptSpecs.ts`、`turnCoordination.ts`、`turnService.ts`、`copilot/confirmation.ts`：Conversation/Focus 共用条件匹配器；`experienceReadSet` 进入 turn manifest 与 run trace；确认业务写入前复核。
- `lib/experience/service.ts`/API：GET 纯读不整理；新增显式 `POST /experiences {action:REFRESH}`；激活/撤销/反馈/跨项目迁移带 `requestId` 幂等与 `expectedVersion` CAS；跨项目迁移只生成 CANDIDATE，不继承 ACTIVE 或不可读私人样本；真实结果提交后仅做有界 refresh，失败不回滚原回执。
- 来源抑制、时间边界、撤销、owner/项目失权、模型在途撤销都会停止新注入与新效果；已提交效果继续按原回执回放。

### 4. Web 与鸿蒙

- Web：`ExperienceSuggestions`、`ExperienceHistory`、`AgentMemoryPanel` 展示条件、未知、反例、匹配、资格、原结果入口，并提供激活/撤销/本次采用/不适用反馈；`MissionPanel` 传入 missionId。
- 鸿蒙：`Experience` 模型/服务/契约、`ExperiencePanel`、`AgentMemoryPanel`、`MissionDetail` 同步同一资格、条件、未知、反例、原结果与安全控制；`ExperienceContract.test.ets` 更新到 CT-8 契约。

## 验证

| 检查 | 结果 |
|---|---|
| `npm.cmd test`（VT 文件串行） | 155 个测试文件通过 |
| `npm.cmd exec tsc -- --noEmit` | 通过 |
| `npm.cmd run lint` | 通过 |
| `npm.cmd run build` | 通过 |
| `npm.cmd run test:e2e` | 隔离库 + 生产构建 E2E 通过 |
| `npm.cmd run harmony:test` | 86 tests, 0 failure/error |
| `npm.cmd run harmony:build` | 通过；`entry-default-unsigned.hap` 6,747,344 bytes，sha256 `13b03c3fabb501d4e48b2b66a0ba2939726e1f84af9bdb4abc54f1e138527f1b` |
| Web 浏览器核对（隔离 E2E 库 + 生产构建） | 登录 e2e-reviewer 后打开项目 missions，展开“项目经验历史”，ACTIVE 经验卡显示适用条件、支持/反例计数、未注入/资格说明与“回原结果核对”入口；PASS |

新增 `tests/ct8OutcomeExperience.test.ts`（11 场景）：结果分层、未采用/反例、条件拆分、独立样本去重、Step 失败归因、Mission 注入与模型决策/撤销、Conversation 匹配器与 use、来源抑制/时间边界/条件不匹配、GET 纯读与显式整理、CAS/幂等、跨项目迁移、注入上限。

迁移证据：`prisma/test-vitest.db`、`prisma/projectmemo-e2e.db` 均从空库重放全部迁移成功；`p3ReviewBoundaries` 旧库增量升级用例通过。

## 提交

- `58c475b` chore(db): restore UX-2 baseline schema migrations in CT-8 worktree
- `31c5fa1` feat(experience): implement CT-8 conditional outcome experience
- `eabc457` feat(ui): expose CT-8 experience eligibility on web and harmony
- `cb83b87` test(experience): add CT-8 scenarios and implementation notes

## 剩余 Gate

- 真实模型 campaign / 隐藏题 / 独立人评未执行；当前为规则、脚本模型与隔离数据库工程验证，不能宣称 CT-8 质量对照通过。
- HAP 为 unsigned，未安装目标设备；签名、模拟器/真机旅程不在此次通过范围。
- 未部署、未迁移真实开发库、未做真实外部写入。
- Web 新经验区块已做隔离浏览器路径核对，但未做独立视觉人评；E2E/浏览器 PASS 不等于视觉验收。
