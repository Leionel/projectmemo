# POST 独立验收一键复跑（A 第二批三项交付）
#
# 用法：
#   pwsh -File evidence/final-a/20261103/post-checkpoint/verify/run-post-verify.ps1 `
#     -Repo D:\Projects\hongmen-final-a-mission-packet `
#     -FinalSha <最终验收提交SHA> `
#     [-TerminalSha <终态入口提交>] [-EvidenceSha <证据窗口提交>] [-RequiresSha <requires提交>]
#
# 行为：git archive FinalSha 到 %TEMP% 干净 shadow（junction node_modules、复制 lib/generated/prisma），
# 复制本目录 fixtures/*.ts 到 shadow/verify-fixtures，依次运行：
#   tsc --noEmit（提交树类型检查，记录 exit）
#   post-terminal-verify / post-evidence-window-verify / post-requires-verify（AFTER）
#   baseline-readback-instrument ×2（AFTER 性能可复算）
#   git-boundary.ps1（对 4b69614..FinalSha）
#   build-post-verification.ts（汇总 a-post-checkpoint-verification.json）
# 只读仓库、只写 verify/ 证据目录；不 add/commit/push；不跑全量测试/next build/hvigor。
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$FinalSha,
  [string]$TerminalSha = '',
  [string]$EvidenceSha = '',
  [string]$RequiresSha = '',
  [string]$Checkpoint = '4b696141435825a3582816e8e449c0e0cf013f29'
)
$ErrorActionPreference = 'Stop'
$verifyRel = 'evidence/final-a/20261103/post-checkpoint/verify'
$verify = Join-Path $Repo $verifyRel
$runs = Join-Path $verify 'post-runs'
$logs = Join-Path $verify 'post-logs'
New-Item -ItemType Directory -Force -Path $runs, $logs | Out-Null
$shadow = Join-Path $env:TEMP ("pm-post-verify-final-" + $FinalSha.Substring(0, 12))
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  checkpoint = $Checkpoint
  commits = [ordered]@{ final = $FinalSha; terminal = $TerminalSha; evidenceWindow = $EvidenceSha; requires = $RequiresSha }
  environment = [ordered]@{
    repo = $Repo; branch = (& git -C $Repo branch --show-current).Trim(); head = (& git -C $Repo rev-parse HEAD).Trim()
    node = (& node --version); npm = (& npm.cmd --version); shadow = $shadow
    method = 'git archive FinalSha -- lib app components prisma public tests scripts package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts prisma.config.ts vitest.config.ts playwright.config.ts .gitattributes eslint.config.mjs postcss.config.mjs; tar -xf; 复制 lib/generated/prisma；node_modules junction 到仓库'
  }
  runs = New-Object System.Collections.Generic.List[object]
}

function Record-Run([string]$name, [string]$command, [int]$exit, [string]$logRel) {
  $manifest.runs.Add([ordered]@{ name = $name; command = $command; exit = $exit; log = $logRel; at = (Get-Date).ToString('o') })
}

# 1) 干净 shadow
if (Test-Path $shadow) {
  $junction = Join-Path $shadow 'node_modules'
  if (Test-Path $junction) { cmd /c rmdir "$junction" | Out-Null }
  Remove-Item $shadow -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $shadow -Force | Out-Null
$tar = Join-Path $env:TEMP ("pm-post-final-" + $FinalSha.Substring(0, 12) + ".tar")
if (Test-Path $tar) { Remove-Item $tar -Force }
git -C $Repo archive --format=tar -o $tar $FinalSha -- lib app components prisma public tests scripts package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts prisma.config.ts vitest.config.ts playwright.config.ts .gitattributes eslint.config.mjs postcss.config.mjs
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
tar -xf $tar -C $shadow
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
Remove-Item $tar -Force
Copy-Item -Recurse (Join-Path $Repo 'lib\generated\prisma') (Join-Path $shadow 'lib\generated\prisma') -Force
New-Item -ItemType Junction -Path (Join-Path $shadow 'node_modules') -Target (Join-Path $Repo 'node_modules') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $shadow 'verify-fixtures') | Out-Null
Copy-Item (Join-Path $verify 'fixtures\*.ts') (Join-Path $shadow 'verify-fixtures') -Force
$env:VERIFY_SOURCE_TREE = "clean shadow of $FinalSha (git archive, HEAD tree)"
$env:VERIFY_COMMIT = $FinalSha
$env:VERIFY_TERMINAL_SHA = $TerminalSha
$env:VERIFY_EVIDENCE_SHA = $EvidenceSha
$env:VERIFY_REQUIRES_SHA = $RequiresSha

