param([Parameter(Mandatory=$true)][string]$StateDir,[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($StateDir)
if($target -eq [IO.Path]::GetPathRoot($target)){throw 'Refusing drive root ACL mutation'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed=@($sid.Value,'S-1-5-18')
# Chromium grants this Windows AppContainer capability access to its own
# sandboxed temporary cache and network stores. It must not grant access to
# credentials, the state ledger, or arbitrary YGPT files.
$chromiumSandboxSid='S-1-15-3-1024-3239966617-1410756637-3494353204-65451782-2225605771-3526040376-1730753648-3419555762'
$chromeSandboxSid='S-1-15-3-1024-1653277547-598600573-1504598449-2187120098-1115546814-1860042162-2924348907-3700367812'
if(-not $VerifyOnly){
  [IO.Directory]::CreateDirectory($target) | Out-Null
  # Load/change only Access. Setting even the same owner through .NET can
  # request WRITE_OWNER, which an ordinary interactive token need not have.
  $acl=[IO.Directory]::GetAccessControl($target,[Security.AccessControl.AccessControlSections]::Access)
  $acl.SetAccessRuleProtection($true,$false)
  foreach($r in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($r)}
  foreach($id in $allowed){
    $identity=New-Object Security.Principal.SecurityIdentifier($id)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  # Write only the explicit DACL/owner sections. Set-Acl can try to copy a
  # SACL on an existing folder and request SeSecurityPrivilege unnecessarily.
  [IO.Directory]::SetAccessControl($target,$acl)

  # The Desktop Commander executor can unpack its pinned bun/node shims into
  # tmp/bun-node-*/. Some Windows extractors preserve executable DACLs that
  # grant Authenticated Users/Users/Administrators access. Repair only these
  # exact, owner-owned shim files inside an already secured parent. All other
  # unexpected broad ACLs must still fail the exhaustive audit below.
  $scratch=Join-Path $target 'tmp'
  if(Test-Path -LiteralPath $scratch -PathType Container){
    foreach($shimDir in @(Get-ChildItem -LiteralPath $scratch -Directory -Filter 'bun-node-*' -Force)){
      if($shimDir.Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('Unexpected executable directory link: '+$shimDir.FullName)}
      $parentAcl=Get-Acl -LiteralPath $shimDir.FullName
      $parentBad=@($parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed})
      if($parentBad.Count -gt 0){throw ('Unexpected executable parent ACL: '+$shimDir.FullName)}
      foreach($exe in @('bun.exe','node.exe')){
        $file=Join-Path $shimDir.FullName $exe
        if(-not(Test-Path -LiteralPath $file -PathType Leaf)){continue}
        $item=Get-Item -LiteralPath $file -Force
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('Unexpected executable link: '+$file)}
        $fileAcl=[IO.File]::GetAccessControl($file,[Security.AccessControl.AccessControlSections]::Access)
        $ownerAcl=[IO.File]::GetAccessControl($file,[Security.AccessControl.AccessControlSections]::Owner)
        $fileOwner=($ownerAcl.GetOwner([Security.Principal.SecurityIdentifier])).Value
        if($fileOwner -ne $sid.Value){throw ('Unexpected executable owner: '+$file+' owner='+$fileOwner+' expected='+$sid.Value)}
        $extra=@($fileAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed})
        if($extra.Count -eq 0){continue}
        $fileAcl.SetAccessRuleProtection($true,$false)
        foreach($rule in @($fileAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$fileAcl.RemoveAccessRuleSpecific($rule)}
        foreach($id in $allowed){
          $identity=New-Object Security.Principal.SecurityIdentifier($id)
          $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
        }
        [IO.File]::SetAccessControl($file,$fileAcl)
      }
    }
  }
}
$actual=Get-Acl -LiteralPath $target
$rules=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
$bad=@($rules | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed})
if(-not $actual.AreAccessRulesProtected -or $bad.Count -gt 0){throw 'State directory ACL is not owner/SYSTEM only'}
# Audit descendants too; explicit grants must never bypass the protected parent.
$unsafe=@(Get-ChildItem -LiteralPath $target -Recurse -Force | ForEach-Object {
  if($_.Attributes -band [IO.FileAttributes]::ReparsePoint){
    # Windows sometimes creates this legacy Internet Cache junction when a
    # child process first initializes its isolated USERPROFILE. Its target is
    # another directory under the *same protected state root*. Check both
    # exact paths and link type; no general reparse-point exemption is safe.
    # Windows may create this legacy cache junction under either isolated
    # profile used by YGPT. Permit only the exact Content.IE5 -> IE pair in
    # those two fixed roots; verify the NTFS tag and substitute target below.
    $isSafeCacheJunction=$false
    foreach($profileRoot in @('engine-home','home')){
      $cacheBase=Join-Path $target ($profileRoot+'\AppData\Local\Microsoft\Windows\INetCache')
      $expectedLink=Join-Path $cacheBase 'Content.IE5'
      $expectedTarget=Join-Path $cacheBase 'IE'
      if($_.FullName -ine $expectedLink){continue}
      # PowerShell 5.1 exposes neither LinkType nor Target on Get-Item. Query
      # the actual NTFS reparse tag and SUBSTITUTE target, never its display name.
      $reparse=(& (Join-Path $env:SystemRoot 'System32\fsutil.exe') reparsepoint query $_.FullName 2>&1) -join "`n"
      $queryOk=($LASTEXITCODE -eq 0)
      $isJunction=($reparse -match '(?m)^Reparse Tag Value\s*:\s*0xa0000003\s*$')
      $substitute=[regex]::Match($reparse,'(?m)^Substitute Name\s*:\s*\\\?\?\\([^\r\n]+?)\s*$')
      $actualTarget=if($substitute.Success){$substitute.Groups[1].Value}else{''}
      if($queryOk -and $isJunction -and $actualTarget -ieq $expectedTarget -and (Test-Path -LiteralPath $expectedTarget -PathType Container)){$isSafeCacheJunction=$true;break}
    }
    if(-not $isSafeCacheJunction){throw ('Reparse point inside state directory: '+$_.FullName)}
    return
  }
  $itemAcl=Get-Acl -LiteralPath $_.FullName
  $relative=$_.FullName.Substring($target.TrimEnd('\').Length).TrimStart('\')
  $isBrowserCache=($relative -match '^tmp\\playwright_chromiumdev_profile-[A-Za-z0-9_-]{6,}\\Default\\(?:Cache|Network|Shared Dictionary)(?:\\|$)')
  $isChromeCache=($relative -match '^(?:engine-home|home)\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\(?:Cache|Network|Safe Browsing Network|Shared Dictionary|Storage)(?:\\|$)')
  $isOwner=($itemAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value)
  foreach($r in $itemAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin $allowed){
      if($isBrowserCache -and $isOwner -and $r.IdentityReference.Value -eq $chromiumSandboxSid){continue}
      if($isChromeCache -and $isOwner -and $r.IdentityReference.Value -eq $chromeSandboxSid){continue}
      $_.FullName
    }
  }
})
if($unsafe.Count -gt 0){throw 'Existing state descendants contain broad explicit ACLs; use a new state directory'}
[pscustomobject]@{ownerSid=$sid.Value;protected=$actual.AreAccessRulesProtected;allowedSids=$allowed;descendantsChecked=$true;sddl=$actual.Sddl} | ConvertTo-Json -Compress
