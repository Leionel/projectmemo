# A1 独立验收：git 边界检查（只读 git，不修改工作树）
# 运行：pwsh -File evidence/final-a/20261103/verify/boundary-a1.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
Push-Location $repo
try {
  $base = '485d485378637e1da3280ed092739d441c8cf749'
  $head = '304adfee664689d67c6c836dc8f711ca0bc2e10b'
  $a1 = 'f267aec674dbb9c28f6fa79bf428816016d2bee5'
  $a1Chain = @('f267aec674dbb9c28f6fa79bf428816016d2bee5', '543162f9424659c00f3f2abdee4a43fe2189aabc', 'b243f62a2970ffc1bd070ba6c2933690c230d72f', '3a62dcefa0a5ff357ae5afbb301598cd4b672d0c', '304adfee664689d67c6c836dc8f711ca0bc2e10b')
  $allowedCodePrefixes = @('lib/mission/workState.ts', 'lib/types/workState.ts', 'lib/mission/workPacket.ts', 'lib/types/workPacket.ts', 'scripts/final-a/')
  $isAllowedCodeFile = { param($f) $f -in @('lib/mission/workState.ts', 'lib/types/workState.ts', 'lib/mission/workPacket.ts', 'lib/types/workPacket.ts') -or $f -like 'scripts/final-a/*' -or $f -like 'tests/finalA*.test.ts' }
  $checks = New-Object System.Collections.ArrayList
  function AddCheck([string]$id, [string]$q, [bool]$pass, $observed, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; verdict = $(if ($pass) { 'PASS' } else { 'FAIL' }); observed = $observed; note = $note })
  }
  $actualHead = (git rev-parse HEAD).Trim(); $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  AddCheck 'A1-BOUND-01' '当前 HEAD 等于 Lead 给定的 A1 最终 HEAD（304adfe）' ($actualHead -eq $head) ([ordered]@{ expected = $head; actual = $actualHead; branch = $branch; baseSha = $base; a1CommitChain = $a1Chain })

  $rangeFiles = @(git diff --name-only "$base..$head")
  $codeFiles = @($rangeFiles | Where-Object { $_ -notmatch '^evidence/' })
  $outsideAllowed = @($codeFiles | Where-Object { -not (& $isAllowedCodeFile $_) })
  AddCheck 'A1-BOUND-02' 'A1 提交范围（485d485..304adfe）的代码文件全部在 A1 合同/探针/测试清单内' ($outsideAllowed.Count -eq 0) ([ordered]@{ a1CommitChain = $a1Chain; codeFiles = $codeFiles; outsideAllowed = $outsideAllowed; evidenceFilesCount = @($rangeFiles | Where-Object { $_ -match '^evidence/' }).Count })

  $prismaFiles = @(git diff --name-only "$base..$head" -- prisma)
  $schemaShaHead = (git rev-parse "$head`:prisma/schema.prisma").Trim()
  $schemaShaBase = (git rev-parse "$base`:prisma/schema.prisma").Trim()
  AddCheck 'A1-BOUND-03' '无 prisma/schema.prisma 或 prisma/migrations 变更' ($prismaFiles.Count -eq 0 -and $schemaShaHead -eq $schemaShaBase) ([ordered]@{ prismaChangedFiles = $prismaFiles; schemaShaBase = $schemaShaBase; schemaShaHead = $schemaShaHead })

  $clientFiles = @(git diff --name-only "$base..$head" -- app components harmonyos public next.config.ts package.json package-lock.json)
  AddCheck 'A1-BOUND-04' '无 app/components/harmonyos/官网布局或依赖改动' ($clientFiles.Count -eq 0) ([ordered]@{ changed = $clientFiles })

  $newFiles = @(git diff --name-status "$base..$head" | Where-Object { $_ -match '^A\s' } | ForEach-Object { ($_ -split "`t")[1] })
  $suspiciousNew = @($newFiles | Where-Object { $_ -match '(runner|planner)' -and $_ -notmatch '^evidence/' })
  $modelAdds = @(git diff "$base..$head" -- prisma | Select-String -Pattern '^\+\s*model\s+\w+' | ForEach-Object { $_.Line })
  $prodScope = @('lib', 'app', 'components', 'harmonyos')
  $baseClientSites = @(git grep -n "new PrismaClient" $base -- $prodScope 2>$null)
  $headClientSites = @(git grep -n "new PrismaClient" $head -- $prodScope 2>$null)
  $probeClientAdds = @(git diff "$base..$head" | Select-String -Pattern '^\+.*new PrismaClient' | ForEach-Object { $_.Line.Trim() })
  AddCheck 'A1-BOUND-05' '产品代码无新状态表/Runner/Planner/新 PrismaClient；探针脚本内第二连接属 task-2 明确要求' ($suspiciousNew.Count -eq 0 -and $modelAdds.Count -eq 0 -and $headClientSites.Count -eq $baseClientSites.Count) ([ordered]@{ suspiciousNewFiles = $suspiciousNew; modelAdds = $modelAdds; prodPrismaClientSitesBase = $baseClientSites.Count; prodPrismaClientSitesHead = $headClientSites.Count; allowedProbeSecondConnections = $probeClientAdds }) 'scripts/final-a/probe-fs-a07-concurrency.ts 的第二个 PrismaClient 只连临时库，是 task-2 验收要求的真实并发证据，不算产品新执行器。'

  $added = @(git diff "$base..$head" | Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+' })
  $secretPatterns = 'BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]|passwd|secret\s*[:=]|token\s*[:=]|api[_-]?key|p7b|p12|jks|keystore'
  $secretHits = @($added | Select-String -Pattern $secretPatterns -CaseSensitive:$false | ForEach-Object { $_.Line.Trim() })
  $secretHits = @($secretHits | ForEach-Object { if ($_.Length -gt 160) { $_.Substring(0, 160) } else { $_ } })
  $realSecret = @($secretHits | Where-Object { $_ -match 'PRIVATE KEY|p7b|p12|jks|keystore' })
  $binaryExt = @(git diff --name-status "$base..$head" | ForEach-Object { ($_ -split "`t")[-1] } | Where-Object { $_ -match '\.(p12|p7b|pem|key|jks|keystore|hap|db|sqlite)$' })
  AddCheck 'A1-BOUND-06' '无密钥/签名/证书/真实库文件进入 A1 提交' ($binaryExt.Count -eq 0 -and $realSecret.Count -eq 0) ([ordered]@{ binaryOrSecretFiles = $binaryExt; patternHitCount = $secretHits.Count; patternHitSamples = $secretHits })

  $docsFiles = @(git diff --name-only "$base..$head" -- docs)
  $docsTracked = @(git ls-files docs).Count
  $planningTracked = @(git ls-files 'docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划').Count
  AddCheck 'A1-BOUND-07' 'docs 未被误加入 git（A1 范围无 docs；tracked docs 数量=基线 41）' ($docsFiles.Count -eq 0 -and $docsTracked -eq 41 -and $planningTracked -eq 0) ([ordered]@{ docsChangedInA1 = $docsFiles; trackedDocsCount = $docsTracked; planningDocsTracked = $planningTracked })

  $wtStatus = @(git status --porcelain)
  $wtA2 = @($wtStatus | Where-Object { $_ -match 'lib/mission/(materialUseProjection|readback|missionService|workspaceSummary)\.ts|tests/finalA(WorkPacketService|ConcurrencyService)\.test\.ts|scripts/final-a/generate-samples\.ts|evidence/final-a/20261103/samples/a2/' })
  AddCheck 'A1-BOUND-08' '工作树内 A2 未提交改动被识别并与 A1 提交范围区分（不记作 A1 越界）' ($wtA2.Count -gt 0) ([ordered]@{ worktreeStatus = $wtStatus; a2InFlightFiles = $wtA2 })

  $boundary = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o'); role = 'independent-verifier'; stage = 'A1_BOUNDARY'
    headSha = $actualHead; baseSha = $base; a1CodeCommit = $a1
    summary = [ordered]@{ total = $checks.Count; pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count }
    checks = $checks
  }
  $boundary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $v 'boundary-a1.json') -Encoding utf8
  $boundary.checks | ForEach-Object { "{0} {1}" -f $_.id, $_.verdict }
  Write-Host ("written: " + (Join-Path $v 'boundary-a1.json'))
} finally { Pop-Location }

