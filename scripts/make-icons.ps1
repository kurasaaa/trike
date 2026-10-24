# Generates the Android launcher icons from the app's own "PN" brand mark
# (.brand-mark in styles.css: --teal-bright square, --navy-deep text, on --navy).
# Run from the project root:  powershell -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$res   = "android/app/src/main/res"
$navy  = [System.Drawing.ColorTranslator]::FromHtml('#0A3543')
$teal  = [System.Drawing.ColorTranslator]::FromHtml('#17C3B2')
$ink   = [System.Drawing.ColorTranslator]::FromHtml('#082830')

function RoundRect($g, $brush, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); $g.FillPath($brush, $p); $p.Dispose()
}
# Draws the PN mark centred in a square canvas; $mark = mark size in px.
function Mark($g, $size, $mark) {
  $o = ($size - $mark) / 2
  RoundRect $g (New-Object System.Drawing.SolidBrush $teal) $o $o $mark $mark ($mark * 10 / 34)
  $font = New-Object System.Drawing.Font('Segoe UI', ($mark * 0.44), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('PN', $font, (New-Object System.Drawing.SolidBrush $ink), (New-Object System.Drawing.RectangleF($o, ($o + $mark * 0.02), $mark, $mark)), $sf)
}
function NewCanvas($size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

$densities = @{ 'mdpi' = 1; 'hdpi' = 1.5; 'xhdpi' = 2; 'xxhdpi' = 3; 'xxxhdpi' = 4 }
foreach ($d in $densities.Keys) {
  $s = $densities[$d]; $dir = "$res/mipmap-$d"
  # adaptive foreground: 108dp canvas, mark inside the 66dp safe zone
  $fg = 108 * $s; $bmp, $g = NewCanvas $fg; Mark $g $fg (56 * $s)
  $bmp.Save("$dir/ic_launcher_foreground.png", [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
  # legacy square icon: 48dp
  $sz = 48 * $s; $bmp, $g = NewCanvas $sz
  RoundRect $g (New-Object System.Drawing.SolidBrush $navy) 0 0 $sz $sz ($sz * 0.18); Mark $g $sz ($sz * 0.62)
  $bmp.Save("$dir/ic_launcher.png", [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
  # legacy round icon
  $bmp, $g = NewCanvas $sz
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $navy), 0, 0, $sz, $sz); Mark $g $sz ($sz * 0.56)
  $bmp.Save("$dir/ic_launcher_round.png", [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
Write-Output "Launcher icons written."
