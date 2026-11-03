# Track A 独立验收计划（A1 / A2）

- 角色：独立验收（independent-verifier），不拥有提交权；本文件与同目录 JSON/日志为 E 轨证据。
- 工作区：`D:\Projects\hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`，基线 `485d485378637e1da3280ed092739d441c8cf749`。
- 计划生成时间（UTC+8）：2026-11-03T11:45 前后；A1 尚未落地时先完成只读侦察与本计划（前置侦察阶段）。
- 写入边界：只写 `evidence/final-a/20261103/verify/`；不改 `lib/ tests/ app/ components/ harmonyos/ prisma/ docs/ scripts/`，不改他人 evidence。
- 独立原则：实现者的“测试通过”声明只作对照，不作通过证据；通过必须来自我自己的命令、自造 fixture、真实 JSON 与退出码。

## 1. 已读输入（只读侦察）

| 输入 | 用途 |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | 工作范围、测试与数据边界、命令口径 |
| `docs/FINAL/.../07_执行准备/01_源码差距与工作包合同预案.md`（§2 A1/A2、§3 合同建议、§3.1 冲突裁决、§4 七探针、§5.3 A→E、§7） | A1/A2 验收语句与失败判据 |
| `docs/FINAL/.../00_总控/15_准备执行回执与开工索引.md`（§4、§5） | 问题优先级、合并/签收节奏 |
| `docs/FINAL/.../00_总控/preparation-20261103/ISSUE_TRACKER.json` | FS-A01～A07 的 status/acceptance/residual 基线 |
| `docs/FINAL/.../00_总控/preparation-20261103/WORK_STATE_PROBE.json`、`probe-work-state.mts` | 准备阶段纯投影复核结论（仅显示层，非业务签收） |
| `07_执行准备/03_鸿蒙与独立验收职责.md`（§3 E 六轨、§4 最小用例组、§5 隔离/分母） | 独立验收口径、分母与不可替代项 |
| `01_产品功能/04_高杠杆功能深化.md`（§2 F1） | 四问工作包用户语义与“不新建权威表/状态机”边界 |
| 基线源码：`lib/types/workState.ts`、`lib/mission/workState.ts`、`lib/mission/readback.ts`、`lib/mission/missionService.ts`、`lib/mission/workspaceSummary.ts`、`lib/mission/materialUseProjection.ts`、`lib/mission/reviewProgress.ts`、`lib/mission/responsibility.ts`、`lib/continuity/sourcePolicy.ts`、`lib/mission/repository.ts`、`lib/mission/contracts.ts`、`app/api/missions/[id]/readback/route.ts`、`prisma/schema.prisma`（AgentMission/Step/Event/Approval/Output/Receipt） | 事实来源、事务边界、查询窗口、原身份/版本字段 |
| 基线测试：`tests/missionWorkspaceSummary.test.ts`、`tests/missionMaterialUseProjection.test.ts`、`tests/missionReadbackPanel.test.ts`、`tests/agentUxWorkState.test.ts` | 原合同回归锚点、独立 SQLite 迁移重放 fixture 模式 |
| `tests/helpers/continuityDatabase.ts`、`vitest.config.ts`、`package.json`、`tmp/final-preparation/context.json` | 隔离方式（import `lib/db` 前设 `DATABASE_URL`；临时库用 better-sqlite3 重放 `prisma/migrations`）、命令与端口 |

基线事实（`485d485`，本轮只读）：

- `missionWorkState` 先匹配 `lastErrorJson.code` 含 `UNKNOWN`，再判断终态；`CANCELLED` 与 `SUCCEEDED` 共用 `phase=COMPLETED`；输入类型没有 `pauseRequestedAt/cancelRequestedAt`。
- `readMissionBack` 在单 `db.$transaction` 内读 mission 与多个投影，但 `observedAt` = 读取时刻；事件白名单不含 `DAILY_BUDGET_WAITING`；无 `workPacket`。
- `readMissionResponsibility` 已支持外部事务（`externalTx` 参数），供 A2 复用同快照。
- 无 `WorkPacket` 持久化表；`AgentMissionEvent/Step/Output/Approval/Receipt` 为原事实来源。

## 2. 工具链与隔离验证（已做）

