# YGPT Local 1.0.15

Desktop authorization could succeed while a later keyboard call failed. The native adapter incorrectly labelled every incomplete `SendInput` return as `INPUT_BLOCKED_UIPI`, without capturing the Win32 error. This could make an already authorized task ask for permission again.

The adapter now reports the actual requested and inserted event counts, Win32 error and observed process integrity levels. Zero insertion and partial insertion have distinct error codes and certainty. A verified higher-integrity target is diagnosed before input; a zero return alone is never treated as proof of UIPI. Keyboard chords send their key-down and reverse key-up events in one ordered batch, with interactive-desktop and foreground checks immediately before dispatch. Partial or previously delivered input still has an unknown outcome and must not be replayed.

Desktop Full Access continues to default to **100 minutes**, for the approving chat only. It does not elevate ordinary desktop tools. The optional Administrator command executor still requires its own owner card and Windows UAC.

On the development PC, the new diagnostic reproduced `INPUT_ACCESS_DENIED`: zero events inserted, Win32 error 5, both processes at medium integrity. The source of that Windows input refusal is not yet confirmed. This release improves correctness and delivery but does not claim that this machine's input blocker or the unrelated extension's real-chat acceptance is resolved.

Use Update for an existing installation. Refresh and bind current desktop windows after a service restart. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues).
