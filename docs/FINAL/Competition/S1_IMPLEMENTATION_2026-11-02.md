# S1 全链路实施记录

日期：2026-11-02，UTC+8。基线 `4b2cbd36882b505613be6960b51d9fc33b8deedc`（S0 候选，未合入 master、未推送、未部署）。

实施树：`D:/Projects/hongmen-s1`，分支 `codex/s1-verified-project-journey`。Owner 为当前 Codex；独立复核尚未签收。主目录 `D:/Projects/hongmen` 的签名配置、生成文件、未提交 UI 和其他工作树没有纳入本次提交。

本记录只在**真实运行过**的地方写通过。真实模型、真机、模拟器、自然日和独立评审分别签收：本轮没有配置真实模型（`LLM_MODE=mock`）、没有设备、没有部署，因此这些 Gate 保持未签收，而不是用工程测试替代。

## 1. 用户现在能做什么

1. **先给材料，不必先写完整目标。** 正常入口 `/projects/new` 与手机“新建项目”都先放材料：粘贴要求/记录/计划，Web 还可以加一份 PDF 或图片。材料进入受控的临时草稿，不是项目、不是记忆，也不是工具授权。
2. **看懂 Agent 的理解并整体纠正。** 预览把“材料明确说了什么（带出处）”“Agent 的建议（还不是目标）”“还不知道什么”“下一步最值得查清”分开。用户可以用一句话整体纠正：明确且在本任务范围内的要求直接生效并冻结到期；含糊的保留为“还没有生效的解释”；需要澄清时只问一个问题。
3. **确认后才建立原业务对象。** 只有用户接受并确认的字段会写进 Project；模型建议永远不会自动成为目标。确认走原 Project + OWNER + AgentRun 回执事务，同请求重放返回同一个项目，改内容被拒，并发只建一次，旧预览/换账号/撤权/到期都拒绝。
4. **材料真的进入项目。** 建项后的同步是第二阶段：逐份记录真实结果（TEXT → 原 Capture；FILE → 原 Attachment 服务），失败保留原项目身份、已完成部分和重试入口；不会重复建项，也不会声称“文件系统与数据库原子完成”。
5. **在同一项目里继续原调查。** 建项后沿用原 Conversation/Mission、动态工具选择、原文核对、Action 提案/批准/完成与 `resultCardId` 回执，没有新的 Runner/Planner/任务队列。
6. **手机与 Web 是同一个对象。** 手机上的材料预览与短纠正、卡片上的关注点、Web 的来源展开与结果核查都指向同一份草稿/同一个 Mission/question；卡片只带定位身份与期限，不带批准令牌或私人正文。
7. **结果分类如实。** Web 与手机的结果区展示“已执行 / 已观察 / 已独立支持 / 用户报告 / 反例 / 未知”的投影，并明确它不是现实目标达成。

## 2. 复用入口与新增合同

### 复用的原入口

| 目的 | 复用的原实现 |
|---|---|
| 建项身份与回执 | `lib/repositories/projects.ts` 的 `createOwnedProject` → 抽取为 `createOwnedProjectInTx`（Project + OWNER + AgentRun 同一事务） |
| 文本材料入项目 | `lib/services/captureService.ts` 的 `processCaptureWithRequest`（幂等 + 真实处理回执） |
| 文件材料入项目 | `lib/services/attachmentService.ts` 的 `processAttachmentUpload`、`extractPdfText`、`inferAndValidateFileType`、`extractImageText`（同一个解析器，不另写一套） |
| 整句纠正准入 | `lib/continuity/admission.ts` 的 `admitDirective`（literal 才生效，模型分类不修改目标） |
| 项目前云计量 | `lib/auth/cloudQuota.ts` 的 `AccountCloudUsage`/`AccountSecurity` 语义，新增账户级 `reserveIntakeCloudCall`（不复用无 projectId 的 `reserveCloudCall` 捷径） |
| 账号资格 | `lib/auth/cloudCapability.ts`（只读，不探活） |
| 到期清理 | 原 `scripts/mission-worker.ts` 扫描循环，新增 `INTAKE_CLEANUP` |
| 结果读回 | `lib/mission/readback.ts` 的 `readMissionBack`（question/approval/output/revision/receipt 精确定位） |
| 责任与执行 | 原 `AgentMission`、`runner.ts`、`runtimeStore.ts`、`continuationService.ts`、`attentionReceipt.ts` |
| 双端入口 | 原 `MissionDetail`、`FocusConversation`、`FormExtension`/`WidgetDataService`、`EntryAbility`、`lib/mission/navigation.ts` |

