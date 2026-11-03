# PERF_RECEIPT — A-新3：readback 量测、证据审查窗口修复与同请求只读复用

- 日期：2026-11-03（UTC+8）。工作树 `D:\Projects\hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`，固定主控检查点 `4b696141435825a3582816e8e449c0e0cf013f29`。本轮全部修改**未提交、未 push、未部署**。
- 数据来源：独立临时 SQLite（mkdtemp + `prisma/migrations/*` 全量重放 + WAL）上的纯 fixture，真实调用 `readMissionBack`；`LLM_MODE=mock`，模型/网络调用 0，未启动 Worker；不读 `.env`、不碰任何真实/开发数据库。
- 只读性：量测窗口内驱动级写语句 0；读前后业务表行数、Mission `version/updatedAt/nextEventSeq/status` 快照 diff 为空。
- 证据主文件：`evidence/final-a/20261103/post-checkpoint/perf/readback-perf.json`（BEFORE/AFTER/AFTER2 三栏 + 重复运行对照）；分阶段原始运行：`post-checkpoint/perf/runs/readback-perf-{BEFORE,AFTER,AFTER2}.json` 及各 `-run1.json`。

## 0. 结论摘要（N=30 稳定读取；确定性计数，两次独立运行完全一致）

| 指标（每次读取） | BEFORE：检查点原始 | AFTER：仅证据审查窗口先筛后限 | AFTER2：窗口修复 + 同请求只读复用 |
|---|---|---|---|
| 驱动级 SQL 语句 | 104（100 SELECT + 2 BEGIN + 2 COMMIT） | 104（同） | **82（78 SELECT + 2 BEGIN + 2 COMMIT）** |
| 查询数（SELECT） | 100 | 100 | **78（-22，-22%）** |
| 事务数 | 2 | 2 | 2 |
| SourcePolicy 检查数 | 6 | 6 | 6（≤8 上限内） |
| readback JSON 字节 | 34,649 | 39,561 | 39,561（复用不改变形状） |
| 证据审查窗口命中 | **0**（3 条目标 question 审查被 24 条更新的其他 question 挤出） | **3/3** 目标 question | 3/3 |
| 受控重试 RETRIED | retries=1，200 查询 / 4 事务 | 同 | **156 查询 / 4 事务**（retries 不变） |
| 受控重试 VERSION_ADVANCED | retries=2，300 查询 / 6 事务 | 同 | **234 查询 / 6 事务**（retries 不变） |
| 读前后业务写入 | 0 | 0 | 0 |
| 延迟 p50（两次运行） | 72.4 / 101.5 ms | 77.2 / 57.9 ms | 70.5 / 72.6 ms |

- **窗口修复的 JSON 增量（+4,912 B）是修复目标本身**：此前被挤出为 0 的目标 question 审查摘要现在真实返回（`evidenceReviews` 分项 29 B → 4,214 B；`workPacket` 19,593 → 20,320 B；`materialUses` 9,581 B 两阶段不变）；同请求复用后 JSON 完全不变（39,561 B → 39,561 B），只减少重复查询。
- **延迟不是承诺**：同机共享工作树下 6 次 N=30 运行 p50 57.9–101.5 ms、p95 88–228 ms 波动（后台可能有其他 Agent 的测试进程），不构成墙钟性能提升/回归结论。确定性负载证据是查询数（100→78）与热点分布（§3）。
- 一致性：30/30 `VERSION_STABLE`；事务数 `$transaction` spy 与驱动级 BEGIN/COMMIT 完全一致；第二只读复查/controlVersion 二次核验与 `WORK_PACKET_AUTHORITY_CHANGED` 语义未改。

## 1. 量测方法（与 `readback-perf.json` 的 `method` 字段一致）

