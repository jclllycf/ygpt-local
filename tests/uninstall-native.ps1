param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Scratch);$install=Join-Path $root 'application';$data=Join-Path $root 'data'
$marker=Get-Content -LiteralPath (Join-Path $install '.ygpt-install.json') -Raw|ConvertFrom-Json
if($root -eq [IO.Path]::GetPathRoot($root) -or $marker.product -ne 'YGPT Local' -or [IO.Path]::GetFullPath($marker.installRoot) -ne $install){throw 'Disposable YGPT installation identity required'}
$credentialsHash=(Get-FileHash -LiteralPath (Join-Path $data 'credentials.dpapi')).Hash
$framework=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\WPF'
Add-Type -Path (Join-Path $framework 'UIAutomationClient.dll');Add-Type -Path (Join-Path $framework 'UIAutomationTypes.dll')
$p=Get-Process -Name YGPTLocal -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq (Join-Path $install 'YGPTLocal.exe')}|Select-Object -First 1
if(-not $p){$p=Start-Process -FilePath (Join-Path $install 'YGPTLocal.exe') -ArgumentList @('--uninstall','--data-dir',('"'+$data+'"')) -PassThru}
function WaitFor([scriptblock]$condition,[int]$seconds=45){$end=[DateTime]::UtcNow.AddSeconds($seconds);do{try{$r=&$condition;if($r){return $r}}catch{};Start-Sleep -Milliseconds 200}while([DateTime]::UtcNow -lt $end);throw 'Uninstall UI condition timed out'}
$window=WaitFor {[Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$p.Id),[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'YGPT Local')))}
$yes=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'Yes'))
if(-not $yes){throw 'Expected owned uninstall confirmation button not found'}
([Windows.Automation.InvokePattern]$yes.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
WaitFor {-not (Test-Path -LiteralPath (Join-Path $install '.ygpt-install.json'))} 60|Out-Null
if([IO.File]::ReadAllText((Join-Path $root 'workspace\retained-user-file.txt')) -ne 'KEEP_USER_DATA'){throw 'User file changed during uninstall'}
if((Get-FileHash -LiteralPath (Join-Path $data 'credentials.dpapi')).Hash -ne $credentialsHash){throw 'Encrypted credentials changed during uninstall'}
if(-not(Test-Path -LiteralPath (Join-Path $data 'state'))){throw 'User snapshot state was removed'}
$helpers=Get-CimInstance Win32_Process -Filter "Name LIKE 'YGPTLocal-Uninstall-%'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($install)}
foreach($helper in $helpers){$dialog=[Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$helper.ProcessId));if($dialog){$ok=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'2'));if($ok){([Windows.Automation.InvokePattern]$ok.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()}}}
$report=[ordered]@{passed=$true;source='actual installed Windows GUI uninstaller with UIA confirmation on a disposable installation';applicationMarkerRemoved=$true;userFilePreserved=$true;encryptedCredentialsPreserved=$true;statePreserved=$true;hostVerified=$false;at=[DateTime]::UtcNow.ToString('o')}
$report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'uninstall-result.json') -Encoding UTF8
$report|ConvertTo-Json