### 新增的最小合同（以及为什么现有结构不够）

| 新增 | 为什么现有结构不足 |
|---|---|
| `ProjectIntakeDraft` / `ProjectIntakeMaterial`（迁移 `20261102140000_project_intake_draft`） | Capture/Attachment 都必须有 `projectId`；为复用先建一个假项目会污染业务事实。临时材料需要 owner、内容 hash、草稿修订、期限、处理状态与清理责任，这些都不是 Project/Capture 的语义；文件正文也不能塞进 AgentRun JSON。 |
| `reserveIntakeCloudCall` / `settleIntakeCloudCall` | `reserveCloudCall(projectId?)` 在没有 projectId 时直接返回——项目前调用若走它就会绕过账户额度与处理许可。新增的是同一张 `AccountCloudUsage` 的账户级预占，并保留派发回执（同一 requestHash 不重发）。 |
| `lib/intake/contracts.ts` + `lib/intake/prompt.ts` | 冻结“材料读到什么 / 用户接受什么 / 这份确认绑定到哪一版”。理解必须逐字核对引文，原文与推断分开，建议不是目标。 |
| `lib/mission/reviewProgress.ts` | 原 GoalState/Step/Action/ResultReceipt 已经有事实，但没有一个把“已执行/已观察/独立支持/用户报告/反例/未知”分开的**只读投影**；新增的是纯函数投影，不是新账本。 |
| 卡片定位字段（`MissionWidgetSnapshot` 扩展 + `MissionHandoffParams`） | 原卡片只有 missionId/status；要“点开同一个原问题”，需要 question/approval/source/version/期限意图，且不能带批准令牌。 |

没有新增：第二套 Runner/Planner、Memory/GoalState、任务队列、通知系统、结果账本或审批机制。

## 3. Issue、Owner、Gate 与 Commit

| 阶段 | 内容 | Commit | Gate | 未关闭 |
|---|---|---|---|---|
| S1-A | 材料 → 可纠正理解 → 确认建项 → 原 Capture 接回；Web 与鸿蒙入口 | `42d934e` | Security：处理许可/额度/注入/幂等/并发/到期负例见 `tests/projectIntake.test.ts`；Functional：`npm.cmd test`、`npm.cmd run build`、E2E、鸿蒙单测与 HAP | 真实模型理解质量、真机交互 |
| S1-B | 历史条件/来源资格探针 + 原 Worker 持续责任真实进程证据 | `05ea5c3` | Security/Functional：`tests/s1MemoryInfluence.test.ts`、`worker-responsibility-probe.mjs` 两次真实子进程 | Linux/systemd、自然日、真实模型判断 |
| S1-C | 手机精确定位 + Web 同问题结果核查 + 结果分类 | `5f736c2` | Functional：`tests/s1ResultProgress.test.ts`、`e2e/s1-cross-device.spec.ts`、鸿蒙 `S1Handoff` 合同 | 真机冷/热启动、卡片系统刷新、离线 TTL 实机 |

Owner：当前 Codex。Worktree：`D:/Projects/hongmen-s1`。独立复核：未提供。

## 4. 实际运行的命令、退出码与证据

以 `evidence/s1-project-journey/20261102/ACCEPTANCE.json` 与 `checks/` 为准。首轮失败日志保留在 `failures/`，不用末次通过覆盖。

