using System;
using System.Reflection;
public static class Rc3TunnelCommandRegression {
 public static int Main(){
  string command=YGPTWatchdog.StdioMcpCommand(@"C:\Program Files\YGPT Local\node.exe",@"D:\Test Projects\runtime\bootstrap.mjs");
  if(command.Contains("\\")||!command.Contains("\"C:/Program Files/YGPT Local/node.exe\"")||!command.Contains("\"D:/Test Projects/runtime/bootstrap.mjs\""))return 11;
  var classify=typeof(YGPTWatchdog).GetMethod("ClassifyClientError",BindingFlags.Static|BindingFlags.NonPublic);
  if(classify==null)return 12;
  string oldError="mcpclient: start stdio command: fork/exec D:AIProjectsnode.exe: The system cannot find the file specified.";
  if(Convert.ToString(classify.Invoke(null,new object[]{oldError}))!="TUNNEL_STDIO_PROCESS_PATH_INVALID")return 13;
  if(Convert.ToString(classify.Invoke(null,new object[]{"HTTP 401 invalid_api_key"}))!="RUNTIME_KEY_INVALID_OR_EXPIRED")return 14;
  Console.WriteLine("STDIO_PATH_NORMALIZATION_PASS;ERROR_CLASSIFICATION_PASS");
  return 0;
 }
}