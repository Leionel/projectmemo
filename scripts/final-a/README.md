# A1 探针（scripts/final-a）README

本目录是 **A1 事实/状态探针层**：在独立临时 SQLite 上调用真实服务与投影函数，按
`docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划/07_执行准备/01_源码差距与工作包合同预案.md`
第 4 节 FS-A01～A07 的失败判据做 **BEFORE_FIX 特征化**，输出可复核 JSON。

> **边界声明**：本目录脚本不修复产品代码；task-2 完成只代表“A1 探针层完成”，**不代表
> FS-A01～07 已修复或已签收**。在 A2 服务修复与 independent-verifier 独立验收签收之前，
> 对外叙述不得写成“已修复”。证据里的 `mode: "BEFORE_FIX"` 与其 `sourceTree` 字段是复核依据。

写入边界：只写 `scripts/final-a/` 与本任务证据 `evidence/final-a/20261103/`（同名样本
`samples/FS-A0x-*.json` 为 A1 BEFORE_FIX 样本，保持原样、不移动不改名）。不 `git commit` / `git push`。

## 1. 文件与用途

| 文件 | 用途 |
|---|---|
| `probe-fs-a.ts` | FS-A01～A06 服务级探针：真实调用 `readMissionBack` / `missionDetail` / `missionWorkspaceSummary` / `materialUseProjection`，并与 `lib/continuity/sourcePolicy.sourceUse`、`validateSources` 对照。输出 `evidence/final-a/20261103/probe-fs-a01-a07.json` + `samples/FS-A0x-*.json`。 |
| `probe-fs-a07-concurrency.ts` | FS-A07 真实双连接并发：主连接 `lib/db` 读取，第二连接 `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 同一 DATABASE_URL }) })` 循环执行真实 update/insert；40 轮交替读，统计跨接口/跨调用/同一响应内修订不一致。输出 `probe-concurrency.json`。 |
| `probe-work-state-pure.ts` | 参考纯投影探针：只调用 `lib/mission/workState.ts:missionWorkState` 纯函数（无数据库），复刻 preparation `WORK_STATE_PROBE.json` 思路。输出 `probe-work-state-pure.json`，显式标注 **纯投影 ≠ 服务缺陷已确认**，不能替代服务级证据。 |
| `smoke-db.ts` | 基建冒烟：验证“独立临时库 + 迁移重放 + 设置 env 后动态 import + 真实服务调用”链路；不产出正式证据。 |
| `lib/probeSupport.ts` | 临时库创建（`mkdtemp` + WAL + 按序重放 `prisma/migrations/*/migration.sql`）、env 设置、证据写出（支持重定向）、`gitHead()`（可被 `PROBE_BASE_SHA` 固定）、`probeSourceTree()`、错误封装与 `runProbe` 退出码封装。 |
| `lib/probeFixtures.ts` | 最小 fixture：owner/project/membership、Mission、Event、`bind_project_sources` 成功步骤、项目内 AgentRun。只做类型导入，不静态加载 lib 运行时模块。 |

## 2. 运行命令

```powershell
cd D:\Projects\hongmen-final-a-mission-packet

npx.cmd tsx scripts/final-a/probe-fs-a.ts
npx.cmd tsx scripts/final-a/probe-fs-a07-concurrency.ts
npx.cmd tsx scripts/final-a/probe-work-state-pure.ts
```

- 退出码：`0` = 探针跑完（**不代表**业务已修复）；非零 = 脚本失败，错误会写入对应证据 JSON
  （`status: "SCRIPT_ERROR"`，含 message/前 12 行 stack）。
- 默认输出会写 `evidence/final-a/20261103/` 下的同名 BEFORE_FIX 证据。**只想做对照复跑时请用
  `PROBE_EVIDENCE_DIR` 重定向，不要覆盖基线证据**（见第 4 节）。
- 运行前提：仓库根目录已 `npm.cmd install`（`tsx`、`better-sqlite3`、Prisma 生成目录
  `lib/generated/prisma` 存在）。脚本不依赖 `.env`。

## 3. BEFORE_FIX 快照方法（git archive 485d485）

**为什么需要**：A1 探针执行期间，工作树可能同时存在 A2/contract-core 的未提交修改
（如 `lib/mission/workState.ts`、`lib/types/workState.ts`、`lib/mission/workPacket.ts`、
`lib/types/workPacket.ts`、新测试）。若直接在工作树跑，证据会混入修复中的行为，失去 BEFORE_FIX
语义。因此基线证据在 `git archive` 导出的 `485d485` 干净快照上生成，且**不修改、不还原**他人工作树。

