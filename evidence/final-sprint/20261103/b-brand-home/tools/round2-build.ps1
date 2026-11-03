# Track B / Round 2 — 生产构建（NEXT_DIST_DIR=.next-build），完整日志 + exit 码。
# 用法：pwsh -File tools/round2-build.ps1 [-DistDir .next-build]
param(
  [string]$DistDir = ".next-build"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../../../../..")).Path
Set-Location $root
$round2 = Join-Path $root "evidence/final-sprint/20261103/b-brand-home/round2"
$logDir = Join-Path $round2 "build"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "build.log"
$exitFile = Join-Path $logDir "build.exit"
$metaFile = Join-Path $logDir "build-meta.json"

# Start-Track 同款隔离环境（mock + 隔离准备库；不启动 Worker）
$dbPath = Join-Path $root "prisma/final-preparation.db"
$env:DATABASE_URL = "file:" + ($dbPath -replace '\\', '/')
$env:ATTACHMENT_DIR = Join-Path $root "tmp/final-preparation/attachments"
$env:LLM_MODE = "mock"
$env:FOCUS_AGENT_ENABLED = "true"
$env:FOCUS_AGENT_R4_ENABLED = "true"
$env:FOCUS_CONTINUITY_ENABLED = "true"
$env:FOCUS_ASYNC_ENABLED = "false"
$env:FOCUS_WEB_ENABLED = "true"
$env:MISSION_ENABLED = "true"
$env:MISSION_UI_ENABLED = "true"
$env:MISSION_WRITES_ENABLED = "true"
$env:MISSION_WEB_ENABLED = "false"
$env:MISSION_AUTO_CONTINUATION_ENABLED = "false"
$env:NEXT_DIST_DIR = $DistDir
Remove-Item Env:PROJECTMEMO_BUILD_SKIP_TYPECHECK -ErrorAction SilentlyContinue

$envSnapshot = @{}
foreach ($name in @("DATABASE_URL","ATTACHMENT_DIR","LLM_MODE","FOCUS_AGENT_ENABLED","FOCUS_AGENT_R4_ENABLED","FOCUS_CONTINUITY_ENABLED","FOCUS_ASYNC_ENABLED","FOCUS_WEB_ENABLED","MISSION_ENABLED","MISSION_UI_ENABLED","MISSION_WRITES_ENABLED","MISSION_WEB_ENABLED","MISSION_AUTO_CONTINUATION_ENABLED","NEXT_DIST_DIR")) {
  $envSnapshot[$name] = [Environment]::GetEnvironmentVariable($name)
}

$gitHead = (git rev-parse HEAD).Trim()
$gitStatusBefore = @(git status --porcelain -- app components lib | ForEach-Object { $_.Trim() })
$startedAt = (Get-Date).ToString("o")
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& npm.cmd run build 2>&1 | Tee-Object -FilePath $logFile
$code = $LASTEXITCODE
$sw.Stop()
$endedAt = (Get-Date).ToString("o")
Set-Content -Path $exitFile -Value $code -Encoding ascii
$gitStatusAfter = @(git status --porcelain -- app components lib | ForEach-Object { $_.Trim() })

$distPath = Join-Path $root $DistDir
$artifacts = $null
if (Test-Path $distPath) {
  $files = Get-ChildItem $distPath -Recurse -File -ErrorAction SilentlyContinue
  $buildIdFile = Join-Path $distPath "BUILD_ID"
  $artifacts = @{
    buildId = if (Test-Path $buildIdFile) { (Get-Content $buildIdFile -Raw).Trim() } else { $null }
    files = ($files | Measure-Object).Count
    sizeMB = [math]::Round((($files | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
  }
}

$meta = @{
  task = "task-4"
  round = 2
  candidateSha = $gitHead
  command = "npm.cmd run build"
  distDir = $DistDir
  exitCode = $code
  startedAt = $startedAt
  endedAt = $endedAt
  durationSec = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  node = (node -v)
  npm = (npm.cmd -v)
  env = $envSnapshot
  logFile = "evidence/final-sprint/20261103/b-brand-home/round2/build/build.log"
  exitFile = "evidence/final-sprint/20261103/b-brand-home/round2/build/build.exit"
  artifacts = $artifacts
  gitStatusBefore = $gitStatusBefore
  gitStatusAfter = $gitStatusAfter
  notes = @(
    "tsconfig.json / next-env.d.ts 由 Next build 自动改写（生成文件），不属于业务源码改动。",
    "构建期间不启动 Worker；mock 模式；DATABASE_URL 指向隔离准备库。"
  )
}
$meta | ConvertTo-Json -Depth 8 | Set-Content -Path $metaFile -Encoding utf8
Write-Output "BUILD EXIT=$code duration=$([math]::Round($sw.Elapsed.TotalSeconds,2))s artifacts=$($artifacts | ConvertTo-Json -Compress)"
