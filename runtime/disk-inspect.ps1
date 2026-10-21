$ErrorActionPreference='Stop'
# Read-only inventory. No Format/Initialize/Clear/Set/Add/Remove cmdlet.
$disks=@(Get-Disk | ForEach-Object {
 $d=$_
 $parts=@(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{number=$_.PartitionNumber;driveLetter=[string]$_.DriveLetter;sizeBytes=$_.Size;type=$_.Type} })
 [pscustomobject]@{number=$d.Number;model=$d.FriendlyName;serial=([string]$d.SerialNumber).Trim();sizeBytes=$d.Size;busType=[string]$d.BusType;partitions=$parts;readOnly=$d.IsReadOnly;offline=$d.IsOffline}
})
ConvertTo-Json -InputObject $disks -Depth 6 -Compress