- **对象**：真实 `readMissionBack(userId, missionId, {questionId})`，独立临时 SQLite + 代表性 fixture。
- **fixture**（`runs/*.json` 的 `fixture` 段）：40 个事件、6 份项目材料（`SOURCE_ARRIVED`/`SOURCE_ASSOCIATED` + `bind_project_sources` 成功步骤）、2 个输出/成果回执、3 个动作回执、3 个本委托 CHAT 运行回执、观察事件（无新信息/观察变化/明确声明的工具观察失败/用户停止）、1 个待批提案、27 条 `EVIDENCE_FIT_REVIEWED`（3 条较早的目标 question + 24 条更新的其他 question）。材料 facts 覆盖 8 类：`SAVED/CANDIDATE/BOUND/OUTPUT_REFERENCE/EXACT_QUOTE/ARTIFACT_ADOPTION/ASSOCIATED/CONTEXT_POINTER`。
- **查询数（方案 B，零产品代码改动）**：量测脚本启动时包装 `better-sqlite3` `Database.prototype.prepare/exec`，只在**本脚本进程 + 本次临时库**内计数驱动层实际执行的 SQL 语句；按 SQL 首关键字分类 `SELECT/INSERT/UPDATE/DELETE/DDL/BEGIN/COMMIT/ROLLBACK/PRAGMA/OTHER`。**未修改 `lib/db.ts`、未加 `PRISMA_QUERY_LOG` 门控**，不影响生产行为或其他测试。
- **事务数**：主连接 `db.$transaction` 进程内 spy 调用数，并与驱动级 `BEGIN/COMMIT` 语句数交叉核对（每读 2 事务：事实收集事务 + 第二只读复查事务）。
- **SourcePolicy 检查数**：`readback.materialUses.coverage.sourcePolicyChecks`（`materialUseProjection` 每个 item 的 `currentUse` 判定次数，纯只读数字；判定逻辑不变）。
- **JSON 字节**：`Buffer.byteLength(JSON.stringify(readback),'utf8')`（Date 序列化为 ISO）。
- **延迟**：`performance.now()` 墙钟、最近邻百分位；SQLite 单机本地口径。
- **零写入证明**：① 量测窗口内驱动级 `INSERT/UPDATE/DELETE/DDL` 语句数；② 读前后业务表行数 + Mission 版本字段快照 diff；③ 受控重试的写入由第二 PrismaClient 执行，在量测窗口内暂停计数并单独记录。
- **受控重试**：spy `db.$transaction`，在“快照已读取、第二只读复查事务返回前”用第二连接（同一临时库文件）真实提交 Mission 版本推进；写法与 `tests/finalAConcurrencyService.test.ts` 一致。BEFORE/AFTER 分别复现 `RETRIED(retries=1)`、`VERSION_ADVANCED(retries=2)`；AFTER2 重试语义、重试次数、事务数完全不变。
- **阶段代码状态**（`runs/*.json` 的 `environment.sourceFilesSha256` 可复核）：
  - BEFORE：`lib/mission/readback.ts`=检查点原始（`0040dee…`）、`materialUseProjection.ts`=仅加只读 `sourcePolicyChecks` 字段、`sourcePolicy.ts`/`responsibility.ts`=检查点原始。
  - AFTER：仅换窗口修复后的 `readback.ts`（`c07cf8d…`），其余同 BEFORE。
  - AFTER2：窗口修复 + 同请求复用（`readback.ts`=`c07cf8d…`、`materialUseProjection.ts`=`ac2cd68…`、`sourcePolicy.ts`=`1b14bd4…`、`responsibility.ts`=`316a972…`）。
  - 三个阶段使用**同一量测脚本**（`scripts/final-a/perf-readback.ts`=`eeaa666…`，运行后未再修改），各自全新临时库与 fixture。

## 2. 证据审查窗口修复（`lib/mission/readback.ts`）

**缺陷（BEFORE 已复现）**：旧实现先取全 Mission 最近 21 条 `EVIDENCE_FIT_REVIEWED`，再按 `payloadJson.evidenceFit.premise.questionId === 选中 questionId` 过滤并取前 3 条。其他 question 的新审查事件会把目标 question 的较早审查挤出窗口：fixture 中 24 条更新的其他 question 审查 + 3 条较早的目标 question 审查 → `items=[]`、`truncated=true`，消费方容易误读成“从未审查”。

**修复**：选中 questionId 时先用原生 SQL `json_extract(payloadJson,'$.evidenceFit.premise.questionId') = ?` 过滤、`ORDER BY seq DESC LIMIT 21`，再取最近 20 条窗口、最多展示 3 条；未选中 question 时保留旧窗口行为（最近 20 条、不按问题过滤）。处理了 raw 查询返回的 `createdAt`/`payloadJson` 两种驱动序列化形态，统一成与原 Prisma 行一致的 `Date`/对象。

