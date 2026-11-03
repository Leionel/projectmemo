# A2 独立验收：git 边界检查（只读 git，不修改工作树）
# 运行：pwsh -File evidence/final-a/20261103/verify/boundary-a2.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
Push-Location $repo
try {
  $base = '304adfee664689d67c6c836dc8f711ca0bc2e10b'   # A1 最终 HEAD
  $head = 'd42831468de0595304382a6021b1171a3cdd6f60'   # A2 提交
  $checks = New-Object System.Collections.ArrayList
  function AddCheck([string]$id, [string]$q, [bool]$pass, $observed, [string]$note = '') {
    $null = $checks.Add([pscustomobject]@{ id = $id; question = $q; verdict = $(if ($pass) { 'PASS' } else { 'FAIL' }); observed = $observed; note = $note })
  }
  $actualHead = (git rev-parse HEAD).Trim()
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  AddCheck 'A2-BOUND-01' '当前 HEAD 等于 Lead 给定的 A2 提交 d428314' ($actualHead -eq $head) ([ordered]@{ expected = $head; actual = $actualHead; branch = $branch; a1FinalHead = $base })

  $rangeFiles = @(git diff --name-only "$base..$head")
  $allowed = @(
    'lib/mission/readback.ts', 'lib/mission/materialUseProjection.ts', 'lib/mission/missionService.ts', 'lib/mission/workspaceSummary.ts',
    'tests/finalAWorkPacketService.test.ts', 'tests/finalAConcurrencyService.test.ts', 'scripts/final-a/generate-samples.ts'
  )
  $outside = @($rangeFiles | Where-Object { $_ -notin $allowed -and $_ -notmatch '^evidence/final-a/20261103/samples/a2/' })
  AddCheck 'A2-BOUND-02' 'A2 提交范围（304adfe..d428314）文件全部在 A2 声明清单内（4 lib + 2 tests + 1 script + samples/a2）' ($outside.Count -eq 0) ([ordered]@{ changedFiles = $rangeFiles; outsideAllowed = $outside })

  $prismaFiles = @(git diff --name-only "$base..$head" -- prisma)
  $schemaShaBase = (git rev-parse "$base`:prisma/schema.prisma").Trim()
  $schemaShaHead = (git rev-parse "$head`:prisma/schema.prisma").Trim()
  $migrations = @(git ls-tree -r --name-only $head -- prisma/migrations).Count
  AddCheck 'A2-BOUND-03' 'A2 无 prisma/schema 或 migrations 变更（schema SHA 相同、迁移目录数 51）' ($prismaFiles.Count -eq 0 -and $schemaShaBase -eq $schemaShaHead -and $migrations -eq 52) ([ordered]@{ prismaChangedFiles = $prismaFiles; schemaShaBase = $schemaShaBase; schemaShaHead = $schemaShaHead; migrationFilesIncludingLock = $migrations })

  $clientFiles = @(git diff --name-only "$base..$head" -- app components harmonyos public next.config.ts package.json package-lock.json)
  AddCheck 'A2-BOUND-04' 'A2 无 app/components/harmonyos/官网布局或依赖改动' ($clientFiles.Count -eq 0) ([ordered]@{ changed = $clientFiles })

  $newFiles = @(git diff --name-status "$base..$head" | Where-Object { $_ -match '^A\s' } | ForEach-Object { ($_ -split "`t")[1] })
  $suspiciousNew = @($newFiles | Where-Object { $_ -match '(runner|planner)' -and $_ -notmatch '^evidence/' })
  $modelAdds = @(git diff "$base..$head" -- prisma | Select-String -Pattern '^\+\s*model\s+\w+' | ForEach-Object { $_.Line })
  $prodScope = @('lib', 'app', 'components', 'harmonyos')
  $prodClientBase = @(git grep -n "new PrismaClient" $base -- $prodScope 2>$null).Count
  $prodClientHead = @(git grep -n "new PrismaClient" $head -- $prodScope 2>$null).Count
  AddCheck 'A2-BOUND-05' 'A2 无新状态表/Runner/Planner/产品代码新 PrismaClient' ($suspiciousNew.Count -eq 0 -and $modelAdds.Count -eq 0 -and $prodClientBase -eq $prodClientHead) ([ordered]@{ suspiciousNewFiles = $suspiciousNew; modelAdds = $modelAdds; prodPrismaClientSitesBase = $prodClientBase; prodPrismaClientSitesHead = $prodClientHead })

  $added = @(git diff "$base..$head" | Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+' })
  $secretPatterns = 'BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]|passwd|secret\s*[:=]|token\s*[:=]|api[_-]?key|p7b|p12|jks|keystore'
  $secretHits = @($added | Select-String -Pattern $secretPatterns -CaseSensitive:$false | ForEach-Object { $_.Line.Trim() })
  $secretHits = @($secretHits | ForEach-Object { if ($_.Length -gt 160) { $_.Substring(0, 160) } else { $_ } })
  $realSecret = @($secretHits | Where-Object { $_ -match 'PRIVATE KEY|p7b|p12|jks|keystore' })
  $binaryExt = @(git diff --name-status "$base..$head" | ForEach-Object { ($_ -split "`t")[-1] } | Where-Object { $_ -match '\.(p12|p7b|pem|key|jks|keystore|hap|db|sqlite)$' })
  AddCheck 'A2-BOUND-06' 'A2 无密钥/签名/证书/真实库文件进入提交' ($binaryExt.Count -eq 0 -and $realSecret.Count -eq 0) ([ordered]@{ binaryOrSecretFiles = $binaryExt; patternHitCount = $secretHits.Count; patternHitSamples = $secretHits })

  $docsFiles = @(git diff --name-only "$base..$head" -- docs)
  $docsTracked = @(git ls-files docs).Count
  AddCheck 'A2-BOUND-07' 'A2 范围未改动/未加入 docs（tracked docs 保持 41）' ($docsFiles.Count -eq 0 -and $docsTracked -eq 41) ([ordered]@{ docsChanged = $docsFiles; trackedDocsCount = $docsTracked })

  $trackedMods = @(git status --porcelain --untracked-files=no)
  AddCheck 'A2-BOUND-08' 'A2 提交后工作树无 tracked 修改（A2 已提交、无残留未提交产品改动）' ($trackedMods.Count -eq 0) ([ordered]@{ trackedModifications = $trackedMods })

  $boundary = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o'); role = 'independent-verifier'; stage = 'A2_BOUNDARY'
    headSha = $actualHead; a1FinalHead = $base
    summary = [ordered]@{ total = $checks.Count; pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count; fail = @($checks | Where-Object { $_.verdict -eq 'FAIL' }).Count }
    checks = $checks
  }
  $boundary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $v 'boundary-a2.json') -Encoding utf8
  $checks | ForEach-Object { "{0} {1}" -f $_.id, $_.verdict }
} finally { Pop-Location }
