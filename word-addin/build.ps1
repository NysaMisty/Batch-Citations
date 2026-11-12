param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'bin'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4 compiler was not found.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$assembly = Join-Path $OutputDirectory 'ZoteroBatchCitations.dll'
$sources = @('BridgeClient.cs', 'Diagnostics.cs', 'WordDocument.cs', 'DocumentEvents.cs', 'WordLauncher.cs', 'Toast.cs', 'RibbonImages.cs', 'Connect.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$extensibility = Join-Path $env:WINDIR 'assembly\GAC\Extensibility\7.0.3300.0__b03f5f7f11d50a3a\extensibility.dll'
$office = Get-ChildItem -LiteralPath (Join-Path $env:WINDIR 'assembly\GAC_MSIL\office') -Recurse -Filter office.dll | Select-Object -Last 1 -ExpandProperty FullName
$word = Get-ChildItem -LiteralPath (Join-Path $env:WINDIR 'assembly\GAC_MSIL\Microsoft.Office.Interop.Word') -Recurse -Filter Microsoft.Office.Interop.Word.dll | Select-Object -Last 1 -ExpandProperty FullName
if (-not $office -or -not (Test-Path -LiteralPath $extensibility)) { throw 'Office interop metadata required to build was not found.' }
# Embed only interface metadata, so installed users need no separate PIA or VSTO package.
$iconResources = @()
foreach($icon in @('batch','display')) {
    $iconPath=Join-Path $PSScriptRoot ('icons\'+$icon+'-ribbon.png')
    $iconResources += "/resource:$iconPath,ZoteroBatchCitations.Icons.$icon"
}
& $compiler /nologo /target:library /platform:anycpu /optimize+ "/out:$assembly" "/link:$extensibility" "/link:$office" "/link:$word" /reference:System.dll /reference:System.Core.dll /reference:System.Xml.dll /reference:Microsoft.CSharp.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $iconResources $sources
if ($LASTEXITCODE -ne 0) { throw 'Word add-in compilation failed.' }
$sourceHashes=[ordered]@{}
foreach($source in @($sources)+@((Join-Path $PSScriptRoot 'build.ps1'))+@(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'icons') -File -Filter '*-ribbon.png'|Select-Object -ExpandProperty FullName)){
    $relative=$source.Substring($PSScriptRoot.Length+1).Replace('\','/')
    $sourceHashes[$relative]=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
}
@{version=[Reflection.AssemblyName]::GetAssemblyName($assembly).Version.ToString();assemblySHA256=(Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant();sources=$sourceHashes}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $OutputDirectory 'build-info.json') -Encoding UTF8
Get-Item -LiteralPath $assembly | Select-Object Name, Length
