# SPDX-License-Identifier: MIT
# Share the native Zotero tab without changing its controls or VBA project.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:ZBCRibbonNamespace='urn:zotero-batch-citations:shared-ribbon'
function Find-ZoteroTemplate([string]$ExplicitPath){
    if($ExplicitPath){$path=[IO.Path]::GetFullPath($ExplicitPath);if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'The specified Zotero.dotm was not found.'};return $path}
    $folders=New-Object 'System.Collections.Generic.List[string]'
    foreach($version in @('16.0','15.0','14.0')){
        $key=Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Office\$version\Word\Options" -ErrorAction SilentlyContinue
        if($key -and $key.'STARTUP-PATH'){$folders.Add([Environment]::ExpandEnvironmentVariables([string]$key.'STARTUP-PATH'))}
    }
    $folders.Add((Join-Path $env:APPDATA 'Microsoft\Word\STARTUP'))
    foreach($folder in $folders){$path=Join-Path $folder 'Zotero.dotm';if(Test-Path -LiteralPath $path -PathType Leaf){return [IO.Path]::GetFullPath($path)}}
    throw 'Install the official Zotero Word plugin first, or pass -ZoteroTemplatePath with the Zotero.dotm path from Word Options > Advanced > File Locations > Startup.'
}
function Get-RibbonHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Enable-ZoteroRibbon([string]$TemplatePath,[string]$StateDirectory){
    $TemplatePath=Find-ZoteroTemplate $TemplatePath
    $StateDirectory=[IO.Path]::GetFullPath($StateDirectory)
    New-Item -ItemType Directory -Path $StateDirectory -Force|Out-Null
    $statePath=Join-Path $StateDirectory 'template-state.json'
    $originalHash=Get-RibbonHash $TemplatePath
    if(Test-Path -LiteralPath $statePath){
        $previous=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8|ConvertFrom-Json
        if($previous.templatePath -ne $TemplatePath){throw 'This backup directory belongs to a different Zotero template. Restore it first or choose another -RibbonStateDirectory.'}
        if($previous.patchedHash -eq $originalHash){return [pscustomobject]@{merged=$true;changed=$false;templatePath=$TemplatePath;backupPath=$previous.backupPath}}
    }
    $archive=[IO.Compression.ZipFile]::OpenRead($TemplatePath)
    $replacements=@{}
    try{
        foreach($name in @('customUI/customUI.xml','customUI/customUI14.xml')){
            $entry=$archive.GetEntry($name);if(-not $entry){continue}
            $reader=New-Object IO.StreamReader($entry.Open(),[Text.Encoding]::UTF8)
            try{$text=$reader.ReadToEnd()}finally{$reader.Dispose()}
            $xml=New-Object Xml.XmlDocument;$xml.PreserveWhitespace=$true;$xml.XmlResolver=$null;$xml.LoadXml($text)
            $tabs=@($xml.SelectNodes("//*[local-name()='tab' and @id='ZoteroTab']"))
            if($tabs.Count -gt 1){throw 'Multiple native Zotero tabs were found; no template changes were made.'}
            if($tabs.Count -eq 0){
                $shared=@($xml.SelectNodes("//*[local-name()='tab' and @idQ]"))|Where-Object { $q=$_.GetAttribute('idQ').Split(':');$q.Count -eq 2 -and $q[1] -eq 'ZoteroTab' -and $_.GetNamespaceOfPrefix($q[0]) -eq $script:ZBCRibbonNamespace }
                if($shared){continue}
                throw 'The official Zotero ribbon structure is not recognized. No template changes were made.'
            }
            $prefix='zbcShared';$index=0
            while($xml.DocumentElement.GetNamespaceOfPrefix($prefix) -and $xml.DocumentElement.GetNamespaceOfPrefix($prefix) -ne $script:ZBCRibbonNamespace){$index++;$prefix='zbcShared'+$index}
            $attribute=$xml.CreateAttribute('xmlns',$prefix,'http://www.w3.org/2000/xmlns/');$attribute.Value=$script:ZBCRibbonNamespace;$null=$xml.DocumentElement.Attributes.Append($attribute)
            $tabs[0].RemoveAttribute('id');$tabs[0].SetAttribute('idQ',$prefix+':ZoteroTab')
            $settings=New-Object Xml.XmlWriterSettings;$settings.Encoding=New-Object Text.UTF8Encoding($false);$settings.Indent=$false;$settings.NewLineHandling=[Xml.NewLineHandling]::None
            $memory=New-Object IO.MemoryStream;$writer=[Xml.XmlWriter]::Create($memory,$settings)
            try{$xml.Save($writer);$writer.Flush();$replacements[$name]=$memory.ToArray()}finally{$writer.Dispose();$memory.Dispose()}
        }
    }finally{$archive.Dispose()}
    if(-not $replacements.Count){return [pscustomobject]@{merged=$true;changed=$false;templatePath=$TemplatePath;backupPath=$null}}
    $backup=Join-Path $StateDirectory ('Zotero-original-'+$originalHash+'.dotm')
    if(-not(Test-Path -LiteralPath $backup)){[IO.File]::Copy($TemplatePath,$backup,$false)}
    if((Get-RibbonHash $backup) -ne $originalHash){throw 'The template backup failed verification; no changes were made.'}
    $temporary=$TemplatePath+'.zbc-'+[Guid]::NewGuid().ToString('N')+'.tmp'
    try{
        [IO.File]::Copy($TemplatePath,$temporary,$false)
        $archive=[IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Update)
        try{
            foreach($name in $replacements.Keys){
                $old=$archive.GetEntry($name);$time=$old.LastWriteTime;$old.Delete()
                $entry=$archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal);$entry.LastWriteTime=$time
                $stream=$entry.Open();try{$data=[byte[]]$replacements[$name];$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
            }
        }finally{$archive.Dispose()}
        $patchedHash=Get-RibbonHash $temporary
        # Persist recovery information before the atomic template replacement.
        $state=@{version='1.1.4';templatePath=$TemplatePath;backupPath=$backup;originalHash=$originalHash;patchedHash=$patchedHash}
        [IO.File]::WriteAllText($statePath,($state|ConvertTo-Json),[Text.Encoding]::UTF8)
        [IO.File]::Replace($temporary,$TemplatePath,[NullString]::Value)
        if((Get-RibbonHash $TemplatePath) -ne $patchedHash){throw 'The shared Zotero template failed verification.'}
        return [pscustomobject]@{merged=$true;changed=$true;templatePath=$TemplatePath;backupPath=$backup}
    }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
}
function Restore-ZoteroRibbon([string]$StateDirectory){
    $statePath=Join-Path $StateDirectory 'template-state.json'
    if(-not(Test-Path -LiteralPath $statePath)){return 'No template backup to restore.'}
    $state=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8|ConvertFrom-Json
    if(-not(Test-Path -LiteralPath $state.templatePath)){return 'The original template location no longer exists; its backup is retained.'}
    if((Get-RibbonHash $state.templatePath) -ne $state.patchedHash){return 'Zotero.dotm has changed since installation; the current template and the backup are retained.'}
    if((Get-RibbonHash $state.backupPath) -ne $state.originalHash){throw 'The original Zotero template backup failed verification; the current template was retained.'}
    $temporary=$state.templatePath+'.zbc-'+[Guid]::NewGuid().ToString('N')+'.tmp'
    try{[IO.File]::Copy($state.backupPath,$temporary,$false);[IO.File]::Replace($temporary,$state.templatePath,[NullString]::Value)}
    finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
    return 'The original Zotero tab template was restored; the backup is retained.'
}
