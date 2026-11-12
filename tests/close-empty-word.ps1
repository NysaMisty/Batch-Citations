param([switch]$SyntheticTest)
$ErrorActionPreference='Stop'
try { $word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application') }
catch { 'No active Word instance'; exit }
if ($SyntheticTest) {
    foreach($document in @($word.Documents)) {
        if(-not $document.Content.Text.StartsWith('SENTINEL first ')){throw 'Refusing to close an unrecognized document.'}
        $document.Close(0)
    }
}
if ($word.Documents.Count -ne 0) { throw 'Refusing to close Word: documents are open.' }
'Closing empty test Word instance'
$quitMode=0
$word.Quit([ref]$quitMode)
