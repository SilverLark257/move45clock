param(
  [switch]$ListOnly,
  [string]$ProcessName = 'DeepSeek Harness'
)

# ASCII-only on purpose: works under Windows PowerShell 5.1 and 7 without a BOM.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DshClockWin32
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }
}
'@

$targetPids = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if ($targetPids.Count -eq 0) {
    Write-Output '{"ok":false,"reason":"process-not-found"}'
    exit 1
}

$script:windows = New-Object System.Collections.ArrayList
$callback = [DshClockWin32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    [uint32]$ownerPid = 0
    [void][DshClockWin32]::GetWindowThreadProcessId($hWnd, [ref]$ownerPid)
    if ($targetPids -contains [int]$ownerPid) {
        $len = [DshClockWin32]::GetWindowTextLength($hWnd)
        $sb = New-Object System.Text.StringBuilder ([Math]::Max($len + 1, 256))
        [void][DshClockWin32]::GetWindowText($hWnd, $sb, $sb.Capacity)
        [void]$script:windows.Add([pscustomobject]@{
            Handle  = $hWnd
            Pid     = [int]$ownerPid
            Title   = $sb.ToString()
            Visible = [DshClockWin32]::IsWindowVisible($hWnd)
            Iconic  = [DshClockWin32]::IsIconic($hWnd)
        })
    }
    return $true
}
[void][DshClockWin32]::EnumWindows($callback, [IntPtr]::Zero)

$candidates = @($script:windows | Where-Object {
    $_.Title -ne '' -and
    $_.Title -notmatch '^(Default IME|MSCTFIME UI|HintWnd|Sogou_TSF_UI)$' -and
    $_.Title -notmatch 'DevTools'
})

# Prefer windows whose title mentions the product; otherwise fall back to any titled window.
$named = @($candidates | Where-Object { $_.Title -match 'DeepSeek' })
if ($named.Count -gt 0) { $candidates = $named }

if ($ListOnly) {
    $candidates | ConvertTo-Json -Depth 3
    exit 0
}

# Prefer a visible window with a real title; otherwise any titled window (tray-hidden).
$target = $candidates | Where-Object { $_.Visible -and -not $_.Iconic } | Select-Object -First 1
if (-not $target) { $target = $candidates | Where-Object { $_.Visible } | Select-Object -First 1 }
if (-not $target) { $target = $candidates | Select-Object -First 1 }
if (-not $target) {
    Write-Output '{"ok":false,"reason":"no-window"}'
    exit 2
}

$hwnd = $target.Handle

# Hidden-to-tray windows are not "minimized": show them explicitly first.
if (-not [DshClockWin32]::IsWindowVisible($hwnd)) {
    [void][DshClockWin32]::ShowWindow($hwnd, 5)   # SW_SHOW
    Start-Sleep -Milliseconds 40
}

# Restore/show the window (SW_RESTORE = 9 also un-minimizes).
[void][DshClockWin32]::ShowWindow($hwnd, 9)
Start-Sleep -Milliseconds 60

# A plain system "ding" is the last-resort fallback: it is audible even when
# Windows refuses to hand foreground to a background process.
try { [System.Media.SystemSounds]::Exclamation.Play() } catch { }

# Windows may refuse foreground changes from a background process. Try the
# plain call first; only tap Alt when it fails (tapping Alt unconditionally can
# open menus in some games).
$focused = [DshClockWin32]::SetForegroundWindow($hwnd)
if (-not $focused) {
    [void][DshClockWin32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    $focused = [DshClockWin32]::SetForegroundWindow($hwnd)
    [void][DshClockWin32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

$flash = New-Object DshClockWin32+FLASHWINFO
$flash.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($flash)
$flash.hwnd = $hwnd
$flash.dwFlags = 3      # FLASHW_ALL
$flash.uCount = 6
$flash.dwTimeout = 0
[void][DshClockWin32]::FlashWindowEx([ref]$flash)

$result = [pscustomobject]@{
    ok        = $true
    title     = $target.Title
    pid       = $target.Pid
    visible   = $target.Visible
    iconic    = $target.Iconic
    focused   = $focused
}
$result | ConvertTo-Json -Compress
exit 0
