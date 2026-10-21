# RC3 validation and owner handoff

The owner requested English-only UI, then asked to perform the remaining tests personally. Automated behavioral testing was stopped. The final RC3 package is compiled and supplied for owner acceptance; no final package, official Secure Tunnel, or ChatGPT acceptance is claimed. The existing RC2 production connection was preserved.

| Evidence | Actual scope and limit |
| --- | --- |
| Local compound regression | 12/12 passed during development before the final startup-task ownership guard; not ChatGPT |
| Native Windows checks | 2/2 passed separately for parse-only command classification and state ACL/link boundaries, before the final guard |
| Earlier packaged installer | 25 native lifecycle assertions passed on the development PC, advanced local-only mode, installer SHA daaa3193667e1715fc7fc7e47ccc4ef0fc60fb318f51efc153a454728a101dcc; earlier bilingual UI, not the final package |
| Cleanup fixture | Exact manifest, changed/open/replaced/foreign/reference/link safety and idempotent receipts exercised. Two owned fixture files, 16 bytes total reclaimed. Not real ChatGPT-triggered cleanup |
| Clean Windows Sandbox | Started and installed an earlier candidate; startup failed because PowerShell script execution was restricted. Replaced default startup scripts with a typed native Windows helper. The final fix was not retested in Sandbox at the owner's request; VM stopped |
| English-only final UI | Language switch and alternate UI strings removed; final native GUI and DPI/accessibility acceptance left to owner |
| Standalone Watchdog | Implemented. Earlier local-mode GUI-exit, single-owner and owned-child recovery checks passed. Actual Windows sign-in and network loss were not verified |
| Official Tunnel / ChatGPT | Owner deferred dedicated website steps. No new Tunnel, key, personal plugin or human risk confirmation created. RC2 evidence is historical and cannot satisfy RC3 gates |
| Final package | Built with bundled runtimes, original icon and native helper; SHA-256 listed alongside download. Unsigned |
| Public Release | Not published. Private development branch is the delivery target until owner acceptance |

See [RC3 development evidence](../evidence/rc3-development.json) and [release gates](../evidence/release-gates.json). A local marker read is not proof of a real ChatGPT user or physical human click. Unknown-result mutations must not be replayed.

## Prior resource measurement

A 15-second sample of an earlier advanced local-only chain measured 23,805,952 private bytes for the Watchdog (22.7 MiB), 202,407,936 private bytes for four processes (193.0 MiB), and 0.062% machine CPU across 32 logical processors. Some working sets were paged out. These are development observations, not a final Secure Tunnel resource budget.

## Owner acceptance still outstanding

Final English-only install/repair, official Secure Tunnel plus first ChatGPT marker read, authentic approval decisions, login/reconnect, cleanup then maintenance/read/restore, clean Windows 10/11 and DPI/accessibility. These were not rerun after the owner took over testing.
