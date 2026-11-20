# KIIRO-HOST Foundation v1.0

## What this package establishes

- Node.js 24 runtime and npm workspaces.
- Existing Next.js frontend retained under `frontend/`.
- NestJS API under `apps/api/`, with `/api/health/live`, `/api/health/ready`, and a database-backed `/api/compute/providers` endpoint.
- BullMQ worker process under `apps/worker/`.
- PostgreSQL 17 and Redis 7 via Docker Compose; database and Redis ports are not published to the host.
- Prisma 6.19 schema for identity, customers, catalog, providers/nodes, compute instances, orders, prepaid/subscription billing, ledger, payments, IP allocation, tasks, outbox, support and audit.

## Important scope boundary

This is a runnable infrastructure and data-model foundation, not yet a production-ready VPS sales platform. Authentication endpoints, email delivery, Turnstile server verification, payment provider integration, ledger posting services, Incus API adapter, resource scheduler, backups, console proxy and admin RBAC are not implemented by this package. The schema reserves the required entities. Do not enable customer registration or accept money until those flows and their security tests are implemented.

The Next.js route handler at `frontend/app/api/backend/[...path]/route.ts` proxies browser requests to the internal API base URL. Server-side Next.js auth route handlers continue to call `API_BASE_URL` directly.

The `compute/providers` response is a read-only catalog endpoint. Providers are seeded as `PLANNED`; capabilities are deliberately false until a real adapter is implemented and tested.

## Repository layout

```text
.
├── apps/
│   ├── api/                 # NestJS REST API
│   └── worker/              # BullMQ background worker
├── packages/
│   └── database/            # Prisma schema, client and seed
├── frontend/                # Existing Next.js frontend
├── docker-compose.yml
├── .env.example
└── docs/
```

## Version choices

- Node.js 24.11+ (Node 24 LTS line)
- NestJS 11
- Prisma 6.19 (stable major with the classic Prisma Client + schema datasource configuration)
- PostgreSQL 17
- Redis 7

Prisma 8 is not selected because its documentation currently labels it a release candidate. Re-evaluate the Prisma major version deliberately before upgrading. Prisma 7/8 use different client/configuration conventions than this Foundation schema.

## First boot

1. Install Docker Engine and the Docker Compose v2 plugin.
2. In repository root, copy `.env.example` to `.env`.
3. Replace all `CHANGE_ME` values with unique random secrets. Generate secrets, for example:

   ```bash
   openssl rand -hex 32
   openssl rand -hex 48
   openssl rand -hex 48
   ```

4. Check that `DATABASE_URL`'s password matches `POSTGRES_PASSWORD`. In Compose, the API/worker override the connection string using the actual Compose environment values; keep the example value synchronized for local commands too.
5. Start services:

   ```bash
   docker compose build
   docker compose up -d
   docker compose ps
   ```

6. Check health:

   ```bash
   curl -fsS http://127.0.0.1:8080/api/health/live
   curl -fsS http://127.0.0.1:8080/api/health/ready
   curl -fsS http://127.0.0.1:8080/api/compute/providers
   ```

7. Both frontend and API ports are bound to `127.0.0.1`, so they are not directly reachable from the public internet. Put a reverse proxy (Caddy/Nginx/Traefik) with HTTPS in front and publish only 80/443. For a temporary direct test only, change the frontend port mapping to `"${FRONTEND_PORT:-3000}:3000"`, then open `http://SERVER_IP:3000`; restore loopback binding after testing.

## Migrations and seed

For the first quick boot, the API container runs `prisma db push` (schema bootstrap) and an idempotent provider seed before starting. This makes the starter easy to inspect, but it is not the long-term production migration strategy. Before production use, generate and commit a reviewed initial migration while the database is empty, then switch the API startup command to `prisma migrate deploy`.

Recommended migration-first procedure (run before starting the API for the first time):

```bash
# Build the API image, then start only an empty PostgreSQL service
docker compose build api
docker compose up -d postgres

# Generate migration inside the Compose network and write it back into the repository
# (Linux/macOS shell; on Windows use the equivalent absolute project path for -v)
docker compose run --rm --no-deps \
  -v "$PWD/packages/database/prisma:/workspace/packages/database/prisma" \
  --entrypoint sh api -lc \
  'npx prisma migrate dev --schema packages/database/prisma/schema.prisma --name foundation_init'
```

Review and commit `packages/database/prisma/migrations/` and `migration_lock.toml`. Then change the API Dockerfile CMD to:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/database/prisma/schema.prisma && npm run db:seed -w @kiiro/database && node apps/api/dist/main.js"]
```

Now run `docker compose up -d --build`. Do not run `prisma migrate dev` or `prisma db push` against production. If you already performed the quick-boot `db push`, use a fresh empty development database to generate the baseline migration rather than running `migrate dev` against the db-push-created schema.

## Development without Docker for the app

Install Node.js 24.11+ and npm 11+, run PostgreSQL/Redis locally or via Compose, then set `DATABASE_URL` and `REDIS_URL` in your shell. The first `npm install` creates the root `package-lock.json`; commit that file. After committing it, change both API and worker Dockerfiles from `npm install` to `npm ci` for repeatable builds. Commands:

```bash
npm install
npm run db:generate
npm run dev:api
# another terminal
npm run dev:worker
```

## Backup and restore baseline

Back up PostgreSQL independently of Docker volume snapshots:

```bash
mkdir -p backups
 docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/kiiro-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Restore into an empty target database:

```bash
cat backups/FILE.dump | docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists'
```

Also back up `.env` securely (separately from Git), Redis data only if queue persistence is required, and any external provider credentials/secrets. Test restores before relying on them.

## Security checklist before public launch

- Put HTTPS reverse proxy/WAF in front; do not expose PostgreSQL or Redis.
- Use unique, high-entropy passwords and `AUTH_SESSION_SECRET`; keep `.env` out of Git.
- Configure exact CORS origins and public URLs.
- Add rate limiting, authentication/session lifecycle, CSRF strategy, RBAC, 2FA and audit coverage.
- Implement server-side Turnstile verification and mail delivery.
- Implement encrypted provider credential storage with a key outside the database; current `encryptedSecret` is only a storage field, not an encryption implementation.
- Implement idempotent double-entry ledger posting and reconcile every transaction; schema alone does not enforce balanced postings.
- Add payment webhook signature verification, idempotency and replay protection.
- Implement Incus adapter, resource reservation transactions, IP allocation and reconciliation before provisioning real instances.
- Configure off-host encrypted backups, retention, monitoring and restore drills.

## Known first-version limitations

- `apps/worker` starts a queue consumer but intentionally does not execute infrastructure jobs.
- No initial migration is committed in this generated package; generate and review it as described above.
- Existing frontend auth screens are starter UI. The API does not yet implement `/auth/*`, so set `NEXT_PUBLIC_AUTH_MOCK_MODE=false` and do not use registration/login until the Identity milestone is delivered.
- Frontend reverse-proxy routing `/api/backend/*` to backend `/api/*` must be configured at the public reverse proxy. For local testing, use a proxy rule or set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api` at build time; browser access then requires the matching CORS origin.
