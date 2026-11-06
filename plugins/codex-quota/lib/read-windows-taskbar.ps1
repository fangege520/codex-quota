param([switch]$Once,[int]$ExcludeProcessId=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,Accessibility
Add-Type -ReferencedAssemblies ([Accessibility.IAccessible].Assembly.Location) -TypeDefinition @'
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
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out RECT rect,int size);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint processId);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd,uint objectId,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible);
 static QuotaRect Rect(IntPtr hwnd) { RECT r; GetWindowRect(hwnd,out r); return new QuotaRect{x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top}; }
 static string Class(IntPtr hwnd) {var b=new System.Text.StringBuilder(256);GetClassName(hwnd,b,256);return b.ToString();}
 static void AccessibleItem(Accessibility.IAccessible item,object child,List<QuotaRect> items) {
  try {
   int state=Convert.ToInt32(item.get_accState(child));if((state&0x18000)!=0)return;
   int role=Convert.ToInt32(item.get_accRole(child));if(role!=34&&role!=37&&role!=43)return;
   int x,y,w,h;item.accLocation(out x,out y,out w,out h,child);
   if(w>0&&h>0)items.Add(new QuotaRect{x=x,y=y,width=w,height=h});
  }catch{}
 }
 static void AccessibleTree(Accessibility.IAccessible root,List<QuotaRect> items,int depth) {
  if(depth>5)return;AccessibleItem(root,0,items);
  int count=0;try{count=Math.Min(root.accChildCount,200);}catch{return;}
  for(int i=1;i<=count;i++)try{
   var child=root.get_accChild(i) as Accessibility.IAccessible;
   if(child!=null)AccessibleTree(child,items,depth+1);else AccessibleItem(root,i,items);
  }catch{}
 }
 static List<QuotaRect> LegacyButtons(IntPtr hwnd) {
  var items=new List<QuotaRect>();Accessibility.IAccessible root=null;
  try{var id=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
   if(AccessibleObjectFromWindow(hwnd,0xfffffffc,ref id,out root)>=0&&root!=null)AccessibleTree(root,items,0);
  }catch{}finally{if(root!=null&&Marshal.IsComObject(root))Marshal.ReleaseComObject(root);}
  return items;
 }
 public static QuotaRect Foreground() {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var hwnd=GetForegroundWindow();RECT r;
  // Exclude the invisible resize border from maximized windows.
  if(DwmGetWindowAttribute(hwnd,9,out r,Marshal.SizeOf(typeof(RECT)))!=0)return Rect(hwnd);
  return new QuotaRect{x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top};
 }
 public static QuotaBar[] Read(int excludeProcessId) {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var bars=new List<QuotaBar>(); var windows=new List<IntPtr>();
  EnumWindows((h,d)=>{
   windows.Add(h);
   var c=Class(h); if(c!="Shell_TrayWnd" && c!="Shell_SecondaryTrayWnd")return true;
   var bar=new QuotaBar{handle=h.ToInt64(),bounds=Rect(h),visible=IsWindowVisible(h)};
   EnumChildWindows(h,(child,v)=>{
    var name=Class(child);var r=Rect(child);
    if(!IsWindowVisible(child))return true;
    if(name=="MSTaskListWClass") {
     var buttons=LegacyButtons(child);
     if(buttons.Count>0)bar.occupied.AddRange(buttons);else bar.occupied.Add(r);
     return true;
    }
    if(name=="ReBarWindow32"||name=="MSTaskSwWClass"||name=="Windows.UI.Composition.DesktopWindowContentBridge")return true;
    // Third-party battery/weather toolbars often expose a non-focusable custom
    // HWND, not a Button. Protect every small visible child, including Static.
    if(r.width>0&&r.height>0&&
       (name=="TrayNotifyWnd"||name=="Start"||name=="Button"||r.width<bar.bounds.width/2))bar.occupied.Add(r);
    return true;
   },IntPtr.Zero);
   bars.Add(bar);return true;
  },IntPtr.Zero);
  // Some taskbar utilities are separate top-level windows. Protect those too,
  // excluding this companion so its previous position never blocks itself.
  foreach(var bar in bars)foreach(var h in windows){
   uint pid;GetWindowThreadProcessId(h,out pid);if(pid==(uint)excludeProcessId||!IsWindowVisible(h)||h.ToInt64()==bar.handle)continue;
   var r=Rect(h);var b=bar.bounds;
   if(r.width>0&&r.width<b.width/2&&r.height>0&&r.height<=b.height*1.5&&
      r.x<b.x+b.width&&r.x+r.width>b.x&&r.y<b.y+b.height&&r.y+r.height>b.y)bar.occupied.Add(r);
  }
  return bars.ToArray();
 }
}
'@
do {
  $quotaBars=@()
  foreach($quotaBar in [QuotaTaskbars]::Read($ExcludeProcessId)) {
    $quotaOccupied=@($quotaBar.occupied)
    $quotaAccurate=$false
    try {
      $quotaRoot=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$quotaBar.handle)
      # Include display-only widgets, but not layout panes containing blank space.
      $quotaConditions=New-Object 'System.Collections.Generic.List[Windows.Automation.Condition]'
      foreach($quotaType in @([Windows.Automation.ControlType]::Button,[Windows.Automation.ControlType]::ListItem,[Windows.Automation.ControlType]::CheckBox,[Windows.Automation.ControlType]::MenuItem,[Windows.Automation.ControlType]::RadioButton,[Windows.Automation.ControlType]::SplitButton,[Windows.Automation.ControlType]::Text,[Windows.Automation.ControlType]::Image,[Windows.Automation.ControlType]::ProgressBar,[Windows.Automation.ControlType]::Custom)) {
        $quotaConditions.Add((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,$quotaType)))
      }
      $quotaCondition=New-Object Windows.Automation.OrCondition($quotaConditions.ToArray())
      $quotaCache=New-Object Windows.Automation.CacheRequest
      foreach($quotaProperty in @([Windows.Automation.AutomationElement]::BoundingRectangleProperty,[Windows.Automation.AutomationElement]::IsOffscreenProperty)) { $quotaCache.Add($quotaProperty) }
      $quotaCache.Push()
      try { $quotaItems=$quotaRoot.FindAll([Windows.Automation.TreeScope]::Descendants,$quotaCondition) } finally { $quotaCache.Pop() }
      foreach($quotaItem in $quotaItems) {
        if($quotaItem.Cached.IsOffscreen) { continue }
        $quotaRect=$quotaItem.Cached.BoundingRectangle
        if($quotaRect.Width -gt 0 -and $quotaRect.Width -lt $quotaBar.bounds.width/2 -and $quotaRect.Height -gt 0) {
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
