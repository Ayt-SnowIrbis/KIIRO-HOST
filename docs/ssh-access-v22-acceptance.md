# SSH Access v2.2 release gate

Do not merge until all cases pass on a disposable Ubuntu 24.04 Incus container.

| Case | Expected |
|---|---|
| Unauthenticated reset | 401, no task |
| Customer resets another customer's VPS | 404, no task |
| Stopped or offline VPS | 409, no task |
| Concurrent lifecycle operation | 409, no duplicate task |
| Valid reset | CHANGE_PASSWORD succeeds; new password authenticates, old password fails |
| Incus exec failure | Task fails, VPS state unchanged |
| Task history and audit | No password or hash returned |
| Completed or failed reset | Task payload no longer contains hash |
| New provisioning | Generated credential delivered once, SSH login works |
| SSH keys | Add/remove own key; unrelated keys preserved |
| Regression | Start, stop, resize, delete, IPAM unchanged |

Current branch is incomplete: automatic credentials, SSH configuration, key management and UI remain release blockers. Never run these tests on a customer's live VPS.