最终源码时点为 `5f736c2`（docs 提交前的工作树）。下表是最后一次在该源码上运行的命令：

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `npm.cmd test` | 0 | 197 文件 / 1504 项通过 / 0 失败，672.51 秒 | `checks/s1-full-tests-final.log` |
| `npm.cmd exec tsc -- --noEmit` | 0 | 无错误 | `checks/s1-types-final.log` |
| `npm.cmd run lint` | 0 | 0 error / 9 warning（与 S0 相同的既有 warning） | `checks/s1-lint-final.log` |
| `npm.cmd run build` | 0 | 编译通过，6 条路径追踪 warning（与 S0 相同） | `checks/s1-build-final.log` |
| `npm.cmd run test:e2e` | 0 | 1 setup + 35 业务通过、2 原有跳过、0 失败、0 flaky、0 重试，207 秒 | `checks/s1-e2e-full-final.log`、`checks/e2e-results-final.json` |
| `npm.cmd run harmony:test` | 0 | 100 项通过、0 失败/错误/忽略 | `checks/s1-harmony-test-final.log` |
| `npm.cmd run harmony:build` | 0 | unsigned HAP 7,898,859 字节，SHA-256 `88d6280905c2584373cf969a3f743b8b0628c378ca2dbda9d0e192d9c4b4867f` | `checks/s1-hap-final.log` |
| `node --env-file=.env --import tsx evidence/s1-project-journey/20261102/worker-responsibility-probe.mjs` | 0 | 两个真实 Worker 子进程，6 条断言 | `checks/s1-worker-responsibility-final.log` |
| `node --env-file=.env --import tsx evidence/s0-trust/20261102/worker-process-probe.mjs` | 0 | S0 清理路径回归通过（修复“同轮成功掩盖失败”后） | `checks/s1-s0-worker-regression.log` |

已发生的失败与修复时点（分开记录，不拼成一次全绿）：

- S1 E2E 首轮 2 项失败：选择器 strict-mode 冲突、`accessToken` 字段名、202/200 断言、`readback` 需显式 `questionId`；逐项修正后同一命令退出 0（`failures/e2e-first-failures.log`）。
- 全量首轮 33 文件失败：新工作树的独立 vitest 库未初始化（`main.Project` 不存在）；按 AGENTS 对**独立测试库**执行 `prisma migrate deploy` 后重跑通过，未使用 `db:setup`/`reset`（`failures/full-tests-first-run-uninitialized-db.log`）。
- 全量 E2E 第一版 3 项失败：材料优先后 `/projects/new` 出现两个同名“项目名称”字段。产品行为正确，改为共享 `fillManualProjectForm`（先展开手工表单再填），未弱化断言。
- S0 Worker 探针在本工作树先失败两次：本地 `.env` 与探针环境不一致；以及**真实缺陷**——同一轮里其它扫描成功会掩盖一处持续失败。修复 `recordWorkerPresence`/`readWorkerPresence` 语义（只有干净的一整轮才清除失败信号）后通过，并补了对应的 `tests/s0WorkerIdentity.test.ts` 断言。
- 修改源码后按影响面重跑了全量、E2E、鸿蒙与两个 Worker 探针；上表是最后一次各检查的真实退出码，不把不同源码时点合并叙述。


## 5. 没做的验收，以及为什么不能写成通过

- **真实模型理解**：本轮 `LLM_MODE=mock`、没有 API Key。因此“读懂材料”在 E2E 中如实显示为规则模式不可用，页面退回原文片段；模型理解路径只由注入替身的单元测试证明合同成立。真实模型质量、成本与留出对比均为 NOT_RUN。
- **真机 / 模拟器**：没有连接设备。HAP 构建通过不等于安装、冷/热启动、卡片刷新或账号切换通过。
- **自然日三日旅程**：没有在真实日期上运行。D1/D2/D3 的脚本与合同已就位，自然日证据为 NOT_RUN；等待自然日期间不另建自动化或新执行器。
- **第二类真实项目**：没有科研/课程真实材料与使用同意，记为待提供；不使用改名后的同一软件样例充当跨项目证明。
- **独立复核与线上部署**：未提供/未执行；没有合入 master、没有 push、没有部署、没有迁移真实库。
- **开发依赖告警**：S0 的 minimatch 开发依赖告警未因本次工作关闭，也没有添加 audit ignore。

