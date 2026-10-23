# YGPT Local 1.0.2 — reliable cleanup after migration

[中文说明](RELEASE_1.0.2_ZH.md) · [Setup](SETUP_GUIDE.md) · [Cleanup policy](RELEASE_1.0.1.md)

This patch completes the installation cleanup workflow from 1.0.1. A final check on the installed Windows host found a signed download-cleanup record that still named its pre-migration data directory. Its ownership guard correctly refused deletion, but the exception also prevented independent rollback-cache maintenance from running.

- Download cleanup and installation-cache cleanup now run independently. A failed download check cannot suppress the other check.
- A signed record naming an earlier installation scope produces a persistent **review-required** result. It is never silently rebound to a new directory, and no file is deleted from that record.
- The cleanup review window displays the reason and next step. Registering a newly downloaded updater with its exact-file checkbox resumes download cleanup; the unchanged legacy record does not cause repeated attempts.
- Keep one verified rollback, reclaim surplus verified copies and redundant contained installer caches, and back up obsolete uninstall registrations before removing them. Private configuration, credentials, state, snapshots, migration/recovery records and development repositories remain protected.

Use the Update EXE for an existing installation or Setup for a new installation. Check `SHA256SUMS.txt`; installers are unsigned. The English setup, separate Chinese documentation, light-blue HD icons, browser lifecycle fixes and clear install/verify/update/uninstall outcomes remain included. An extension still loaded from rc.17 or earlier needs one Reload per browser profile.

See [verification](../evidence/housekeeping-1.0.2-verification.json) for automated and Windows field evidence. Local readiness and controlled browser tests do not establish real ChatGPT human-click approval or every signed-in browser workflow. Clean Windows and Windows sign-in acceptance remain unverified.

![Download review and independent cache cleanup — native window with fixture data](images/installation-cleanup-1.0.2.png)
