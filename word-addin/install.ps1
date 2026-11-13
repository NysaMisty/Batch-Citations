param(
    [switch]$Uninstall,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'ZoteroBatchCitations\word\2.0.0'),
    [string]$ZoteroTemplatePath,
    [string]$SourceAssemblyPath,
    [string]$RibbonStateDirectory = (Join-Path $env:LOCALAPPDATA 'ZoteroBatchCitations\ribbon')
)
$ErrorActionPreference = 'Stop'
if($SourceAssemblyPath -and -not (Test-Path -LiteralPath $SourceAssemblyPath)){throw 'The explicitly requested candidate assembly does not exist; refusing a fallback.'}
$classID = '{59B8DFA8-9039-4855-B4CD-DBF701CE7A81}'
$progID = 'ZoteroBatchCitations.Connect'
$classPath = "Software\Classes\CLSID\$classID"
$progPath = "Software\Classes\$progID"
$addinPath = "Software\Microsoft\Office\Word\Addins\$progID"
if (Get-Process WINWORD -ErrorAction SilentlyContinue) { throw 'Save your documents and close Word before installing or uninstalling the add-in.' }
. (Join-Path $PSScriptRoot 'RibbonIntegration.ps1')
if($Uninstall){Restore-ZoteroRibbon $RibbonStateDirectory}
else{$ribbon=Enable-ZoteroRibbon $ZoteroTemplatePath $RibbonStateDirectory;Write-Output ('Shared Zotero tab enabled. Original template backup: '+$ribbon.backupPath)}
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        if ($Uninstall) {
            # Only this add-in's three exact, fixed user keys are removed. Files and documents are retained.
            foreach ($keyPath in @($classPath, $progPath, $addinPath)) { $baseKey.DeleteSubKeyTree($keyPath, $false) }
            continue
        }
        $source = if($SourceAssemblyPath){[IO.Path]::GetFullPath($SourceAssemblyPath)}else{Join-Path $PSScriptRoot 'ZoteroBatchCitations.dll'}
        if (-not (Test-Path -LiteralPath $source)) { $source = Join-Path $PSScriptRoot 'bin\ZoteroBatchCitations.dll' }
        if (-not (Test-Path -LiteralPath $source)) { throw 'Build the add-in first, or use the complete release ZIP.' }
        $assemblyPath = Join-Path ([IO.Path]::GetFullPath($InstallDirectory)) 'ZoteroBatchCitations.dll'
        New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
        if ([IO.Path]::GetFullPath($source) -ne $assemblyPath) { Copy-Item -LiteralPath $source -Destination $assemblyPath -Force }
        $assemblyName = [Reflection.AssemblyName]::GetAssemblyName($assemblyPath).FullName
        foreach ($keyPath in @($classPath, $progPath)) {
            $key = $baseKey.CreateSubKey($keyPath)
            try { $key.SetValue('', 'ZoteroBatchCitations.Connect') } finally { $key.Dispose() }
        }
        $key = $baseKey.CreateSubKey("$classPath\InprocServer32")
        try {
            $key.SetValue('', 'mscoree.dll')
            $key.SetValue('ThreadingModel', 'Both')
            $key.SetValue('Class', 'ZoteroBatchCitations.Connect')
            $key.SetValue('Assembly', $assemblyName)
            $key.SetValue('RuntimeVersion', 'v4.0.30319')
            $key.SetValue('CodeBase', ([Uri]$assemblyPath).AbsoluteUri)
        } finally { $key.Dispose() }
        $key = $baseKey.CreateSubKey("$classPath\InprocServer32\2.0.0.0")
        try {
            $key.SetValue('Class', 'ZoteroBatchCitations.Connect')
            $key.SetValue('Assembly', $assemblyName)
            $key.SetValue('RuntimeVersion', 'v4.0.30319')
            $key.SetValue('CodeBase', ([Uri]$assemblyPath).AbsoluteUri)
        } finally { $key.Dispose() }
        $key = $baseKey.CreateSubKey("$classPath\ProgId")
        try { $key.SetValue('', $progID) } finally { $key.Dispose() }
        $key = $baseKey.CreateSubKey("$progPath\CLSID")
        try { $key.SetValue('', $classID) } finally { $key.Dispose() }
        $key = $baseKey.CreateSubKey("$classPath\Implemented Categories\{62C8FE65-4EBB-45e7-B440-6E39B2CDBF29}"); $key.Dispose()
        $key = $baseKey.CreateSubKey($addinPath)
        try {
            $key.SetValue('FriendlyName', 'Zotero Batch Citations 2.0.0')
            $key.SetValue('Description', 'Live numbered citation mapping for the current Word document')
            $key.SetValue('LoadBehavior', 3, [Microsoft.Win32.RegistryValueKind]::DWord)
            $key.SetValue('CommandLineSafe', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
        } finally { $key.Dispose() }
    } finally { $baseKey.Dispose() }
}
if ($Uninstall) { 'Word add-in unregistered for this user. Existing document fields remain available to Zotero.' }
else { 'Installed for this user. Start Zotero, then open Word > Zotero > Batch Match Numbers / Number Display.' }
