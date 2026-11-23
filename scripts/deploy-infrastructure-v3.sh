#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/kiiro-host

: "${KIIRO_SNAPSHOT_CONFIRMED:?Set KIIRO_SNAPSHOT_CONFIRMED=yes after completing snapshot}"
test "$KIIRO_SNAPSHOT_CONFIRMED" = "yes" || { echo "Snapshot confirmation required"; exit 1; }
test "$(git branch --show-current)" = "main" || { echo "Deploy only from main"; exit 1; }

COMPOSE=(docker compose
  -f docker-compose.yml
  -f docker-compose.incus-worker.yml
  -f docker-compose.infrastructure-v2.yml
  -f docker-compose.infrastructure-v3.yml)

for file in docker-compose.yml docker-compose.incus-worker.yml docker-compose.infrastructure-v2.yml docker-compose.infrastructure-v3.yml; do
  test -f "$file" || { echo "Missing Compose file: $file"; exit 1; }
done
grep -q 'incus-managed-standalone.js' docker-compose.incus-worker.yml || { echo "Managed Incus worker entrypoint required"; exit 1; }
test -f /etc/kiiro-host/incus/nodes/incus-test-node-01.json || { echo "Test node config missing"; exit 1; }

echo "=== Validate Compose ==="
"${COMPOSE[@]}" config --quiet

echo "=== Preserve local Compose files ==="
BACKUP_DIR="/opt/kiiro-backups/infrastructure-v3-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP_DIR"
cp -p docker-compose.incus-worker.yml docker-compose.infrastructure-v2.yml "$BACKUP_DIR/"
if test -f docker-compose.incus-monitor.yml; then cp -p docker-compose.incus-monitor.yml "$BACKUP_DIR/"; fi
echo "Backup directory: $BACKUP_DIR"

echo "=== PostgreSQL backup ==="
docker exec kiiro-host-postgres-1 sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP_DIR/postgres.dump"
test -s "$BACKUP_DIR/postgres.dump"
chmod 600 "$BACKUP_DIR/postgres.dump"

echo "=== Build API / Worker / Frontend / Migrate ==="
"${COMPOSE[@]}" build api worker frontend migrate

echo "=== Apply migrations without seed ==="
"${COMPOSE[@]}" run --rm --no-deps --entrypoint sh migrate -c \
  'npx prisma migrate deploy --schema packages/database/prisma/schema.prisma'

echo "=== Recreate application services only ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate api frontend worker incus-worker

echo "=== Wait for API health ==="
CID=$("${COMPOSE[@]}" ps -q api)
test -n "$CID"
ready=0
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID")
  if test "$status" = healthy; then ready=1; break; fi
  if test "$status" = unhealthy; then break; fi
  sleep 5
done
if test "$ready" -ne 1; then
  docker logs --tail 100 "$CID"
  echo "API failed health check; inspect logs and use snapshot recovery if needed"
  exit 1
fi

echo "=== Verify real Incus connectivity ==="
"${COMPOSE[@]}" exec -T api node -e '
const { createIncusConnection } = require("./apps/api/dist/modules/compute/incus-connection.js");
(async () => {
  const info = await createIncusConnection("incus-test-node-01").get("/1.0");
  if (!info || info.auth !== "trusted") throw new Error("Incus connection not trusted");
  console.log("Incus:", info.environment?.server_name, info.environment?.server_version);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
'

echo "=== Verify worker status ==="
"${COMPOSE[@]}" ps api frontend worker incus-worker postgres redis
echo "=== Recent managed worker logs ==="
docker logs --tail 20 kiiro-host-incus-worker-1

echo "DEPLOYMENT FINISHED. Backups: $BACKUP_DIR"
