# POST 独立验收：git 边界 / 密钥 / docs 扫描（A 第二批交付）
# 运行示例：
#   pwsh -File evidence/final-a/20261103/post-checkpoint/verify/git-boundary.ps1 `
#     -Repo D:\Projects\hongmen-final-a-mission-packet `
#     -Checkpoint 4b696141435825a3582816e8e449c0e0cf013f29 `
#     -FinalSha <最终验收 SHA> `
#     -Out evidence/final-a/20261103/post-checkpoint/verify/post-runs/git-boundary.json
# 只读 git（diff/log/ls-files/show），不修改工作树、不 add/commit。
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Checkpoint,
  [Parameter(Mandatory = $true)][string]$FinalSha,
  [Parameter(Mandatory = $true)][string]$Out,
  [switch]$SkipHeadCheck
)
$ErrorActionPreference = 'Stop'
function Invoke-Git([string[]]$GitArgs) { & git.exe -C $Repo @GitArgs }
$checks = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$id, [string]$question, [bool]$pass, $observed, [string]$note = '') {
  $checks.Add([ordered]@{ id = $id; question = $question; verdict = if ($pass) { 'PASS' } else { 'FAIL' }; observed = $observed; note = $note })
}

$head = (& git.exe -C $Repo rev-parse HEAD).Trim()
$branch = (& git.exe -C $Repo branch --show-current).Trim()
$ancestor = & git.exe -C $Repo merge-base --is-ancestor $Checkpoint $FinalSha; $isAncestor = ($LASTEXITCODE -eq 0)
$finalIsHead = ($FinalSha -eq $head)
$commitList = @((& git.exe -C $Repo rev-list --reverse "$Checkpoint..$FinalSha") | Where-Object { $_ })
$changed = @((& git.exe -C $Repo diff --name-status $Checkpoint $FinalSha) | Where-Object { $_ })
$changedPaths = @($changed | ForEach-Object { ($_ -split "`t")[1] } | Where-Object { $_ })

$forbiddenPrefixes = @('prisma/', 'app/', 'components/', 'harmonyos/', 'docs/', 'public/', 'deploy/', 'e2e/', 'prototypes/')
$forbiddenHits = @($changedPaths | Where-Object { $p = $_; $forbiddenPrefixes | Where-Object { $p.StartsWith($_) } })
$docsTracked = @((& git.exe -C $Repo ls-files docs) | Where-Object { $_ })
$docsInCommits = @((& git.exe -C $Repo log --name-only --format= "$Checkpoint..$FinalSha" -- docs) | Where-Object { $_ })
$schemaChanges = @($changedPaths | Where-Object { $_ -match '(^|/)(schema\.prisma|migrations/)' })
$runnerPlannerFiles = @($changedPaths | Where-Object { $_ -match '(?i)(runner|planner)' })