## 6. 回滚方法

1. 代码回滚：`git revert` 本任务的三个提交（`42d934e`、`05ea5c3`、`5f736c2`）即可；迁移只新增两张表，回退时保留表与其中数据，不执行 `DROP`/`reset`。
2. 功能降级：关闭入口只影响新建流程——`/projects/new` 保留“直接填写”的手工建项，手机保留原“新建项目档案”对话框；已建项目、原 Conversation/Mission、Action 与回执不受影响。
3. 材料清理：关闭新增入口时仍保留 `INTAKE_CLEANUP`、到期读取拒绝与失败重试责任。清理异常应修复或转为明确的受控清理交接，不能只移除扫描；单独保留到期判定并不能清除磁盘上的私人原件。
4. 卡片定位：回退 `WidgetCard`/`EntryAbility` 的新参数会导致卡片只打开 Mission 而不定位问题——这是能力回退，不是安全回退；`handoffIntentExpired` 与读回时的服务端校验必须保留。
5. 隐私/撤权守卫（处理许可、额度、幂等、预览 hash、来源版本、owner/session/generation）不得随功能一起回滚。

## 7. 自然日责任的原对象身份与交接

本轮没有启动自然日轨，因此没有“正在后台等待”的真实责任对象。下一轮启动时按以下身份交接，不新建任务：

- 项目：由 S1-A 正常入口建立，Project.id 与 `AgentRun(provider=project-intake-confirm-v1)` 回执绑定；
- 材料来源：`ProjectIntakeMaterial.id` + `sha256` + `revision`，同步后对应原 `Capture.id` 或 `Attachment.id`；
- 问题与责任：`AgentMission.id`（含 `planRevision`/`contextVersion`/`budgetUsedJson`），问题为 `AgentMissionEvent(type=QUESTION)` 的 id；
- 结果：`AgentMissionOutput(id,revision)` + `ActionItem.resultCardId`；
- 卡片定位：`MissionWidgetSnapshot.{questionId, approvalId, sourceId, missionVersion, expiresAt}`。

下一责任方接手时应先核对：release、数据库、功能开关与 `WORKER_PRESENCE_FILE` 是否一致，再确认 `nextAttemptAt`/`nextBoundary`、累计预算与等待状态；不得清零预算、复活旧批准或另建相似任务。

## 8. 本阶段发现并修复的真实缺陷

1. **项目前云处理会绕过账户额度**：原 `reserveCloudCall(projectId?)` 在无项目时直接返回。项目前理解若沿用会既不核处理许可也不计账户额度。改为账户级预占 + 处理许可 + 派发回执，并先查 `cloudCapability` 再扣额度（否则“未配置模型”也会先花一次额度）。
2. **建项与“已建项”状态可能分叉**：确认回执与草稿状态若分两次提交，重放会二次建项。现在两者在同一事务，且在事务内重新判断 `CONFIRMED` 后走重放而不是新建。
3. **材料同步不是一个原子操作**：文件写盘与数据库提交本来就不原子。现在逐份记录 `syncJson`，失败保留项目身份与清理责任，重试跳过已成功项。
4. **卡片只能打开委托、不能打开原问题**：补 question/approval 定位与期限意图，并让过期意图回到当前委托而不是旧问题。
5. **结果进展缺少分类**：补 `reviewProgress` 只读投影，避免把工具成功或用户报告当成目标达成。
6. **一处持续失败会被同轮其它成功扫描掩盖**：S0 的 Worker 状态只要“4 次成功扫描”就清掉 `failedPhase`，而本轮扫描从 4 类变成 5 类后，单轮就能凑够 4 次成功，持续失败的 `PROJECT_CLEANUP` 被显示成正常。改为只有干净的一整轮才清除失败信号，`isActivelyInspecting` 也不再被同轮更晚的时间戳误导；`tests/s0WorkerIdentity.test.ts` 补了“单次成功扫描不能清掉失败”的负例，S0 的 `worker-process-probe.mjs` 复跑通过。


