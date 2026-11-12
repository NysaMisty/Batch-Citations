param([Parameter(Mandatory=$true)][string]$TestDirectory,[Parameter(Mandatory=$true)][string]$NativeTemplate,[string]$AssemblyPath,[switch]$BibliographyOnly,[switch]$ReliabilityOnly,[switch]$IntegrityOnly,[switch]$IdentityOnly,[switch]$IterationOnly,[switch]$IterationInteractionOnly,[switch]$ActivationOnly,[string]$SourceFixture,[switch]$BackgroundValidation)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop'){throw 'Run this Office COM test with Windows PowerShell (powershell.exe), before creating any test registration or process.'}
$TestDirectory=[IO.Path]::GetFullPath($TestDirectory)
$work=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')+'\'
if(-not $TestDirectory.StartsWith($work,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $TestDirectory -Leaf) -notlike 'test-*'){throw 'Use a named disposable test directory under the project work folder.'}
if(Get-Process WINWORD -ErrorAction SilentlyContinue){throw 'A Word process is already running; no registration or session changes were made.'}
if(-not(Test-Path -LiteralPath (Join-Path $TestDirectory 'connection.json'))){throw 'The isolated Zotero live runner must be ready first.'}
$backup=Join-Path $TestDirectory 'registration-before.json'
if(Test-Path -LiteralPath $backup){throw 'Use a fresh host test directory.'}
$nativeHash=(Get-FileHash -LiteralPath $NativeTemplate -Algorithm SHA256).Hash
$userTemplate=Join-Path $env:APPDATA 'Microsoft\Word\STARTUP\Zotero.dotm'
$userHash=if(Test-Path -LiteralPath $userTemplate){(Get-FileHash -LiteralPath $userTemplate -Algorithm SHA256).Hash}else{$null}
$template=Join-Path $TestDirectory 'ribbon\Zotero-ZBC-Test.dotm'
$state=Join-Path $TestDirectory 'word-template-state.json'
$started=$false;$loaded=$false
& (Join-Path $PSScriptRoot 'temporary-registration.ps1') -Action Save -BackupPath $backup
try{
    & (Join-Path $PSScriptRoot 'ribbon-integration.ps1') -OriginalTemplate $NativeTemplate -OutputDirectory (Join-Path $TestDirectory 'ribbon')
    & (Join-Path $PSScriptRoot '..\word-addin\install.ps1') -InstallDirectory (Join-Path $TestDirectory 'installed') -SourceAssemblyPath $AssemblyPath -ZoteroTemplatePath $template -RibbonStateDirectory (Join-Path $TestDirectory 'installation-ribbon-backup')
    if($IntegrityOnly){
        $candidate=Join-Path $TestDirectory 'installed\ZoteroBatchCitations.dll'
        if(-not (Test-Path -LiteralPath $candidate)){throw 'The isolated candidate add-in assembly was not installed.'}
        & (Join-Path $PSScriptRoot 'word-citation-integrity.ps1') -AssemblyPath $candidate -OutputDirectory (Join-Path $TestDirectory 'integrity')
        @{ok=$true;integrityOnly=$true;assembly=$candidate}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $TestDirectory 'integrity-result.json') -Encoding UTF8
        return
    }
    $seed=Join-Path $TestDirectory 'seed.docx';Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\examples\placeholder-demo.docx') -Destination $seed
    $wordExe=Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\WINWORD.EXE'
    $process=Start-Process -FilePath $wordExe -ArgumentList @('/x',('"'+$seed+'"')) -WindowStyle Hidden -PassThru
    $started=$true;$deadline=(Get-Date).AddSeconds(30);$word=$null
    do{
        try{$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}catch{Start-Sleep -Milliseconds 200}
        if((Get-Date) -gt $deadline){throw 'The normally launched isolated Word host did not become ready.'}
    }while($null -eq $word)
    if($word.Documents.Count -ne 1 -or $word.Documents.Item(1).FullName -ne $seed){throw 'The active Word host does not contain only the named seed document.'}
    $word.Visible=-not $BackgroundValidation;if(-not $BackgroundValidation){$word.Activate()}
    & (Join-Path $PSScriptRoot 'word-template-host.ps1') -Action Load -TestTemplate $template -StatePath $state
    $loaded=$true
    if($ActivationOnly){
        & (Join-Path $PSScriptRoot 'word-auto-check.ps1') -TestDirectory $TestDirectory -LeaveOpen -BackgroundValidation:$BackgroundValidation
    }elseif($IterationOnly){
        & (Join-Path $PSScriptRoot 'word-iteration-host.ps1') -TestDirectory $TestDirectory -SourceFixture $SourceFixture -InteractionsOnly:$IterationInteractionOnly
    }elseif($IdentityOnly){
        & (Join-Path $PSScriptRoot 'word-identity-host.ps1') -TestDirectory $TestDirectory -LeaveOpen
    }elseif($ReliabilityOnly){
        & (Join-Path $PSScriptRoot 'word-reliability.ps1') -TestDirectory $TestDirectory
    }elseif($BibliographyOnly){
        & (Join-Path $PSScriptRoot 'word-bibliography-reopen.ps1') -TestDirectory $TestDirectory
    }else{
    & (Join-Path $PSScriptRoot 'word-auto-check.ps1') -TestDirectory $TestDirectory -LeaveOpen -BackgroundValidation:$BackgroundValidation
    # The interaction suite deliberately leaves automatic submission on hold.
    # Resume the synthetic runner before exercising the existing core workflow.
    $controlResult=Join-Path $TestDirectory 'live-control-result.json'
    if(Test-Path -LiteralPath $controlResult){Remove-Item -LiteralPath $controlResult}
    @{action='submit'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $TestDirectory 'live-control.json') -Encoding UTF8
    $deadline=(Get-Date).AddSeconds(10)
    while(-not(Test-Path -LiteralPath $controlResult)){if((Get-Date) -gt $deadline){throw 'The synthetic runner did not resume submission.'};Start-Sleep -Milliseconds 100}
    if(-not(Get-Content -LiteralPath $controlResult -Raw -Encoding UTF8|ConvertFrom-Json).ok){throw 'The synthetic runner rejected submission.'}
    & (Join-Path $PSScriptRoot 'word-live.ps1') -TestDirectory $TestDirectory -ExistingWord -LeaveOpen
    & (Join-Path $PSScriptRoot 'word-bibliography-reopen.ps1') -TestDirectory $TestDirectory
    & (Join-Path $PSScriptRoot 'word-reliability.ps1') -TestDirectory $TestDirectory
    }
}finally{
    # Restore only the test session; preserve every document before closing it.
    if($started){
        @{action='close-dialogs'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $TestDirectory 'live-control.json') -Encoding UTF8
        $deadline=(Get-Date).AddSeconds(10)
        while(Test-Path -LiteralPath (Join-Path $TestDirectory 'live-control.json')){if((Get-Date) -gt $deadline){throw 'The isolated Zotero runner did not release its test dialogs.'};Start-Sleep -Milliseconds 100}
    }
    if($loaded){& (Join-Path $PSScriptRoot 'word-template-host.ps1') -Action Restore -TestTemplate $template -StatePath $state}
    if($started){
        $word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
        $root=$TestDirectory.TrimEnd('\')+'\'
        foreach($doc in @($word.Documents)){
            if(-not ([IO.Path]::GetFullPath($doc.FullName)).StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'An unrelated document is open; leaving Word and the registration backup intact.'}
            if(-not $doc.Saved){$doc.Save()}
        }
        & (Join-Path $PSScriptRoot 'close-word-fixtures.ps1') -TestDirectory $TestDirectory
        $deadline=(Get-Date).AddSeconds(20)
        while(Get-Process -Id $process.Id -ErrorAction SilentlyContinue){if((Get-Date) -gt $deadline){throw 'Word is still exiting; the registration backup is retained.'};Start-Sleep -Milliseconds 200}
    }
    & (Join-Path $PSScriptRoot 'temporary-registration.ps1') -Action Restore -BackupPath $backup
    $after=Join-Path $TestDirectory 'registration-after.json'
    & (Join-Path $PSScriptRoot 'temporary-registration.ps1') -Action Save -BackupPath $after
    $original=Get-Content -LiteralPath $backup -Raw -Encoding UTF8|ConvertFrom-Json|ConvertTo-Json -Depth 100 -Compress
    $restored=Get-Content -LiteralPath $after -Raw -Encoding UTF8|ConvertFrom-Json|ConvertTo-Json -Depth 100 -Compress
    if($original -ne $restored){throw 'Registration readback differs from its baseline.'}
    if((Get-FileHash -LiteralPath $NativeTemplate -Algorithm SHA256).Hash -ne $nativeHash){throw 'The runtime original template changed.'}
    if($userHash -and (Get-FileHash -LiteralPath $userTemplate -Algorithm SHA256).Hash -ne $userHash){throw 'The user original template changed.'}
    @{ok=$true;registrationRestored=$true;nativeTemplateUnchanged=$true;userTemplateUnchanged=$true;normalWordLaunch=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $TestDirectory 'host-restoration.json') -Encoding UTF8
}
