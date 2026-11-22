# Instance Management v2.2.3

## Scope

This release line completes the customer and administrator VPS-management domain without claiming that a provider operation succeeded before the hypervisor confirms it. Incus is the first production driver. Proxmox remains a later driver.

## Current branch changes

- Adds customer-scoped instance list/detail/task/event API routes under `/api/compute/customer/instances`.
- Enforces authenticated USER role and scopes every query and operation to the authenticated customer's `customerId`.
- Adds a customer VPS list and detail page under `/dashboard/instances`.
- Exposes Start, Stop and Reboot in the customer UI only for explicitly marked Mock Incus instances on online mock nodes.
- Adds additive database foundations for SSH public-key inventory, firewall rules, richer snapshot/backup lifecycle metadata and future task types.

## Capability / implementation status

| Capability | Database | API | UI | Real Incus execution |
|---|---:|---:|---:|---:|
| List/detail VPS | Existing | Added customer-scoped | Added | Read path still pending |
| Start/Stop/Reboot | Existing | Customer-scoped queue added | Added | Pending |
| Resize | Existing | Admin mock-only | Admin mock-only | Pending |
| Reinstall OS | Task enum exists | Pending | Pending | Pending |
| Root password reset | Task enum added | Pending | Pending | Pending; requires guest agent/cloud-init strategy |
| SSH key inventory | Added | Pending | Pending | Pending; public keys only, never private keys |
| Snapshots | Extended | Pending | Pending | Pending |
| Backup/restore | Extended | Pending | Pending | Pending; external object storage required |
| Firewall | Rule model added | Pending | Pending | Pending; requires explicit host/network integration |
| Console / VNC | Pending | Pending | Pending | Pending; requires short-lived ticket/proxy |
| Rescue mode | Task enum added | Pending | Pending | Pending |
| Monitoring | Existing instance events only | Pending metrics API | Pending | Pending agent/metrics pipeline |
| Delete / retention | Existing task enum | Pending | Pending | Pending |
| Migration between nodes | Task enum added | Pending | Pending | Pending; requires storage/network migration design |

## Security invariants

1. A customer can access only instances whose `customerId` matches their authenticated customer profile.
2. Customer actions are checked again by the API; UI visibility is not authorization.
3. Operations are serialized with a database row lock and rejected if another task is active.
4. A real provider operation must be completed and verified by its driver before task success or observed instance state is updated.
5. Passwords and private SSH keys must never be persisted in task payloads, events, audit metadata or logs.
6. Console access must use short-lived, single-purpose tickets; never expose provider credentials to browsers.
7. Firewall rules must be validated server-side (CIDR, ports, protocol, direction) and applied atomically with rollback on provider failure.
8. Destructive reinstall/delete/restore operations require explicit confirmation and a backup warning.

## Required completion work

### 1. Provider driver and node connectivity
- Define a typed provider-driver contract and capability discovery.
- Implement Incus mTLS API client on the compute worker side.
- Validate node identity, API certificate, TLS trust, request timeouts and operation polling.
- Keep provider credentials out of frontend and API responses.
- Add reconciliation so provider state repairs stale database state.

### 2. Operations
- Implement PROVISION, START, STOP, REBOOT, RESIZE, REINSTALL and DELETE with durable task transitions.
- Implement password reset and SSH key injection through a documented guest-agent/cloud-init path.
- Implement snapshot and independent backup workflows, including restore validation.
- Implement rescue and migration only after storage and networking prerequisites are available.

### 3. Customer and admin UI
- Add capability-driven actions, destructive-operation confirmations and operation progress.
- Add access, SSH keys, snapshots/backups, firewall, console and monitoring sections.
- Add admin overrides, reason capture, suspension and audit views.

### 4. Verification
- Prisma schema validation and migration deployment on a disposable PostgreSQL database.
- API unit/integration tests for cross-customer IDOR, role enforcement, active-task conflicts and audit writes.
- Worker tests for retries, idempotency, provider timeouts and reconciliation.
- Incus integration tests on a dedicated disposable node.
- Frontend production build and accessibility checks.

## Deployment warning

This branch adds a database migration and customer-facing read/control surfaces. It is not a production-ready hypervisor-control release yet. Do not deploy the migration or expose the new customer routes publicly until CI and the full verification checklist pass. Existing Mock behavior must remain isolated from real nodes.
