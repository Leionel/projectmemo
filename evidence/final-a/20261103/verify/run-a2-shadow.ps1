# A2 独立验收：在 A2 提交（d428314）的干净 shadow 内复跑 tsc + 独立 fixture（只读仓库，写临时目录/verify 证据）
# 运行：pwsh -File evidence/final-a/20261103/verify/run-a2-shadow.ps1
$ErrorActionPreference = 'Stop'
$repo = 'D:\Projects\hongmen-final-a-mission-packet'
$sha = 'd42831468de0595304382a6021b1171a3cdd6f60'
$shadow = Join-Path $env:TEMP 'pm-a2-full-verify'
$v = Join-Path $repo 'evidence\final-a\20261103\verify'
$logs = Join-Path $v 'logs'
$runs = Join-Path $v 'fixtures\runs'
New-Item -ItemType Directory -Force -Path $logs, $runs | Out-Null
foreach ($log in @('a2-tsc-fullshadow.log', 'a2-service-fixture.log', 'a2-concurrency-fixture.log')) {
  Remove-Item (Join-Path $logs $log) -Force -ErrorAction SilentlyContinue
}
if (Test-Path $shadow) {
  $junction = Join-Path $shadow 'node_modules'
  if (Test-Path $junction) { cmd /c rmdir "$junction" | Out-Null }
  Remove-Item $shadow -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $shadow -Force | Out-Null
$tar = Join-Path $env:TEMP 'pm-a2-full-d428314.tar'
if (Test-Path $tar) { Remove-Item $tar -Force }
git -C $repo archive --format=tar -o $tar $sha -- lib app components prisma public tests scripts package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts prisma.config.ts vitest.config.ts playwright.config.ts .gitattributes
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
tar -xf $tar -C $shadow
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
Remove-Item $tar -Force
Copy-Item -Recurse (Join-Path $repo 'lib\generated\prisma') (Join-Path $shadow 'lib\generated\prisma') -Force
New-Item -ItemType Junction -Path (Join-Path $shadow 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
Write-Host ("shadow ready at {0}; top items = {1}" -f $sha, @(Get-ChildItem $shadow | Measure-Object).Count)
Push-Location $shadow
try {
  $env:VERIFY_SOURCE_TREE = 'A2 final HEAD d428314 via git archive (source tree; untracked verify/ excluded)'
  # tsc 必须先在“提交内容的干净树”上跑：fixture 是验收方未跟踪文件，不能混入 A2 提交的 tsc 证据。
  npm.cmd exec tsc -- --noEmit *> (Join-Path $logs 'a2-tsc-fullshadow.log')
  $tscExit = $LASTEXITCODE
  Set-Content (Join-Path $logs 'a2-tsc-fullshadow.exit') "$tscExit"
  New-Item -ItemType Directory -Force -Path (Join-Path $shadow 'verify-fixtures') | Out-Null
  Copy-Item "$v\fixtures\*.ts" (Join-Path $shadow 'verify-fixtures') -Force
  npx.cmd tsx verify-fixtures/a2-service-fixture.ts (Join-Path $runs 'a2-service-fixture.json') 2>&1 | Tee-Object (Join-Path $logs 'a2-service-fixture.log')
  $serviceExit = $LASTEXITCODE
  Set-Content (Join-Path $logs 'a2-service-fixture.exit') "$serviceExit"
  npx.cmd tsx verify-fixtures/a2-concurrency-fixture.ts (Join-Path $runs 'a2-concurrency-fixture.json') 2>&1 | Tee-Object (Join-Path $logs 'a2-concurrency-fixture.log')
  $concurrencyExit = $LASTEXITCODE
  Set-Content (Join-Path $logs 'a2-concurrency-fixture.exit') "$concurrencyExit"
  Remove-Item Env:VERIFY_SOURCE_TREE -ErrorAction SilentlyContinue
  Write-Host ("EXITS: tsc={0} service={1} concurrency={2}" -f $tscExit, $serviceExit, $concurrencyExit)
} finally {
  Pop-Location
}
