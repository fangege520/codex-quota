param(
  [string]$Executable,
  [string]$Runtime,
  [Parameter(Mandatory=$true)][string]$ShortcutName,
  [switch]$Remove
)
$ErrorActionPreference='Stop'
if(-not $Remove -and (-not $Executable -or -not $Runtime -or -not (Test-Path -LiteralPath $Executable -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $Runtime 'package.json') -PathType Leaf))) { throw 'RUNTIME_NOT_FOUND' }
if([IO.Path]::GetFileName($ShortcutName) -ne $ShortcutName) { throw 'INVALID_SHORTCUT_NAME' }

$quotaRuntimeRoot=Join-Path $env:APPDATA 'codex-quota\runtime'
function Test-QuotaExecutable([string]$Path) {
  if(-not $Path) { return $false }
  return $Path.StartsWith($quotaRuntimeRoot+'\',[StringComparison]::OrdinalIgnoreCase) -and
    $Path.EndsWith('\node_modules\electron\dist\electron.exe',[StringComparison]::OrdinalIgnoreCase)
}

$quotaShell=New-Object -ComObject WScript.Shell
$quotaPaths=@()
foreach($quotaFolder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs')) | Select-Object -Unique) {
  if(-not $quotaFolder -or -not (Test-Path -LiteralPath $quotaFolder)) { continue }
  $quotaPath=Join-Path $quotaFolder ($ShortcutName+'.lnk')
  $quotaLink=$quotaShell.CreateShortcut($quotaPath)
  $quotaExists=Test-Path -LiteralPath $quotaPath
  if($quotaExists -and -not (Test-QuotaExecutable $quotaLink.TargetPath)) {
    if($Remove) { continue }
    throw "Shortcut already exists: $quotaPath"
  }
  if($Remove) {
    if($quotaExists) { Remove-Item -LiteralPath $quotaPath }
    continue
  }
  $quotaLink.TargetPath=$Executable
  $quotaLink.Arguments='"'+$Runtime+'" --launch-codex'
  $quotaLink.WorkingDirectory=$Runtime
  $quotaLink.Description='Open Codex and connect the quota assistant'
  $quotaLink.Save()
  $quotaPaths+=$quotaPath
}
if(-not $Remove -and -not $quotaPaths.Count) { throw 'SHORTCUT_FOLDER_NOT_FOUND' }

$quotaSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$quotaLegacyName='Codex Quota - Start with ChatGPT'
$quotaTaskName="$quotaLegacyName ($quotaSid)"
$quotaSchedule=New-Object -ComObject Schedule.Service
$quotaSchedule.Connect()
$quotaTaskFolder=$quotaSchedule.GetFolder('\')
$quotaTasks=$quotaTaskFolder.GetTasks(1)
if(-not $Remove) {
  $quotaAppIds=@('OpenAI.Codex_2p2nqsd0c76g0!App')
  $quotaAppIds+=@(Get-StartApps | Where-Object {
    $_.Name -eq 'ChatGPT' -and $_.AppID -match '^OpenAI\.[\w.-]+_2p2nqsd0c76g0![\w.-]+$'
  } | Select-Object -ExpandProperty AppID)
  $quotaAppFilter=($quotaAppIds | Select-Object -Unique | ForEach-Object { "Data[@Name='ApplicationId']='$_'" }) -join ' or '
  $quotaChannel='Microsoft-Windows-TWinUI/Operational'
  $quotaXPath="*[System[Provider[@Name='Microsoft-Windows-Immersive-Shell'] and EventID=1621 and Security[@UserID='$quotaSid']]] and *[EventData[($quotaAppFilter) and Data[@Name='Result']='0']]"
  $quotaTask=$quotaSchedule.NewTask(0)
  $quotaTask.RegistrationInfo.Description='Start Codex Quota when this user launches ChatGPT or Codex.'
  $quotaTask.Principal.UserId=$quotaSid
  $quotaTask.Principal.LogonType=3
  $quotaTask.Settings.ExecutionTimeLimit='PT0S'
  $quotaTask.Settings.DisallowStartIfOnBatteries=$false
  $quotaTask.Settings.StopIfGoingOnBatteries=$false
  $quotaTask.Settings.MultipleInstances=2
  $quotaTrigger=$quotaTask.Triggers.Create(0)
  $quotaTrigger.Subscription="<QueryList><Query Id='0' Path='$quotaChannel'><Select Path='$quotaChannel'>$quotaXPath</Select></Query></QueryList>"
  $quotaAction=$quotaTask.Actions.Create(0)
  $quotaAction.Path=$Executable
  $quotaAction.Arguments='"'+$Runtime+'"'
  $quotaAction.WorkingDirectory=$Runtime
  $null=$quotaTaskFolder.RegisterTaskDefinition($quotaTaskName,$quotaTask,6,$null,$null,3)
}

# Task Scheduler may return an account name even when it was registered by SID.
foreach($quotaExistingTask in $quotaTasks) {
  if($quotaExistingTask.Name -ne $quotaLegacyName -and (-not $Remove -or $quotaExistingTask.Name -ne $quotaTaskName)) { continue }
  $quotaDefinition=$quotaExistingTask.Definition
  if($quotaDefinition.Actions.Count -ne 1 -or -not (Test-QuotaExecutable $quotaDefinition.Actions.Item(1).Path)) { continue }
  $quotaOwner=$quotaDefinition.Principal.UserId
  if($quotaOwner -notlike 'S-1-*') {
    try { $quotaOwner=[Security.Principal.NTAccount]::new($quotaOwner).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch [Security.Principal.IdentityNotMappedException] { continue }
  }
  if($quotaOwner -eq $quotaSid) { $quotaTaskFolder.DeleteTask($quotaExistingTask.Name,0) }
}
[Console]::OutputEncoding=New-Object Text.UTF8Encoding
@{shortcuts=$quotaPaths; startupTask=$quotaTaskName} | ConvertTo-Json -Compress