- Node v24.16.0 / npm 11.15.0；`node_modules`、`.bin/vitest`、`.bin/tsx` 存在。
- `tsx` 可解析 `@/*` 别名（`npm.cmd exec tsx -- <file>` 跑通 `lib/mission/workState.ts`）。
- 独立临时 SQLite：在脚本/测试顶部（import `lib/db` 之前）设置 `DATABASE_URL=file:<tmp>/<uuid>.db`，用 `better-sqlite3` 按序执行 `prisma/migrations/*/migration.sql`；设置 `MISSION_ENABLED=true`、`MISSION_UI_ENABLED=true`、`LLM_MODE=mock`；不碰 `prisma/final-preparation.db`、不 seed、不调用模型/网络。
- 重任务（全量 Vitest / next build / hvigor / E2E）不在本验收内，除非 Lead 另行批准。

## 3. A1 验收计划（Lead 通知 task-1 落地后 claim task-4 执行）

证据产物：`evidence/final-a/20261103/verify/a1-verification.json`（结构见任务书）+ 原命令日志/JSON 样本。

### 3.1 检查清单

| ID | 检查 | 方法 | PASS 判据 |
|---|---|---|---|
| A1-RUN-01 | A1 纯合同测试独立跑通 | `npm.cmd test -- tests/finalAWorkStateContract.test.ts tests/finalAWorkPacketContract.test.ts`；记录完整命令/退出码/尾部输出 | 退出码 0；用例分母与 skip/fail 数记录；失败日志原样保存在 verify/logs/ |
| A1-RUN-02 | 既有 workState 锚点未被破坏 | `npm.cmd test -- tests/agentUxWorkState.test.ts tests/missionWorkspaceSummary.test.ts` | 退出码 0；原有断言未被弱化（对照 diff，不只看绿） |
| A1-RUN-03 | 探针脚本独立执行 | 先读 `scripts/final-a/` 全部脚本与每个 SQL/写库目标；确认仅临时库、无网络/模型；再 `npm.cmd exec tsx -- scripts/final-a/<probe>`；记录命令/退出码/JSON | 退出码 0（探针结论可为 REPRODUCED，不当作修复通过）；无法确认隔离则不执行并记 BLOCKED |
| A1-FS-A01 | 终态 + UNKNOWN 并存 | 自造 fixture（独立临时库）：① SUCCEEDED + `lastErrorJson={code:"EXTERNAL_UNKNOWN"}`；② CANCELLED + UNKNOWN 错误；③ 纯投影最小输入。读 `readMissionBack` 与 `missionWorkState` 真实 JSON | ①原终态事实（SUCCEEDED）与未结算效果（UNKNOWN/EXTERNAL_UNKNOWN）同时可见；②CANCELLED 不显示成功完成/可恢复（无 SUCCEEDED 语义、无成功勾选、action 非“查看成功结果”）；只留一个事实或取消转成功判 FAIL |
| A1-FS-A02 | 停止请求在途 | 自造 fixture：RUNNING + 有效 `leaseUntil`；经 `commandMission(pause)` 落库 `pauseRequestedAt` 后读；同法 cancel；另造结算后状态对照 | 显示“请求已收到、尚未结算”；主操作不是继续派发；原 RUNNING 保护保留；纯投影层面与读取层一致 |
| A1-FS-A03 | 额度等待（抽查/待 A2） | 纯投影：READY + 最新事件 DAILY_BUDGET_WAITING + 未来 nextAttemptAt；服务级三处（detail/summary/readback）一致性在 A2 复测 | A1 内：纯投影 QUEUED + nextCheckAt + 累计预算不清零；服务级未落地记 NOT_RUN（待 A2） |
| A1-FS-A04 | 读取时间 vs 成功观察时间 | 纯投影与 readback：固定 delegation.lastObservedAt；多次投影/读取 | checkedAt 前进、observedAt 不前进；失败不显示无变化 |
| A1-FS-A05 | 当前来源许可（抽查/待 A2） | 检查 DTO 是否预留 currentUse/availabilityMeaning；服务级 SUPPRESSED/UNKNOWN 在 A2 复测 | 合同层不把 CURRENT 等同独立证据；缺服务实现记 NOT_RUN（待 A2） |
| A1-FS-A06 | 材料使用窗口（抽查/待 A2） | 检查 coverage 字段与合同语义；服务级 40+ 无关 AgentRun 挤压在 A2 复测 | 合同层保留“未找到≠从未发生”覆盖字段；A1 不判服务 PASS |
| A1-FS-A07 | 跨修订快照（抽查/待 A2） | 检查 workPacket.snapshot/primaryAction.requires 字段；真实并发在 A2 复测 | 合同要求同事务快照、版本要求全量、提交服务端重查；A2 前记 NOT_RUN |
| A1-DTO-01 | 四问 DTO 覆盖 | 读 `lib/types/workPacket.ts` 与 `lib/mission/workPacket.ts`，按 done/basis/stopped/next 四问逐字段核对合同预案 §3 表格 | 四问均有字段与来源；字段可追溯到原事实；不新增生命周期/授权 |
| A1-DTO-02 | 可选字段 vs 真实 null | 检查每个 `?` 字段与 `string|null` 字段的测试/构造器行为；自造缺字段输入 | 旧服务缺字段可降级；null 不被当 0/成功/无发生 |
| A1-DTO-03 | primaryAction | 检查 primaryAction 携带原对象身份 + 全版本要求 + `readOnly`；自造旧版本输入 | 原对象 id 不被替换；requires 覆盖 missionVersion/planRevision/contextVersion 等；readOnly=true；读取不授予执行/写入 |
| A1-DTO-04 | realityOutcome | 检查字段值与测试 | 恒为 `NOT_INFERRED`，不出现现实完成推断 |
| A1-DTO-05 | NO_CHANGE 非生命周期 | 检查 NO_CHANGE 只作为观察结论出现的规则/测试 | 可与 WAITING_OBSERVATION 并存；失败/未观察/来源不可用不显示 NO_CHANGE |
| A1-BOUNDARY-01 | 无 schema/迁移变更 | `git diff --stat 485d485 -- prisma`；`git status --porcelain -- prisma` | 空；无新 migration 目录 |
| A1-BOUNDARY-02 | 无客户端/官网布局改动 | `git diff --name-only 485d485 -- components app harmonyos docs`（docs 另记） | 无改动（若 A1 提交范围声明无客户端，则必须为空） |
| A1-BOUNDARY-03 | 无新状态表/Runner/Planner | 枚举 diff 新增文件；grep 新增 `model ` in schema、`new PrismaClient`、`runner/planner` 命名 | 无新权威表/第二 Runner/Planner |
| A1-BOUNDARY-04 | 无密钥/签名泄露 | 扫新增行 `BEGIN .*PRIVATE KEY`、`password=`、`token=`、`secret`、`.hap`、`.p7b`、`.p12` | 无真实密钥/签名/凭据；fixture 占位除外并注明 |
| A1-BOUNDARY-05 | docs 不混入 git | `git status --porcelain -- docs`；`git check-ignore docs` | docs 仍被忽略、提交不含 docs |
| A1-EVID-01 | 证据自洽 | 对照实现者证据（若有）与我的独立结果 | 不一致之处单列；实现者声明不作 PASS 依据 |

