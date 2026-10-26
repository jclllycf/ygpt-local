$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskMessage=[Console]::In.ReadToEnd() | ConvertFrom-Json
$taskIcon=New-Object System.Windows.Forms.NotifyIcon
try {
 $taskIcon.Icon=[System.Drawing.SystemIcons]::Information
 $taskIcon.Text='YGPT Local'
 $taskIcon.Visible=$true
 $taskIcon.BalloonTipTitle=([string]$taskMessage.title).Substring(0,[Math]::Min(63,([string]$taskMessage.title).Length))
 $taskIcon.BalloonTipText=([string]$taskMessage.body).Substring(0,[Math]::Min(240,([string]$taskMessage.body).Length))
 $taskIcon.ShowBalloonTip(8000)
 $taskDeadline=[DateTime]::UtcNow.AddSeconds(9)
 while([DateTime]::UtcNow -lt $taskDeadline){[System.Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 100}
} finally {$taskIcon.Visible=$false;$taskIcon.Dispose()}