```powershell
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$sha  = '485d485378637e1da3280ed092739d441c8cf749'

$shadow = Join-Path $env:TEMP ('pm-final-a-baseline-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $shadow | Out-Null
$tar = Join-Path $env:TEMP ('pm-final-a-baseline-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.tar')

# 只导出探针需要且无历史大文件/Unicode 文件名干扰的路径
git -C $repo archive --format=tar -o $tar $sha -- `
  lib prisma package.json tsconfig.json next-env.d.ts package-lock.json `
  prisma.config.ts vitest.config.ts .gitattributes
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
tar -xf $tar -C $shadow
if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
Remove-Item $tar -Force

# lib/generated/prisma 被 gitignore：从主树复制（schema 未变，生成物可复用）
New-Item -ItemType Directory -Path (Join-Path $shadow 'lib\generated') -Force | Out-Null
Copy-Item -Recurse (Join-Path $repo 'lib\generated\prisma') (Join-Path $shadow 'lib\generated\prisma') -Force

# 复用主树依赖（junction）。结束时必须先 cmd /c rmdir 移除 junction，再删 shadow，
# 避免递归删除跟随链接影响主树 node_modules。
New-Item -ItemType Junction -Path (Join-Path $shadow 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null

# 探针脚本本身不在基线提交里，复制进去
Copy-Item -Recurse (Join-Path $repo 'scripts\final-a') (Join-Path $shadow 'scripts\final-a') -Force

$env:PROBE_BASE_SHA   = $sha
$env:PROBE_SOURCE_TREE = 'pristine baseline snapshot @485d485 via git archive (working-tree A2 edits excluded; BEFORE_FIX)'

Push-Location $shadow
try {
  npx.cmd tsx scripts/final-a/probe-fs-a.ts
  npx.cmd tsx scripts/final-a/probe-fs-a07-concurrency.ts
  npx.cmd tsx scripts/final-a/probe-work-state-pure.ts
} finally { Pop-Location }

# 证据在 $shadow\evidence\final-a\20261103；复制回仓库前先确认目标路径与文件名（勿覆盖他人证据）
cmd /c rmdir "$shadow\node_modules"
Remove-Item $shadow -Recurse -Force
```

说明：

- `PROBE_BASE_SHA` 让证据 `baseSha` 在无 `.git` 的快照里仍记录真实基线；默认（不设置时）
  用 `git rev-parse HEAD`。
- `PROBE_SOURCE_TREE` 写进证据 `sourceTree`，用于复核“证据来自哪个源码树”。
- 临时数据库不在 shadow 内：`setupIsolatedDatabase()` 仍会 `mkdtemp` 到 OS 临时目录；
  证据 `environment.temporaryDir` / `databaseUrl` 记录当次真实库位置，重跑每次不同。
- 若工作树处于干净基线（`git status` 无他人改动），也可直接在工作树跑；但以 `sourceTree`
  和 `git rev-parse HEAD` 能对上的证据为准。

## 4. `PROBE_EVIDENCE_DIR` 重定向（修复前后对照）

A2 修复落地后，用同一脚本做“修复后”对照时，把输出重定向到独立目录，避免覆盖 BEFORE_FIX 证据：

```powershell
$env:PROBE_EVIDENCE_DIR = 'D:\Projects\hongmen-final-a-mission-packet\evidence\final-a\20261103\after-fix'
try {
  npx.cmd tsx scripts/final-a/probe-fs-a07-concurrency.ts
} finally {
  Remove-Item Env:PROBE_EVIDENCE_DIR
}
```

- 设置后 `writeEvidence()` 写绝对目录 `PROBE_EVIDENCE_DIR\...`，证据内 `samplePaths` 也会是
  该目录下的绝对路径（不是仓库相对路径）；不设置时保持仓库默认证据目录。
- 相对路径会按当前工作目录解析，建议直接给绝对路径。
- 对照复跑时建议同时设置 `PROBE_SOURCE_TREE`（例如
  `'working-tree after A2 fix @ <head/描述>'`），让证据自己说明运行树。

## 5. 隔离、幂等与 mock 说明

- `setupIsolatedDatabase(label)` 的顺序（必须遵守）：
  1. `fs.mkdtempSync(os.tmpdir()/pm-final-a-<label>-*)`；
  2. `better-sqlite3` 打开 `<dir>/probe.db`，`PRAGMA journal_mode = WAL`；
  3. 按 `prisma/migrations` 目录名排序，逐个执行 `migration.sql`；
  4. 设置 `DATABASE_URL=file:<绝对路径>`、`MISSION_ENABLED=true`、`MISSION_WRITES_ENABLED=true`、
     `MISSION_UI_ENABLED=true`、`FOCUS_AGENT_ENABLED=true`、`FOCUS_CONTINUITY_ENABLED=true`、
     `FOCUS_AGENT_R4_ENABLED=false`、`FOCUS_ASYNC_ENABLED=false`、`FOCUS_WEB_ENABLED=true`、
     `SEMANTIC_MEMORY_ENABLED=false`、`LLM_MODE=mock`、`WORKER_PRESENCE_FILE=<临时目录>/worker-presence.json`；
  5. 之后才允许 `await import("../../lib/db")` 等模块。本目录脚本没有顶层 `lib/` 运行时 import，
     避免在设置 env 之前连到真实库。
- 不读 `.env`、不依赖 `prisma/final-preparation.db`、不 seed、不删除任何真实库；
  worker presence 写临时目录，不污染工作树 `.runtime/`。