**输出兼容**：
- `readback.evidenceReviews` 保持 `{ items, truncated }`，**只增**覆盖字段：`questionFiltered`、`questionId`、`windowLimit`(20)、`displayLimit`(3)、`inspected`、`note`；旧客户端忽略新字段。
- `truncated` 语义：选中 question 时只表示**该问题窗口**溢出（>20 条），不表示全局审查历史完整；未选中时沿用旧窗口截断语义。
- `workPacket.basis.evidenceReviews` 形状保持 `{ items, truncated }`（类型未改）；`workPacket.coverage.windows` 的 `EVIDENCE_REVIEWS` 备注说明“先过滤再限额”，未命中 ≠ 从未发生。
- `selectedFitRows` 仍按 `premise.questionId === selectedQuestionId` 过滤（与原 `===` 语义逐字一致，含未选中时 `undefined` 匹配）。

**测试**：`tests/finalAEvidenceReviewWindow.test.ts`（5/5，退出 0）：
1. 24 条更新的其他 question 审查 + 3 条较早目标审查 → 修复后命中 3 条且全部属于目标 question、`questionFiltered=true`、`truncated=false`、workPacket 同批、读前后零写入；
2. 目标 question 自身 22 条审查 → 仍最多 3 条，`inspected=21`、`truncated=true`、`workPacket.basis.evidenceReviews.truncated=true`；
3. 未选中 question → 旧窗口行为（2 条无 questionId 记录返回 2 条）、`questionFiltered=false`、`note` 标注；
4. 未选中 question 且窗口被 24 条其他 question 审查占满 → 保持旧行为 0 条 + `truncated=true`，不猜测；
5. 同请求复用等价：预载 continuity 与无预载的 `sourceUse` 结果 `toEqual` 完全一致；`SUPPRESSED` 仍为 `SUPPRESSED`、`independentEvidence=false`、`availability=UNAVAILABLE`/`excerpt=null` 且历史 facts 保留；`materialUseProjection` 逐 item `currentUse` 同源、`sourcePolicyChecks=2`；零写入。

修复前行为以注释/用例名记录（不保留红例）；该窗口测试在修复前会命中“其他 question 挤出”的 0 条路径。

## 3. 查询热点与同请求只读复用收益

BEFORE/AFTER 每次读取的 100 条 SELECT 中（按 SQL shape 聚合，`runs/*.json` 的 `queryHotspots`）：

| 热点（每次读取） | BEFORE/AFTER | AFTER2 | 处理 |
|---|---|---|---|
| `effectiveContinuity` 相关：User + AgentDirectiveEvent + AgentClaimEvent + AgentClaim | **8 组 × 4 = 32** | **3 组 × 4 = 12** | 责任读取 2 次（collect + 第二复查事务）+ materialUseProjection 每 item 1 次（6）→ materialUseProjection 每请求 1 次并传给每次 `sourceUse` |
| `ownedMission`（Mission 全字段）+ `ProjectMembership` | 3 + 3 = 6 | 2 + 2 = 4 | collect 内已 `ownedMission` 的 m 作为 `preloadedMission` 传给责任读取，避免重复鉴权读取 |
| 每 item SourcePolicy 路径：`Project` + `Capture`(view) + `KnowledgeCard` + `Capture`(lineage) + `ExternalSignal` | 6 × 5 = 30 | 6 × 5 = 30 | **逐 source 安全判定，刻意不复用** |
| 其他（第二复查 Mission SELECT、事件/回执窗口等） | 其余 | 其余 | 不变 |

- 合计 **100 → 78 查询（-22，-22%）**，与热点差（20 + 2）完全吻合；事务数、SourcePolicy 检查数、JSON 形状均不变。
- `effectiveContinuity` 8→3 的含义：collect 责任读取 1 次、第二复查事务责任读取 1 次（安全性要求保留）、materialUseProjection 本请求 1 次（原为每 item 各 1 次）。

**复用实现边界（Lead 批准的 (a)+(b)）**：
- `lib/continuity/sourcePolicy.ts`：`sourceUse` 新增**可选第 6 参** `precomputed?: { continuity }`；传入时跳过重复 `effectiveContinuity`，**逐 source 的 project/lineage/private/blocked/suppressed/known/independentEvidence 判定逻辑与顺序完全不变**；不传时保持原行为，无任何模块级/跨请求缓存。
- `lib/mission/materialUseProjection.ts`：仅在 `input.userId` 存在时，item 循环前计算 1 次 `effectiveContinuity(userId,{projectId,missionId},tx)` 并逐 item 传给 `currentUseOf → sourceUse`；`currentUse` 形状、`sourcePolicyChecks`（仍每 item 计 1 次）、判定结果不变。
- `lib/mission/responsibility.ts`：`readMissionResponsibility` 新增**可选 `preloadedMission`**，合同=调用方已在同一事务用 `ownedMission` 校验归属；缺省路径仍自行 `ownedMission`。本轮只有 `collectMissionBack` 传入（其开头已 `ownedMission`）；`reviseMissionResponsibility`、第二复查事务等其他调用方未改。
- 未新增合同字段（无 `continuityViewsComputed`）；JSON 字节 39,561→39,561 证明形状未变。

