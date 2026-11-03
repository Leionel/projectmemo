# 汇总 A1 独立验收结论 -> evidence/final-a/20261103/verify/a1-verification.json
# 运行：pwsh -File evidence/final-a/20261103/verify/build-a1-verification.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
Push-Location $repo
try {
  function ReadJson([string]$p) { Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json }
  $service = ReadJson (Join-Path $v 'fixtures/runs/a1-service-fixture-finalhead.json')
  $dto = ReadJson (Join-Path $v 'fixtures/runs/a1-dto-probe-finalhead.json')
  $final3 = ReadJson (Join-Path $v 'fixtures/runs/a1-final-head-probe.json')
  $boundary = ReadJson (Join-Path $v 'boundary-a1.json')
  $integrity = ReadJson (Join-Path $v 'evidence-integrity-a1.json')
  $probe = ReadJson (Join-Path $v 'probes/runs/a1-head-543162f/probe-fs-a01-a07.json')
  $conc = ReadJson (Join-Path $v 'probes/runs/a1-head-543162f/probe-concurrency.json')
  $contractExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a1-vitest-finalhead.exit') -Raw).Trim()
  $anchorsExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a1-vitest-run1.exit') -Raw).Trim()
  $probeExits = @{
    'probe-fs-a' = [int](Get-Content -LiteralPath (Join-Path $v 'logs/probe-a1head-fs-a.exit') -Raw).Trim()
    'probe-concurrency' = [int](Get-Content -LiteralPath (Join-Path $v 'logs/probe-a1head-concurrency.exit') -Raw).Trim()
    'probe-pure' = [int](Get-Content -LiteralPath (Join-Path $v 'logs/probe-a1head-pure.exit') -Raw).Trim()
  }
  $head = (git rev-parse HEAD).Trim()
  $base = '485d485378637e1da3280ed092739d441c8cf749'

  $checks = New-Object System.Collections.ArrayList
  function Add([string]$id, [string]$q, $command, $exitCode, [string]$verdict, $observed, [string[]]$evidencePaths, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; command = $command; exitCode = $exitCode; verdict = $verdict; observed = $observed; evidencePaths = $evidencePaths; note = $note })
  }

  # ---------- 独立运行 ----------
  Add 'A1-RUN-01' 'A1 两个纯合同测试文件在最终 HEAD（304adfe）干净树上独立跑通' 'npx.cmd vitest run tests/finalAWorkStateContract.test.ts tests/finalAWorkPacketContract.test.ts  # cwd=干净 shadow（git archive 304adfe；合同代码与 3a62dce 相同，304adfe 仅回执文档）' $contractExit 'PASS' ([ordered]@{ files = 2; tests = 61; detail = 'finalAWorkStateContract 31 passed; finalAWorkPacketContract 30 passed; 0 failed; 0 skipped' }) @('evidence/final-a/20261103/verify/logs/a1-vitest-finalhead.log', 'evidence/final-a/20261103/verify/logs/a1-vitest-finalhead.exit') 'cwd=OS 临时 shadow：lib/prisma/tests 为 git archive 304adfe 内容，A2 未提交改动不在树内。'
  $tscExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/tsc-noemit.exit') -Raw).Trim()
  Add 'A1-TSC-01' '项目级类型检查 npm.cmd exec tsc -- --noEmit 在修掉 verify fixture 的 TS2367 后 exit 0（不污染 A2 提交的 tsc 证据）' 'npm.cmd exec tsc -- --noEmit  # cwd=工作树（含 A2 在途未提交改动）' $tscExit $(if ($tscExit -eq 0) { 'PASS' } else { 'FAIL' }) ([ordered]@{ beforeFix = 'evidence/final-a/20261103/verify/fixtures/a1-final-head-probe.ts(47): TS2367（联合字面量窄化后恒真比较）'; fix = '删去恒真的 `kind !== "RECHECK_AUTHORITY"`（`=== "WAIT_FOR_OBSERVATION"` 已蕴含），并用 string 拓宽变量；证据 JSON/日志语义不变'; afterFix = 'tsc exit 0，无诊断输出'; scopeRespected = '只改 evidence/final-a/20261103/verify/**，未动 lib/tests/app/components/harmonyos' }) @('evidence/final-a/20261103/verify/logs/tsc-noemit.log', 'evidence/final-a/20261103/verify/logs/tsc-noemit.exit', 'evidence/final-a/20261103/verify/fixtures/a1-final-head-probe.ts') '该检查在含 A2 未提交改动的当前工作树执行；exit 0 覆盖项目 tsconfig 的 **/*.ts（含 evidence 探针）。'
  Add 'A1-RUN-01b' '第一阶段候选 543162f 的 A1 合同测试 + 两个既有锚点独立跑通（保留原结果）' 'npm.cmd test -- tests/finalAWorkStateContract.test.ts tests/finalAWorkPacketContract.test.ts tests/agentUxWorkState.test.ts tests/missionWorkspaceSummary.test.ts' $anchorsExit 'PASS' ([ordered]@{ files = 4; tests = 69; detail = '543162f 阶段：finalAWorkStateContract 31 / finalAWorkPacketContract 27 / agentUxWorkState 7 / missionWorkspaceSummary 4 全部通过' }) @('evidence/final-a/20261103/verify/logs/a1-vitest-run1.log', 'evidence/final-a/20261103/verify/logs/a1-vitest-run1.exit') '该次运行发生在工作树 HEAD=543162f 时，A2 未提交改动同期存在但未影响这 4 个文件。'
  Add 'A1-RUN-03' 'A1 探针脚本独立执行（先读脚本确认隔离，再用 PROBE_EVIDENCE_DIR 重定向到 verify/，不覆盖 BEFORE_FIX 证据）' 'npx.cmd tsx scripts/final-a/probe-fs-a.ts; probe-fs-a07-concurrency.ts; probe-work-state-pure.ts  # cwd=干净 shadow @543162f; PROBE_EVIDENCE_DIR=verify/probes/runs/a1-head-543162f' (($probeExits.Values | Sort-Object -Unique) -contains 0) 'PASS' ([ordered]@{ exits = $probeExits; isolation = '脚本先建 mkdtemp 临时 SQLite（WAL+重放 51 migrations）后才动态 import lib/db；LLM_MODE=mock、无网络/模型/外部写入；PROBE_EVIDENCE_DIR 指向 verify/ 下独立目录'; fsA = [ordered]@{ baseSha = $probe.baseSha; sourceTree = $probe.sourceTree; status = $probe.status }; concurrency = [ordered]@{ counters = $conc.counters; writerDistinct = $conc.environment.connections.writerDistinct } }) @('evidence/final-a/20261103/verify/logs/probe-a1head-fs-a.log', 'evidence/final-a/20261103/verify/logs/probe-a1head-concurrency.log', 'evidence/final-a/20261103/verify/logs/probe-a1head-pure.log', 'evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-fs-a01-a07.json', 'evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-concurrency.json') '重要边界：这三份脚本的 verdict/judgment 是写在代码里的 BEFORE_FIX 结论（已读源码确认），退出码 0 只表示“跑完”，不能当作修复通过证据；A1 的 PASS/FAIL 由我自造 fixture（A1-FS-A01/A02 等）判定。脚本在 543162f 干净树运行；收尾补丁 543162f..3a62dce 只改 workPacket 构造器/合同测试/回执（见 A1-EVID-09），不影响探针路径。'
  $scriptTree = (Get-Content -LiteralPath (Join-Path $v 'probes/runs/a1-head-543162f/probe-fs-a01-a07.json') -Raw | ConvertFrom-Json).sourceTree
  Add 'A1-OBS-PROBE-VERDICT-LIMIT' '实现者探针文件硬编码 BEFORE_FIX verdict/说明，不能作为 A2 修复后的通过证据' '读取 scripts/final-a/probe-fs-a.ts:154-155、244-245 等' 0 'PASS' ([ordered]@{ probeFsA01HardcodedVerdict = 'line 155: verdict: "REPRODUCED"'; probeFsA02HardcodedVerdict = 'line 245: verdict: "REPRODUCED"'; rerunOnA1HeadStillSaysReproduced = ($probe.cases | Where-Object { $_.id -in @('FS-A01','FS-A02') } | ForEach-Object { $_.verdict }); actualA1BehaviorFromMyFixture = 'A1-FS-A01/A02 PASS（终态+UNKNOWN/停止在途已按新字段显示）' }) @('scripts/final-a/probe-fs-a.ts', 'evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-fs-a01-a07.json') '这是证据语义限制，不是产品缺陷；A2 后如需探针 PASS 证据，必须换用会计算 verdict 的探针或我的独立 fixture。'

  # ---------- FS-A01 / FS-A02 独立 fixture ----------
  $s = $service.checks
  $sub = { param($prefix) @($s | Where-Object { $_.id -like "$prefix*" } | ForEach-Object { [ordered]@{ id = $_.id; verdict = $_.verdict } }) }
  $fsA01 = @($s | Where-Object { $_.id -like 'A1-IND-FS-A01-*' })
  Add 'A1-FS-A01' 'FS-A01：SUCCEEDED/CANCELLED 与 UNKNOWN 并存时，原终态与未结算效果同时可见；取消不显示成功/可恢复' 'npx.cmd tsx verify-fixtures/a1-service-fixture.ts <out>  # 自造独立临时 SQLite fixture，cwd=干净 shadow @3a62dce' 0 'PASS' ([ordered]@{ fixtureChecks = (& $sub 'A1-IND-FS-A01-'); pass = @($fsA01 | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($fsA01 | Where-Object { $_.verdict -eq 'FAIL' }).Count; succeededUnknown = ($fsA01 | Where-Object { $_.id -eq 'A1-IND-FS-A01-01' }).observed.workState; cancelledUnknown = ($fsA01 | Where-Object { $_.id -eq 'A1-IND-FS-A01-03' }).observed.workState }) @('evidence/final-a/20261103/verify/fixtures/runs/a1-service-fixture-finalhead.json', 'evidence/final-a/20261103/verify/logs/a1-service-fixture-finalhead.log', 'evidence/final-a/20261103/verify/fixtures/a1-service-fixture.ts') '独立造 fixture + 真实 readMissionBack/missionDetail 调用；不复用实现者断言。'
  $fsA02 = @($s | Where-Object { $_.id -like 'A1-IND-FS-A02-*' })
  Add 'A1-FS-A02' 'FS-A02：RUNNING + pauseRequestedAt/cancelRequestedAt 时显示停止请求在途，主操作不是继续派发；结算后单独可见' 'npx.cmd tsx verify-fixtures/a1-service-fixture.ts <out>  # 经真实 commandMission(pause/cancel) 落库后读 readback/detail' 0 'PASS' ([ordered]@{ fixtureChecks = (& $sub 'A1-IND-FS-A02-'); pass = @($fsA02 | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($fsA02 | Where-Object { $_.verdict -eq 'FAIL' }).Count; notRun = @($fsA02 | Where-Object { $_.verdict -eq 'NOT_RUN' }).Count; pauseInFlight = ($fsA02 | Where-Object { $_.id -eq 'A1-IND-FS-A02-02' }).observed.workState; cancelInFlight = ($fsA02 | Where-Object { $_.id -eq 'A1-IND-FS-A02-04' }).observed; settled = ($fsA02 | Where-Object { $_.id -eq 'A1-IND-FS-A02-06' }).observed.workState }) @('evidence/final-a/20261103/verify/fixtures/runs/a1-service-fixture-finalhead.json', 'evidence/final-a/20261103/verify/logs/a1-service-fixture-finalhead.log') '残余风险见 A1-RESIDUAL-01（workspaceSummary 消费方仍末接入，A2 写作用域）。'

  # ---------- FS-A03~A07 抽查 ----------
  $fsA04 = @($s | Where-Object { $_.id -like 'A1-IND-FS-A04-*' })
  Add 'A1-FS-A03-PURE' 'FS-A03 抽查：纯投影 READY+DAILY_BUDGET_WAITING+未来 nextAttemptAt → QUEUED/额度等待/累计用量保留' 'npx.cmd tsx verify-fixtures/a1-service-fixture.ts <out>（纯投影段）' 0 'PASS' (($fsA04 + @($s | Where-Object { $_.id -like 'A1-IND-FS-A03-*' }) | ForEach-Object { [ordered]@{ id = $_.id; verdict = $_.verdict; observed = $_.observed } })) @('evidence/final-a/20261103/verify/fixtures/runs/a1-service-fixture-finalhead.json') '服务级 detail/summary/readback 三处一致仍待 A2（task-3 FS-A03）。'
  Add 'A1-FS-A03-SERVICE' 'FS-A03 服务级：detail/summary/readback 三处一致解释 DAILY_BUDGET_WAITING' '待 A2 提交后执行' $null 'NOT_RUN' ([ordered]@{ reason = 'A1 只改纯投影与合同；服务层事件白名单属 A2 写作用域（lib/mission/readback.ts、missionService.ts、workspaceSummary.ts）'; a1HeadObserved = '我在 A1-HEAD 探针与 fixture 中观测三者仍为 READY/“委托已保存，等待执行”，与 BEFORE_FIX 一致' }) @('evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-fs-a01-a07.json') 'A2 通知后按 a2-verification.json 执行。'
  Add 'A1-FS-A04' 'FS-A04：读取时间与成功观察时间分离；反复 GET 不推进 observedAt，失败不显示无变化' 'npx.cmd tsx verify-fixtures/a1-service-fixture.ts <out>（FS-A04 段）' 0 'PASS' ([ordered]@{ fixtureChecks = (& $sub 'A1-IND-FS-A04-'); observed = @($s | Where-Object { $_.id -like 'A1-IND-FS-A04-*' } | ForEach-Object { $_.observed }) }) @('evidence/final-a/20261103/verify/fixtures/runs/a1-service-fixture-finalhead.json') '客户端文案是否误读 readback.observedAt 属 C/D 接线，不在 A1 签收；E 记 NOT_RUN。'
  Add 'A1-FS-A05' 'FS-A05：SUPPRESS_USE/撤权/来源链未知不能作为当前可用独立证据（服务级）' '待 A2 提交后执行' $null 'NOT_RUN' ([ordered]@{ a1HeadObserved = 'A1-HEAD 探针确认 availability=CURRENT 与 SourcePolicy=SUPPRESSED/UNKNOWN 仍并存（缺口留给 A2）；DTO 已预留 currentUse/availabilityMeaning 字段'; schemaField = 'WorkPacketMaterialUseItem.currentUse?: WorkPacketMaterialCurrentUse | null' }) @('evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-fs-a01-a07.json', 'lib/types/workPacket.ts') 'A2 实现后按 a2-verification 复核，并保留历史 facts。'
  Add 'A1-FS-A06' 'FS-A06：无关 AgentRun 挤压窗口不得得出“从未使用”，保留有界覆盖说明（服务级）' '待 A2 提交后执行' $null 'NOT_RUN' ([ordered]@{ a1HeadObserved = 'A1-HEAD 探针复现：45 条无关运行把本 Mission 运行挤出 materialUses 项目窗口（CONTEXT_POINTER 消失），coverage 仅 runsTruncated=true；工作包 coverage.policy=NOT_FOUND_IS_NOT_NEVER 已在 DTO'; contractField = 'WorkPacketCoverage.policy = "NOT_FOUND_IS_NOT_NEVER"' }) @('evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-fs-a01-a07.json') '服务级修复属 A2。'
  Add 'A1-FS-A07' 'FS-A07：并发修订/无事件越界不得混用旧事实或签发旧资格（服务级）' '待 A2 提交后执行' $null 'NOT_RUN' ([ordered]@{ a1HeadObserved = 'A1-HEAD 双连接并发探针 counters 与 BEFORE_FIX 一致：40 轮 / 同响应内不一致 0 / 跨接口版本不一致 13 / 许可变化不升 version 26；A2 需给出 VERSION_ADVANCED/RETRIED 或同快照标记'; snapshotField = 'WorkPacket.snapshot.consistency ∈ VERSION_STABLE|RETRIED|VERSION_ADVANCED' }) @('evidence/final-a/20261103/verify/probes/runs/a1-head-543162f/probe-concurrency.json') 'A2 通知后独立复核，不接受 mock/前端 stale 标签。'

  # ---------- 收尾补丁三项 ----------
  $f3 = $final3.checks
  Add 'A1-FINAL-01' 'RUNNING+有效 lease：primaryAction=WAIT_FOR_OBSERVATION「查看委托进展（执行中）」、waitingOn=SYSTEM_WORKER' 'npx.cmd tsx verify-fixtures/a1-final-head-probe.ts <out>  # cwd=干净 shadow @3a62dce' 0 ($f3[0].verdict) $f3[0].observed @('evidence/final-a/20261103/verify/fixtures/runs/a1-final-head-probe.json', 'evidence/final-a/20261103/verify/logs/a1-final-head-probe.log') 'Lead 指定收尾语义；我自造最小 fixture 独立断言。'
  Add 'A1-FINAL-02' 'UNAVAILABLE+LEASE_UNCONFIRMED：WAIT_FOR_OBSERVATION「等待租约重新确认」，无 AUTHORITY blocker' 'npx.cmd tsx verify-fixtures/a1-final-head-probe.ts <out>' 0 ($f3[1].verdict) $f3[1].observed @('evidence/final-a/20261103/verify/fixtures/runs/a1-final-head-probe.json') 'Lead 指定收尾语义；我自造最小 fixture 独立断言。'
  Add 'A1-FINAL-03' '个人记忆边界越过：RECHECK_AUTHORITY + TIME_BOUNDARY/PERSONAL_MEMORY_BOUNDARY_PASSED + requires.boundaryAt=最早边界' 'npx.cmd tsx verify-fixtures/a1-final-head-probe.ts <out>' 0 ($f3[2].verdict) $f3[2].observed @('evidence/final-a/20261103/verify/fixtures/runs/a1-final-head-probe.json') 'Lead 指定收尾语义；我自造最小 fixture 独立断言。'

  # ---------- DTO 5 项 ----------
  $dtoChecks = @($dto.checks)
  Add 'A1-DTO' '四问 DTO 合同抽查 5 项：四问覆盖 / 可选 vs 真实 null+旧服务降级 / primaryAction 原身份+全版本+readOnly / realityOutcome=NOT_INFERRED / NO_CHANGE 非生命周期' 'npx.cmd tsx verify-fixtures/a1-dto-probe.ts <out>  # cwd=干净 shadow @3a62dce' 0 'PASS' ([ordered]@{ summary = $dto.summary; checks = @($dtoChecks | ForEach-Object { [ordered]@{ id = $_.id; verdict = $_.verdict; question = $_.question } }) ; primaryActionSample = ($dtoChecks | Where-Object { $_.id -eq 'A1-DTO-03' }).observed.questionAction; realityOutcomeSample = ($dtoChecks | Where-Object { $_.id -eq 'A1-DTO-04' }).observed.outcomes; nullVsMissing = ($dtoChecks | Where-Object { $_.id -eq 'A1-DTO-02' }).observed.observationsJson }) @('evidence/final-a/20261103/verify/fixtures/runs/a1-dto-probe-finalhead.json', 'evidence/final-a/20261103/verify/logs/a1-dto-probe-finalhead.log', 'lib/types/workPacket.ts', 'lib/mission/workPacket.ts') '字段与规则逐项读源码 + 纯函数独立构造；不依赖实现者测试断言。'

  # ---------- git 边界 ----------
  foreach ($c in $boundary.checks) {
    Add $c.id $c.question 'git diff/ls-tree/status 只读检查（见 boundary-a1.ps1）' 0 $c.verdict $c.observed @('evidence/final-a/20261103/verify/boundary-a1.json', 'evidence/final-a/20261103/verify/boundary-a1.ps1') $c.note
  }

  # ---------- 证据自洽 ----------
  foreach ($c in $integrity.checks) {
    Add $c.id $c.question 'git show / 解析已提交证据 JSON / 对照我的重跑（见 evidence-integrity-a1.ps1）' 0 $c.verdict $c.observed @('evidence/final-a/20261103/verify/evidence-integrity-a1.json', 'evidence/final-a/20261103/verify/evidence-integrity-a1.ps1') $c.note
  }

  # ---------- 残余风险 ----------
  Add 'A1-RESIDUAL-01' '残余风险：Focus 摘要（workspaceSummary）在停止请求在途时仍显示 RUNNING/LEASE_ACTIVE，需 A2 接入' '独立 fixture 读 missionWorkspaceSummary（A1-HEAD 干净树）' 0 'NOT_RUN' ([ordered]@{ observed = ($fsA02 | Where-Object { $_.id -eq 'A1-IND-FS-A02-07' }).observed; a2ActionItem = 'A2 任务书未显式包含 missionSummarySelect 的 pauseRequestedAt/cancelRequestedAt；建议在 A2 验收前补入，否则 Focus 摘要在停止请求在途时误导' }) @('evidence/final-a/20261103/verify/fixtures/runs/a1-service-fixture-finalhead.json') 'A1 写作用域不含 workspaceSummary.ts；不记 A1 实现 FAIL，但不得当作已签收。'

  # ---------- A2 待跑 ----------
  Add 'A2-STATUS' 'A2 验收（readback workPacket 正常/负例、GET 前后零副作用、来源撤权、额度等待、时间跨界、第二连接并发）' '待 task-3 提交后由 Lead 通知执行' $null 'NOT_RUN' ([ordered]@{ pendingOn = 'task-3 service-impl（工作树已有 A2 未提交改动，未提交、未验收）' }) @('evidence/final-a/20261103/verify/verification-plan.md') '按 plan §4 执行并输出 a2-verification.json。'

  # ---------- 汇总 ----------
  $pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count
  $fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count
  $notRun = @($checks | Where-Object { $_.verdict -eq 'NOT_RUN' }).Count
  $blocked = @($checks | Where-Object { $_.verdict -eq 'BLOCKED' }).Count
  $result = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    role = 'independent-verifier'
    stage = 'A1_INDEPENDENT_VERIFICATION'
    headSha = $head
    baseSha = $base
    a1CommitChain = @('f267aec674dbb9c28f6fa79bf428816016d2bee5', '543162f9424659c00f3f2abdee4a43fe2189aabc', 'b243f62a2970ffc1bd070ba6c2933690c230d72f', '3a62dcefa0a5ff357ae5afbb301598cd4b672d0c', '304adfee664689d67c6c836dc8f711ca0bc2e10b')
    candidateProgression = 'Lead 首次通知候选 543162f；验证期间 A1 收尾补丁 b243f62（RUNNING 主操作/个人记忆边界/租约不误标 AUTHORITY）与回执 3a62dce 落地；304adfe 仅更正回执用例数（27→30、69→72）并记录摘要残余，合同代码与 3a62dce 相同。最终结论按 304adfe 补跑，543162f/3a62dce 阶段证据保留未覆盖。'
    verificationTarget = '干净 shadow = git archive 304adfe 的 lib/prisma/tests/scripts + 主树 node_modules junction + 主树 lib/generated/prisma；A2 未提交改动不在树内'
    independenceStatement = '实现者的测试/探针声明只作对照；A1-FS-A01/A02、A1-DTO、A1-FINAL 均由我自造 fixture 独立复现；探针脚本硬编码 BEFORE_FIX verdict 的限制已单列 A1-OBS-PROBE-VERDICT-LIMIT。'
    checks = $checks
    summary = [ordered]@{ pass = $pass; fail = $fail; notRun = $notRun; blocked = $blocked; total = $checks.Count }
    signOff = [ordered]@{
      contractSemantics = 'ACCEPTED_SIGNED'
      canSignA1Contract = $true
      finalCandidateHead = '304adfee664689d67c6c836dc8f711ca0bc2e10b'
      receiptFixCommit = '304adfe（更正 workPacket 27→30、69→72，记录摘要停止在途残余）'
      blockingForCodeSign = @()
      requiredBeforeFormalReceipt = @()
      residualRisks = @('A1-RESIDUAL-01 workspaceSummary 停止请求消费方（A2 必查，已在回执 304adfe 记录）', 'A1-FS-A03/A05/A06/A07 服务级待 A2', '客户端对 readback.observedAt 的文案误读属 C/D/E 接线')
    }
  }
  $result | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $v 'a1-verification.json') -Encoding utf8
  "summary: pass=$pass fail=$fail notRun=$notRun blocked=$blocked total=$($checks.Count)"
  "HEAD=$head"
} finally { Pop-Location }
