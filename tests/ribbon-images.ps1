param([Parameter(Mandatory=$true)][string]$OutputDirectory,[string]$AssemblyPath=(Join-Path $PSScriptRoot '..\word-addin\bin\ZoteroBatchCitations.dll'))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a fresh image evidence directory.'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Drawing
$path=$AssemblyPath
$assembly=[Reflection.Assembly]::LoadFrom([IO.Path]::GetFullPath($path))
$get=$assembly.GetType('ZoteroBatchCitations.RibbonImages').GetMethod('Get',[Reflection.BindingFlags]'Public,Static')
$checks=New-Object 'System.Collections.Generic.List[string]'
$images=@()
function Check([string]$Name,[bool]$Value){if(-not $Value){throw "Check failed: $Name"};$checks.Add($Name);Write-Output "PASS: $Name"}
function InkBottom($Bitmap,[int]$Start,[int]$End){
    $bottom=-1
    for($x=$Start;$x -lt $End;$x++){for($y=0;$y -lt $Bitmap.Height;$y++){if($Bitmap.GetPixel($x,$y).A -gt 128){$bottom=[Math]::Max($bottom,$y)}}}
    return $bottom
}
$preview=New-Object Drawing.Bitmap(340,310)
$graphics=[Drawing.Graphics]::FromImage($preview)
$font=New-Object Drawing.Font('Segoe UI',12,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$graphics.Clear([Drawing.Color]::FromArgb(245,245,245))
try{
    $row=0
    foreach($id in @('batch','display','inline','superscript')){
        $picture=$get.Invoke($null,@($id))
        $pictureType=$picture.GetType().InvokeMember('Type',[Reflection.BindingFlags]::GetProperty,$null,$picture,$null)
        $handle=$picture.GetType().InvokeMember('Handle',[Reflection.BindingFlags]::GetProperty,$null,$picture,$null)
        Check "$id uses a native OLE icon" ($pictureType -eq 3 -and $handle -ne 0)
        $icon=[Drawing.Icon]::FromHandle([IntPtr][long]$handle)
        $bitmap=$icon.ToBitmap()
        try{
            $bitmap.Save((Join-Path $OutputDirectory ($id+'.png')),[Drawing.Imaging.ImageFormat]::Png)
            $size=if($id -in @('inline','superscript')){16}else{32}
            Check "$id has the expected Ribbon size and transparent background" ($bitmap.Width -eq $size -and $bitmap.Height -eq $size -and $bitmap.GetPixel(0,0).A -eq 0 -and $bitmap.GetPixel($size-1,$size-1).A -eq 0)
            Check "$id reuses its cached picture" ([object]::ReferenceEquals($picture,$get.Invoke($null,@($id))))
            if($id -eq 'batch'){
                $centered=$true;$stemCentered=$false
                for($cell=0;$cell -lt 4;$cell++){
                    $ox=($cell%2)*16;$oy=[Math]::Floor($cell/2)*16;$xs=@();$ys=@();$grayX=@();$grayY=@()
                    for($x=$ox;$x -lt 16+$ox;$x++){for($y=$oy;$y -lt 16+$oy;$y++){
                        $c=$bitmap.GetPixel($x,$y)
                        if($c.A -gt 96 -and $c.B -gt $c.R+25 -and $c.B -gt $c.G+25){$xs+=$x;$ys+=$y}
                        if($c.A -gt 96 -and $c.R -lt 190 -and [Math]::Abs($c.R-$c.B) -lt 22 -and [Math]::Abs($c.R-$c.G) -lt 22){$grayX+=$x;$grayY+=$y}
                    }}
                    if(-not $xs.Count -or -not $grayX.Count){$centered=$false;continue}
                    $xm=$xs|Measure-Object -Minimum -Maximum;$ym=$ys|Measure-Object -Minimum -Maximum
                    $gx=$grayX|Measure-Object -Minimum -Maximum;$gy=$grayY|Measure-Object -Minimum -Maximum
                    $cx=($gx.Minimum+$gx.Maximum)/2;$cy=($gy.Minimum+$gy.Maximum)/2
                    if([Math]::Abs(($xm.Minimum+$xm.Maximum)/2-$cx) -gt 1 -or [Math]::Abs(($ym.Minimum+$ym.Maximum)/2-$cy) -gt 1){$centered=$false}
                    if($cell -eq 0){
                        $stem=@();$mid=[int][Math]::Floor($cy)
                        for($x=0;$x -lt 16;$x++){$c=$bitmap.GetPixel($x,$mid);if($c.A -gt 96 -and $c.B -gt $c.R+25 -and $c.B -gt $c.G+25){$stem+=$x}}
                        if($stem.Count){$measure=$stem|Measure-Object -Average;$stemCentered=[Math]::Abs($measure.Average-$cx) -le 0.75}
                    }
                }
                Check 'all four numbers are centered within their own rendered brackets' $centered
                Check 'the vertical stem of one is optically centered' $stemCentered
            }
            if($id -eq 'display'){
                $inside=$true;$count=0
                for($x=0;$x -lt 32;$x++){for($y=0;$y -lt 32;$y++){$c=$bitmap.GetPixel($x,$y);if($c.A -gt 96 -and $c.B -gt $c.R+25 -and $c.B -gt $c.G+25){$count++;if($x -lt 6 -or $x -gt 25 -or $y -lt 7 -or $y -gt 28){$inside=$false}}}}
                Check 'both display glyphs stay inside the document with safe margins' ($inside -and $count -gt 20)
            }
            if($id -eq 'inline'){Check 'inline X and 2 share the same visual baseline' ([Math]::Abs((InkBottom $bitmap 0 9)-(InkBottom $bitmap 9 16)) -le 1)}
            if($id -eq 'superscript'){Check 'superscript 2 is visibly raised above X' ((InkBottom $bitmap 9 16) -le (InkBottom $bitmap 0 9)-2)}
            $bitmap.Save((Join-Path $OutputDirectory ($id+'.png')),[Drawing.Imaging.ImageFormat]::Png)
            $graphics.DrawString($id,$font,[Drawing.Brushes]::Black,8,20+$row*76)
            $graphics.DrawImageUnscaled($bitmap,110,16+$row*76)
            $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::NearestNeighbor; $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::Half; $graphics.DrawImage($bitmap,170,4+$row*76,$size*2,$size*2)
            $images+=@{id=$id;width=$size;height=$size;type=$pictureType;transparent=$true}
        }finally{$bitmap.Dispose()}
        $row++
    }
    $preview.Save((Join-Path $OutputDirectory 'ribbon-icons.png'),[Drawing.Imaging.ImageFormat]::Png)
    @{ok=$true;method='Actual OLE picture round-trip and pixel checks; no desktop screenshot';checks=$checks;images=$images;wordAddinSHA256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;finished=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Encoding UTF8
}finally{$graphics.Dispose();$preview.Dispose();$font.Dispose()}
