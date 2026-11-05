param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Runtime,
  [Parameter(Mandatory=$true)][ValidateSet('start','show','hide','toggle','stop','composer-on','composer-off','system-bar-on','system-bar-off','snapshot','launch-codex','settings')][string]$Action
)
$ErrorActionPreference='Stop'
$quotaTaskName='CodexQuotaLaunch-'+[Guid]::NewGuid().ToString('N')
$quotaFolder=$null
try {
  if(-not (Test-Path -LiteralPath $Executable) -or -not (Test-Path -LiteralPath (Join-Path $Runtime 'package.json'))) { throw 'RUNTIME_NOT_FOUND' }
  $quotaFlags=@{start='';show='--show';hide='--hide';toggle='--toggle';stop='--quit';'composer-on'='--composer-on';'composer-off'='--composer-off';'system-bar-on'='--system-bar-on';'system-bar-off'='--system-bar-off';snapshot='--save-previews';'launch-codex'='--launch-codex';settings='--settings'}
  # A detached Node child may still belong to Codex's Windows process job.
  # Start through the current user's scheduler so quitting Codex cannot kill it.
  # This is demand-only, has no triggers, and is removed immediately after launch.
  $quotaSchedule=New-Object -ComObject Schedule.Service
  $quotaSchedule.Connect()
  $quotaFolder=$quotaSchedule.GetFolder('\')
  $quotaTask=$quotaSchedule.NewTask(0)
  $quotaTask.RegistrationInfo.Description='Start the user-requested Codex Quota companion independently'
  $quotaTask.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $quotaTask.Principal.LogonType=3
  $quotaTask.Settings.Hidden=$true
  $quotaTask.Settings.ExecutionTimeLimit='PT0S'
  $quotaTask.Settings.DisallowStartIfOnBatteries=$false
  $quotaTask.Settings.StopIfGoingOnBatteries=$false
  $quotaTask.Settings.AllowHardTerminate=$false
  $quotaTaskAction=$quotaTask.Actions.Create(0)
  $quotaTaskAction.Path=$Executable
  $quotaTaskAction.Arguments='"'+$Runtime+'" '+$quotaFlags[$Action]
  $quotaTaskAction.WorkingDirectory=$Runtime
  $quotaRegistered=$quotaFolder.RegisterTaskDefinition($quotaTaskName,$quotaTask,6,$null,$null,3)
  $quotaRunning=$quotaRegistered.Run($null)
  for($quotaAttempt=0;$quotaAttempt -lt 100 -and $quotaRunning.State -eq 2;$quotaAttempt++) { Start-Sleep -Milliseconds 100; $quotaRunning.Refresh() }
  if($quotaRunning.State -eq 2) { $quotaRunning.Stop(); throw 'COMPANION_LAUNCH_TIMEOUT' }
  @{ok=$true;state=$quotaRunning.State} | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if($quotaFolder) { try { $quotaFolder.DeleteTask($quotaTaskName,0) } catch {} }
}
