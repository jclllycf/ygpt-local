$ErrorActionPreference='Stop'
# Parse only. Never invoke the submitted text, load profiles or evaluate values.
$text=[Console]::In.ReadToEnd()
$tokens=$null;$errors=$null
$tree=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
if($errors.Count -or $text.Length -gt 12000){'false';exit}
$allowed=@('get-childitem','gci','dir','ls','get-content','gc','cat','type','get-item','gi','get-itemproperty','get-itempropertyvalue','test-path','resolve-path','convert-path','split-path','join-path','select-object','select','where-object','where','foreach-object','sort-object','sort','measure-object','group-object','select-string','format-list','format-table','format-wide','out-string','convertto-json','convertfrom-json','get-date','get-location','pwd','get-process','get-service','get-scheduledtask','get-scheduledtaskinfo','get-ciminstance','get-wmiobject','get-winevent','get-eventlog','get-disk','get-partition','get-volume','get-acl','get-filehash','get-computerinfo','get-itempropertyvalue','write-output','echo')
$safe=$true;$commands=0
foreach($node in $tree.FindAll({param($n) $true},$true)){
 if($node -is [Management.Automation.Language.CommandAst]){
  $commands++;$name=$node.GetCommandName()
  if(-not $name -or $name.ToLowerInvariant() -notin $allowed -or $node.InvocationOperator -notin @('Unknown')){$safe=$false;break}
  if($node.CommandElements|Where-Object {$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -match '^(?:OutVariable|ov|PipelineVariable|pv|ErrorVariable|ev)$'}){$safe=$false;break}
  if($name -eq 'foreach-object' -and ($node.CommandElements|Select-Object -Skip 1|Where-Object {$_ -isnot [Management.Automation.Language.ScriptBlockExpressionAst] -and $_ -isnot [Management.Automation.Language.CommandParameterAst]})){$safe=$false;break}
 }
 if($node -is [Management.Automation.Language.InvokeMemberExpressionAst] -or $node -is [Management.Automation.Language.AssignmentStatementAst] -or $node -is [Management.Automation.Language.RedirectionAst] -or $node -is [Management.Automation.Language.TypeExpressionAst] -or $node -is [Management.Automation.Language.FunctionDefinitionAst] -or $node -is [Management.Automation.Language.UsingStatementAst] -or $node -is [Management.Automation.Language.TrapStatementAst]){$safe=$false;break}
 if($node -is [Management.Automation.Language.UnaryExpressionAst] -and $node.TokenKind -in @('PlusPlus','MinusMinus','PostfixPlusPlus','PostfixMinusMinus')){$safe=$false;break}
 if($node -is [Management.Automation.Language.VariableExpressionAst] -and $node.VariablePath.UserPath -notmatch '^(?:_|PSItem|true|false|null|env:[A-Za-z_][A-Za-z0-9_]*)$'){$safe=$false;break}
 if($node -is [Management.Automation.Language.MemberExpressionAst] -and $node.Static){$safe=$false;break}
}
if($safe -and $commands -gt 0){'true'}else{'false'}
