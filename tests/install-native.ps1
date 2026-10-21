param([Parameter(Mandatory=$true)][string]$SetupExe,[Parameter(Mandatory=$true)][string]$Scratch,[switch]$Repair)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Scratch)
if($root -eq [IO.Path]::GetPathRoot($root)){throw 'Disposable scratch directory required'}
if((Test-Path -LiteralPath $root) -and -not $Repair){throw 'Use a new empty scratch directory'}
if(-not(Test-Path -LiteralPath $root)){New-Item -ItemType Directory -Path $root | Out-Null}
$workspace=Join-Path $root 'workspace';$install=Join-Path $root 'application';$data=Join-Path $root 'data'
if($Repair){$marker=Get-Content -LiteralPath (Join-Path $install '.ygpt-install.json') -Raw|ConvertFrom-Json;if($marker.product -ne 'YGPT Local' -or [IO.Path]::GetFullPath($marker.installRoot) -ne $install){throw 'Disposable YGPT installation identity required'}}
else{New-Item -ItemType Directory -Path $workspace | Out-Null}
$sentinel=Join-Path $workspace 'retained-user-file.txt';if(-not $Repair){[IO.File]::WriteAllText($sentinel,'KEEP_USER_DATA')}
$beforeIngress=if($Repair){(Get-Content -LiteralPath (Join-Path $data 'ygpt.config.json') -Raw|ConvertFrom-Json).ingressId}else{$null}
$framework=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\WPF'
Add-Type -Path (Join-Path $framework 'UIAutomationClient.dll')
Add-Type -Path (Join-Path $framework 'UIAutomationTypes.dll')
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
$p=Start-Process -FilePath $SetupExe -ArgumentList @('--install-dir',('"'+$install+'"'),'--data-dir',('"'+$data+'"')) -PassThru
$script:stage='window'
function WaitFor([scriptblock]$condition,[int]$seconds=30){$deadline=[DateTime]::UtcNow.AddSeconds($seconds);$last='';do{try{$r=&$condition;if($r){return $r}}catch{$last=$_.Exception.Message};Start-Sleep -Milliseconds 200}while([DateTime]::UtcNow -lt $deadline);throw ('GUI condition was not observed at '+$script:stage+'; '+$last)}
function Element([string]$id){$window.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$id))}
function Next { $b=Element 'next';if(-not $b){$cond=[Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'Next'),[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button));$b=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$cond)};([Windows.Automation.InvokePattern]$b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke() }
function Value([string]$id,[string]$text){$e=Element $id;([Windows.Automation.ValuePattern]$e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)).SetValue($text)}
try{
 $window=WaitFor {$p.Refresh();if($p.MainWindowHandle -ne 0){[Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)}}
 Value 'folder' $workspace
 $check=Element 'consent';([Windows.Automation.TogglePattern]$check.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)).Toggle()
 Next
 $script:stage='environment page';WaitFor {Element 'port'} | Out-Null
 Value 'port' ([string]$port)
 $checks=$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::CheckBox))
 foreach($check in $checks){$toggle=[Windows.Automation.TogglePattern]$check.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern);if($toggle.Current.ToggleState -eq [Windows.Automation.ToggleState]::On){$toggle.Toggle()}}
 Next
 $script:stage='local-only selection';$item=WaitFor {Element 'mode-local-only'}
 ([Windows.Automation.SelectionItemPattern]$item.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)).Select()
 Next
 Next
 $script:stage='install page';$button=WaitFor {$window.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'Install & configure'),[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)))}
 ([Windows.Automation.InvokePattern]$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
 $script:stage='configuration written';$configured=WaitFor {$notice=Element 'setup-message';$nextButton=Element 'next';if((Test-Path -LiteralPath (Join-Path $data 'ygpt.config.json')) -and $nextButton.Current.IsEnabled -and (Test-Path -LiteralPath (Join-Path $data 'service-health.json'))){return @{ok=$true}};if($notice -and $notice.Current.Name -and -not $notice.Current.Name.StartsWith('Installing')){return @{ok=$false;error=$notice.Current.Name}}} 180
 if(-not $configured.ok){throw $configured.error}
 Add-Type -AssemblyName System.Security
 $sealed=[IO.File]::ReadAllText((Join-Path $data 'credentials.dpapi'))
 $secrets=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($sealed.Substring(6)),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))|ConvertFrom-Json
 $headers=@{Authorization=('Bearer '+$secrets.localKey)}
 $script:stage='service health';$health=WaitFor {Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/healthz') -Headers $headers -TimeoutSec 2} 40
 if(-not $health.localReady -or $health.hostLinked){throw 'Local readiness or truthful host state failed'}
 $node=(& (Join-Path $install 'runtimes\node\node.exe') --version).Trim()
 $python=(& (Join-Path $install 'runtimes\python\python.exe') -c 'import platform; print(platform.python_version())').Trim()
 if([IO.File]::ReadAllText($sentinel) -ne 'KEEP_USER_DATA'){throw 'User data changed'}
 if($Repair -and (Get-Content -LiteralPath (Join-Path $data 'ygpt.config.json') -Raw|ConvertFrom-Json).ingressId -ne $beforeIngress){throw 'Owner ingress identity changed during repair'}
 $report=[ordered]@{passed=$true;source='actual packaged Windows installer driven through native UIA';repair=[bool]$Repair;localOnly=$true;localReady=$health.localReady;publicTools=$health.publicTools;appOnly=$health.appOnly;hostVerified=$false;node=$node;python=$python;developerToolsRequiredForInstalledRuntime=$false;userDataPreserved=$true;ownerIdentityPreserved=([bool]$Repair);cleanWindowsVm=$false;installerSha256=(Get-FileHash -LiteralPath $SetupExe -Algorithm SHA256).Hash.ToLowerInvariant();at=[DateTime]::UtcNow.ToString('o')}
 $report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root $(if($Repair){'repair-result.json'}else{'install-result.json'})) -Encoding UTF8
 $report|ConvertTo-Json
}catch{
 throw ('Installer UI test failed at '+$script:stage+': '+$_.Exception.Message)
}finally{
 if(Test-Path -LiteralPath $data){[IO.File]::WriteAllText((Join-Path $data 'paused'),'test complete; pause only this disposable installation')}
 if(-not $p.HasExited){$p.CloseMainWindow()|Out-Null}
}
