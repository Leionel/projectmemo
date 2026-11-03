# A2 独立验收：A2 已提交样本/证据自洽性核查（只读 + 写 verify 证据）
# 运行：pwsh -File evidence/final-a/20261103/verify/evidence-integrity-a2.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
$samples = Join-Path $repo 'evidence\final-a\20261103\samples\a2'
Push-Location $repo
try {
  $head = (git rev-parse HEAD).Trim()
  $checks = New-Object System.Collections.ArrayList
  function AddCheck([string]$id, [string]$q, [bool]$pass, $observed, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; verdict = $(if ($pass) { 'PASS' } else { 'FAIL' }); observed = $observed; note = $note })
  }
  function ReadJson([string]$p) { Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json }

  $files = @(Get-ChildItem $samples -Filter '*.json')
  $parseErrors = @()
  $json = @{}
  foreach ($file in $files) {
    try { $json[$file.Name] = ReadJson $file.FullName } catch { $parseErrors += $file.Name }
  }
  AddCheck 'A2-EVID-01' 'A2 样本文件齐全（12 状态 + legacy + index + service-verification = 15）且全部可解析' ($files.Count -eq 15 -and $parseErrors.Count -eq 0) ([ordered]@{ fileCount = $files.Count; names = @($files.Name | Sort-Object); parseErrors = $parseErrors })

  $index = $json['a2-index.json']
  $indexFiles = @($index.samples | ForEach-Object { [System.IO.Path]::GetFileName($_.path) })
  $dirFiles = @($files.Name | Where-Object { $_ -notin @('a2-index.json', 'a2-service-verification.json') })
  AddCheck 'A2-EVID-02' 'a2-index 清单与实际样本文件一一对应；base/head SHA 记录一致（A2 生成时为 3a62dce）' ($indexFiles.Count -eq 13 -and (@($indexFiles | Where-Object { $_ -notin $dirFiles }).Count -eq 0) -and (@($dirFiles | Where-Object { $_ -notin $indexFiles }).Count -eq 0) -and $index.baseSha -eq '3a62dcefa0a5ff357ae5afbb301598cd4b672d0c' -and $index.headSha -eq $index.baseSha) ([ordered]@{ indexCount = $indexFiles.Count; dirSampleCount = $dirFiles.Count; indexOnly = @($indexFiles | Where-Object { $_ -notin $dirFiles }); dirOnly = @($dirFiles | Where-Object { $_ -notin $indexFiles }); baseSha = $index.baseSha; headSha = $index.headSha; a1FixCommit = $index.a1FixCommit })

  # 12 状态样本：readback + workPacket 存在且身份/版本自洽；snapshot 标记合法
  $stateOrder = @($index.samples | Where-Object { $_.file -ne 'a2-legacy-server-without-workpacket.json' })
  $badSamples = @()
  foreach ($entry in $stateOrder) {
    $name = [System.IO.Path]::GetFileName($entry.path)
    $doc = $json[$name]
    $rb = $doc.readback
    $wp = $rb.workPacket
    if (-not $wp) { $badSamples += "${name}: missing workPacket"; continue }
    if ($wp.identity.missionVersion -ne $rb.missionVersion) { $badSamples += "${name}: identity.version != readback.missionVersion" }
    if ($wp.stopped.workState.originalRef.version -ne $rb.missionVersion) { $badSamples += "${name}: workState.originalRef.version mismatch" }
    if ($wp.next.primaryAction.requires.missionVersion -ne $rb.missionVersion) { $badSamples += "${name}: requires.missionVersion mismatch" }
    if ($wp.snapshot.mode -ne 'SINGLE_READ_TRANSACTION') { $badSamples += "${name}: snapshot.mode invalid" }
    if ($wp.snapshot.checkedAt -ne $rb.readAt) { $badSamples += "${name}: snapshot.checkedAt != readAt" }
    if ($wp.realityOutcome -ne 'NOT_INFERRED') { $badSamples += "${name}: realityOutcome" }
  }
  AddCheck 'A2-EVID-03' '12 状态样本的 workPacket 身份/版本/快照/requires/realityOutcome 内部自洽' ($badSamples.Count -eq 0) ([ordered]@{ sampleCount = $stateOrder.Count; badSamples = $badSamples })

  # 交叉核对关键状态断言（与我的独立 fixture 独立结果对照）
  $running = $json['a2-running.json'].readback
  $stop = $json['a2-stop-requested.json'].readback
  $budget = $json['a2-daily-budget-waiting.json'].readback
  $cancelled = $json['a2-cancelled.json'].readback
  $legacy = $json['a2-legacy-server-without-workpacket.json']
  $legacyRb = $legacy.readback
  AddCheck 'A2-EVID-04' '关键状态样本与独立验收结论一致：RUNNING→WAIT_FOR_OBSERVATION、停止在途→CHECK_STOP_SETTLEMENT、额度→QUEUED+DAILY_BUDGET_WAITING、取消≠成功' (
    $running.workState.phase -eq 'RUNNING' -and $running.workPacket.next.primaryAction.kind -eq 'WAIT_FOR_OBSERVATION' -and
    $stop.workState.reasonCode -eq 'STOP_REQUESTED_IN_FLIGHT' -and $stop.workPacket.next.primaryAction.kind -eq 'CHECK_STOP_SETTLEMENT' -and
    $budget.workState.phase -eq 'QUEUED' -and $budget.workState.reasonCode -eq 'DAILY_BUDGET_WAITING' -and
    $cancelled.workState.reasonCode -eq 'CANCELLED' -and $cancelled.workState.terminal.status -eq 'CANCELLED' -and $cancelled.workPacket.next.primaryAction.label -notmatch '成功'
  ) ([ordered]@{ running = [ordered]@{ phase = $running.workState.phase; primaryAction = $running.workPacket.next.primaryAction.kind }; stopRequested = [ordered]@{ reasonCode = $stop.workState.reasonCode; primaryAction = $stop.workPacket.next.primaryAction.kind; stopRequest = $stop.workState.stopRequest }; budget = [ordered]@{ phase = $budget.workState.phase; reasonCode = $budget.workState.reasonCode }; cancelled = [ordered]@{ reasonCode = $cancelled.workState.reasonCode; terminal = $cancelled.workState.terminal; primaryAction = $cancelled.workPacket.next.primaryAction.label } })

  $legacyKeys = @($legacyRb.PSObject.Properties.Name)
  $removedPaths = @($legacy.removedPaths)
  AddCheck 'A2-EVID-05' '旧服务变体：缺 workPacket/readAt/observation 时保留原详情字段，缺字段为 undefined 而非伪造成功' (
    ($legacy.variant -eq 'LEGACY_SERVER_WITHOUT_WORKPACKET') -and
    ($legacyKeys -notcontains 'workPacket') -and ($legacyKeys -notcontains 'readAt') -and ($legacyKeys -notcontains 'observation') -and
    ($legacyKeys -contains 'workState') -and ($null -ne $legacyRb.workState) -and
    ($removedPaths -contains 'workPacket') -and ($removedPaths -contains 'readAt') -and ($removedPaths -contains 'observation') -and
    ($legacyRb.realityOutcome -eq 'NOT_INFERRED')
  ) ([ordered]@{ variant = $legacy.variant; removedPaths = $removedPaths; readbackKeys = $legacyKeys; hasWorkState = ($null -ne $legacyRb.workState); realityOutcome = $legacyRb.realityOutcome })

  $serviceVerification = $json['a2-service-verification.json']
  AddCheck 'A2-EVID-06' 'a2-service-verification 记录的命令/测试数可复核（18+1=19 tests、12 files/84 regression、样本 13）' (
    @($serviceVerification.commands | Where-Object { $_.command -match 'finalAWorkPacketService' }).Count -eq 1 -and
    (@($serviceVerification.commands | Where-Object { $_.command -match 'finalAWorkPacketService' })[0].tests -eq 19) -and
    @($serviceVerification.commands | Where-Object { $_.command -match 'missionContinuation' }).Count -eq 1 -and
    (@($serviceVerification.commands | Where-Object { $_.command -match 'missionContinuation' })[0].tests -eq 84) -and
    $serviceVerification.scope.modified.Count -eq 4 -and $serviceVerification.scope.added.Count -eq 4
  ) ([ordered]@{ commands = @($serviceVerification.commands | ForEach-Object { [ordered]@{ command = $_.command; exitCode = $_.exitCode; files = $_.files; tests = $_.tests } }); modified = $serviceVerification.scope.modified; added = $serviceVerification.scope.added })

  $dirty = @(git status --porcelain --untracked-files=no -- 'evidence/final-a/20261103/samples/a2')
  AddCheck 'A2-EVID-07' 'A2 提交的样本文件在工作树中未被改写（tracked 内容与 HEAD 一致）' ($dirty.Count -eq 0) ([ordered]@{ dirtyPaths = $dirty })

  $integrity = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o'); role = 'independent-verifier'; stage = 'A2_EVIDENCE_INTEGRITY'
    headSha = $head
    summary = [ordered]@{ total = $checks.Count; pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count }
    checks = $checks
  }
  $integrity | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $v 'evidence-integrity-a2.json') -Encoding utf8
  $checks | ForEach-Object { "{0} {1}" -f $_.id, $_.verdict }
} finally { Pop-Location }

