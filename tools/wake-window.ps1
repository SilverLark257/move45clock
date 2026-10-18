param(
  [switch]$ListOnly,
  [string]$ProcessName = 'DeepSeek Harness'
)

# ASCII-only on purpose: works under Windows PowerShell 5.1 and 7 without a BOM.
$ErrorActionPreference = 'Stop'

# Small append-only diagnostic log. Harmless in production and invaluable when
# the window does not come back: it records every branch this script took.
$WAKE_LOG = Join-Path $env:TEMP 'dsh-clock-wake.log'
function Write-WakeLog([string]$message) {
    try {
        Add-Content -LiteralPath $WAKE_LOG -Value ((Get-Date -Format 'HH:mm:ss.fff') + ' ' + $message) -Encoding Ascii
    } catch { }
}

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
$wasVisible = [DshClockWin32]::IsWindowVisible($hwnd)
$wasIconic = [DshClockWin32]::IsIconic($hwnd)
Write-WakeLog "start hwnd=$hwnd pid=$($target.Pid) wasVisible=$wasVisible wasIconic=$wasIconic"

function Find-DshTrayButton {
    param($scope)

    $items = $scope.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($item in $items) {
        if ($item.Current.ClassName -eq 'SystemTray.NormalButton' -and $item.Current.Name -match 'DeepSeek') {
            return $item
        }
    }
    return $null
}

<#
    Invoke the DSH tray icon exactly like the user does.

    Why this is the only reliable path:
    the app's X button calls window.hide(); Win32 ShowWindow makes the HWND
    visible but Electron still thinks the page is hidden, so Chromium never
    repaints (the user sees the old frame and an invisible click blocker).
    A tray click runs focusPrimaryWindow() INSIDE Electron: restore + show +
    focus, which marks the page visible and repaints it.

    Returns $true when the icon was found and invoked.
#>
function Invoke-DshTrayIcon {
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop

        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $tray = $root.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ClassNameProperty,
                'Shell_TrayWnd'
            ))
        )
        if ($null -eq $tray) {
            Write-WakeLog 'tray: Shell_TrayWnd not found'
            return $false
        }

        $targetButton = Find-DshTrayButton -scope $tray
        if ($null -eq $targetButton) {
            # The icon lives in the overflow: click the chevron first. The
            # chevron is the leftmost SystemTray.NormalButton of the tray group.
            $items = $tray.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            $opener = $null
            $minX = [double]::MaxValue
            foreach ($item in $items) {
                if ($item.Current.ClassName -ne 'SystemTray.NormalButton') { continue }
                $rect = $item.Current.BoundingRectangle
                if ($rect.Width -le 0) { continue }
                if ($rect.X -lt $minX) {
                    $minX = $rect.X
                    $opener = $item
                }
            }
            if ($null -eq $opener) {
                Write-WakeLog 'tray: overflow opener not found'
                return $false
            }

            $opener.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            Start-Sleep -Milliseconds 600

            $windows = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Children,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            foreach ($window in $windows) {
                if ($window.Current.ClassName -match 'Overflow|NotifyIcon') {
                    $targetButton = Find-DshTrayButton -scope $window
                    if ($null -ne $targetButton) { break }
                }
            }

            if ($null -eq $targetButton) {
                Write-WakeLog 'tray: DSH icon not found in overflow'
                # Close the panel again so we do not leave it hanging open.
                try { $opener.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { }
                return $false
            }
        }

        $targetButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-WakeLog 'tray: invoked DSH icon'
        return $true
    } catch {
        Write-WakeLog "tray: UIA failed: $($_.Exception.Message)"
        return $false
    }
}

$shownByTray = $false
if (-not $wasVisible -or $wasIconic) {
    $shownByTray = Invoke-DshTrayIcon
    if ($shownByTray) {
        # Electron needs a moment to show and focus the window.
        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Milliseconds 200
            if ([DshClockWin32]::IsWindowVisible($hwnd) -and -not [DshClockWin32]::IsIconic($hwnd)) { break }
        }
    }
}
Write-WakeLog "after tray: visible=$([DshClockWin32]::IsWindowVisible($hwnd)) iconic=$([DshClockWin32]::IsIconic($hwnd)) trayUsed=$shownByTray"

if (-not [DshClockWin32]::IsWindowVisible($hwnd) -or [DshClockWin32]::IsIconic($hwnd)) {
    # Fallback: Win32 restore/show, then a second instance (best effort).
    if (-not [DshClockWin32]::IsWindowVisible($hwnd)) {
        [void][DshClockWin32]::ShowWindow($hwnd, 5)   # SW_SHOW
        Start-Sleep -Milliseconds 40
    }
    [void][DshClockWin32]::ShowWindow($hwnd, 9)       # SW_RESTORE
    Start-Sleep -Milliseconds 60
    Write-WakeLog "after ShowWindow visible=$([DshClockWin32]::IsWindowVisible($hwnd)) iconic=$([DshClockWin32]::IsIconic($hwnd))"

    try {
        $exe = (Get-Process -Id $target.Pid -ErrorAction SilentlyContinue).Path
        if ($exe) {
            Write-WakeLog "launching second instance: $exe"
            Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
            Start-Sleep -Milliseconds 300
            Write-WakeLog 'second instance returned'
        }
    } catch {
        Write-WakeLog "second instance failed: $($_.Exception.Message)"
    }
}

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
    tray      = $shownByTray
    focused   = $focused
}
Write-WakeLog "done focused=$focused visibleNow=$([DshClockWin32]::IsWindowVisible($hwnd)) iconicNow=$([DshClockWin32]::IsIconic($hwnd))"
$result | ConvertTo-Json -Compress
exit 0
