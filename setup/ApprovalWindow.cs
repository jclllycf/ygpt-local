using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

// Manual Windows-owner fallback over the existing authenticated named pipe.
// No browser-visible credential, public listener or automatic approval.
public sealed class ApprovalWindow:Window {
 readonly string data;
 readonly Func<object,Dictionary<string,object>> request;
 readonly ListBox list=new ListBox();
 readonly TextBox details=new TextBox();
 readonly TextBlock state=new TextBlock();
 readonly Button once=new Button(),chat=new Button(),deny=new Button();
 readonly DispatcherTimer timer=new DispatcherTimer();
 readonly List<Dictionary<string,object>> entries=new List<Dictionary<string,object>>();
 bool busy=false,loading=false;
 string selectedId="";
 public ApprovalWindow(string dataDir):this(dataDir,p=>HostCore.ControlRequest(dataDir,"review",p)){}
 internal ApprovalWindow(string dataDir,Func<object,Dictionary<string,object>> transport){
  data=dataDir;request=transport;Title="YGPT Local — Approval center";Width=940;Height=700;MinWidth=760;MinHeight=560;
  ShowActivated=true;WindowStartupLocation=WindowStartupLocation.CenterScreen;Background=new SolidColorBrush(Color.FromRgb(247,251,254));Foreground=new SolidColorBrush(Color.FromRgb(15,42,68));FontFamily=new FontFamily("Segoe UI");FontSize=14;
  AutomationProperties.SetAutomationId(this,"ygpt.approval-center");
  var root=new DockPanel{Margin=new Thickness(24)};Content=root;
  var heading=new StackPanel{Margin=new Thickness(0,0,0,18)};DockPanel.SetDock(heading,Dock.Top);root.Children.Add(heading);
  heading.Children.Add(new TextBlock{Text="Review pending actions",FontSize=24,FontWeight=FontWeights.SemiBold});
  heading.Children.Add(new TextBlock{Text="This is the same approval queue used by your phone and browser. Review the exact action before choosing.",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,8,0,0)});
  state.TextWrapping=TextWrapping.Wrap;state.Margin=new Thickness(0,12,0,12);AutomationProperties.SetAutomationId(state,"review-state");DockPanel.SetDock(state,Dock.Bottom);root.Children.Add(state);
  var actions=new WrapPanel();DockPanel.SetDock(actions,Dock.Bottom);root.Children.Add(actions);
  Configure(once,"Allow once","review-allow-once",()=>Decide("once"));Configure(chat,"Always allow in this chat","review-allow-chat",()=>Decide("chat"));Configure(deny,"Deny","review-deny",()=>Decide("deny"));actions.Children.Add(once);actions.Children.Add(chat);actions.Children.Add(deny);
  var columns=new Grid();columns.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(280)});columns.ColumnDefinitions.Add(new ColumnDefinition());root.Children.Add(columns);
  list.Margin=new Thickness(0,0,16,0);list.BorderBrush=new SolidColorBrush(Color.FromRgb(217,231,242));AutomationProperties.SetAutomationId(list,"review-request-list");columns.Children.Add(list);list.SelectionChanged+=(s,e)=>ShowSelection();
  details.IsReadOnly=true;details.TextWrapping=TextWrapping.Wrap;details.Padding=new Thickness(16);details.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;details.Background=Brushes.White;details.BorderBrush=list.BorderBrush;AutomationProperties.SetAutomationId(details,"review-details");Grid.SetColumn(details,1);columns.Children.Add(details);
  timer.Interval=TimeSpan.FromSeconds(3);timer.Tick+=(s,e)=>Refresh();Loaded+=(s,e)=>{Refresh();timer.Start();};Closed+=(s,e)=>timer.Stop();ShowSelection();
 }
 void Configure(Button b,string label,string id,Action action){b.Content=label;SetupWindow.StyleButton(b,id=="review-allow-once");AutomationProperties.SetAutomationId(b,id);b.Click+=(s,e)=>action();}
 Dictionary<string,object> Current(){return list.SelectedIndex>=0&&list.SelectedIndex<entries.Count?entries[list.SelectedIndex]:null;}
 static string StateLabel(string value){switch(value){case "awaiting_user":return "Awaiting your decision";case "approved":return "Approved";case "running":return "Running";case "unknown":return "Check the existing result";default:return value;}}
 void ShowSelection(){var row=Current();if(row==null){details.Text="Choose a pending request. Completed requests disappear from this queue; their original results stay in ChatGPT.";once.Content="Allow once";once.IsEnabled=chat.IsEnabled=deny.IsEnabled=false;return;}
  selectedId=HostCore.S(row,"id");var p=row.ContainsKey("presentation")?row["presentation"] as Dictionary<string,object>:null;
  details.Text=p==null?"Review unavailable":HostCore.S(p,"title")+"\n\nTarget\n"+HostCore.S(p,"target")+"\n\nImpact\n"+HostCore.S(p,"impact")+"\n\nExact details\n"+HostCore.S(p,"technical")+"\n\nRequest\n"+selectedId+"\n\nExpires\n"+HostCore.S(row,"expiresAt");
  once.Content=p!=null&&HostCore.S(p,"approveLabel")!=""?HostCore.S(p,"approveLabel"):"Allow once";
  if(p!=null&&HostCore.S(p,"reversible")!="")details.Text+="\n\nRecovery and revocation\n"+HostCore.S(p,"reversible");
  bool enabled=!busy&&HostCore.S(row,"state")=="awaiting_user"&&HostCore.S(row,"nonce")!="";
  once.IsEnabled=deny.IsEnabled=enabled;var scope=row.ContainsKey("chatScope")?row["chatScope"] as Dictionary<string,object>:null;chat.IsEnabled=enabled&&scope!=null&&HostCore.B(scope,"eligible");
 }
 async void Refresh(){if(busy||loading)return;loading=true;try{
  var result=await Task.Run(()=>request(new{kind="queue"}));if(!result.ContainsKey("entries"))throw new Exception("Approval center is unavailable. Update YGPT Local and check its connection.");
  string previous=selectedId;entries.Clear();list.Items.Clear();foreach(object item in (IEnumerable)result["entries"]){var row=item as Dictionary<string,object>;if(row==null)continue;entries.Add(row);var p=row["presentation"] as Dictionary<string,object>;list.Items.Add(new TextBlock{Text=HostCore.S(p??new Dictionary<string,object>(),"title")+"\n"+StateLabel(HostCore.S(row,"state")),TextWrapping=TextWrapping.Wrap,Padding=new Thickness(10)});}
  int index=entries.FindIndex(r=>HostCore.S(r,"id")==previous);list.SelectedIndex=index>=0?index:previous==""&&entries.Count>0?0:-1;
  state.Text=entries.Count==0?"No pending approvals. Return to your ChatGPT conversation.":"Reviewing "+entries.Count+" saved request(s). No action runs before your choice.";ShowSelection();
 }catch(Exception){state.Text="Could not connect to the approval queue. Start the YGPT connection and retry; no decision was submitted.";}finally{loading=false;}}
 async void Decide(string choice){var row=Current();if(row==null||busy)return;busy=true;ShowSelection();state.Text="Recording your decision…";try{
  var payload=new{kind="decision",id=HostCore.S(row,"id"),nonce=HostCore.S(row,"nonce"),requestDigest=HostCore.S(row,"requestDigest"),decision=choice};
  var result=await Task.Run(()=>request(payload));if(!HostCore.B(result,"ok"))throw new Exception("The request changed, expired or was already handled.");
  state.Text="Decision saved: "+HostCore.S(result,"state")+". Return to the same ChatGPT conversation; choose Resume chat if needed.";
 }catch(Exception){state.Text="Decision not confirmed. It was not resubmitted. Refresh the request before trying again.";}finally{busy=false;ShowSelection();}}
}
