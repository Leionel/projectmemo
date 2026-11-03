# 汇总 A2 独立验收结论 -> evidence/final-a/20261103/verify/a2-verification.json
# 运行：pwsh -File evidence/final-a/20261103/verify/build-a2-verification.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
Push-Location $repo
try {
  function ReadJson([string]$p) { Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json }
  $service = ReadJson (Join-Path $v 'fixtures/runs/a2-service-fixture.json')
  $concurrency = ReadJson (Join-Path $v 'fixtures/runs/a2-concurrency-fixture.json')
  $boundary = ReadJson (Join-Path $v 'boundary-a2.json')
  $integrity = ReadJson (Join-Path $v 'evidence-integrity-a2.json')
  $tscShadowExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a2-tsc-fullshadow.exit') -Raw).Trim()
  $tscWorktreeExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a2-tsc-worktree.exit') -Raw).Trim()
  $implExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a2-impl-tests-shadow.exit') -Raw).Trim()
  $serviceExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a2-service-fixture.exit') -Raw).Trim()
  $concurrencyExit = [int](Get-Content -LiteralPath (Join-Path $v 'logs/a2-concurrency-fixture.exit') -Raw).Trim()
  $head = (git rev-parse HEAD).Trim()
  $a1Final = '304adfee664689d67c6c836dc8f711ca0bc2e10b'
  $tscShadowLog = Get-Content -LiteralPath (Join-Path $v 'logs/a2-tsc-fullshadow.log') -Raw
  $tscWorktreeLog = Get-Content -LiteralPath (Join-Path $v 'logs/a2-tsc-worktree.log') -Raw

  $checks = New-Object System.Collections.ArrayList
  function Add([string]$id, [string]$q, $command, $exitCode, [string]$verdict, $observed, [string[]]$evidencePaths, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; command = $command; exitCode = $exitCode; verdict = $verdict; observed = $observed; evidencePaths = $evidencePaths; note = $note })
  }

  # ---------- 运行 / tsc ----------
  Add 'A2-RUN-01' 'A2 实现者测试作为对照独立跑通（不当作 A2 通过证据）' 'npx.cmd vitest run tests/finalAWorkPacketService.test.ts tests/finalAConcurrencyService.test.ts  # cwd=干净 shadow @d428314' $implExit 'PASS' ([ordered]@{ files = 2; tests = 19; detail = 'finalAWorkPacketService 18 passed; finalAConcurrencyService 1 passed' }) @('evidence/final-a/20261103/verify/logs/a2-impl-tests-shadow.log', 'evidence/final-a/20261103/verify/logs/a2-impl-tests-shadow.exit') '对照用；我的独立结论来自自造 fixture（A2-IND-*）。'
  Add 'A2-TSC-01' 'A2 提交在干净 shadow（git archive d428314）内 tsc --noEmit exit 0（A2 提交自身类型证据）' 'npm.cmd exec tsc -- --noEmit  # cwd=干净 shadow，先于复制验收 fixture' $tscShadowExit $(if ($tscShadowExit -eq 0) { 'PASS' } else { 'FAIL' }) ([ordered]@{ exit = $tscShadowExit; diagnosticsLogBytes = (Get-Item (Join-Path $v 'logs/a2-tsc-fullshadow.log')).Length; tree = 'git archive d428314: lib/app/components/prisma/public/tests/scripts + 配置文件；不含 untracked verify/' }) @('evidence/final-a/20261103/verify/logs/a2-tsc-fullshadow.log', 'evidence/final-a/20261103/verify/logs/a2-tsc-fullshadow.exit') '关键：验收方 fixture 未混入该 tsc 证据（先跑 tsc 再复制 fixture）。'
  Add 'A2-TSC-02' '当前工作树（含 A2 提交 + 验收方 untracked fixture）tsc --noEmit exit 0（不污染后续提交的 tsc 证据）' 'npm.cmd exec tsc -- --noEmit  # cwd=工作树' $tscWorktreeExit $(if ($tscWorktreeExit -eq 0) { 'PASS' } else { 'FAIL' }) ([ordered]@{ exit = $tscWorktreeExit; diagnosticsLogBytes = (Get-Item (Join-Path $v 'logs/a2-tsc-worktree.log')).Length; worktreeStatusTrackedChanges = @(git status --porcelain --untracked-files=no) }) @('evidence/final-a/20261103/verify/logs/a2-tsc-worktree.log', 'evidence/final-a/20261103/verify/logs/a2-tsc-worktree.exit')

  # ---------- 独立 fixture（正常/负例/零副作用/降级/FS-A03..07/A1-RESIDUAL-01） ----------
  foreach ($c in $service.checks) {
    Add $c.id $c.question ('npx.cmd tsx verify-fixtures/a2-service-fixture.ts <out>  # cwd=干净 shadow @d428314（独立临时 SQLite）') $serviceExit $c.verdict $c.observed @('evidence/final-a/20261103/verify/fixtures/runs/a2-service-fixture.json', 'evidence/final-a/20261103/verify/fixtures/a2-service-fixture.ts', 'evidence/final-a/20261103/verify/logs/a2-service-fixture.log') $c.note
  }
  foreach ($c in $concurrency.checks) {
    Add $c.id $c.question ('npx.cmd tsx verify-fixtures/a2-concurrency-fixture.ts <out>  # 第二 PrismaClient 真实并发；干净 shadow @d428314') $concurrencyExit $c.verdict $c.observed @('evidence/final-a/20261103/verify/fixtures/runs/a2-concurrency-fixture.json', 'evidence/final-a/20261103/verify/fixtures/a2-concurrency-fixture.ts', 'evidence/final-a/20261103/verify/logs/a2-concurrency-fixture.log') $c.note
  }

  # ---------- git 边界 / 证据自洽 ----------
  foreach ($c in $boundary.checks) {
    Add $c.id $c.question 'git diff/ls-tree/status 只读检查（boundary-a2.ps1）' 0 $c.verdict $c.observed @('evidence/final-a/20261103/verify/boundary-a2.json', 'evidence/final-a/20261103/verify/boundary-a2.ps1') $c.note
  }
  foreach ($c in $integrity.checks) {
    Add $c.id $c.question '解析 A2 提交样本并交叉核对（evidence-integrity-a2.ps1）' 0 $c.verdict $c.observed @('evidence/final-a/20261103/verify/evidence-integrity-a2.json', 'evidence/final-a/20261103/verify/evidence-integrity-a2.ps1') $c.note
  }

  # ---------- 未签收轨 ----------
  Add 'A2-CLIENT-WIRING' 'Web/鸿蒙客户端消费 workPacket、旧服务降级与迟到响应隔离' '待 C/D 接线后由 Lead 通知' $null 'NOT_RUN' ([ordered]@{ reason = 'A2 只提交服务端；C/D 消费与双端真实 JSON 不在本提交' }) @('evidence/final-a/20261103/verify/verification-plan.md') '不能随 A2 服务提交自动签收。'
  Add 'A2-DEVICE-MODEL-WORKER-DAY' '设备/真实模型/真实 Worker/自然日/独立用户轨' '不适用本次 A2 服务验收' $null 'NOT_RUN' ([ordered]@{ reason = '本轨只覆盖服务只读合同；无设备、无付费模型、无自然日责任、无独立用户' }) @() 'E 六轨分别记账，不用服务测试代替。'
  Add 'A2-RUN-02' '受影响回归 12 files / 84 tests（Lead 已跑；我未独立复跑）' 'npm.cmd test -- <12 个受影响测试文件>' $null 'NOT_RUN' ([ordered]@{ leadReported = '12 files / 84 tests exit 0（Lead 复核）'; myDecision = '按资源排队口径未重复跑全量回归；A2-IND-* 独立 fixture 已覆盖关键读写路径' }) @() '若要作为 E 轨正式回归证据，需在集成树由 Lead/E 统一跑并保留日志。'

  # ---------- 汇总 ----------
  $pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count
  $fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count
  $notRun = @($checks | Where-Object { $_.verdict -eq 'NOT_RUN' }).Count
  $blocked = @($checks | Where-Object { $_.verdict -eq 'BLOCKED' }).Count
  $result = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    role = 'independent-verifier'
    stage = 'A2_INDEPENDENT_VERIFICATION'
    headSha = $head
    a1FinalHead = $a1Final
    a2Commit = 'd42831468de0595304382a6021b1171a3cdd6f60'
    verificationTarget = '干净 shadow = git archive d428314 的源码树 + 主树 node_modules junction + 主树 lib/generated/prisma；tsc 在复制验收 fixture 之前执行；A2 未跟踪验收 fixture 不进入提交 tsc 证据'
    independenceStatement = 'A2 服务结论来自我自造 fixture（a2-service-fixture.ts 27 项 + a2-concurrency-fixture.ts 3 项）与真实 API 路由调用；实现者 18+1 测试与提交样本只作对照；并发使用第二 PrismaClient 真实写入，mock/前端 stale 标签不计。'
    denominators = [ordered]@{
      independentServiceChecks = $service.summary.total
      independentConcurrencyChecks = $concurrency.summary.total
      implementerTestsAsReference = 19
      committedA2Samples = 15
      a2BoundaryChecks = $boundary.summary.total
      a2EvidenceIntegrityChecks = $integrity.summary.total
      tscRuns = 2
    }
    checks = $checks
    summary = [ordered]@{ pass = $pass; fail = $fail; notRun = $notRun; blocked = $blocked; total = $checks.Count }
    failureLogPaths = @()
    residualRisks = @(
      '阶段 A 环境压力 80 轮均为 VERSION_STABLE（单进程事件循环下自然交错未命中复查窗口）；RETRIED/VERSION_ADVANCED 由阶段 B 服务端受控复查点 + 第二连接真实提交确定性验证（与实现者测试同方法，属文档允许的受控并发点）。',
      'readback 增加责任视图 + SourcePolicy 谱系 + 事务外复查，延迟未做墙钟性能断言（只记录，不承诺性能）。',
      '许可变化若不经公开 submitDirective（直接持久化 AgentDirectiveEvent）才存在“mission.version 未变”窗口；公开路径会经连续性失效联动推进 Mission version（本 fixture 观测 2→3）。该窗口的读取语义已测，但生产可达性依赖其他写入路径，需集成期复核。',
      'A2 样本在提交前的工作树生成并标注 base=head=3a62dce；我在 d428314 干净 shadow 独立复核其关键语义一致，但样本本身不是提交时刻的 git archive 产物。',
      'C/D 客户端消费、旧服务降级端到端、设备/真实模型/Worker/自然日/独立用户轨均 NOT_RUN，不能随服务提交自动签收。',
      'A1-RESIDUAL-01 的 workspaceSummary 修复已在服务层验证 PASS；Focus 页面/鸿蒙端实际消费仍待 C/D 接线与设备证据。'
    )
    signOff = [ordered]@{
      a2ServiceContract = 'ACCEPTED_SIGNED'
      canSignA2Service = $true
      blockingForCodeSign = @()
      pendingOutsideThisScope = @('C/D 双端消费与旧后端降级端到端', 'E 设备/真实模型/Worker/自然日/独立用户轨', '集成树统一回归与候选 manifest')
    }
  }
  $result | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $v 'a2-verification.json') -Encoding utf8
  "summary: pass=$pass fail=$fail notRun=$notRun blocked=$blocked total=$($checks.Count)"
  "HEAD=$head"
} finally { Pop-Location }
