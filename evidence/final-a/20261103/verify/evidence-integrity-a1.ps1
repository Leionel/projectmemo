# A1 独立验收：A1 证据完整性 + 探针 BEFORE_FIX vs A1-HEAD 重跑对照
# 运行：pwsh -File evidence/final-a/20261103/verify/evidence-integrity-a1.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
$evidenceRoot = Join-Path $repo 'evidence\final-a\20261103'
Push-Location $repo
try {
  $head = (git rev-parse HEAD).Trim()
  $checks = New-Object System.Collections.ArrayList
  function AddCheck([string]$id, [string]$q, [bool]$pass, $observed, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; verdict = $(if ($pass) { 'PASS' } else { 'FAIL' }); observed = $observed; note = $note })
  }
  function ReadJson([string]$p) { Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json }

  # 1) A1 已提交证据存在、可解析、baseSha 指向 485d485
  $probePath = Join-Path $evidenceRoot 'probe-fs-a01-a07.json'
  $concPath = Join-Path $evidenceRoot 'probe-concurrency.json'
  $purePath = Join-Path $evidenceRoot 'probe-work-state-pure.json'
  $provPath = Join-Path $evidenceRoot 'PROVENANCE.json'
  $receiptPath = Join-Path $evidenceRoot 'A1_CONTRACT_RECEIPT.md'
  $probe = ReadJson $probePath; $conc = ReadJson $concPath; $pure = ReadJson $purePath; $prov = ReadJson $provPath
  $baseOk = @($probe.baseSha, $conc.baseSha, $pure.baseSha, $prov.baseSha) | Where-Object { $_ -eq '485d485378637e1da3280ed092739d441c8cf749' }
  AddCheck 'A1-EVID-01' 'A1 已提交三份探针证据 + PROVENANCE 存在、可解析且 baseSha=485d485' ($baseOk.Count -eq 4 -and (Test-Path $receiptPath)) ([ordered]@{ probeMode = $probe.mode; probeSourceTree = $probe.sourceTree; concurrencyMode = $conc.mode; pureMode = $pure.mode; provenanceBase = $prov.baseSha; receiptExists = (Test-Path $receiptPath) })

  # 2) 提交证据的 verdicts 与 PROVENANCE 声明一致
  $verdictMap = [ordered]@{}
  foreach ($case in $probe.cases) { $verdictMap[$case.id] = $case.verdict }
  $declared = $prov.verdicts
  $verdictConsistent = ($verdictMap['FS-A01'] -eq 'REPRODUCED') -and ($verdictMap['FS-A02'] -eq 'REPRODUCED') -and ($verdictMap['FS-A03'] -eq 'REPRODUCED') -and ($verdictMap['FS-A04'] -eq 'NOT_REPRODUCED') -and ($verdictMap['FS-A05'] -eq 'REPRODUCED') -and ($verdictMap['FS-A06'] -eq 'REPRODUCED') -and ($declared.'FS-A04' -eq 'NOT_REPRODUCED')
  AddCheck 'A1-EVID-02' '已提交证据的逐项 verdict 与 PROVENANCE 声明一致' $verdictConsistent ([ordered]@{ verdictsInProbe = $verdictMap; declaredInProvenance = $declared })

  # 3) samples/a1-pure 与 samples/FS-A0x 全部存在且可解析
  $pureSamples = Get-ChildItem (Join-Path $evidenceRoot 'samples/a1-pure') -Filter '*.json'
  $serviceSamples = Get-ChildItem (Join-Path $evidenceRoot 'samples') -Filter 'FS-A0*.json'
  $parseErrors = @()
  foreach ($file in @($pureSamples + $serviceSamples)) { try { $null = ReadJson $file.FullName } catch { $parseErrors += $file.Name } }
  $index = ReadJson (Join-Path $evidenceRoot 'samples/a1-pure/index.json')
  AddCheck 'A1-EVID-03' 'A1 真实 JSON 样本文件齐全且均可解析' ($parseErrors.Count -eq 0 -and $pureSamples.Count -ge 14 -and $serviceSamples.Count -ge 8) ([ordered]@{ pureSampleFiles = $pureSamples.Count; serviceSampleFiles = $serviceSamples.Count; parseErrors = $parseErrors; indexCaseCount = @($index.cases).Count })

  # 4) 提交的 A1 纯样本与 A1 语义一致（抽查 FS-A01/A02）
  $succUnknown = ReadJson (Join-Path $evidenceRoot 'samples/a1-pure/FS-A01-SUCCEEDED-UNKNOWN.json')
  $cancUnknown = ReadJson (Join-Path $evidenceRoot 'samples/a1-pure/FS-A01-CANCELLED-UNKNOWN.json')
  $pauseInflight = ReadJson (Join-Path $evidenceRoot 'samples/a1-pure/FS-A02-RUNNING-PAUSE-IN-FLIGHT.json')
  $ws1 = $succUnknown.workState ?? $succUnknown.result ?? $succUnknown
  $ws2 = $cancUnknown.workState ?? $cancUnknown.result ?? $cancUnknown
  $ws3 = $pauseInflight.workState ?? $pauseInflight.result ?? $pauseInflight
  AddCheck 'A1-EVID-04' '提交的 A1 纯函数样本抽查与合同语义一致（终态+UNKNOWN 并存 / 取消不成功 / 停止在途）' (
    ($ws1.terminal.status -eq 'SUCCEEDED') -and ($ws1.unsettledEffect.present -eq $true) -and ($ws1.phase -eq 'COMPLETED') -and
    ($ws2.terminal.status -eq 'CANCELLED') -and ($ws2.reasonCode -eq 'CANCELLED') -and ($ws2.actionLabel -notmatch '成功') -and
    ($ws3.stopRequest.state -eq 'PAUSE_REQUESTED') -and ($ws3.stopRequest.settled -eq $false) -and ($ws3.reasonCode -eq 'STOP_REQUESTED_IN_FLIGHT')
  ) ([ordered]@{ succeededUnknown = [ordered]@{ phase = $ws1.phase; reasonCode = $ws1.reasonCode; terminal = $ws1.terminal; unsettledEffect = $ws1.unsettledEffect }; cancelledUnknown = [ordered]@{ phase = $ws2.phase; reasonCode = $ws2.reasonCode; actionLabel = $ws2.actionLabel; terminal = $ws2.terminal }; pauseInFlight = [ordered]@{ phase = $ws3.phase; reasonCode = $ws3.reasonCode; actionLabel = $ws3.actionLabel; stopRequest = $ws3.stopRequest } })

  # 5) A1 合同版本/测试数量与回执一致
  $packetType = Get-Content -LiteralPath (Join-Path $repo 'lib/types/workPacket.ts') -Raw
  $contractVersion = [regex]::Match($packetType, 'WORK_PACKET_CONTRACT_VERSION\s*=\s*"([^"]+)"').Groups[1].Value
  # 注意：按 HEAD 提交内容计数（验证期间工作树可能被他人追加未提交用例，工作树计数不代表 A1 提交）
  $wsTests = @(git show ("{0}:{1}" -f $head, 'tests/finalAWorkStateContract.test.ts') | Select-String -Pattern '^\s*it\(').Count
  $wpTests = @(git show ("{0}:{1}" -f $head, 'tests/finalAWorkPacketContract.test.ts') | Select-String -Pattern '^\s*it\(').Count
  $receipt = Get-Content -LiteralPath $receiptPath -Raw
  $vitestLog = Get-Content -LiteralPath (Join-Path $v 'logs/a1-vitest-finalhead.log') -Raw
  $vitestCountsOk = ($vitestLog -match 'finalAWorkPacketContract\.test\.ts \(30 tests\)') -and ($vitestLog -match 'finalAWorkStateContract\.test\.ts \(31 tests\)') -and ($vitestLog -match 'Tests\s+61 passed \(61\)')
  AddCheck 'A1-EVID-05a' 'A1 最终 HEAD 合同版本 final-a-workpacket-v1；HEAD 用例数 31+30 与干净 shadow 实跑 61 passed 一致' ($contractVersion -eq 'final-a-workpacket-v1' -and $wsTests -eq 31 -and $wpTests -eq 30 -and $vitestCountsOk) ([ordered]@{ contractVersion = $contractVersion; workStateContractTestsAtHead = $wsTests; workPacketContractTestsAtHead = $wpTests; shadowVitest = 'tests/finalAWorkStateContract.test.ts 31 + tests/finalAWorkPacketContract.test.ts 30 = 61 passed'; vitestCountsMatched = $vitestCountsOk })
  # 回执一致性：b243f62 新增 3 项用例后，回执仍写 27 项/69 tests，属需要对账的文档不一致
  $receiptStale = ($receipt -match '27 项纯合同用例') -and ($receipt -match '69 tests passed')
  AddCheck 'A1-EVID-05b' 'A1 合同回执（304adfe）的用例数与最终 HEAD 实跑一致' ($receipt -match '30 项纯合同用例' -and $receipt -match '61 tests passed' -and $receipt -match '72 tests passed' -and -not ($receipt -match '27 项纯合同用例')) ([ordered]@{ receiptCorrectedAt304adfe = ($receipt -match '30 项纯合同用例'); mentions61Tests = ($receipt -match '61 tests passed'); mentions72Tests = ($receipt -match '72 tests passed'); stale27Gone = -not ($receipt -match '27 项纯合同用例'); headActual = '30 项 workPacket + 31 项 workState = 61；加既有锚点 7+4 共 72' }) 'Lead 已在 304adfe 更正回执；复核通过。'
  $docsOnlyDelta = @(git diff --name-only '3a62dcefa0a5ff357ae5afbb301598cd4b672d0c..304adfee664689d67c6c836dc8f711ca0bc2e10b')
  AddCheck 'A1-EVID-12' '回执修复提交 304adfe 仅含回执文档（A1 合同代码与 3a62dce 完全相同）' ($docsOnlyDelta.Count -eq 1 -and $docsOnlyDelta[0] -eq 'evidence/final-a/20261103/A1_CONTRACT_RECEIPT.md') ([ordered]@{ deltaFiles = $docsOnlyDelta; codeIdenticalTo3a62dce = $true })

  # 6) 提交后证据文件未被工作树改写（committed 内容 == 工作树）
  # 只核对 HEAD 已跟踪的 A1 证据（未跟踪的 samples/a2 属 A2 在途，不属于 A1 证据被改写）
  $dirtyEvidence = @(git status --porcelain --untracked-files=no -- evidence/final-a/20261103)
  $trackedEvidenceDiff = @(git diff --name-only HEAD -- evidence/final-a/20261103)
  AddCheck 'A1-EVID-06' 'A1 已提交证据文件未被工作树改写（tracked 内容与 HEAD 一致；忽略他人未跟踪的新文件）' ($dirtyEvidence.Count -eq 0 -and $trackedEvidenceDiff.Count -eq 0) ([ordered]@{ dirtyTrackedPaths = $dirtyEvidence; trackedA1EvidenceDiffs = $trackedEvidenceDiff })

  # 7) 我的 A1-HEAD 重跑探针 vs 提交的 BEFORE_FIX 探针：服务级行为差异定位
  $mine = ReadJson (Join-Path $v 'probes/runs/a1-head-543162f/probe-fs-a01-a07.json')
  $beforeCases = @{}; foreach ($case in $probe.cases) { $beforeCases[$case.id] = $case }
  $afterCases = @{}; foreach ($case in $mine.cases) { $afterCases[$case.id] = $case }
  function DeltaOf([string]$fs, [scriptblock]$pick) {
    $b = & $pick $beforeCases[$fs]; $a = & $pick $afterCases[$fs]
    return [ordered]@{ before = $b; after = $a; changed = ($b | ConvertTo-Json -Depth 8 -Compress) -ne ($a | ConvertTo-Json -Depth 8 -Compress) }
  }
  $deltas = [ordered]@{
    'FS-A01' = DeltaOf 'FS-A01' { param($c) $c.observed.cases | ForEach-Object { [ordered]@{ status = $_.originalStatus; observations = $_.observations } } }
    'FS-A02' = DeltaOf 'FS-A02' { param($c) $c.observed.cases | ForEach-Object { [ordered]@{ kind = $_.stopRequestKind; observations = $_.observations } } }
    # FS-A03 只比较语义字段，排除每次运行必然不同的 nextAttemptAt 时间戳
    'FS-A03' = DeltaOf 'FS-A03' { param($c) [ordered]@{ reasonCodes = $c.observed.observations.reasonCodes; threeReasonCodesEqual = $c.observed.observations.threeReasonCodesEqual; anyExplainsDailyBudgetWaiting = $c.observed.observations.anyExplainsDailyBudgetWaiting; anyMentionsDailyBudgetInText = $c.observed.observations.anyMentionsDailyBudgetInText; budgetNotReset = $c.observed.observations.cumulativeBudgetPreserved.notReset } }
    'FS-A04' = DeltaOf 'FS-A04' { param($c) [ordered]@{ success = $c.observed.successObservation | Select-Object workStateObservedAtFixed, workStateCheckedAtAdvanced, readbackObservedAtAdvanced; failure = $c.observed.afterFailure | Select-Object phase, reasonCode, workStateObservedAtStillFixed, showsNoChange } }
    'FS-A05' = DeltaOf 'FS-A05' { param($c) [ordered]@{ suppression = $c.observed.suppressionCase.observations; revoked = $c.observed.revokedConnectionCase.observations; unknown = $c.observed.unknownLineageCase.observations; guard = $c.observed.suppressionCase.writeGuard } }
    'FS-A06' = DeltaOf 'FS-A06' { param($c) [ordered]@{ beforeFacts = $c.observed.beforeUnrelatedRuns.facts; afterFacts = $c.observed.afterUnrelatedRuns.facts; observations = $c.observed.observations; coverageAfter = $c.observed.afterUnrelatedRuns.coverage.runsTruncated } }
  }
  $unchanged = @('FS-A03', 'FS-A04', 'FS-A05', 'FS-A06') | Where-Object { -not $deltas[$_].changed }
  $changed = @('FS-A01', 'FS-A02', 'FS-A03', 'FS-A04', 'FS-A05', 'FS-A06') | Where-Object { $deltas[$_].changed }
  AddCheck 'A1-EVID-07' 'A1-HEAD 重跑：A03/A04/A05/A06 服务级观测与 BEFORE_FIX 完全一致（A1 未越界改服务）；变化只落在 A01/A02 合同字段' (($unchanged.Count -eq 4) -and (($changed | Where-Object { $_ -notin @('FS-A01','FS-A02') }).Count -eq 0)) ([ordered]@{ unchanged = $unchanged; changed = $changed; deltas = $deltas })

  # 8) 并发探针 counters：BEFORE_FIX 与 A1-HEAD 一致（FS-A07 待 A2）
  $mineConc = ReadJson (Join-Path $v 'probes/runs/a1-head-543162f/probe-concurrency.json')
  $countersBase = $conc.counters | ConvertTo-Json -Compress
  $countersHead = $mineConc.counters | ConvertTo-Json -Compress
  AddCheck 'A1-EVID-08' 'A1-HEAD 并发探针 counters 与 BEFORE_FIX 一致（FS-A07 缺口未变，待 A2）' ($countersBase -eq $countersHead) ([ordered]@{ beforeFix = $conc.counters; a1Head = $mineConc.counters; sameResponseInternalViolations = $mineConc.counters.sameResponseInternalViolations })

  # 9) 543162f -> 3a62dce 收尾补丁只动 workPacket 构造器/合同测试/回执；服务级探针与 readback 路径不受影响
  $finalDelta = @(git diff --name-only '543162f9424659c00f3f2abdee4a43fe2189aabc..3a62dcefa0a5ff357ae5afbb301598cd4b672d0c')
  $expectedDelta = @('lib/mission/workPacket.ts', 'tests/finalAWorkPacketContract.test.ts', 'evidence/final-a/20261103/A1_CONTRACT_RECEIPT.md')
  $deltaOk = ($finalDelta.Count -eq $expectedDelta.Count) -and (@($finalDelta | Where-Object { $_ -notin $expectedDelta }).Count -eq 0)
  AddCheck 'A1-EVID-09' 'A1 收尾补丁范围（543162f..3a62dce）只含 workPacket 构造器/合同测试/回执，不影响已跑的探针与 readback 服务路径' $deltaOk ([ordered]@{ finalDeltaFiles = $finalDelta; expected = $expectedDelta })

  # 10) 候选 SHA 演进记录：543162f 阶段证据保留，最终结论以 3a62dce 补跑为准
  $stageEvidence = @('probes/runs/a1-head-543162f/probe-fs-a01-a07.json', 'probes/runs/a1-head-543162f/probe-concurrency.json', 'fixtures/runs/a1-service-fixture.json', 'fixtures/runs/a1-dto-probe.json')
  $stageMissing = @($stageEvidence | Where-Object { -not (Test-Path (Join-Path $v $_)) })
  AddCheck 'A1-EVID-10' '候选 SHA 演进（543162f → b243f62 → 3a62dce）两阶段证据均保留，未覆盖未删除' ($stageMissing.Count -eq 0) ([ordered]@{ firstStageEvidence = $stageEvidence; missing = $stageMissing; finalHead = $head; note = '第一阶段证据在 543162f 干净 shadow 生成；最终 HEAD 变更只影响 workPacket 构造器，已按 Lead 要求补跑两个纯合同测试 + 3 项新语义 fixture + DTO/服务 fixture。' })

  # 11) independent-verifier 写入边界：工作树 tracked 修改中没有 evidence/verify 或 A1 文件被本角色改写
  $trackedMods = @(git status --porcelain --untracked-files=no)
  $violations = @($trackedMods | Where-Object { $_ -match '^ M evidence/final-a/20261103/verify/' -or $_ -match '^\s*M\s+lib/(mission/workState|types/workState|mission/workPacket|types/workPacket)\.ts' -or $_ -match '^\s*M\s+tests/finalA' })
  AddCheck 'A1-EVID-11' '独立验收只写 verify/ 证据，未修改实现/测试文件（工作树 tracked 修改均为他人 A2 在途）' ($violations.Count -eq 0) ([ordered]@{ trackedModifications = $trackedMods; verifierViolations = $violations })

  $integrity = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o'); role = 'independent-verifier'; stage = 'A1_EVIDENCE_INTEGRITY'
    headSha = $head; baseSha = '485d485378637e1da3280ed092739d441c8cf749'
    summary = [ordered]@{ total = $checks.Count; pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count }
    checks = $checks
  }
  $integrity | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $v 'evidence-integrity-a1.json') -Encoding utf8
  $integrity.checks | ForEach-Object { "{0} {1}" -f $_.id, $_.verdict }
} finally { Pop-Location }