$diffText = (& git.exe -C $Repo diff $Checkpoint $FinalSha) -join "`n"
$addedLines = @((& git.exe -C $Repo diff $Checkpoint $FinalSha) | Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+' })
$secretPatterns = [ordered]@{
  private_key = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  openai_sk = 'sk-[A-Za-z0-9_-]{20,}'
  aws_akia = 'AKIA[0-9A-Z]{16}'
  github_token = 'gh[pousr]_[A-Za-z0-9]{20,}'
  slack_token = 'xox[baprs]-[A-Za-z0-9-]{10,}'
  bearer_hardcode = '(?i)authorization\s*:\s*["'']Bearer\s+[A-Za-z0-9._-]{20,}'
  env_secret_assign = '(?i)(API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*["''][^"'']{12,}["'']'
}
$secretHits = @()
foreach ($k in $secretPatterns.Keys) {
  $hits = @($addedLines | Select-String -Pattern $secretPatterns[$k] -AllMatches | ForEach-Object { $_.Line.Trim().Substring(0, [Math]::Min(160, $_.Line.Trim().Length)) })
  if ($hits.Count -gt 0) { $secretHits += [ordered]@{ pattern = $k; hits = $hits } }
}
$envFiles = @($changedPaths | Where-Object { $_ -match '(^|/)\.env($|\.)' -or $_ -match 'signing|\.p12$|\.jks$|\.keystore$' })

$newTables = @($addedLines | Select-String -Pattern '(?i)CREATE TABLE|model\s+[A-Za-z_]+\s*\{' -AllMatches | ForEach-Object { $_.Line.Trim() })
$newExecutors = @($addedLines | Select-String -Pattern '(?i)setInterval|new Worker\(|class\s+\w*(Runner|Planner)|startWorkerLoop|plannerLoop' -AllMatches | ForEach-Object { $_.Line.Trim().Substring(0, [Math]::Min(160, $_.Line.Trim().Length)) })

Add-Check 'GIT-01' 'FinalSha 是固定检查点 4b69614 的后代' $isAncestor ([ordered]@{ checkpoint = $Checkpoint; finalSha = $FinalSha; isAncestor = $isAncestor })
if (-not $SkipHeadCheck) { Add-Check 'GIT-02' '最终验收 SHA 等于当前 HEAD（验收对象与工作树一致）' $finalIsHead ([ordered]@{ head = $head; finalSha = $FinalSha }) } ([ordered]@{ head = $head; finalSha = $FinalSha })
Add-Check 'GIT-03' '提交区间不含 schema.prisma / prisma/migrations' ($schemaChanges.Count -eq 0) ([ordered]@{ schemaChanges = $schemaChanges; prismaFiles = @($changedPaths | Where-Object { $_ -match '^prisma/' }) })
Add-Check 'GIT-04' '提交区间不含 app/ components/ harmonyos/ public/ deploy/ e2e/ 等 UI/官网/客户端文件' ($forbiddenHits.Count -eq 0) ([ordered]@{ forbiddenPrefixes = $forbiddenPrefixes; hits = $forbiddenHits })
$planningPath = "docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划"
& git.exe -C $Repo check-ignore -q $planningPath | Out-Null
$planningIgnored = ($LASTEXITCODE -eq 0)
$planningTracked = @((& git.exe -C $Repo ls-files $planningPath) | Where-Object { $_ }).Count
Add-Check 'GIT-05' '规划 docs（docs/FINAL/...）未入 git：不在提交区间、未被跟踪且被 gitignore；仓库既有 docs/ 本次未变' ($docsInCommits.Count -eq 0 -and $planningTracked -eq 0 -and $planningIgnored) ([ordered]@{ docsInCommits = $docsInCommits.Count; planningTracked = $planningTracked; planningIgnored = $planningIgnored; trackedDocsElsewhere = $docsTracked.Count })
Add-Check 'GIT-06' '提交区间不含 .env / 签名私钥 / keystore 等敏感文件' ($envFiles.Count -eq 0) ([ordered]@{ envFiles = $envFiles })
Add-Check 'GIT-07' '新增行未发现密钥模式（7 类模式扫描）' ($secretHits.Count -eq 0) ([ordered]@{ patterns = @($secretPatterns.Keys); hits = $secretHits })
Add-Check 'GIT-08' '新增行未新增数据表（model/CREATE TABLE）' ($newTables.Count -eq 0) ([ordered]@{ hits = $newTables })
Add-Check 'GIT-09' '新增行未引入 Runner/Planner/后台循环执行器' ($newExecutors.Count -eq 0) ([ordered]@{ hits = $newExecutors })
Add-Check 'GIT-10' '提交区间未改 lib/mission/runner.ts 之外的执行器/调度文件' (@($changedPaths | Where-Object { $_ -match 'worker|runner|planner|scheduler' }).Count -eq 0) ([ordered]@{ executorRelated = @($changedPaths | Where-Object { $_ -match 'worker|runner|planner|scheduler' }) })

$pass = @($checks | Where-Object { $_.verdict -eq 'PASS' }).Count
$result = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  purpose = 'POST 独立验收：A 第二批交付的 git 边界 / 密钥 / docs 扫描'
  repo = $Repo
  branch = $branch
  head = $head
  checkpoint = $Checkpoint
  finalSha = $FinalSha
  commits = $commitList
  changedFiles = $changed
  changedFileCount = $changedPaths.Count
  checks = $checks
  summary = [ordered]@{ total = $checks.Count; pass = $pass; fail = $checks.Count - $pass }
}
$outDir = Split-Path -Parent (Join-Path $Repo $Out)
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$json = $result | ConvertTo-Json -Depth 8
Set-Content -Path (Join-Path $Repo $Out) -Value $json -Encoding UTF8
Write-Host ("git-boundary: {0}/{1} PASS; changed files={2}; out={3}" -f $pass, $checks.Count, $changedPaths.Count, (Join-Path $Repo $Out))
if ($checks.Count -ne $pass) { exit 1 } else { exit 0 }




