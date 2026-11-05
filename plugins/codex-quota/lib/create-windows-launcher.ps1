param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Runtime,
  [Parameter(Mandatory=$true)][string]$ShortcutName
)
$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $Executable) -or -not (Test-Path -LiteralPath (Join-Path $Runtime 'package.json'))) { throw 'RUNTIME_NOT_FOUND' }
if([IO.Path]::GetFileName($ShortcutName) -ne $ShortcutName) { throw 'INVALID_SHORTCUT_NAME' }
$quotaShell=New-Object -ComObject WScript.Shell
$quotaPaths=@()
foreach($quotaFolder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs')) | Select-Object -Unique) {
  if(-not $quotaFolder -or -not (Test-Path -LiteralPath $quotaFolder)) { continue }
  $quotaPath=Join-Path $quotaFolder ($ShortcutName+'.lnk')
  $quotaLink=$quotaShell.CreateShortcut($quotaPath)
  $quotaLink.TargetPath=$Executable
  $quotaLink.Arguments='"'+$Runtime+'" --launch-codex'
  $quotaLink.WorkingDirectory=$Runtime
  $quotaLink.Description='Start Codex and connect the quota sidebar'
  $quotaLink.Save()
  $quotaPaths+=$quotaPath
}
if(-not $quotaPaths.Count) { throw 'SHORTCUT_FOLDER_NOT_FOUND' }
[Console]::OutputEncoding=New-Object Text.UTF8Encoding
ConvertTo-Json -InputObject $quotaPaths -Compress
