# Real mouse input and a screen capture for e2e/channel.mjs's island check (E2E_DESKTOP=1): the island's
# click-through is the operating system's business, so only real clicks show it.
param(
  [Parameter(Mandatory = $true)][ValidateSet('click', 'move', 'capture', 'where')][string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Out = ''
)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public struct POINT { public int X; public int Y; }
}
'@
[void][DesktopInput]::SetProcessDPIAware()
switch ($Action) {
  'where' {
    $p = New-Object DesktopInput+POINT
    [void][DesktopInput]::GetCursorPos([ref]$p)
    "$($p.X) $($p.Y)"
  }
  'move' {
    [void][DesktopInput]::SetCursorPos($X, $Y)
  }
  'click' {
    # Moved as input, in steps, like a hand on a mouse: SetCursorPos alone skips the low-level hook that tells a
    # click-through window where the pointer is.
    Add-Type -AssemblyName System.Windows.Forms
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $from = New-Object DesktopInput+POINT
    [void][DesktopInput]::GetCursorPos([ref]$from)
    for ($i = 1; $i -le 12; $i++) {
      $px = $from.X + ($X - $from.X) * $i / 12
      $py = $from.Y + ($Y - $from.Y) * $i / 12
      $nx = [uint32](($px - $vs.Left) * 65535 / ($vs.Width - 1))
      $ny = [uint32](($py - $vs.Top) * 65535 / ($vs.Height - 1))
      [DesktopInput]::mouse_event(0xC001, $nx, $ny, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 15
    }
    Start-Sleep -Milliseconds 200
    [DesktopInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [DesktopInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  }
  'capture' {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  }
}
