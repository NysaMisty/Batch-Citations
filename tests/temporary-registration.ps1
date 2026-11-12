param([ValidateSet('Save','Restore')][string]$Action='Save',[Parameter(Mandatory=$true)][string]$BackupPath)
$ErrorActionPreference='Stop'
if(Get-Process WINWORD -ErrorAction SilentlyContinue){throw 'Close test Word before changing temporary registration.'}
$paths=@('Software\Classes\CLSID\{59B8DFA8-9039-4855-B4CD-DBF701CE7A81}','Software\Classes\ZoteroBatchCitations.Connect','Software\Microsoft\Office\Word\Addins\ZoteroBatchCitations.Connect')
function Read-Key($Key){
    if($null -eq $Key){return $null}
    $values=@(foreach($name in $Key.GetValueNames()){@{name=$name;kind=[int]$Key.GetValueKind($name);value=$Key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}})
    $children=@(foreach($name in $Key.GetSubKeyNames()){$child=$Key.OpenSubKey($name);try{@{name=$name;data=(Read-Key $child)}}finally{$child.Dispose()}})
    return @{values=$values;children=$children}
}
function Write-Key($Key,$Data){
    foreach($v in $Data.values){
        $kind=[Microsoft.Win32.RegistryValueKind][int]$v.kind;$value=$v.value
        if($kind -eq [Microsoft.Win32.RegistryValueKind]::Binary){$value=[byte[]]$value}
        if($kind -eq [Microsoft.Win32.RegistryValueKind]::MultiString){$value=[string[]]$value}
        if($kind -eq [Microsoft.Win32.RegistryValueKind]::DWord){$value=[int]$value}
        if($kind -eq [Microsoft.Win32.RegistryValueKind]::QWord){$value=[long]$value}
        $Key.SetValue([string]$v.name,$value,$kind)
    }
    foreach($entry in $Data.children){$child=$Key.CreateSubKey([string]$entry.name);try{Write-Key $child $entry.data}finally{$child.Dispose()}}
}
if($Action -eq 'Save'){
    if(Test-Path -LiteralPath $BackupPath){throw 'Refusing to overwrite an existing registry backup.'}
    $records=@(foreach($view in @('Registry32','Registry64')){
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::$view)
        try{foreach($path in $paths){$key=$base.OpenSubKey($path);try{@{view=$view;path=$path;data=(Read-Key $key)}}finally{if($key){$key.Dispose()}}}}finally{$base.Dispose()}
    })
    $records|ConvertTo-Json -Depth 100|Set-Content -LiteralPath $BackupPath -Encoding UTF8
}else{
    $records=Get-Content -LiteralPath $BackupPath -Raw|ConvertFrom-Json
    foreach($record in $records){
        if($record.path -notin $paths -or $record.view -notin @('Registry32','Registry64')){throw 'Backup contains an unrelated registration key.'}
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::$($record.view))
        try{
            $base.DeleteSubKeyTree([string]$record.path,$false)
            if($null -ne $record.data){$key=$base.CreateSubKey([string]$record.path);try{Write-Key $key $record.data}finally{$key.Dispose()}}
        }finally{$base.Dispose()}
    }
}
Write-Output "Temporary registration: $Action complete."
