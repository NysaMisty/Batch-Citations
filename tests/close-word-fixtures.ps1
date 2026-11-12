param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')+'\'
$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
foreach($doc in $word.Documents){
    if(-not ([IO.Path]::GetFullPath($doc.FullName)).StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing to close a document outside the named test directory.'}
}
foreach($doc in @($word.Documents)){$doc.Close(0)}
$quitMode=0;$word.Quit([ref]$quitMode)