## 4. 受控重试与零写入（三阶段一致）

| 场景 | consistency | retries | 查询 | 事务 | 第二连接写入 | Mission version |
|---|---|---|---|---|---|---|
| BEFORE/AFTER 注入 1 次 | RETRIED | 1 | 200 | 4 | 1 | 7→8 |
| BEFORE/AFTER 注入 3 次 | VERSION_ADVANCED | 2 | 300 | 6 | 3 | 8→11 |
| AFTER2 注入 1 次 | RETRIED | 1 | **156** | 4 | 1 | 7→8 |
| AFTER2 注入 3 次 | VERSION_ADVANCED | 2 | **234** | 6 | 3 | 8→11 |

- 三阶段稳定读取：0 条驱动级写语句；业务表行数与 Mission 版本字段快照 diff 为空（`runs/*.json` 的 `stable.zeroWrites`）。
- 第二只读事务仍重新鉴权并核对 controlVersion；`WORK_PACKET_AUTHORITY_CHANGED` 路径未被本轮改动。

## 5. 复跑命令与退出码

```powershell
cd D:\Projects\hongmen-final-a-mission-packet

# 三阶段量测（每次运行独立临时库；--phase 按当时产品代码状态切换）
npx.cmd tsx scripts/final-a/perf-readback.ts --phase=BEFORE   # exit 0
npx.cmd tsx scripts/final-a/perf-readback.ts --phase=AFTER    # exit 0
npx.cmd tsx scripts/final-a/perf-readback.ts --phase=AFTER2   # exit 0
npx.cmd tsx scripts/final-a/perf-readback.ts --merge          # exit 0
```

- 每个阶段内含 18 项检查（稳定读取 30/30、事务 spy 与 BEGIN/COMMIT 一致、SourcePolicy=6、材料 items=6、写语句=0、快照 diff 空、RETRIED/ADVANCED 语义、窗口修复期望），三阶段均 `18/18 passed`、退出码 0；合并后 `readback-perf.json` 的 `comparison` 见 §0。
- 复跑说明：`BEFORE` 需检查点原始 `readback.ts` + 原始 `sourcePolicy.ts`/`responsibility.ts` + 仅加 `sourcePolicyChecks` 的 `materialUseProjection.ts`；`AFTER` 仅换窗口修复 `readback.ts`；`AFTER2` 为最终代码。各阶段证据里的 `environment.sourceFilesSha256` 是当次实际文件哈希。
- 延迟口径：每次运行先做 3 次预热，再记录 N=30；重复运行（`-run1.json`）用于说明延迟噪声。

## 6. 定向回归与类型检查（最终代码实际执行，详见 `RUN_LOG.md`）

| 命令 | 结果 |
|---|---|
| `npm.cmd test -- tests/finalAEvidenceReviewWindow.test.ts` | 5/5 PASS，exit 0 |
| `npm.cmd test -- tests/continuitySuppression.test.ts tests/ux2SourceBinding.test.ts tests/ux2ClaimSourceRights.test.ts tests/missionMaterialUseProjection.test.ts tests/finalAWorkPacketService.test.ts tests/finalAConcurrencyService.test.ts tests/missionReadbackPanel.test.ts tests/missionNativeContract.test.ts` | 8 文件 61/61 PASS，exit 0 |
| 完整定向批次（`finalA*` 已跟踪 5 文件 + `continuitySuppression` + `missionMaterialUseProjection` + `missionEvidenceFitIntegration` + `missionNativeContract` + `missionReadbackPanel` + 10 个 `ux2*`，共 20 文件） | **20 文件 159/159 PASS，170.75 s，exit 0**（2026-11-03 15:14:33 UTC+8 起；逐文件明细见 `RUN_LOG.md`） |
| `npm.cmd exec tsc -- --noEmit` | **0 条诊断，exit 0** |

