# RC3 installer — first-install Task Scheduler fix (2026-10-21)

## User reproduction
Windows Sandbox, Step 5 **Install & configure**, default empty application directory under `%LOCALAPPDATA%\Programs\YGPTLocal`. Failure: `Setup stopped during 'register Windows automatic startup': The system cannot find the file specified. (HRESULT 0x80070002)`. This was NOT caused by missing portable ZIP or OpenAI credentials.

## Root cause (confirmed on Windows)
1. `Schedule.Service\GetFolder("\\")\GetTask(name)` returns HRESULT 0x80070002 when a task does not yet exist. .NET dynamic COM projects the failure as `System.IO.FileNotFoundException`, while `HostCore.RegisterTask` caught only `COMException`. Fixed to accept only the exact HResult from the GetTask call, otherwise rethrow.
2. Windows normalizes scheduled task principal `UserId` into a short account name (observed on test host), though the installer submitted a SID. Direct string equality incorrectly judged its own task as foreign. Fixed by translating the stored NTAccount to a SID and comparing the underlying user identity. All mismatched tasks remain protected.

## UX improvements
- Application folder validated earlier; source ZIP/portable extraction directory rejected.
- Missing Watchdog state in partial repair uses process ownership checks, not synthetic health.
- Stage-specific failure messages for payload, data, provisioning, task registration, Watchdog launch.
- Buttons for recommended Tunnel name, Tunnel description, API key name, and plugin name/description.
- Suggested plugin Name remains **YGPT Local**. ChatGPT's external form still requires user confirmation or copy/paste.
- Plugin description explains the local-file intent and authorized scope, including reading and editing files, code/projects, builds/tests, terminal tasks, browser/desktop and rollback.

## Test evidence
- Native project compile PASS.
- 15/15 Node/MCP/Windows and new TaskScheduler test PASS.
- Disposable owner-specific Windows task: first create, idempotent re-register and remove PASS.
- Full packaged Windows UIA installer, isolated local-only setup: PASS. Reached eight pages, local MCP ping/read, no-GUI runtime continuation, duplicate owner prevention, child crash recovery, cleanup only of test fixture, setting re-open, safe drain. Candidate SHA256: `8ad442d933d713d90bebf170c353b92b8f95b675f216a410fec56643ba5de843`.
- NOT VERIFIED: user's actual Sandbox guest after replacing the EXE, fresh remote Secure MCP Tunnel and ChatGPT host first-use, real Windows logout/login, production network disconnect/recovery.

## Candidate
`D:\AI\Projects\YGPT-Local\dist\YGPTLocal-Setup-1.0.0-rc.3-win-x64.exe`.
Old copies on Sandbox Desktop must be replaced; filename does not distinguish the rebuilt candidate. Do not push public GitHub Release until release gates are satisfied.

## Diagnostic task cleanup
Temporary per-test scheduled tasks must be removed by their fixtures after verifying the action path belongs to the fixture. Do not remove production tasks by name alone. Any old fixture task requiring manual cleanup must be checked against its exact disposable action path first; no production task is in scope.
