param([string]$Suffix='compact')
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$work=[IO.Path]::GetFullPath((Join-Path $project '..'))
function Wait-Result([string]$Path,[int]$Seconds=120){
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
    $null=Start-Process -FilePath $Executable -ArgumentList @('-no-remote','-profile',('"'+(Join-Path $root 'profile')+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'stdout.log') -RedirectStandardError (Join-Path $root 'stderr.log') -PassThru
    return $root
}
function Stop-Runtime([string]$Root){
    if(-not $Root){return}
    '{"action":"stop"}'|Set-Content -LiteralPath (Join-Path $Root 'live-control.json') -Encoding UTF8
    $profilePath=Join-Path $Root 'profile';$deadline=(Get-Date).AddSeconds(20)
    do{
        $processes=@(Get-CimInstance Win32_Process -Filter "Name='zotero.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($profilePath)})
        if(-not $processes.Count){return};if((Get-Date) -gt $deadline){throw 'Isolated runtime did not stop normally'};Start-Sleep -Milliseconds 250
    }while($true)
}
foreach($major in @(7,10)){
    $runtime=if($major -eq 7){Join-Path $work 'runtimes\runtime7\Zotero_win-x64'}else{Join-Path $work 'runtimes\runtime10'}
    $exe=Join-Path $runtime 'zotero.exe';$ui=$null;$live=$null
    try{
        $ui=Start-Runtime "v$major-ui116$Suffix" $exe $false
        $result=Wait-Result (Join-Path $ui 'result.json')
        if(-not $result.ok -or $result.checks.Count -ne 90){throw 'UI acceptance count mismatch'}
        Write-Output "Zotero $major UI: 90 checks passed"
    }finally{Stop-Runtime $ui}
    try{
        $live=Start-Runtime "v$major-live116$Suffix" $exe $true
        $ready=Wait-Result (Join-Path $live 'live-status.json');if($ready.state -ne 'ready'){throw 'Live runner not ready'}
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'run-host-validation.ps1') -TestDirectory $live -NativeTemplate (Join-Path $runtime 'integration\word-for-windows\Zotero.dotm') -AssemblyPath (Join-Path $project 'word-addin\bin\ZoteroBatchCitations.dll') -IterationOnly -SourceFixture (Join-Path $work '..\textdocx\大规模文档测试.docx') -BackgroundValidation
        if($LASTEXITCODE -ne 0){throw 'Word acceptance failed'}
        $result=Wait-Result (Join-Path $live 'word-iteration-result.json')
        if(-not $result.ok -or $result.checks.Count -ne 43){throw 'Word acceptance count mismatch'}
        Write-Output "Zotero $major Word: 43 checks passed"
    }finally{Stop-Runtime $live}
}