未跟踪的其他 Agent 在途测试（如 `tests/finalARequiresGuards.test.ts`、`tests/finalATerminalUnknownSummary.test.ts`、`tests/finalATerminalUnknownFocus.test.ts`）不在本轮回执分母内：它们属于其他并行任务的工作树文件，且非本任务写入。


## 7. 残余与未达标

1. **延迟不作承诺**：SQLite 单机、单进程、共享工作树；p50/p95 受机器负载与 GC 影响显著（6 次运行 p50 57.9–101.5 ms、p95 88–228 ms）。查询数（100→78）是确定性收益；未做线上吞吐/并发压测。
2. **口径边界**：查询数是 better-sqlite3 驱动层 SQL 语句数（含 Prisma 生成的 SQL），不等于 Prisma 引擎内部工作单元数；未测引擎 CPU/内存；未测网络/HTTP/序列化之外的框架开销。
3. **未做跨请求缓存**：复用只发生在同一请求、同一事务、同一 user+mission scope 内；跨请求/版本缓存、后台执行器、新状态库均未引入（按任务边界）。
4. **窗口修复范围**：只修 `readback` 的 `EVIDENCE_FIT_REVIEWED` 窗口；`contextBuilder`/其他消费方未改。本回执不替 Web/鸿蒙客户端签收 UI 文案。
5. **工作树含其他 Agent 未提交改动**：`git status` 记录在证据 `environment.git.statusPorcelain`（例如 `missionService.ts`、`presentation.ts`、`workspaceSummary.ts`、`globalFocus*` 等，非本轮 A-新3 文件）。本轮回执的数值以 `sourceFilesSha256` 记录的实际文件为准；其他 Agent 后续改动可能使“当前工作树重跑”与本回执不同。
6. **为类型一致补 1 行**：`scripts/final-a/a1-contract-samples.ts` 的合成样本 coverage 需新增只读字段 `sourcePolicyChecks: 1`（`MaterialUseProjection` 类型增量导致），否则 `tsc` 报 TS2741；未改该脚本行为。
7. **未跑/未宣称**：全量 Vitest、`next build`、E2E、hvigor、设备、真实模型、自然日与真人验收；不声称线上性能或产品整体放行。
8. `readback-perf.json` 的 `windowCorrectness.coverage` 为 `null`：修复后的覆盖说明放在 `readback.evidenceReviews` 顶层字段（`questionFiltered/windowLimit/displayLimit/inspected/note`），不在嵌套 `coverage` 对象里；字段级断言见窗口测试。`hits=3` 且 `questionFilteredFieldPresent=true`、`truncated=false` 是量测证据。

## 8. 回滚

- 三处复用均为**新增可选参数**，缺省路径行为不变：回滚只需撤销调用方传参（`readback.ts` 传 `m`、`materialUseProjection.ts` 传 continuity），再按需恢复 `sourcePolicy.ts`/`responsibility.ts` 的签名即可。
- 窗口修复回滚：恢复 `lib/mission/readback.ts` 到 `4b69614` 版本；`evidenceReviews` 新增字段为只增，不影响旧消费者。
- 量测脚本与证据均在 `scripts/final-a/perf-readback.ts`、`evidence/final-a/20261103/post-checkpoint/perf/`，删除即可完全移除；不依赖数据库迁移、不改 schema。

## 9. 文件与源码 SHA（本次最终代码）

| 文件 | sha256（`JSON.stringify(fileContent)`，与证据内一致） |
|---|---|
| `lib/mission/readback.ts` | `c07cf8d265041bc13332511c40e6624dce7ff4b36e0859d57753713410ee5fb5` |
| `lib/mission/materialUseProjection.ts` | `ac2cd68b3ea96f7fdbe00a2454dd8588fa61d8f200bb969134f51369571adb8e` |
| `lib/mission/responsibility.ts` | `316a972024c0e01c1616d32d0fabf63e2321902b4b2248012491db44c7d1f0d5` |
| `lib/continuity/sourcePolicy.ts` | `1b14bd480db88660f2593b53e852936135d4da1f7c9da8958a653b50b5ab522f` |
| `scripts/final-a/perf-readback.ts` | `eeaa6662eff4757e7d1a25316f501b64367b734fa36ad2b7deccd6c302389d2c` |
| `tests/finalAEvidenceReviewWindow.test.ts` | `7007894efc56aa3c28a32ab59debc11115630fcd9badc287c622648d3b02b72e` |
| `lib/db.ts` | 未修改（方案 B 未加 `PRISMA_QUERY_LOG` 门控） |
