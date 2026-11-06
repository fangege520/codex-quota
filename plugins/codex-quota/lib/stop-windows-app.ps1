param([Parameter(Mandatory=$true)][string]$Executable)

$ErrorActionPreference='Stop'
$Executable=[IO.Path]::GetFullPath($Executable)
$appName=[IO.Path]::GetFileName($Executable)
if($appName -notin @('Codex.exe','ChatGPT.exe') -or
  -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $Executable) 'resources\app.asar') -PathType Leaf)) {
  throw 'INVALID_DESKTOP_EXECUTABLE'
}

$sessionId=(Get-Process -Id $PID).SessionId
$targets=@(Get-CimInstance Win32_Process -Filter "SessionId=$sessionId AND Name='$appName'" |
  Where-Object { $_.CreationDate -and (!$_.ExecutablePath -or $_.ExecutablePath -eq $Executable) } |
  Sort-Object CreationDate |
  ForEach-Object { @{ id=$_.ProcessId; started=$_.CreationDate.ToUniversalTime().Ticks.ToString() } })
$selection=@{ executable=$Executable; session=$sessionId; targets=$targets } | ConvertTo-Json -Compress
$encodedSelection=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selection))

$stopTargets={
  param([string]$EncodedSelection)
  $ErrorActionPreference='Stop'
  $selection=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedSelection)) | ConvertFrom-Json
  $needsElevation=$false
  foreach($target in $selection.targets) {
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$([uint32]$target.id)"
    if(!$current -or $current.SessionId -ne $selection.session -or
      $current.CreationDate.ToUniversalTime().Ticks.ToString() -ne $target.started) { continue }
    if(!$current.ExecutablePath) { $needsElevation=$true; continue }
    if($current.ExecutablePath -ne $selection.executable) { continue }
    $process=Get-Process -Id $target.id -ErrorAction SilentlyContinue
    if(!$process) { continue }
    try {
      $process.Kill()
      if(!$process.WaitForExit(5000)) { throw 'DESKTOP_STOP_TIMEOUT' }
    } catch {
      $cause=$_.Exception.GetBaseException()
      if($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 5) {
        $needsElevation=$true
      } elseif(!$process.HasExited) { throw }
    }
  }
  if($needsElevation) { return 5 }
  return 0
}

if((& $stopTargets $encodedSelection) -eq 5) {
  # Elevate only this fixed command and the identities captured above. The GUI is
  # started separately by the original, unelevated assistant.
  $command="exit (& { $stopTargets } '$encodedSelection')"
  $encodedCommand=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  try {
    $elevated=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -PassThru -Wait `
      -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encodedCommand)
    exit $elevated.ExitCode
  } catch {
    if($_.Exception.GetBaseException().NativeErrorCode -eq 1223) { exit 1223 }
    throw
  }
}
