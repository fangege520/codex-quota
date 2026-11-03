param([switch]$Once)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class QuotaRect { public int x,y,width,height; }
public class QuotaBar { public long handle; public QuotaRect bounds; public List<QuotaRect> occupied=new List<QuotaRect>(); public bool visible; }
public static class QuotaTaskbars {
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
 delegate bool EnumProc(IntPtr hwnd, IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd,EnumProc callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder name,int length);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 static QuotaRect Rect(IntPtr hwnd) { RECT r; GetWindowRect(hwnd,out r); return new QuotaRect{x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top}; }
 static string Class(IntPtr hwnd) {var b=new System.Text.StringBuilder(256);GetClassName(hwnd,b,256);return b.ToString();}
 public static QuotaRect Foreground() {return Rect(GetForegroundWindow());}
 public static QuotaBar[] Read() {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var bars=new List<QuotaBar>();
  EnumWindows((h,d)=>{
   var c=Class(h); if(c!="Shell_TrayWnd" && c!="Shell_SecondaryTrayWnd")return true;
   var bar=new QuotaBar{handle=h.ToInt64(),bounds=Rect(h),visible=IsWindowVisible(h)};
   EnumChildWindows(h,(child,v)=>{var name=Class(child);if(IsWindowVisible(child)&&(name=="TrayNotifyWnd"||name=="Start"||name=="Button"))bar.occupied.Add(Rect(child));return true;},IntPtr.Zero);
   bars.Add(bar);return true;
  },IntPtr.Zero);return bars.ToArray();
 }
}
'@
do {
  $quotaBars=@()
  foreach($quotaBar in [QuotaTaskbars]::Read()) {
    $quotaOccupied=@($quotaBar.occupied)
    $quotaAccurate=$false
    try {
      $quotaRoot=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$quotaBar.handle)
      $quotaConditions=New-Object 'System.Collections.Generic.List[Windows.Automation.Condition]'
      foreach($quotaType in @([Windows.Automation.ControlType]::Button,[Windows.Automation.ControlType]::ListItem,[Windows.Automation.ControlType]::CheckBox,[Windows.Automation.ControlType]::MenuItem,[Windows.Automation.ControlType]::RadioButton,[Windows.Automation.ControlType]::SplitButton)) {
        $quotaConditions.Add((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,$quotaType)))
      }
      $quotaConditions.Add((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty,$true)))
      $quotaCondition=New-Object Windows.Automation.OrCondition($quotaConditions.ToArray())
      $quotaCache=New-Object Windows.Automation.CacheRequest
      foreach($quotaProperty in @([Windows.Automation.AutomationElement]::BoundingRectangleProperty,[Windows.Automation.AutomationElement]::IsOffscreenProperty)) { $quotaCache.Add($quotaProperty) }
      $quotaCache.Push()
      try { $quotaItems=$quotaRoot.FindAll([Windows.Automation.TreeScope]::Descendants,$quotaCondition) } finally { $quotaCache.Pop() }
      foreach($quotaItem in $quotaItems) {
        if($quotaItem.Cached.IsOffscreen) { continue }
        $quotaRect=$quotaItem.Cached.BoundingRectangle
        if($quotaRect.Width -gt 0 -and $quotaRect.Width -lt $quotaBar.bounds.width -and $quotaRect.Height -gt 0) {
          $quotaOccupied+=@{x=[int]$quotaRect.X;y=[int]$quotaRect.Y;width=[int]$quotaRect.Width;height=[int]$quotaRect.Height}
        }
      }
      $quotaAccurate=$true
    } catch {}
    $quotaBars+=@{handle=[string]$quotaBar.handle;bounds=$quotaBar.bounds;occupied=@($quotaOccupied);visible=$quotaBar.visible;accurate=$quotaAccurate}
  }
  @{bars=@($quotaBars);foreground=[QuotaTaskbars]::Foreground()} | ConvertTo-Json -Depth 6 -Compress | Write-Output
  if(-not $Once) { Start-Sleep -Seconds 2 }
} while(-not $Once)
