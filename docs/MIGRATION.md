# Optional migration and recovery

The candidate uses a new product name, a separate installation/data directory and its own startup entry. The existing service and Tunnel remain unchanged. Never make two runtime processes consume the same Tunnel or open the same live ledger.

The naming audit in `baseline-migration-map.json` records source transformations and original hashes. New public tools use `y_`. The compatibility resolver accepts historical prefixed calls; no encrypted historic approval, ledger key or capability is rewritten in place. Older unprefixed durable job tools are now advertised as `y_task_*` to avoid collisions with native `y_job_*`.

Full automated migration of live encrypted state is not released. Before a future opt-in migration: finish active jobs and approvals, stop only the old owner instance, verify and retain copies of its configuration/snapshots, choose a new dedicated connection or explicitly transfer ownership, copy only supported state under the same Windows owner, then validate restore and exact tool catalog. Never copy browser cookies or merge account homes.

This candidate does not promise whole-system release rollback. File edit snapshots and restore conflict protection remain required. Uninstall retains user data by default. Do not erase backups until the owner explicitly accepts the corresponding content and cleanup.
