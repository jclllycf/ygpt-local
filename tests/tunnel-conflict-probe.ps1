param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Scratch)
if(-not $root.Contains('.ygpt-local-tests') -or (Test-Path -LiteralPath $root)){throw 'New disposable fixture root required'}
New-Item -ItemType Directory -Path $root | Out-Null
$target='tunnel_'+('0'*32);$other='tunnel_'+('1'*32)
[IO.File]::WriteAllText((Join-Path $root 'yaml.yaml'),("control_plane:`n  tunnel_id: "+$target+"`n  api_key: env:FIXTURE_ONLY`n"))
[IO.File]::WriteAllText((Join-Path $root 'json.yaml'),(@{control_plane=@{tunnel_id=$target;api_key='FIXTURE_NOT_A_REAL_KEY'}}|ConvertTo-Json -Compress))
$global:YGPTConflictFixtureInventory=@()
function Get-CimInstance {param([string]$ClassName,[string]$Filter);return $global:YGPTConflictFixtureInventory}
$entry=Join-Path $PSScriptRoot '..\service\tunnel-conflict.ps1'
function Probe {$r=& $entry -TunnelId $target;return ($r|ConvertFrom-Json)}
$checks=@()
foreach($name in @('yaml','json')){
 $global:YGPTConflictFixtureInventory=@([pscustomobject]@{CommandLine=('tunnel-client.exe run --profile-dir "'+$root+'" --profile '+$name)})
 $r=Probe;if(-not $r.conflict -or -not $r.processInventoryAvailable){throw ($name+' identity was not protected')};$checks+=($name+' profile identity')
}
$global:YGPTConflictFixtureInventory=@([pscustomobject]@{CommandLine=('tunnel-client.exe run --control-plane.tunnel-id '+$other)})
$r=Probe;if($r.conflict -or -not $r.processInventoryAvailable){throw 'Unrelated identity should be allowed'};$checks+='unrelated owner retained'
$global:YGPTConflictFixtureInventory=@([pscustomobject]@{CommandLine='tunnel-client.exe run --profile-dir "missing" --profile unknown'})
$r=Probe;if($r.processInventoryAvailable){throw 'Unknown profile must not be silently allowed'};$checks+='unknown profile blocks safely'
@{passed=$true;source='controlled process/profile fixtures, not a remote connection';checks=$checks}|ConvertTo-Json -Compress