Push-Location $shadow
try {
  # 2) 提交树类型检查（只记录，不替代 Lead 的 tsc）
  $tscLog = Join-Path $logs 'after-tsc-shadow.log'
  npm.cmd exec tsc -- --noEmit *> $tscLog
  $tscExit = $LASTEXITCODE
  Set-Content (Join-Path $logs 'after-tsc-shadow.exit') "$tscExit"
  Record-Run 'tsc-shadow' 'npm.cmd exec tsc -- --noEmit' $tscExit 'post-logs/after-tsc-shadow.log'

  # 3) 三项 POST 独立复验
  foreach ($pair in @(
      @('post-terminal-verify.ts', 'after-post-terminal.json'),
      @('post-evidence-window-verify.ts', 'after-post-evidence-window.json'),
      @('post-requires-verify.ts', 'after-post-requires.json')
    )) {
    $name = $pair[0]; $jsonName = $pair[1]; $baseName = $jsonName.Replace('.json', '')
    $logPath = Join-Path $logs ($baseName + '.log')
    npx.cmd tsx ("verify-fixtures/" + $name) (Join-Path $runs $jsonName) 2>&1 | Tee-Object $logPath
    $exit = $LASTEXITCODE
    Set-Content (Join-Path $logs ($baseName + '.exit')) "$exit"
    Record-Run $baseName ("npx.cmd tsx verify-fixtures/" + $name + " post-runs/" + $jsonName) $exit ("post-logs/" + $baseName + ".log")
  }

  # 4) 性能：同一脚本跑两次，BEFORE 基线已在 4b69614 shadow 固定
  foreach ($n in 1, 2) {
    $jsonName = "after-post-perf-run$n.json"; $baseName = "after-post-perf-run$n"
    npx.cmd tsx verify-fixtures/baseline-readback-instrument.ts (Join-Path $runs $jsonName) 2>&1 | Tee-Object (Join-Path $logs ($baseName + '.log'))
    $exit = $LASTEXITCODE
    Set-Content (Join-Path $logs ($baseName + '.exit')) "$exit"
    Record-Run $baseName ("npx.cmd tsx verify-fixtures/baseline-readback-instrument.ts post-runs/" + $jsonName) $exit ("post-logs/" + $baseName + ".log")
  }
} finally {
  Pop-Location
}

# 5) git 边界（在主仓库只读执行）
$gitLog = Join-Path $logs 'git-boundary.log'
pwsh -File (Join-Path $verify 'git-boundary.ps1') -Repo $Repo -Checkpoint $Checkpoint -FinalSha $FinalSha -Out "$verifyRel/post-runs/git-boundary.json" *> $gitLog
$gitExit = $LASTEXITCODE
Set-Content (Join-Path $logs 'git-boundary.exit') "$gitExit"
Record-Run 'git-boundary' ("pwsh -File verify/git-boundary.ps1 -Checkpoint $Checkpoint -FinalSha $FinalSha") $gitExit 'post-logs/git-boundary.log'

# 6) 汇总
$aggOut = Join-Path $verify 'a-post-checkpoint-verification.json'
npx.cmd tsx (Join-Path $verify 'fixtures\build-post-verification.ts') $verify $aggOut 2>&1 | Tee-Object (Join-Path $logs 'aggregate.log')
$aggExit = $LASTEXITCODE
Set-Content (Join-Path $logs 'aggregate.exit') "$aggExit"
Record-Run 'aggregate' 'npx.cmd tsx fixtures/build-post-verification.ts' $aggExit 'post-logs/aggregate.log'

$manifest | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $runs 'run-manifest.json') -Encoding UTF8
Write-Host ("POST verify done. aggregate exit={0}; manifest={1}" -f $aggExit, (Join-Path $runs 'run-manifest.json'))
exit $aggExit
