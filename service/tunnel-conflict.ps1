param([Parameter(Mandatory=$true)][string]$TunnelId)
$ErrorActionPreference='Stop'
if($TunnelId -notmatch '^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$'){throw 'Invalid tunnel identity'}
$match='(?<![a-z0-9_])'+[regex]::Escape($TunnelId)+'(?![a-z0-9_])'
$conflicts=@(Get-CimInstance Win32_Process -Filter "Name = 'tunnel-client.exe'" | Where-Object {$_.CommandLine -match $match})
@{conflict=($conflicts.Count -gt 0);processInventoryAvailable=$true}|ConvertTo-Json -Compress
