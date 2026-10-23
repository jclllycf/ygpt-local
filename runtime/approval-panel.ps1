param([Parameter(Mandatory=$true)][string]$StateDir,[switch]$ValidateOnly,[string]$PreviewImage,[string]$PreviewFile,[switch]$Probe,[switch]$FocusOnOpen)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Security
$xaml=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'approval-view.xaml'))
$window=[Windows.Markup.XamlReader]::Load([Xml.XmlNodeReader]::new([xml]$xaml))
$brandPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\brand\ygpt-local-512.png'))
$window.FindName('BrandIcon').Source=[Windows.Media.Imaging.BitmapImage]::new([Uri]$brandPath)
$area=[Windows.SystemParameters]::WorkArea;$window.Left=$area.Right-440;$window.Top=$area.Bottom-490
$controls=@{};foreach($n in @('State','Title','Purpose','Queue','SourceLabel','Source','Target','Impact','Denied','Risk','Privilege','Technical','Code','Expiry','History','HistoryText','Allow','Always','Deny','Note')){$controls[$n]=$window.FindName($n)}
$labels=@{awaiting_user='等待确认';approved='已批准，准备执行';running='正在执行';succeeded='已完成';failed='执行失败';unknown='结果待核实';denied='已拒绝';expired='已过期'}
function ShowOperation($r){
 $p=$r.presentation
 if(-not $p){throw 'Structured operation explanation is required'}
 $controls.State.Text=$labels[$r.state];$controls.Title.Text=$p.title;$controls.Purpose.Text=$p.purpose
 $controls.Target.Text=$p.target;$controls.Impact.Text=$p.impact;$controls.Denied.Text=$p.denied
 $controls.Risk.Text=($p.risk+'。'+$p.reversible);$controls.Privilege.Text=$p.administrator
 $controls.Risk.Visibility=if($p.risk -like '*高风险*' -or $p.risk -like '*永久*'){'Visible'}else{'Collapsed'}
 $controls.Code.Text=$p.technical;$controls.Expiry.Text=('到期：'+([datetime]$r.expiresAt).ToLocalTime().ToString('HH:mm:ss')+"`n请求："+$r.id)
 $visible=if($p.source){'Visible'}else{'Collapsed'};$controls.Source.Visibility=$visible;$controls.SourceLabel.Visibility=$visible;$controls.Source.Text=$p.source
 $ready=$r.state -eq 'awaiting_user' -and -not $r.previewOnly;$controls.Allow.IsEnabled=$ready;$controls.Deny.IsEnabled=$ready
 $controls.Always.IsEnabled=$ready -and $r.chatScope.eligible;$controls.Always.ToolTip=if($r.chatScope){$r.chatScope.explanation}else{'此类请求必须逐次确认。'}
 if($r.previewOnly){$controls.Note.Text='设计预览 · 示例参数 · 按钮不会执行任何操作。'}elseif($r.state -eq 'unknown'){$controls.Note.Text='可能已产生效果。请先核实，不会自动重复执行。'}
}
if($ValidateOnly){[pscustomobject]@{xamlLoaded=$true;controls=$controls.Count;lightDefault=$true;technicalCollapsed=(-not $controls.Technical.IsExpanded);interactive=[Environment]::UserInteractive;sessionId=(Get-Process -Id $PID).SessionId} | ConvertTo-Json -Compress;exit 0}
if($PreviewImage){
 if(-not $PreviewFile){throw 'PreviewFile with structured fixture data is required'}
 ShowOperation ([IO.File]::ReadAllText($PreviewFile) | ConvertFrom-Json)
 $window.ShowActivated=$false;$window.Show();$window.UpdateLayout()
 # Render the actual WPF client area; native title-bar space cannot be painted
 # into a RenderTargetBitmap and previously left misleading black padding.
 $surface=$window.Content;$m=$surface.Margin;$width=[int][Math]::Ceiling($surface.ActualWidth+$m.Left+$m.Right);$height=[int][Math]::Ceiling($surface.ActualHeight+$m.Top+$m.Bottom)
 $visual=New-Object Windows.Media.DrawingVisual;$draw=$visual.RenderOpen();$draw.DrawRectangle($window.Background,$null,[Windows.Rect]::new(0,0,$width,$height));$draw.DrawRectangle([Windows.Media.VisualBrush]::new($surface),$null,[Windows.Rect]::new($m.Left,$m.Top,$surface.ActualWidth,$surface.ActualHeight));$draw.Close()
 $bmp=New-Object Windows.Media.Imaging.RenderTargetBitmap($width,$height,96,96,[Windows.Media.PixelFormats]::Pbgra32);$bmp.Render($visual)
 $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bmp));$stream=[IO.File]::Create($PreviewImage);$encoder.Save($stream);$stream.Dispose();$window.Close();exit 0
}
if(-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0){throw 'Signed-in Windows desktop required'}
$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StateDir)))).Replace('-','').Substring(0,20)
$mutex=New-Object Threading.Mutex($false,('Local\YApproval_'+$hash));if(-not $mutex.WaitOne(0)){exit 0}
$sealed=[IO.File]::ReadAllText((Join-Path $StateDir 'local-panel.dpapi')).Trim();if(-not $sealed.StartsWith('dpapi:')){throw 'No protected local panel credential'}
$data=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($sealed.Substring(6)),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$auth=[Text.Encoding]::UTF8.GetString($data) | ConvertFrom-Json;$base=[uri]$auth.base
if($base.Host -ne '127.0.0.1' -or $base.Scheme -ne 'http'){throw 'Loopback only'}
$headers=@{Authorization=('Bearer '+$auth.key)};$script:csrf='';$script:entries=@();$script:selected=$null;$script:changing=$false
function UpdateView {
 $i=$controls.Queue.SelectedIndex;if($i -lt 0 -or $i -ge $script:entries.Count){$controls.Allow.IsEnabled=$false;$controls.Always.IsEnabled=$false;$controls.Deny.IsEnabled=$false;return}
 $r=$script:entries[$i];$script:selected=$r.id;ShowOperation $r
}
function RefreshQueue {
 try{
  $q=Invoke-RestMethod -Uri ($auth.base+'/api/queue') -Headers $headers -TimeoutSec 3 -UseBasicParsing;$script:csrf=$q.csrf
  $signature=($q.entries | ForEach-Object {$_.id+':'+$_.state}) -join ','
  if($signature -eq $script:lastSignature){return};$script:lastSignature=$signature;$script:changing=$true
  $pending=@($q.entries | Where-Object {$_.state -in @('awaiting_user','approved','running','unknown')})
  # PowerShell 5.1 unwraps a single object returned from `if`; force an
  # array or Count becomes null and the lone request's buttons stay disabled.
  $script:entries=@(if($pending.Count){$pending}else{$q.entries | Select-Object -First 1})
  $controls.Queue.Items.Clear();foreach($r in $script:entries){$controls.Queue.Items.Add([pscustomobject]@{label=($labels[$r.state]+' · '+$r.presentation.title);id=$r.id}) | Out-Null}
  $controls.Queue.Visibility=if($script:entries.Count -gt 1){'Visible'}else{'Collapsed'}
  $index=0;for($i=0;$i -lt $script:entries.Count;$i++){if($script:entries[$i].id -eq $script:selected){$index=$i;break}}
  $controls.Queue.SelectedIndex=$index;$script:changing=$false;UpdateView
  $controls.HistoryText.Text=(@($q.events | Select-Object -First 6 | ForEach-Object {([datetime]$_.at).ToLocalTime().ToString('HH:mm:ss')+'  '+$_.label+'  '+$_.title}) -join "`n")
  if($script:entries.Count -eq 0){$controls.State.Text='当前没有待审批操作';$controls.Title.Text='可以关闭此窗口';$controls.Purpose.Text='普通开发工作自动继续。'}
 }catch{$script:lastPanelError=$_.Exception.Message;$controls.Note.Text='审批服务不可用，不会自动执行。';$controls.Allow.IsEnabled=$false;$controls.Always.IsEnabled=$false;$controls.Deny.IsEnabled=$false}
}
function Decide([string]$choice){
 try{
  $controls.Allow.IsEnabled=$false;$controls.Always.IsEnabled=$false;$controls.Deny.IsEnabled=$false
  $h=@{Authorization=$headers.Authorization;'X-YGPT-CSRF'=$script:csrf};$body=@{id=$script:selected;decision=$choice} | ConvertTo-Json -Compress
  $null=Invoke-RestMethod -Uri ($auth.base+'/api/decision') -Method Post -ContentType 'application/json' -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 3 -UseBasicParsing
  $controls.Note.Text='决定已记录。需要时向 ChatGPT 发送“继续”以查询结果。';RefreshQueue
 }catch{$controls.Note.Text='请求已过期或已处理，请核对当前状态。';RefreshQueue}
}
$controls.Queue.Add_SelectionChanged({if(-not $script:changing){UpdateView}});$controls.Allow.Add_Click({Decide 'once'});$controls.Always.Add_Click({Decide 'chat'});$controls.Deny.Add_Click({Decide 'deny'})
$timer=New-Object Windows.Threading.DispatcherTimer;$timer.Interval=[TimeSpan]::FromSeconds(1);$timer.Add_Tick({RefreshQueue})
RefreshQueue
if($Probe){[pscustomobject]@{title=$controls.Title.Text;allowEnabled=$controls.Allow.IsEnabled;alwaysEnabled=$controls.Always.IsEnabled;denialEnabled=$controls.Deny.IsEnabled;lastError=$script:lastPanelError;entryCount=$script:entries.Count} | ConvertTo-Json -Compress;$mutex.ReleaseMutex();$mutex.Dispose();exit 0}
$window.Add_SizeChanged({$window.Left=$area.Right-$window.ActualWidth-16;$window.Top=$area.Bottom-$window.ActualHeight-16})
# A short taskbar flash makes a non-activating approval discoverable. Only the
# explicitly requested manual demo may temporarily come to the foreground.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YPanelNotice {
 [StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
 [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
 public static void Flash(IntPtr hwnd) { var f=new FLASHWINFO(); f.cbSize=(uint)Marshal.SizeOf(f); f.hwnd=hwnd; f.dwFlags=2; f.uCount=3; FlashWindowEx(ref f); }
}
'@
$focusTimer=New-Object Windows.Threading.DispatcherTimer;$focusTimer.Interval=[TimeSpan]::FromSeconds(6);$focusTimer.Add_Tick({$window.Topmost=$false;$focusTimer.Stop()})
if($FocusOnOpen){$window.ShowActivated=$true;$window.Topmost=$true}
$timer.Start();$window.Add_ContentRendered({
 $handle=([Windows.Interop.WindowInteropHelper]::new($window)).Handle
 [YPanelNotice]::Flash($handle)
 if($FocusOnOpen){$window.Activate() | Out-Null;$focusTimer.Start()}
});$window.Add_Closed({$timer.Stop();$focusTimer.Stop()})
try{$window.ShowDialog() | Out-Null}finally{$mutex.ReleaseMutex();$mutex.Dispose();[Array]::Clear($data,0,$data.Length)}
