#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd /opt/kiiro-host
echo "=== SSH Access v2.2: production preflight ==="
git fetch origin main
git checkout main
git merge --ff-only origin/main
# Operator must explicitly pin the merged release SHA.
EXPECTED_SHA="${1:?Pass the verified merged main commit SHA as argument}"
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA" || { echo "Unexpected release HEAD"; exit 1; }
files=(docker-compose.yml docker-compose.incus-worker.yml docker-compose.infrastructure-v2.yml docker-compose.infrastructure-v3.yml)
for file in "${files[@]}"; do test -f "$file" || { echo "Missing compose file: $file"; exit 1; }; done
DC=(docker compose -p kiiro-host)
for file in "${files[@]}"; do DC+=(-f "$file"); done
"${DC[@]}" config --quiet
docker exec kiiro-host-postgres-1 sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
test "$(docker inspect -f '{{.State.Running}}' kiiro-host-redis-1)" = true
mkdir -p /opt/kiiro-backups
backup="/opt/kiiro-backups/kiiro-ssh-v22-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec kiiro-host-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup"
test -s "$backup" || { echo "Backup empty"; exit 1; }
echo "Verified PostgreSQL backup at $backup"
echo "=== Building images (running services unchanged) ==="
"${DC[@]}" build api worker frontend
# Do not recreate workers while customer operations are queued or running.
active="$(docker exec -i kiiro-host-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
SELECT COUNT(*) FROM tasks WHERE status IN ('QUEUED','RUNNING');
SQL
)"
if [[ "$active" != 0 ]]; then echo "$active unfinished tasks; aborting before restart"; exit 1; fi
echo "=== Rolling out without removing volumes or infrastructure ==="
"${DC[@]}" up -d --no-deps --force-recreate worker incus-worker
"${DC[@]}" up -d --no-deps --force-recreate api
curl -fsS --retry 30 --retry-all-errors --retry-delay 3 --max-time 5 http://127.0.0.1:8080/api/health/ready
"${DC[@]}" up -d --no-deps --force-recreate frontend
curl -fsS --retry 30 --retry-all-errors --retry-delay 3 --max-time 5 -o /dev/null http://127.0.0.1:3000/login
"${DC[@]}" ps
"${DC[@]}" logs --tail=40 incus-worker
echo "=== SSH Access v2.2 code deployed. Complete disposable VPS SSH acceptance tests before customer rollout. ==="
