param([Parameter(Mandatory=$true)][string]$TunnelId)
$ErrorActionPreference='Stop'
if($TunnelId -notmatch '^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$'){throw 'Invalid tunnel identity'}
$match='(?<![a-z0-9_])'+[regex]::Escape($TunnelId)+'(?![a-z0-9_])'
# Inspect only the control-plane identity. Never print process command lines or
# profile contents: profiles can contain credentials. Legacy production uses a
# named profile, so matching a literal ID on the command line alone is unsafe.
function Flag([string]$command,[string]$name){
 $m=[regex]::Match($command,'(?:^|\s)'+[regex]::Escape($name)+'(?:=|\s+)(?:"([^"]*)"|([^\s]+))')
 if($m.Success){if($m.Groups[1].Success){return $m.Groups[1].Value};return $m.Groups[2].Value};return $null
}
$known=$true;$conflict=$false
try{
 foreach($process in Get-CimInstance Win32_Process -Filter "Name = 'tunnel-client.exe'"){
  $command=[string]$process.CommandLine
  if(-not $command){$known=$false;continue}
  if($command -match $match){$conflict=$true;continue}
  $literal=Flag $command '--control-plane.tunnel-id'
  if($literal -match '^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$'){continue}
  $profile=Flag $command '--profile';$directory=Flag $command '--profile-dir'
  if(-not $directory -or $profile -notmatch '^[A-Za-z0-9_-][A-Za-z0-9_.-]*$' -or $profile.Contains('..')){$known=$false;continue}
  $file=[IO.Path]::GetFullPath((Join-Path $directory ($profile+'.yaml')))
  for($ancestor=$file;$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){if((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked profile'}}
  $yaml=[IO.File]::ReadAllText($file)
  $identity=[regex]::Match($yaml,'(?m)^\s*tunnel_id:\s*["'']?(tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32})["'']?\s*(?:#.*)?$')
  $id=if($identity.Success){$identity.Groups[1].Value}else{$null}
  # JSON is also valid YAML; older launchers write a JSON object to .yaml.
  if(-not $id -and $yaml.TrimStart().StartsWith('{')){try{$profileObject=$yaml|ConvertFrom-Json -ErrorAction Stop;$id=[string]$profileObject.control_plane.tunnel_id}catch{}}
  if($id -notmatch '^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$'){$known=$false;continue};if($id -eq $TunnelId){$conflict=$true}
 }
}catch{$known=$false}
@{conflict=$conflict;processInventoryAvailable=$known}|ConvertTo-Json -Compress
