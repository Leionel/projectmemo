# Track B / Round 2 — next start 管理（生产构建预览，默认端口 34212）。
# 用法：pwsh -File tools/round2-server.ps1 -Action start|stop|status [-Port 34212] [-DistDir .next-build]
param(
  [ValidateSet("start","stop","status")]
  [string]$Action = "start",
  [int]$Port = 34212,
  [string]$DistDir = ".next-build"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../../../../..")).Path
Set-Location $root
$round2 = Join-Path $root "evidence/final-sprint/20261103/b-brand-home/round2"
$logDir = Join-Path $round2 "server"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "server.log"
$errLog = Join-Path $logDir "server.err.log"
$pidFile = Join-Path $logDir "server.pid"
$metaFile = Join-Path $logDir "server-meta.json"

function Get-ListenerPid([int]$p) {
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  $line = netstat -ano | Select-String -Pattern "LISTENING" | Select-String -Pattern ":$p\s" | Select-Object -First 1
  if ($line) {
    $parts = ($line.ToString().Trim() -split '\s+')
    if ($parts.Count -ge 5) { return [int]$parts[-1] }
  }
  return $null
}

if ($Action -eq "status") {
  $listener = Get-ListenerPid $Port
  $http = $null
  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
    $sw.Stop()
    $http = @{ status = $r.StatusCode; length = $r.Content.Length; latencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1) }
  } catch { $http = @{ error = $_.Exception.Message } }
  Write-Output ("port={0} listenerPid={1} http={2}" -f $Port, $listener, ($http | ConvertTo-Json -Compress))
  exit 0
}

if ($Action -eq "stop") {
  $listener = Get-ListenerPid $Port
  if ($listener) { Stop-Process -Id $listener -Force -ErrorAction SilentlyContinue; Write-Output "stopped pid=$listener on port $Port" }
  else { Write-Output "no listener on port $Port" }
  if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
  exit 0
}

# start
$existing = Get-ListenerPid $Port
if ($existing) { throw "端口 $Port 已被占用（pid=$existing），不终止其他进程。" }

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

$startedAt = (Get-Date).ToString("o")
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$nodeExe = (Get-Command node).Source
$nextBin = Join-Path $root "node_modules/next/dist/bin/next"
$proc = Start-Process -FilePath $nodeExe -ArgumentList @($nextBin, "start", "-H", "127.0.0.1", "-p", "$Port") -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
$ready = $false
$firstLatency = $null
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $t = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
    $t.Stop()
    if ($r.StatusCode -eq 200) { $ready = $true; $firstLatency = [math]::Round($t.Elapsed.TotalMilliseconds, 1); break }
  } catch {}
}
$sw.Stop()
if (-not $ready) { throw "next start 未在 60s 内就绪；见 $errLog" }
$listener = Get-ListenerPid $Port
if (-not $listener) { $listener = $proc.Id }
$listener | Set-Content -Path $pidFile -Encoding ascii
$meta = @{
  task = "task-4"
  round = 2
  mode = "next start（production build）"
  port = $Port
  baseUrl = "http://127.0.0.1:$Port"
  distDir = $DistDir
  command = "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $Port"
  node = (node -v)
  startedAt = $startedAt
  readyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
  firstRequestLatencyMs = $firstLatency
  pid = $listener
  log = "evidence/final-sprint/20261103/b-brand-home/round2/server/server.log"
  errLog = "evidence/final-sprint/20261103/b-brand-home/round2/server/server.err.log"
  env = @{
    DATABASE_URL = $env:DATABASE_URL
    LLM_MODE = $env:LLM_MODE
    NEXT_DIST_DIR = $env:NEXT_DIST_DIR
    ATTACHMENT_DIR = $env:ATTACHMENT_DIR
    MISSION_WEB_ENABLED = $env:MISSION_WEB_ENABLED
    FOCUS_ASYNC_ENABLED = $env:FOCUS_ASYNC_ENABLED
  }
  note = "本地回环；mock；不启动 Worker；仅用于生产构建预览与取证。"
}
$meta | ConvertTo-Json -Depth 6 | Set-Content -Path $metaFile -Encoding utf8
Write-Output "server ready pid=$listener port=$Port readyMs=$($meta.readyMs) firstRequestMs=$firstLatency"