### 3.2 A1 通过规则

- 只有 A1-RUN-01/02/03、A1-FS-A01/02、A1-DTO-01/02/03/04/05、A1-BOUNDARY-01～05、A1-EVID-01 全部 PASS 才签 A1 核心；A03/A05/A06/A07 服务级按任务允许记 NOT_RUN（待 A2），但合同字段自洽性必须 PASS。
- 任一 FAIL：保留原命令、退出码、完整日志路径、真实 JSON 片段；向 Lead 报“不能签收”，不修改实现者文件换绿。
- 记录 HEAD SHA、`git status --porcelain` 摘要、diff 统计；若 A1 是未提交工作树改动，以 `git stash create` 摘要或文件哈希记录候选状态（不提交、不 stash 破坏工作树）。

## 4. A2 验收计划（Lead 通知 task-3 完成后）

证据产物：`evidence/final-a/20261103/verify/a2-verification.json`（逐项 + 用例分母 + 失败原日志路径 + 残余风险）。

| ID | 检查 | 方法 | PASS 判据 |
|---|---|---|---|
| A2-RUN-01 | A2 服务测试独立跑通 | `npm.cmd test -- tests/finalAWorkPacketService.test.ts tests/finalAConcurrencyService.test.ts` | 退出码 0；分母记录 |
| A2-RUN-02 | 受影响既有测试回归 | `missionContinuation`、`missionMaterialUseProjection`、`s2ResourceReadback`、`s2CallCoverage`、`missionNativeContract`、`missionWorkspaceSummary`（按 Lead 批准范围单跑） | 退出码 0；不删除/skip 断言换绿 |
| A2-WP-01 | workPacket 正常四问 | 自造独立库 fixture，调 `readMissionBack` 读真实 JSON | done/basis/stopped/next 有内容；身份/版本/快照一致；primaryAction 指原对象 readOnly；realityOutcome=NOT_INFERRED |
| A2-WP-02 | 负例：异 Owner/异项目/匿名 | 直调服务 + readback GET 路由（匿名 401） | 404/401；不泄漏标题/问题/数量 |
| A2-WP-03 | GET 前后无写入 | 读前读后事件数、AgentRun 数、`budgetUsedJson`、`version/status/updatedAt` 全等 | 全等；无新增 Event/Step/Run/预算变化 |
| A2-WP-04 | 旧服务缺 workPacket 降级 | 删除/缺省 workPacket 的响应结构（类型可选断言 + 原有字段仍在） | 原详情可用；显式“摘要暂不可用”而非伪造成功；未知不是 0 |
| A2-WP-05 | 未找到 ≠ 从未发生 | 有界窗口/截断字段与 coverage 语义 | 覆盖不足有明确说明；不把未找到写成从未使用 |
| A2-WP-06 | 来源撤权/抑制/未知 | SUPPRESS_USE 指令/撤权连接/来源链未知 fixture，读 materialUses.currentUse | 当前不可用/不称独立证据；历史 facts 保留；写入守卫仍拒绝（抽样 approve/confirm 负例） |
| A2-WP-07 | 额度等待三处一致 | READY+DAILY_BUDGET_WAITING+未来 nextAttemptAt，分别读 detail/summary/readback | 三者均 QUEUED/等待额度+nextCheckAt；累计预算不清零；不凭日期允许运行 |
| A2-WP-08 | 时间跨界无新事件 | 越过 continuationPolicy.expiresAt/deadline/lease，不新增事件再读 | 权限 EXPIRED/STOPPED；primaryAction 变重核；不签发旧操作资格 |
| A2-WP-09 | 真实 JSON null | budgetUsedJson 缺失、lastErrorJson null、nextAttemptAt null、lastSuccessfulAt null 等 | 真实 null 保留为 null，不补 0/不省略字段 |
| A2-CONC-01 | 第二 PrismaClient 真实并发 | 同临时库文件（WAL），独立 PrismaClient 连接循环写 version/constraints/撤权；主连接交替 readback | 响应内部版本一致（快照同修订）或明确 snapshot.consistency=VERSION_ADVANCED/RETRIED；不得用 mock/前端 stale 标签；记录迭代数/不一致计数/失败原始 JSON |
| A2-BOUND-01 | 边界复检 | 同 A1-BOUNDARY-01～05 | 无 schema/迁移/客户端/密钥；docs 不入 git |

