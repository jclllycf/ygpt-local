param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Probe,[Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Scratch)
if($root -eq [IO.Path]::GetPathRoot($root) -or (Test-Path -LiteralPath $root)){throw 'New disposable scratch directory required'}
$inputDir=Join-Path $root 'input';$outputDir=Join-Path $root 'output'
New-Item -ItemType Directory -Path $inputDir,$outputDir | Out-Null
Copy-Item -LiteralPath $Installer -Destination (Join-Path $inputDir 'Setup.exe')
Copy-Item -LiteralPath $Probe -Destination (Join-Path $inputDir 'InstallerProbe.exe')
$nonce=[guid]::NewGuid().ToString('N')
$config=[xml]@"
<Configuration>
 <VGpu>Disable</VGpu><Networking>Disable</Networking><ClipboardRedirection>Disable</ClipboardRedirection><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection><MemoryInMB>3072</MemoryInMB>
 <MappedFolders>
  <MappedFolder><HostFolder>$inputDir</HostFolder><SandboxFolder>C:\YGPTInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
  <MappedFolder><HostFolder>$outputDir</HostFolder><SandboxFolder>C:\YGPTOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
 </MappedFolders>
 <LogonCommand><Command>C:\YGPTInput\InstallerProbe.exe C:\YGPTInput\Setup.exe C:\YGPTScratch C:\YGPTOutput\result.json</Command></LogonCommand>
</Configuration>
"@
$configPath=Join-Path $root 'installer-test.wsb';$config.Save($configPath)
$hash=(Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
$launch=[ordered]@{installerSha256=$hash;nonce=$nonce;networkingDisabled=$true;clipboardDisabled=$true;inputReadOnly=$true;onlyWritableHostFolder=$outputDir;result=(Join-Path $outputDir 'result.json');config=$configPath;launched=$false}
$cli=Get-Command wsb -ErrorAction SilentlyContinue
if($cli){$id=[guid]::NewGuid().ToString();$launch.sandboxId=$id;& $cli.Source start --id $id --config $config.OuterXml --raw;if($LASTEXITCODE -ne 0){throw 'Windows Sandbox CLI start failed'};$launch.launched=$true}
else{if(Get-Process -Name WindowsSandboxClient,WindowsSandbox -ErrorAction SilentlyContinue){throw 'Existing Sandbox session detected; it was not changed'};$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe') -ArgumentList ('"'+$configPath+'"') -PassThru;$launch.launcherPid=$p.Id;$launch.launched=$true}
$launch|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'launch.json') -Encoding UTF8
$launch|ConvertTo-Json -Compress
