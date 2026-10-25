using System;
using System.Reflection;
using System.Runtime.InteropServices;
class DesktopInputRegression {
 static FieldInfo effect=typeof(YDesktop).GetField("effectStarted",BindingFlags.Static|BindingFlags.NonPublic);
 static void Check(bool value,string message){if(!value)throw new Exception(message);}
 static void Failure(uint requested,uint inserted,int error,string code,bool uncertain){
  effect.SetValue(null,false);YDesktop.inputDiagnostics=null;bool failed=false;
  try{YDesktop.InputResult(requested,inserted,error);}catch(Exception e){failed=true;Check(e.Message.StartsWith(code+":"),e.Message);Check(!e.Message.Contains("INPUT_BLOCKED_UIPI"),"zero return cannot establish UIPI");}
  Check(failed,"failure must be reported");Check((bool)effect.GetValue(null)==uncertain,"effect certainty must follow actual inserted count");
  Check((uint)YDesktop.inputDiagnostics["inserted"]==inserted,"actual count");Check((int)YDesktop.inputDiagnostics["win32Error"]==error,"native error");
 }
 static void Main(){
  Check(IntPtr.Size==8&&Marshal.SizeOf(typeof(YDesktop.INPUT))==40,"Win64 INPUT layout");
  var chord=YDesktop.KeyInputs("CTRL+SHIFT+R");Check(chord.Length==6,"one complete chord batch");ushort[] keys={0x11,0x10,0x52,0x52,0x10,0x11};
  for(int n=0;n<chord.Length;n++){Check(chord[n].type==1&&chord[n].key.vk==keys[n],"ordered down/reverse-up");Check(chord[n].key.flags==(n<3?0u:2u),"all releases present");}
  Check(YDesktop.KeyInputs("ENTER").Length==2,"single key includes release");
  foreach(string invalid in new[]{"CTRL+CTRL","CTRL+NOT_A_KEY","CTRL+SHIFT+ALT+A+B+C"}){bool failed=false;try{YDesktop.KeyInputs(invalid);}catch{failed=true;}Check(failed,"invalid chord rejected before dispatch");}
  Failure(4,0,0,"INPUT_NOT_INSERTED",false);Failure(4,0,5,"INPUT_ACCESS_DENIED",false);Failure(4,0,87,"INPUT_INVALID_PARAMETER",false);Failure(4,1,0,"INPUT_PARTIAL",true);
  effect.SetValue(null,true);try{YDesktop.InputResult(2,0,0);}catch{}Check((bool)effect.GetValue(null),"a later zero return must preserve earlier input uncertainty");
  effect.SetValue(null,false);YDesktop.InputResult(4,4,0);Check((bool)effect.GetValue(null),"successful input recorded");
  Console.WriteLine("DESKTOP_INPUT_REGRESSION_PASS");
 }
}