## 5. 风险与待澄清

1. A1 的探针脚本由并行任务提供（`scripts/final-a/`），可能与 A1 合同测试不同步；若脚本未就绪或只含 BEFORE_FIX 语义，按 NOT_RUN/部分执行记录，不代替。
2. A1/A2 是同一工作树的未提交改动，验证时以 `git status`/文件哈希记录候选状态；Lead 提交后（如有新 SHA）需在证据中追加候选 SHA。
3. `readMissionBack` 是 `db.$transaction` 单事务 + better-sqlite3 单写者；并发验证以真实第二连接写、读侧重试语义为准，不以“无报错”当一致性通过。
4. 证据中的 tests 只作为对照：即使实现者测试全绿，FS-A01/A02 的自造 fixture 失败仍判 FAIL。
5. 不做真实模型/设备/自然日/外部写入/部署；这些轨在证据中记 NOT_RUN，不随代码合并自动签收。

## 6. 状态

- 2026-11-03 前置侦察完成；A1 尚未落地（task-1/task-2 in progress），task-4 仍被 task-1 阻塞。
- 已向 Lead 报告 READY；等 Lead 通知 A1 落地后 claim task-4 -> 执行 §3；A2 通知后执行 §4。
- 2026-11-03T12:15Z（UTC+8）A1 独立验收完成，结论见 `a1-verification.json`：
  - A1 提交链 f267aec（合同/探针）→ 543162f（回执）→ b243f62（RUNNING 主操作/个人记忆边界/租约不误标 AUTHORITY）→ 3a62dce（回执补记）→ **304adfe（更正回执用例数，最终 HEAD）**。
  - 第一阶段证据在 543162f 干净 shadow 生成；最终 HEAD 补跑两个纯合同测试（61 passed）+ 收尾 3 项自造 fixture + DTO 5 项 + 服务 fixture。
  - 首次结论 31 PASS / 1 FAIL / 6 NOT_RUN（FAIL=回执用例数未更新）。Lead 在 304adfe 更正回执后复核：**A1-EVID-05b PASS、A1-EVID-12（304adfe 仅文档）PASS，候选 HEAD=304adfe，结果 34 PASS / 0 FAIL / 6 NOT_RUN / 0 BLOCKED**（40 checks；含新增 A1-TSC-01、A1-EVID-12）。A1 合同语义 **ACCEPTED_SIGNED**。
  - TS2367 修复：`fixtures/a1-final-head-probe.ts` 中联合字面量窄化后的恒真 `!== "RECHECK_AUTHORITY"` 已删（`=== WAIT_FOR_OBSERVATION` 已蕴含），改用 string 拓宽变量；仅改 verify/ 写作用域。复跑 `npm.cmd exec tsc -- --noEmit` exit 0、无诊断（`logs/tsc-noemit.log` 0 字节、`logs/tsc-noemit.exit`），不污染 A2 提交的 tsc 证据。
  - 残余风险：workspaceSummary 在停止请求在途时仍显示 RUNNING/LEASE_ACTIVE（A2 写作用域，回执 304adfe 已记录）；FS-A03/A05/A06/A07 服务级、A2 全部项 = NOT_RUN，等 task-3 提交通知。
  - 探针脚本 verdict/judgment 硬编码 BEFORE_FIX，退出码 0 只表示跑完，不能作为 A2 修复通过证据（见 `A1-OBS-PROBE-VERDICT-LIMIT`）。

