param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$Port
)
$ErrorActionPreference='Stop'
try {
  # Store packages require activation with their package identity. Directly
  # spawning WindowsApps executables can return ERROR_ACCESS_DENIED.
  $quotaExecutable=[IO.Path]::GetFullPath($Executable)
  $quotaAumid=$null
  foreach($quotaPackage in @(Get-AppxPackage OpenAI.Codex)) {
    [xml]$quotaManifest=Get-Content -LiteralPath (Join-Path $quotaPackage.InstallLocation 'AppxManifest.xml') -Raw
    foreach($quotaApplication in $quotaManifest.Package.Applications.Application) {
      $quotaCandidate=[IO.Path]::GetFullPath((Join-Path $quotaPackage.InstallLocation $quotaApplication.Executable))
      if($quotaCandidate -eq $quotaExecutable) {
        $quotaAumid=$quotaPackage.PackageFamilyName+'!'+$quotaApplication.Id
      }
    }
  }
  if(-not $quotaAumid) { throw 'WINDOWS_PACKAGE_NOT_FOUND' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQuotaActivationManager {
 [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
 [PreserveSig] int ActivateForFile(IntPtr id, IntPtr items, IntPtr verb, out uint pid);
 [PreserveSig] int ActivateForProtocol(IntPtr id, IntPtr items, out uint pid);
}
public static class QuotaActivation {
 public static uint Activate(string id, string args) {
   var obj=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
   try { uint pid; int result=((IQuotaActivationManager)obj).ActivateApplication(id,args,2,out pid); Marshal.ThrowExceptionForHR(result); return pid; }
   finally { Marshal.ReleaseComObject(obj); }
 }
}
'@
  $quotaActivated=[QuotaActivation]::Activate($quotaAumid,"--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port")
  @{ok=$true;pid=$quotaActivated;appUserModelId=$quotaAumid} | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
