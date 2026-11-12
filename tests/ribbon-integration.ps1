param([Parameter(Mandatory=$true)][string]$OriginalTemplate,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\word-addin\RibbonIntegration.ps1')
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$template=Join-Path $OutputDirectory 'Zotero-ZBC-Test.dotm'
$state=Join-Path $OutputDirectory 'backup'
if(Test-Path -LiteralPath $template){throw 'Use a fresh ribbon test directory.'}
Copy-Item -LiteralPath $OriginalTemplate -Destination $template
$checks=New-Object 'System.Collections.Generic.List[string]'
function Check([string]$Name,[bool]$Value){if(-not $Value){throw "Check failed: $Name"};$checks.Add($Name);Write-Output "PASS: $Name"}
function Entries([string]$Path){
    $zip=[IO.Compression.ZipFile]::OpenRead($Path);$result=@{}
    try{foreach($entry in $zip.Entries){$stream=$entry.Open();$memory=New-Object IO.MemoryStream;try{$stream.CopyTo($memory);$result[$entry.FullName]=[Convert]::ToBase64String($memory.ToArray())}finally{$stream.Dispose();$memory.Dispose()}}}finally{$zip.Dispose()}
    return $result
}
try{
    $before=Entries $template;$originalHash=Get-RibbonHash $template
    $result=Enable-ZoteroRibbon $template $state;$after=Entries $template
    Check 'only the ribbon XML entry changes; native VBA macros and other parts remain byte-identical' ($before.Count -eq $after.Count -and @($before.Keys|Where-Object {$_ -notlike 'customUI/*' -and $before[$_] -ne $after[$_]}).Count -eq 0)
    [xml]$xml=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($after['customUI/customUI.xml']))
    $tab=$xml.SelectSingleNode("//*[local-name()='tab' and @idQ]");$q=$tab.GetAttribute('idQ').Split(':')
    Check 'the native Zotero tab uses the shared namespace' ($q[1] -eq 'ZoteroTab' -and $tab.GetNamespaceOfPrefix($q[0]) -eq $script:ZBCRibbonNamespace -and -not $tab.HasAttribute('id'))
    [xml]$old=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($before['customUI/customUI.xml']))
    $oldTab=$old.SelectSingleNode("//*[local-name()='tab']")
    Check 'native Zotero controls and callback attributes are preserved' ($oldTab.InnerXml -eq $tab.InnerXml -and $oldTab.GetAttribute('getLabel') -eq $tab.GetAttribute('getLabel'))
    $patchedHash=Get-RibbonHash $template;$repeat=Enable-ZoteroRibbon $template $state
    Check 'repeated installation is idempotent' (-not $repeat.changed -and (Get-RibbonHash $template) -eq $patchedHash)
    $null=Restore-ZoteroRibbon $state
    Check 'uninstall restores the exact original template bytes' ((Get-RibbonHash $template) -eq $originalHash)
    $null=Enable-ZoteroRibbon $template $state
    Copy-Item -LiteralPath $OriginalTemplate -Destination $template -Force
    $zip=[IO.Compression.ZipFile]::Open($template,[IO.Compression.ZipArchiveMode]::Update)
    try{$entry=$zip.CreateEntry('vendor-update-test.xml');$writer=New-Object IO.StreamWriter($entry.Open());try{$writer.Write('<synthetic-vendor-update/>')}finally{$writer.Dispose()}}finally{$zip.Dispose()}
    $vendorHash=Get-RibbonHash $template;$null=Restore-ZoteroRibbon $state
    Check 'uninstall preserves a template replaced by a later Zotero update' ((Get-RibbonHash $template) -eq $vendorHash)
    $null=Enable-ZoteroRibbon $template $state;$null=Restore-ZoteroRibbon $state
    Check 'repair backs up and can restore the newer official template' ((Get-RibbonHash $template) -eq $vendorHash)
    # Leave a fresh shared template for the actual Word host test.
    $null=Enable-ZoteroRibbon $template $state
    @{ok=$true;checks=$checks;originalTemplateSHA256=$originalHash;templatePath=$template;patchedSHA256=(Get-RibbonHash $template)}|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $OutputDirectory 'ribbon-result.json') -Encoding UTF8
}catch{@{ok=$false;checks=$checks;error=$_.Exception.Message;stack=$_.ScriptStackTrace}|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $OutputDirectory 'ribbon-result.json') -Encoding UTF8;throw}