- 2026-11-03T12:36Z（UTC+8）A2 独立验收完成，结论见 `a2-verification.json`（A2 提交 d428314，A1 最终 304adfe）：
  - **48 PASS / 0 FAIL / 3 NOT_RUN / 0 BLOCKED（51 checks）；A2 服务合同 ACCEPTED_SIGNED。**
  - 独立 fixture（干净 shadow @d428314，独立临时 SQLite，真实 readMissionBack/detail/summary/command/route + 第二 PrismaClient）：服务 27 项 + 并发 3 项全 PASS。覆盖：四问工作包正常/身份版本同快照/负例（异 Owner、成员、跨项目 target 404、回执版本 409、匿名 401）、GET 前后零副作用（事件/AgentRun/Step/Output/Receipt/预算/版本/updatedAt/continuitySeq）、旧服务缺 workPacket/readAt/observation 降级、真实 null（不补 0）、FS-A03 三处一致+预算不清零、FS-A04 读/观察时间分离+失败不显示无变化、FS-A05 抑制/撤权/未知 currentUse+历史 facts+写守卫、FS-A06 mission-first 窗口（45 条无关运行不挤掉，未找到≠从未发生）、FS-A07 时间跨界无新事件+许可变化窗口、A1-RESIDUAL-01 workspaceSummary 停止请求在途。
  - 并发：阶段 A 环境压力 80 轮内部不一致 0（自然交错 80/80 VERSION_STABLE）；阶段 B 服务端受控复查点 + 第二连接真实提交，确定性验证 RETRIED(retries=1) 与 VERSION_ADVANCED(retries=2 + SNAPSHOT_VERSION_ADVANCED 阻断)，内部版本全一致；读取零写入。
  - tsc：A2 提交干净 shadow exit 0（fixture 未混入，日志 0 字节）；当前工作树（含 A2 提交 + 验收 fixture）exit 0。
  - 边界 8/8 PASS（无 schema/migrations、无客户端/官网/依赖、无新表/Runner/Planner、无密钥、docs 不入 git、工作树无 tracked 残留）；A2 样本/证据 7/7 自洽。
  - 残余：C/D 双端消费与设备/真实模型/Worker/自然日/独立用户轨 NOT_RUN；阶段 A 未自然命中复查窗口（受控点已验）；readback 延迟未做性能断言；样本为提交前工作树生成并标注 base=head=3a62dce，关键语义已在 d428314 干净树复核一致。


