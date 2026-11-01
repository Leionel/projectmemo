param([ValidateSet('Open','Revise','Revoke','VerifyRevoked')][string]$Phase='Open')
$ErrorActionPreference='Stop'
$ct7Hdc='D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
$ct7Evidence=Join-Path $PSScriptRoot '../evidence/r4-deployment/20261031-acceptance'
function Read-Ct7Layout {
  & $ct7Hdc -t 127.0.0.1:5555 shell uitest dumpLayout -p /data/local/tmp/ct7-layout.json | Out-Null
  & $ct7Hdc -t 127.0.0.1:5555 file recv /data/local/tmp/ct7-layout.json (Join-Path $ct7Evidence 'native-layout.json') | Out-Null
  $raw=Get-Content (Join-Path $ct7Evidence 'native-layout.json') -Raw
  $tree=$raw | ConvertFrom-Json
  $ct7Focused=@($tree.children | Where-Object {$_.attributes.bundleName -eq 'xyz.luojiatutor.projectmemo.ct7acceptance' -and $_.attributes.focused -eq 'true'})
  if($ct7Focused.Count -ne 1){throw 'The isolated CT7 acceptance application must be the focused window'}
  return $tree
}
function Find-Ct7Text($node,[string]$text) {
  if($node.attributes.text -eq $text -and $node.attributes.enabled -ne 'false'){$node.attributes}
  foreach($child in $node.children){Find-Ct7Text $child $text}
}
function Tap-Ct7Text([string]$text) {
  for($attempt=0;$attempt -lt 6;$attempt++){
    $ct7Matches=@(Find-Ct7Text (Read-Ct7Layout) $text)
    if($ct7Matches.Count -gt 1){throw "Ambiguous UI target: $text"}
    if($ct7Matches.Count -eq 1){
      $parts=[regex]::Matches($ct7Matches[0].bounds,'\d+') | ForEach-Object {[int]$_.Value}
      $ct7X=[int](($parts[0]+$parts[2])/2);$ct7Y=[int](($parts[1]+$parts[3])/2)
      if($ct7Y -gt 330 -and $ct7Y -lt 2740){
        & $ct7Hdc -t 127.0.0.1:5555 shell uitest uiInput click $ct7X $ct7Y | Out-Null
        Start-Sleep -Milliseconds 800
        Write-Output "Tapped: $text"
        return
      }
    }
    & $ct7Hdc -t 127.0.0.1:5555 shell uitest uiInput swipe 1100 2400 1100 800 600 | Out-Null
    Start-Sleep -Milliseconds 700
  }
  throw "UI target not found: $text"
}
if($Phase -eq 'Open'){
  Tap-Ct7Text '项目'
  Tap-Ct7Text '课程项目上线核对'
  Tap-Ct7Text '资料'
  Tap-Ct7Text '当前理解与工程观察 →'
}elseif($Phase -eq 'Revise'){
  Tap-Ct7Text '修订只读许可'
  Tap-Ct7Text '24 小时'
  Tap-Ct7Text '确认这些路径的只读许可'
}elseif($Phase -eq 'Revoke'){
  Tap-Ct7Text '撤销读取'
}
Start-Sleep -Milliseconds 700
$tree=Read-Ct7Layout
if($Phase -in @('Revoke','VerifyRevoked') -and (@(Find-Ct7Text $tree '已撤销').Count -ne 1 -or @(Find-Ct7Text $tree '交给忆程调查').Count -ne 0)){
  throw 'Revocation did not become visible or investigation remained available'
}
if($Phase -eq 'Revise' -and (@(Find-Ct7Text $tree '确认这些路径的只读许可').Count -ne 0 -or @(Find-Ct7Text $tree '环境权限已变化，请重新核对').Count -gt 0)){
  throw 'Revision was not acknowledged by the UI'
}
$tree | ConvertTo-Json -Depth 100 | Set-Content (Join-Path $ct7Evidence "native-$Phase-layout.json")
$ct7RemoteProof="/data/local/tmp/ct7-proof-$Phase-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).png"
& $ct7Hdc -t 127.0.0.1:5555 shell uitest screenCap -p $ct7RemoteProof | Out-Null
& $ct7Hdc -t 127.0.0.1:5555 file recv $ct7RemoteProof (Join-Path $ct7Evidence "native-$Phase.png") | Out-Null
Write-Output "Saved native-$Phase evidence"