- 不调用模型、网络或付费接口；`LLM_MODE=mock`，证据环境字段记录 `modelProviderCalls: 0`。
- 幂等：每次运行都新建独立临时 SQLite；同一源码树上连跑两轮，verdict 与并发计数器保持稳定
  （已实测 FS-A01～A07 全部用例两轮一致）。
- 探针只读服务（`readMissionBack`/`missionDetail`/`missionWorkspaceSummary`/`readMissionResponsibility`）
  不创建业务事件、不推进预算、不写入真实数据；所有 fixture 写操作只发生在临时库。

## 6. verdict 解读与残余边界（不要误读）

verdict 语义：

- `REPRODUCED`：**当前源码**真实服务行为命中该 FS 的失败判据；不等于根因已定位、更不等于已修复。
- `NOT_REPRODUCED`：该服务层判据未命中；不等于客户端/设备层没有风险。
- `INCONCLUSIVE`：证据不足（本批无此项）。

已知需特别说明的残余：

1. **FS-A04 = NOT_REPRODUCED（服务层）**：固定 `planJson.delegation.lastObservedAt` 后连续 GET，
   `readback.observedAt` 与 `workState.checkedAt` 前进（两者都是读取时刻），但
   `workState.observedAt` 只来自 `delegation.lastObservedAt`，固定不动；改为 `FAILED/TOOL_FAILED`
   后成功观察时间仍不前进，也没有 `NO_CHANGE`。**残余风险在客户端文案**：任何调用方把
   `readback.observedAt` 当作“刚刚核查成功”仍会误导；服务字段语义本身是分离的，但本探针
   不替 Web/鸿蒙客户端签收，也不证明 UI 不会误读。
2. **FS-A05 的 `availability = CURRENT`**：`materialUseProjection` 只用
   `readProjectMaterial` 的复合 hash（`rawText + sourceType + cardHash`）判断“版本是否匹配”，
   `CURRENT` **仅表示版本匹配**，不代表 `SourcePolicy` 允许当前使用、也不代表独立证据。
   探针已实测：`SUPPRESS_USE`、`SourceConnection` 撤销、来源链未知三种情形下
   `sourceUse = SUPPRESSED/UNKNOWN`，而 `availability` 仍 `CURRENT` —— 这是真实矛盾，
   当前工作包若照搬 `CURRENT` 会绕过抑制；历史 facts 与摘录不因撤权删除，写守卫仍拒绝
   （`SOURCE_USE_SUPPRESSED`），这两项是正常/通过的。
3. **FS-A05 的 hash 适配**：任务书示例写 `sourcePointer.hash = sha256(text)`，但真实
   `readProjectMaterial().hash` 是 `jsonHash({rawText, sourceType, cardHash})`；按 `sha256(text)`
   绑定只会得到 `availability = CHANGED`，无法命中“版本匹配但策略抑制”的矛盾。因此探针用
   真实 `readProjectMaterial().hash` 绑定，并把 `rawTextSha256` 留在证据里供复核。
4. **FS-A07 并发语义**：两个独立 PrismaClient 指向同一 SQLite 文件，写连接在读取之间真实提交
   update/insert；并发是事件循环 `await` 边界的交错提交，不是 OS 线程级并行。证据显示
   `readMissionBack` 同一响应内 0 不一致（单事务组合有效），缺口在 `missionDetail` /
   `readMissionResponsibility` / `readMissionBack` 各自独立快照且没有公共版本号
   （detail 有 `version`、responsibility 有 `controlVersion` 哈希）。修复/签收以 A2 服务
   测试与 independent-verifier 复核为准。
5. **当前工作树 ≠ 基线**：工作树若包含 A2/contract-core 未提交改动，直接运行会得到“修复中”的
   行为，不能当作 BEFORE_FIX 证据，也不能当作已修复签收；请以证据 JSON 的 `baseSha` /
   `sourceTree` 和运行目录为准。

## 7. 证据与运行记录

输出：

- `evidence/final-a/20261103/probe-fs-a01-a07.json`：FS-A01～A06 逐项 `verdict` / `criterion` /
  `observed`（精简真实 JSON）/ `notes` / `samplePaths`；
- `evidence/final-a/20261103/probe-concurrency.json`：FS-A07 迭代数、逐轮关键版本、
  不一致明细、`licenseChangeSamples`；
- `evidence/final-a/20261103/probe-work-state-pure.json`：纯投影参考（含“纯投影 ≠ 服务缺陷已确认”声明）；
- `evidence/final-a/20261103/samples/FS-A0x-*.json`：A1 BEFORE_FIX 完整真实 JSON 样本
  （保持原样，供 Verifier/A2 对照；A2 修复后样本应使用 `samples/a2-*.json` 或 `samples/a2/`）；
- `evidence/final-a/20261103/PROVENANCE.json`：快照方法、命令、退出码、环境、临时库路径、重跑说明。

基线证据运行记录（485d485 快照，最终脚本版本）：三脚本退出码均为 `0`；
`npm.cmd exec tsc -- --noEmit` 下 `scripts/final-a` 无类型错误（全量 tsc 的其它报错不属于本目录，
例如他人临时文件；不在此重复）。
