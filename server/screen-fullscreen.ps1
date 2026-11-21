# Toggles full screen on the big game screen window (presses F11 on it).
#
# Called by the game server when the referee taps the full-screen button on the phone.
# Browsers do not let a web page enter full screen by itself without a click on that PC,
# so the server (running on the same PC) presses F11 on the screen window instead.
#
# The screen page puts "[<port>]" at the end of its title (e.g. "... [3000]"), so we find
# exactly the window of THIS game server, even if other browser windows are open.
#
# Usage: powershell -ExecutionPolicy Bypass -File screen-fullscreen.ps1 -Port 3000
#        add -List to only print the windows that were found (for troubleshooting).

param([int]$Port = 3000, [switch]$List)

$log = Join-Path $env:TEMP 'horoof-open-screen.log'
function Log($m) { try { Add-Content -LiteralPath $log -Value ("{0:HH:mm:ss} fullscreen: {1}" -f (Get-Date), $m) } catch {} }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class HoroofWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  public static List<KeyValuePair<IntPtr, string>> Find(string marker) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      var t = sb.ToString();
      if (t.Contains(marker)) found.Add(new KeyValuePair<IntPtr, string>(h, t));
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // Bring a window to the front and press F11 on it.
  public static bool PressF11(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    // Tapping ALT lets a background process move another window to the front.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    System.Threading.Thread.Sleep(200);
    if (GetForegroundWindow() != h) return false;
    keybd_event(0x7A, 0, 0, UIntPtr.Zero); // F11 down
    keybd_event(0x7A, 0, 2, UIntPtr.Zero); // F11 up
    return true;
  }
}
"@

$marker = "[$Port]"
$wins = [HoroofWin]::Find($marker)

if ($List) {
  foreach ($w in $wins) { "{0}  {1}" -f $w.Key, $w.Value }
  exit 0
}

if ($wins.Count -eq 0) {
  Log "no window with $marker in its title"
  exit 1
}

$ok = [HoroofWin]::PressF11($wins[0].Key)
Log ("F11 on window $marker -> " + $(if ($ok) { 'ok' } else { 'could not bring the window to the front' }))
