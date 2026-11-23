# KIIRO-HOST Infrastructure v3 — release runbook

## Scope

- Node registration, region assignment, capacity editing, Incus connection and maintenance state
- Node-bound IP pools (existing unassigned pools remain unassigned until explicitly bound)
- Container provisioning and deletion using the Incus API
- START/STOP/REBOOT for provisioner-owned containers through existing instance APIs
- Node resource reservations, task/event history, heartbeat age, inventory
- No SSH, host reboot, host shutdown, or OS administration from the panel

## Prerequisites

- Verified management VPS snapshot and PostgreSQL backup
- The Incus host is configured manually: trusted client certificate, reachable Incus API, managed bridge, storage pool, image alias
- `/etc/kiiro-host/incus/nodes/<node-id>.json` exists on management VPS
- Node-specific managed worker is configured and runs `apps/worker/dist/incus-managed-standalone.js`
- Each node has a dedicated worker instance with `INCUS_NODE_ID`, `INCUS_NODE_CONFIG_DIR`, and certificate volume
- Existing `docker-compose.incus-worker.yml` on production VPS is operator-owned and must be preserved
- Incus networks and address routing are operator configured. An IP allocated in PostgreSQL does **not** establish external routing automatically.
- VM provisioning is not enabled by this release; only Incus containers are supported.

## Database migration

`20261123120000_infrastructure_v3` adds nullable `ip_pools.node_id` with a node foreign key. Existing pools remain unchanged and cannot be used for new provisioning until bound to an Incus node.

Run `npx prisma migrate deploy --schema packages/database/prisma/schema.prisma` using the existing migration image and database network. **Do not run the migrate service default command as it also executes seed.**

## Admin workflow

1. Register region at `/admin/provisioning` if necessary.
2. Register Incus node at `/admin/infrastructure`; install its node JSON and certificate files on the management VPS.
3. Set node vCPU, RAM and disk capacity at `/admin/nodes`.
4. Connect node at `/admin/infrastructure`.
5. Configure network and storage pool at `/admin/provisioning`.
6. Create a node-bound IPv4 pool at `/admin/infrastructure`, add available addresses, or bind a legacy pool.
7. Configure the image's **local Incus alias** at `/admin/provisioning`.
8. Create a container at `/admin/provisioning`; the scheduler chooses an ONLINE node with a fresh heartbeat, enough capacity, and a free IPv4.
9. Track tasks at `/admin/provisioning`; customer and admin lifecycle routes work for provisioner-owned containers.
10. Delete only provisioner-owned containers; successful deletion frees resource reservations and IP address.

## Failure policy

Provisioning errors leave the instance in ERROR and **retain** IP and resource reservations for manual review, because an Incus timeout can mean the remote operation actually succeeded. Do not automatically reuse that address. A worker crash can leave a RUNNING task; it is not blindly replayed. Inspect Incus and the task before manual reconciliation.

## Deployment checklist (after snapshot)

1. Merge the reviewed feature branch into `main`.
2. On VPS, back up the local Compose overrides and the PostgreSQL database.
3. `git fetch origin && git switch main && git pull --ff-only origin main`.
4. Validate combined Compose files, including local Incus worker override and `docker-compose.infrastructure-v2.yml` plus `docker-compose.infrastructure-v3.yml`.
5. Build `api worker frontend migrate` without stopping production.
6. Run only Prisma migrate deploy using the migration image (skip seed).
7. Recreate only `api frontend worker incus-worker` with the combined Compose configuration. Do not recreate PostgreSQL or Redis.
8. Check API healthy, frontend running, worker logs, Incus API inventory, and new admin provisioning page.
9. Keep the old images until the release is accepted. Database rollback requires a snapshot/restore or a planned reverse migration.

## One-command deployment after merge and snapshot confirmation

From `/opt/kiiro-host` on the updated `main`, run:

```bash
KIIRO_SNAPSHOT_CONFIRMED=yes bash scripts/deploy-infrastructure-v3.sh
```

This script backs up PostgreSQL and local Compose files, builds images, applies the migration without seed, recreates application containers only, and checks API/Incus. It does not delete test environments or reboot nodes.

## Minimal release validation

- `docker compose ... config --quiet`
- `docker compose ... build api worker frontend migrate`
- `prisma migrate status` after deployment
- API health endpoint and real Incus `/1.0` connectivity
- One non-production container create/delete with a disposable IP **only after operator approval**

Do not perform live create/delete operations against production customer instances as part of a smoke test.
