# Infrastructure Management v1.0 — implementation contract

Status: IN DEVELOPMENT. This document defines implementation and acceptance requirements; it is not a claim of deployed functionality.

## Scope

One integrated release: multi-node Incus registration and removal, connection credentials and trust, health/resource reconciliation, network/storage discovery, IP pool lifecycle and atomic allocations, instance lifecycle integration, admin UI and audit.

## Architecture

- API (NestJS): admin-authenticated management routes and validation. No raw private key or token in responses, logs, audit metadata or browser local storage.
- Worker: independent node scheduler and per-node Incus mTLS clients. Node-specific credentials resolved server-side; no global INCUS_NODE_ID restriction for the new scheduler. Preserve the existing isolated test worker until migration is verified.
- PostgreSQL/Prisma: Node, Region, Provider, IpPool, IpAddress, InstanceAddress, Task, AuditLog already exist. Add node connection credential references, pool network scope and allocation metadata through reviewed migrations. Preserve existing data and constraints.
- UI: admin infrastructure list and node detail with tabs Overview, Connection, Networks, Storage, IP Pools, Instances, Events. Explicit destructive-action confirmations.
- Provisioning: no automatic placement on an unverified node. Discovery does not automatically expose private NAT addresses as public IPs.

## Admin operations

1. Register node: region, unique name, endpoint (HTTPS), provider, credentials; start OFFLINE. Validate URL, prohibit arbitrary outbound endpoints (SSRF protection), validate certificate chain or pinned fingerprint, prove mTLS access before ONLINE.
2. Update: rename, region, maintenance mode and connection rotation; every change audited. ONLINE determined by successful probe/heartbeat, not user-selected flag alone.
3. Delete: refuse when any non-deleted instances, active tasks, reserved addresses or other dependencies remain. Disable/retire first; never silently delete remote Incus containers.
4. Connection: upload/rotate client cert and key securely; server certificate pinning, expiry warnings, revocation procedure. Encrypt secrets at rest and restrict access.
5. Health: poll /1.0, instances, networks and storage; record lastSeenAt, connectivity error and observed capacities; DEGRADED for partial failures; MAINTENANCE suppresses placement.
6. IP pools: CIDR validation (IPv4/IPv6), gateway and network scope, no overlapping pools within the same routing domain, explicit private/public classification. CRUD must block deletion when allocated.
7. Address allocation: transactional SELECT FOR UPDATE SKIP LOCKED or equivalent unique claim, idempotent allocation, release on deprovision only, no reuse while in release/quarantine. Reconcile assigned addresses with Incus interfaces but do not auto-claim NAT IPs as routable public addresses.
8. Instance state: periodically reconcile observed state and network addresses; don't overwrite in-flight lifecycle tasks. Exclude loopback and IPv6 link-local; preserve allocation provenance.
9. Resource accounting: capacity from Incus, reservations from active instance allocations, available = capacity - reserved; reconcile discrepancies and avoid negative available values.

## Security and rollout

- Keep feature gated until multi-node worker, credentials and health have integration tests.
- Preserve current working incus-test-node-01 and existing worker while adding the new architecture.
- Do not use --remove-orphans on isolated Compose overrides.
- No public node registration until SSRF-safe endpoint policy and server-side credential storage are implemented.
- Never send Incus client private keys to the frontend after initial ingestion.

## Acceptance tests (required before release)

- Add two distinct Incus nodes, probe both, rotate credentials for one without impacting the other.
- Reject untrusted server certificate and inaccessible endpoint.
- Simulate node loss, recover heartbeat, enforce MAINTENANCE.
- Create IPv4 and IPv6 pools, reject invalid/overlapping CIDRs and duplicate allocations.
- Concurrently allocate the last available IP: exactly one allocation succeeds.
- Reject deletion of a node with active instances and of a pool with allocations.
- Reconcile stop/start/reboot and changed private IP, display address type correctly.
- Audit all admin mutations and verify customer isolation.
- Run Prisma validation, backend/frontend builds, unit and integration tests before deployment.

## Rollout

Develop and review on feat/infrastructure-management-v1. Merge to main only after acceptance checks; deploy API, worker, frontend and migrations together with an explicit cutover of the legacy test worker.
