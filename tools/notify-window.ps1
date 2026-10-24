# Move45clock - always-on-top reminder window (Windows only).
# UI text arrives base64-encoded UTF-8, so this file stays pure ASCII and
# Chinese survives Windows PowerShell 5.1 whatever the console code page is.
param(
    [string]$TitleB64 = '',
    [string]$BodyB64 = '',
    [string]$FooterB64 = '',
    [string]$OpenB64 = '',
    [string]$LaterB64 = '',
    [string]$WakeScript = '',
    [int]$Seconds = 25
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

function ConvertFrom-B64Text {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function New-SolidBrush {
    param([System.Windows.Media.Color]$Color)
    return (New-Object System.Windows.Media.SolidColorBrush $Color)
}

$titleText = ConvertFrom-B64Text $TitleB64
$bodyText = ConvertFrom-B64Text $BodyB64
$footerText = ConvertFrom-B64Text $FooterB64
$openText = ConvertFrom-B64Text $OpenB64
$laterText = ConvertFrom-B64Text $LaterB64
if ([string]::IsNullOrWhiteSpace($openText)) { $openText = 'Open DSH' }
if ([string]::IsNullOrWhiteSpace($laterText)) { $laterText = 'Later' }

$fontName = 'Microsoft YaHei UI'
$accent = [System.Windows.Media.Color]::FromRgb(217, 96, 26)
$ink = [System.Windows.Media.Color]::FromRgb(91, 58, 26)
$muted = [System.Windows.Media.Color]::FromRgb(179, 133, 77)
$paper = [System.Windows.Media.Color]::FromRgb(255, 246, 229)
$line = [System.Windows.Media.Color]::FromRgb(255, 217, 160)

$window = New-Object System.Windows.Window
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.Width = 360
$window.SizeToContent = [System.Windows.SizeToContent]::Height
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual

$frame = New-Object System.Windows.Controls.Border
$frame.Background = New-SolidBrush $paper
$frame.BorderBrush = New-SolidBrush $line
$frame.BorderThickness = New-Object System.Windows.Thickness 2
$frame.CornerRadius = New-Object System.Windows.CornerRadius 18
$frame.Padding = New-Object System.Windows.Thickness 18, 14, 18, 14

$stack = New-Object System.Windows.Controls.StackPanel

$title = New-Object System.Windows.Controls.TextBlock
$title.Text = $titleText
$title.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$title.FontSize = 18
$title.FontWeight = [System.Windows.FontWeights]::Bold
$title.Foreground = New-SolidBrush $accent
[void]$stack.Children.Add($title)

$body = New-Object System.Windows.Controls.TextBlock
$body.Text = $bodyText
$body.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$body.FontSize = 13
$body.Foreground = New-SolidBrush $ink
$body.TextWrapping = [System.Windows.TextWrapping]::Wrap
$body.Margin = New-Object System.Windows.Thickness 0, 8, 0, 0
[void]$stack.Children.Add($body)

$footer = New-Object System.Windows.Controls.TextBlock
$footer.Text = $footerText
$footer.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$footer.FontSize = 11
$footer.Foreground = New-SolidBrush $muted
$footer.Margin = New-Object System.Windows.Thickness 0, 10, 0, 0
[void]$stack.Children.Add($footer)

$buttons = New-Object System.Windows.Controls.StackPanel
$buttons.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$buttons.Margin = New-Object System.Windows.Thickness 0, 12, 0, 0

function New-Pill {
    param([string]$Text, [bool]$Primary)
    $pill = New-Object System.Windows.Controls.Border
    $pill.CornerRadius = New-Object System.Windows.CornerRadius 999
    $pill.Padding = New-Object System.Windows.Thickness 16, 8, 16, 8
    $pill.Margin = New-Object System.Windows.Thickness 0, 0, 8, 0
    $pill.Cursor = [System.Windows.Input.Cursors]::Hand
    if ($Primary) {
        $pill.Background = New-SolidBrush ([System.Windows.Media.Color]::FromRgb(240, 120, 77))
        $labelColor = [System.Windows.Media.Colors]::White
    } else {
        $pill.Background = [System.Windows.Media.Brushes]::White
        $pill.BorderBrush = New-SolidBrush $line
        $pill.BorderThickness = New-Object System.Windows.Thickness 1.5
        $labelColor = $accent
    }
    $label = New-Object System.Windows.Controls.TextBlock
    $label.Text = $Text
    $label.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
    $label.FontSize = 13
    $label.FontWeight = [System.Windows.FontWeights]::Bold
    $label.Foreground = New-SolidBrush $labelColor
    $pill.Child = $label
    return $pill
}

$openPill = New-Pill $openText $true
$laterPill = New-Pill $laterText $false

$openPill.Add_MouseLeftButtonUp({
    try {
        if ($WakeScript -and (Test-Path -LiteralPath $WakeScript)) {
            $ps = Join-Path $PSHOME 'powershell.exe'
            if (-not (Test-Path -LiteralPath $ps)) { $ps = 'powershell.exe' }
            $quoted = '"' + $WakeScript + '"'
            Start-Process -FilePath $ps -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quoted, '-Quiet') -WindowStyle Hidden | Out-Null
        }
    } catch {
        # Opening DSH may fail (fullscreen game, policy); the window still closes.
    }
    $window.Close()
})

$laterPill.Add_MouseLeftButtonUp({
    $window.Close()
})

[void]$buttons.Children.Add($openPill)
[void]$buttons.Children.Add($laterPill)
[void]$stack.Children.Add($buttons)

$frame.Child = $stack
$window.Content = $frame

$window.Add_Loaded({
    $area = [System.Windows.SystemParameters]::WorkArea
    $window.Left = $area.Right - $window.ActualWidth - 18
    $window.Top = $area.Bottom - $window.ActualHeight - 18
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds([Math]::Max(3, $Seconds))
$timer.Add_Tick({
    $timer.Stop()
    $window.Close()
})
$timer.Start()

[void]$window.ShowDialog()
