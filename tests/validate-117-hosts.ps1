param([string]$Suffix='acceptance',[ValidateSet('UI','Word','Activation','Independent','All')][string]$Phase='All',[int[]]$Majors=@(7,10))
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop'){throw 'Use Windows PowerShell (powershell.exe) for the Office COM acceptance runner.'}
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$work=[IO.Path]::GetFullPath((Join-Path $project '..'))
$iteration=(Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw|ConvertFrom-Json).version.Replace('.','')
$runtimeProcesses=@{}
function Wait-Result([string]$Path,[int]$Seconds=180){
    $deadline=(Get-Date).AddSeconds($Seconds)
    while(-not(Test-Path -LiteralPath $Path)){if((Get-Date) -gt $deadline){throw "Timeout: $Path"};Start-Sleep -Milliseconds 250}
    $result=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
    if($result.ok -eq $false){throw ($result.error+' '+$result.stack)}
    return $result
}
function Start-Runtime([string]$Name,[string]$Executable,[bool]$Live){
    $flags=if($Live){@('--live-test','--hold-batch','--keep-open','--capture-ui')}else{@('--keep-open','--capture-ui')}
    $null=& python (Join-Path $project 'scripts\prepare-runtime.py') $Name @flags
    if($LASTEXITCODE -ne 0){throw 'Prepare runtime failed'}
    $root=Join-Path $work ('test-runs\active\test-'+$Name)
    $runtimeProcesses[$root]=Start-Process -FilePath $Executable -ArgumentList @('-no-remote','-profile',('"'+(Join-Path $root 'profile')+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'stdout.log') -RedirectStandardError (Join-Path $root 'stderr.log') -PassThru
    return $root
}
function Stop-Runtime([string]$Root){
    if(-not $Root){return}
    '{"action":"stop"}'|Set-Content -LiteralPath (Join-Path $Root 'live-control.json') -Encoding UTF8
    $process=$runtimeProcesses[$Root];$deadline=(Get-Date).AddSeconds(20)
    if(-not $process){throw 'No owned isolated runtime process was recorded'}
    do{
        $process.Refresh()
        if($process.HasExited){$runtimeProcesses.Remove($Root);return};if((Get-Date) -gt $deadline){throw 'Isolated runtime did not stop normally'};Start-Sleep -Milliseconds 250
    }while($true)
}
if($Phase -in @('UI','Word','Activation','All')){foreach($major in $Majors){
    $runtime=if($major -eq 7){Join-Path $work 'runtimes\runtime7\Zotero_win-x64'}else{Join-Path $work 'runtimes\runtime10'}
    $exe=Join-Path $runtime 'zotero.exe';$root=$null
    if($Phase -in @('UI','All')){try{
        $root=Start-Runtime "v$major-ui$iteration-$Suffix" $exe $false
        $result=Wait-Result (Join-Path $root 'result.json')
        Write-Output "Zotero $major UI: $($result.checks.Count) checks passed"
    }finally{Stop-Runtime $root}}
    if($Phase -in @('Word','Activation','All')){try{
        $kind=if($Phase -eq 'Activation'){'activation'}else{'live'}
        $root=Start-Runtime "v$major-$($kind)$iteration-$Suffix" $exe $true
        $ready=Wait-Result (Join-Path $root 'live-status.json');if($ready.state -ne 'ready'){throw 'Live runner not ready'}
        $flags=if($Phase -eq 'Activation'){@('-ActivationOnly')}else{@('-IterationOnly')}
        $hostArgs=@{TestDirectory=$root;NativeTemplate=(Join-Path $runtime 'integration\word-for-windows\Zotero.dotm');AssemblyPath=(Join-Path $project 'word-addin\bin\ZoteroBatchCitations.dll');SourceFixture=(Join-Path $work 'test-fixtures\large-document.docx');BackgroundValidation=$true}
        if($Phase -eq 'Activation'){$hostArgs.ActivationOnly=$true}else{$hostArgs.IterationOnly=$true}
        & (Join-Path $PSScriptRoot 'run-host-validation.ps1') @hostArgs *> (Join-Path $root 'word-host.log')
        $name=if($Phase -eq 'Activation'){'word-auto-result.json'}else{'word-iteration-result.json'}
        $result=Wait-Result (Join-Path $root $name)
        Write-Output "Zotero $major Word $kind : $($result.checks.Count) checks passed"
    }finally{Stop-Runtime $root}}
}}
if($Phase -in @('Independent','All')){
    $assembly=Join-Path $project 'word-addin\bin\ZoteroBatchCitations.dll'
    foreach($test in @('safety','citation-integrity','identity-pipeline')){
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "word-$test.ps1") -AssemblyPath $assembly -OutputDirectory (Join-Path $work "test-runs\active\test-word-$($test)$iteration-$Suffix")
        if($LASTEXITCODE -ne 0){throw "Independent $test failed"}
    }
}
