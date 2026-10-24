using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

// Only ApprovalWindow is production code. This fixture has no real pipe,
// credentials, operations, network or production-directory access.
public static class HostCore {
 public static Dictionary<string,object> ControlRequest(string data,string action,object payload){throw new Exception("Real owner pipe forbidden in fixture");}
 public static string S(Dictionary<string,object> d,string key){return d.ContainsKey(key)?Convert.ToString(d[key]):"";}
 public static bool B(Dictionary<string,object> d,string key){return d.ContainsKey(key)&&d[key] is bool&&(bool)d[key];}
}
public static class SetupWindow {public static void StyleButton(Button b,bool primary){b.Padding=new Thickness(16,12,16,12);b.Margin=new Thickness(0,0,8,8);}}
public static class ApprovalWindowRegression {
 const BindingFlags Private=BindingFlags.Instance|BindingFlags.NonPublic;
 static T Field<T>(object o,string name){return (T)o.GetType().GetField(name,Private).GetValue(o);}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void PumpUntil(Func<bool> done){var end=DateTime.UtcNow.AddSeconds(6);while(!done()){if(DateTime.UtcNow>end)throw new Exception("Dispatcher timeout");var frame=new DispatcherFrame();var timer=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(10)};timer.Tick+=(s,e)=>{timer.Stop();frame.Continue=false;};timer.Start();Dispatcher.PushFrame(frame);}}
 static Dictionary<string,object> Row(string id,bool eligible){return new Dictionary<string,object>{{"id",id},{"state","awaiting_user"},{"nonce","nonce-"+id},{"requestDigest","digest-"+id},{"expiresAt","Fixture only"},{"presentation",new Dictionary<string,object>{{"title","Fixture "+id},{"target","Disposable example"},{"impact","No execution"},{"technical","Exact fixture arguments"}}},{"chatScope",new Dictionary<string,object>{{"eligible",eligible}}}};}
 [STAThread] public static int Main(){
  SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
  var queue=new List<Dictionary<string,object>>{Row("FIRST",false),Row("SECOND",true)};object submitted=null;bool fail=false;
  var w=new ApprovalWindow("FIXTURE_ONLY",payload=>{
   string kind=Convert.ToString(payload.GetType().GetProperty("kind").GetValue(payload,null));
   if(kind=="queue")return new Dictionary<string,object>{{"entries",queue.ToArray()}};
   submitted=payload;return new Dictionary<string,object>{{"ok",!fail},{"state","denied"}};
  });w.ShowActivated=false;w.Left=-20000;w.Top=-20000;w.WindowStartupLocation=WindowStartupLocation.Manual;w.Show();
  var list=Field<ListBox>(w,"list");PumpUntil(()=>list.Items.Count==2);w.UpdateLayout();
  Check(Field<TextBox>(w,"details").Text.Contains("Exact fixture arguments"),"Review must show exact details");
  Check(Field<Button>(w,"once").IsEnabled&&!Field<Button>(w,"chat").IsEnabled,"Ineligible chat grants must remain disabled");
  list.SelectedIndex=1;Check(Field<Button>(w,"chat").IsEnabled,"Eligible request has scoped choice");
  Field<Button>(w,"deny").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));PumpUntil(()=>submitted!=null&&!Field<bool>(w,"busy"));
  Check(Convert.ToString(submitted.GetType().GetProperty("id").GetValue(submitted,null))=="SECOND"&&Convert.ToString(submitted.GetType().GetProperty("requestDigest").GetValue(submitted,null))=="digest-SECOND","Choice must bind selected request and digest");
  Check(Field<TextBlock>(w,"state").Text.Contains("Decision saved"),"Decision needs explicit feedback");
  queue.RemoveAt(1);w.GetType().GetMethod("Refresh",Private).Invoke(w,null);PumpUntil(()=>list.Items.Count==1&&!Field<bool>(w,"loading"));
  Check(list.SelectedIndex==-1&&!Field<Button>(w,"once").IsEnabled,"Removing completed request must not select another pending action");
  w.Height=w.MinHeight;w.Width=w.MinWidth;w.UpdateLayout();var root=(DockPanel)w.Content;
  foreach(var b in new[]{Field<Button>(w,"once"),Field<Button>(w,"chat"),Field<Button>(w,"deny")}){var p=b.TransformToAncestor(root).Transform(new Point());Check(p.Y>=0&&p.Y+b.ActualHeight<=root.ActualHeight+1,"Decision buttons remain visible at minimum size");}
  fail=true;submitted=null;list.SelectedIndex=0;Field<Button>(w,"once").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));PumpUntil(()=>submitted!=null&&!Field<bool>(w,"busy"));
  Check(Field<TextBlock>(w,"state").Text.Contains("not confirmed"),"Failures must not imply success");w.Close();Console.WriteLine("APPROVAL_WINDOW_PASS");return 0;
 }
}
