param(
  [ValidateSet('Register', 'Run', 'Background')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$OutDirectory,
  [Parameter(Mandatory=$true)][string]$TaskName
)
$ErrorActionPreference = 'Stop'
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$OutDirectory = (Resolve-Path -LiteralPath $OutDirectory).Path
$workerScript = Join-Path $Workspace 'scripts/v2-long-run.ts'
if (-not (Test-Path -LiteralPath $workerScript) -or -not (Test-Path -LiteralPath (Join-Path $OutDirectory 'run.json'))) { throw 'Missing isolated run configuration' }
if ($Mode -eq 'Run') {
  Set-Location -LiteralPath $Workspace
  & $NodePath --import tsx $workerScript worker --out $OutDirectory *> (Join-Path $OutDirectory 'scheduled-worker.log')
  exit $LASTEXITCODE
}
$description = 'ProjectMemo isolated fixture run: ' + $OutDirectory
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $PSCommandPath + '" -Mode Run -Workspace "' + $Workspace + '" -NodePath "' + $NodePath + '" -OutDirectory "' + $OutDirectory + '" -TaskName "' + $TaskName + '"'
if ($Mode -eq 'Background') {
  $launcher = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
  @{ started = $true; mode = 'CURRENT_USER_BACKGROUND'; launcherPid = $launcher.Id; out = $OutDirectory; rebootRecovery = $false } | ConvertTo-Json -Compress
  exit 0
}
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Description -ne $description) { throw 'Refusing to replace an unrelated scheduled task' }
  if ($existing.State -eq 'Running') { throw 'Scheduled worker is already running' }
} else {
  $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments -WorkingDirectory $Workspace
  # Use the current login token without storing credentials. Task-folder permissions still apply.
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 74) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
  Register-ScheduledTask -TaskName $TaskName -Description $description -Action $action -Principal $principal -Settings $settings | Out-Null
}
Start-ScheduledTask -TaskName $TaskName
@{ started = $true; mode = 'WINDOWS_TASK_SCHEDULER'; taskName = $TaskName; out = $OutDirectory } | ConvertTo-Json -Compress
