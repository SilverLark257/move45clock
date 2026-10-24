# Move45clock - always-on-top reminder window (Windows only).
# UI text arrives base64-encoded UTF-8, so this file stays pure ASCII and
# Chinese survives Windows PowerShell 5.1 whatever the console code page is.
param(
    [string]$TitleB64 = '',
    [string]$PlanB64 = '',
    [string]$DetailB64 = '',
    [string]$MetaB64 = '',
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

# -- helpers ---------------------------------------------------------------
function ConvertFrom-B64Text {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function New-Color {
    param([string]$Hex)
    return [System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString($Hex)
}

function New-SolidBrush {
    param([System.Windows.Media.Color]$Color)
    return (New-Object System.Windows.Media.SolidColorBrush $Color)
}

function New-GradientBrush {
    param([string]$From, [string]$To)
    $brush = New-Object System.Windows.Media.LinearGradientBrush
    $brush.StartPoint = New-Object System.Windows.Point 0, 0
    $brush.EndPoint = New-Object System.Windows.Point 1, 1
    $start = New-Object System.Windows.Media.GradientStop
    $start.Color = New-Color $From
    $start.Offset = 0
    $end = New-Object System.Windows.Media.GradientStop
    $end.Color = New-Color $To
    $end.Offset = 1
    [void]$brush.GradientStops.Add($start)
    [void]$brush.GradientStops.Add($end)
    return $brush
}

function New-SoftShadow {
    param([double]$Blur, [double]$Depth, [double]$Opacity)
    $effect = New-Object System.Windows.Media.Effects.DropShadowEffect
    $effect.BlurRadius = $Blur
    $effect.ShadowDepth = $Depth
    $effect.Opacity = $Opacity
    $effect.Direction = 270
    $effect.Color = New-Color '#6B3A12'
    return $effect
}

$fontName = 'Microsoft YaHei UI'
$emojiFont = 'Segoe UI Emoji'
$accent = New-Color '#E0572B'
$ink = New-Color '#6B451F'
$soft = New-Color '#9A6A33'
$muted = New-Color '#B3854D'

$titleText = ConvertFrom-B64Text $TitleB64
$planText = ConvertFrom-B64Text $PlanB64
$detailText = ConvertFrom-B64Text $DetailB64
$metaText = ConvertFrom-B64Text $MetaB64
$footerText = ConvertFrom-B64Text $FooterB64
$openText = ConvertFrom-B64Text $OpenB64
$laterText = ConvertFrom-B64Text $LaterB64
if ([string]::IsNullOrWhiteSpace($openText)) { $openText = 'Open DSH' }
if ([string]::IsNullOrWhiteSpace($laterText)) { $laterText = 'Later' }

# -- window shell ----------------------------------------------------------
$window = New-Object System.Windows.Window
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.Width = 380
$window.SizeToContent = [System.Windows.SizeToContent]::Height
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$window.FontFamily = New-Object System.Windows.Media.FontFamily $fontName

$frame = New-Object System.Windows.Controls.Border
$frame.Background = New-GradientBrush '#FFFBF4' '#FFF0DB'
$frame.BorderBrush = New-SolidBrush (New-Color '#FFD9A0')
$frame.BorderThickness = New-Object System.Windows.Thickness 1.5
$frame.CornerRadius = New-Object System.Windows.CornerRadius 20
$frame.Padding = New-Object System.Windows.Thickness 18, 15, 18, 15
$frame.Margin = New-Object System.Windows.Thickness 10
$frame.Effect = New-SoftShadow 26 5 0.18

$stack = New-Object System.Windows.Controls.StackPanel

# -- header: chick badge + title -------------------------------------------
$header = New-Object System.Windows.Controls.StackPanel
$header.Orientation = [System.Windows.Controls.Orientation]::Horizontal

$badge = New-Object System.Windows.Controls.Border
$badge.Width = 32
$badge.Height = 32
$badge.CornerRadius = New-Object System.Windows.CornerRadius 16
$badge.Background = New-SolidBrush (New-Color '#FFE3C2')
$badge.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

$badgeText = New-Object System.Windows.Controls.TextBlock
$badgeText.Text = [char]::ConvertFromUtf32(0x1F423)
$badgeText.FontFamily = New-Object System.Windows.Media.FontFamily $emojiFont
$badgeText.FontSize = 16
$badgeText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$badgeText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$badge.Child = $badgeText
[void]$header.Children.Add($badge)

$title = New-Object System.Windows.Controls.TextBlock
$title.Text = $titleText
$title.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$title.FontSize = 17
$title.FontWeight = [System.Windows.FontWeights]::Bold
$title.Foreground = New-SolidBrush $accent
$title.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$title.Margin = New-Object System.Windows.Thickness 10, 0, 0, 0
[void]$header.Children.Add($title)
[void]$stack.Children.Add($header)

# -- body ------------------------------------------------------------------
$plan = New-Object System.Windows.Controls.TextBlock
$plan.Text = $planText
$plan.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$plan.FontSize = 14
$plan.FontWeight = [System.Windows.FontWeights]::SemiBold
$plan.Foreground = New-SolidBrush $ink
$plan.TextWrapping = [System.Windows.TextWrapping]::Wrap
$plan.Margin = New-Object System.Windows.Thickness 0, 11, 0, 0
[void]$stack.Children.Add($plan)

if (-not [string]::IsNullOrWhiteSpace($detailText)) {
    $detail = New-Object System.Windows.Controls.TextBlock
    $detail.Text = $detailText
    $detail.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
    $detail.FontSize = 12.5
    $detail.Foreground = New-SolidBrush $soft
    $detail.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $detail.LineHeight = 19
    $detail.Margin = New-Object System.Windows.Thickness 0, 3, 0, 0
    [void]$stack.Children.Add($detail)
}

if (-not [string]::IsNullOrWhiteSpace($metaText)) {
    $meta = New-Object System.Windows.Controls.TextBlock
    $meta.Text = $metaText
    $meta.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
    $meta.FontSize = 11.5
    $meta.Foreground = New-SolidBrush $muted
    $meta.Margin = New-Object System.Windows.Thickness 0, 7, 0, 0
    [void]$stack.Children.Add($meta)
}

$divider = New-Object System.Windows.Controls.Border
$divider.Height = 1
$divider.Background = New-SolidBrush (New-Color '#F4E2C8')
$divider.Margin = New-Object System.Windows.Thickness 0, 11, 0, 0
[void]$stack.Children.Add($divider)

$footer = New-Object System.Windows.Controls.TextBlock
$footer.Text = $footerText
$footer.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
$footer.FontSize = 10.5
$footer.Foreground = New-SolidBrush $muted
$footer.Margin = New-Object System.Windows.Thickness 0, 8, 0, 0
[void]$stack.Children.Add($footer)

# -- buttons ---------------------------------------------------------------
$buttons = New-Object System.Windows.Controls.StackPanel
$buttons.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$buttons.Margin = New-Object System.Windows.Thickness 0, 12, 0, 0

$primaryNormal = New-GradientBrush '#FFB265' '#F4747E'
$primaryHover = New-GradientBrush '#FFC27F' '#FA8A93'
$secondaryNormal = New-SolidBrush #FFFFFF
$secondaryHover = New-SolidBrush (New-Color '#FFF4E3')

function New-Pill {
    param([string]$Text, [bool]$Primary)
    $pill = New-Object System.Windows.Controls.Border
    $pill.CornerRadius = New-Object System.Windows.CornerRadius 18
    $pill.Padding = New-Object System.Windows.Thickness 18, 7, 18, 7
    $pill.Height = 36
    $pill.Margin = New-Object System.Windows.Thickness 0, 0, 9, 0
    $pill.Cursor = [System.Windows.Input.Cursors]::Hand
    $pill.RenderTransform = New-Object System.Windows.Media.ScaleTransform 1, 1
    $pill.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5

    if ($Primary) {
        $pill.Background = $primaryNormal
        $pill.Effect = New-SoftShadow 10 2 0.28
        $pill.Tag = @{ Normal = $primaryNormal; Hover = $primaryHover }
        $labelColor = [System.Windows.Media.Colors]::White
    } else {
        $pill.Background = $secondaryNormal
        $pill.BorderBrush = New-SolidBrush (New-Color '#F0CFA5')
        $pill.BorderThickness = New-Object System.Windows.Thickness 1.2
        $pill.Tag = @{ Normal = $secondaryNormal; Hover = $secondaryHover }
        $labelColor = New-Color '#B45A1E'
    }

    $content = New-Object System.Windows.Controls.StackPanel
    $content.Orientation = [System.Windows.Controls.Orientation]::Horizontal

    if ($Primary) {
        $icon = New-Object System.Windows.Shapes.Path
        $icon.Data = [System.Windows.Media.Geometry]::Parse('M 0,0 L 7,4.5 L 0,9 Z')
        $icon.Fill = [System.Windows.Media.Brushes]::White
        $icon.Width = 7
        $icon.Height = 9
        $icon.Stretch = [System.Windows.Media.Stretch]::None
        $icon.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
        $icon.Margin = New-Object System.Windows.Thickness 0, 1, 7, 0
        [void]$content.Children.Add($icon)
    }

    $label = New-Object System.Windows.Controls.TextBlock
    $label.Text = $Text
    $label.FontFamily = New-Object System.Windows.Media.FontFamily $fontName
    $label.FontSize = 12.5
    $label.FontWeight = [System.Windows.FontWeights]::SemiBold
    $label.Foreground = New-SolidBrush $labelColor
    $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [void]$content.Children.Add($label)
    $pill.Child = $content

    $pill.Add_MouseEnter({
        $this.Background = $this.Tag.Hover
        $this.RenderTransform.ScaleX = 1.03
        $this.RenderTransform.ScaleY = 1.03
    })
    $pill.Add_MouseLeave({
        $this.Background = $this.Tag.Normal
        $this.RenderTransform.ScaleX = 1
        $this.RenderTransform.ScaleY = 1
    })
    $pill.Add_MouseLeftButtonDown({
        $this.RenderTransform.ScaleX = 0.97
        $this.RenderTransform.ScaleY = 0.97
    })
    $pill.Add_MouseLeftButtonUp({
        $this.RenderTransform.ScaleX = 1.03
        $this.RenderTransform.ScaleY = 1.03
    })
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
    $window.Left = $area.Right - $window.ActualWidth - 6
    $window.Top = $area.Bottom - $window.ActualHeight - 6
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds([Math]::Max(3, $Seconds))
$timer.Add_Tick({
    $timer.Stop()
    $window.Close()
})
$timer.Start()

[void]$window.ShowDialog()
