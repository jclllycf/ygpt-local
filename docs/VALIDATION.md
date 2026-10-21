# Validation status

This is a development release candidate, not an accepted public release. The owner authorized a production rename and cutover on 2026-10-21. The existing OpenAI Tunnel identity and other tunnels were retained.

| Check | Evidence and limit |
| --- | --- |
| Renamed catalog; SQLite; snapshots, restore and conflict | Real Windows broker tests passed; 92 public + 2 App-only tools |
| HTTP authentication | Real HTTP/SDK integration passed: OAuth PKCE, owner consent, discovery, revocation, Host rejection and maintenance drain |
| OAuth restart and refresh | Windows DPAPI persistence passed; rotating refresh and replay-family revocation passed |
| Browser, desktop and jobs | Actual isolated Edge DOM/click/screenshot, native Windows UIA fixture and persistent job output passed locally |
| Approval semantics | Local fixtures passed once/exact reuse, deny, bounded chat grant and context revocation; not proof of a human-host click |
| App CSP | Inline bundle ran under its real policy in Edge; not ChatGPT host rendering |
| Native installer | Actual packaged GUI fresh install and same-folder repair passed on the development PC; user file and owner identity retained |
| Uninstall | Actual installed GUI uninstall passed after fixing trailing-backslash argument quoting; user file, encrypted credentials and state retained |
| Bundled runtimes | Node 24.22.0, CPython 3.14.8, cloudflared 2026.10.2, official OpenAI tunnel-client 0.0.16; publisher hashes and notices retained |
| Clean Windows VM without developer tools | Not verified. Windows Sandbox CLI could not start; fallback produced no test receipt. No OS feature/security settings were changed |
| GitHub CI | Windows CI run 3 passed after correcting the embedded-Python source-build import path |
| Source and dependencies | Source scan passed; 106 npm license declarations reviewed; npm production audit reported zero known vulnerabilities against the official registry. Final archive/history checks remain |
| Dedicated OpenAI Tunnel | Existing owner-authorized OpenAI Tunnel identity retained during cutover; production ready. A separate direct API/SDK ingress probe returned 404 and is not counted as host validation |
| Real new-brand ChatGPT plugin | Existing plugin renamed and updated to 1.0.3. An actual ChatGPT chat returned production 1.0.0-rc.1 and the fixture file content value=100; other host scenarios remain pending |
| Twenty golden host prompts | All pending; no synthetic accuracy is reported |
| Repository / Release | A single private preparation repository exists. No public Release or download acceptance has been claimed |

Local seven-test suite is a small set of compound integration tests, not six separate human-host approvals. Check version and SHA in the accompanying evidence before matching results to a particular installer. Subsequent binary changes require another installer test.

Remaining work includes clean Windows VM verification, final uninstallation/upgrade checks, optional legacy snapshot import, real Tunnel credentials and reconnection, actual ChatGPT tool selection and App approvals, remaining credential failure scenarios and final public release checks. Never infer these from a green local health response.
