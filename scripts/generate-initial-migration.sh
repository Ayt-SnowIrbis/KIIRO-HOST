#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

MIGRATION_NAME="${1:-foundation_init}"
case "$MIGRATION_NAME" in
  *[!a-zA-Z0-9_]*|'') echo "Migration name may contain only letters, digits and underscores" >&2; exit 2 ;;
esac

MIGRATION_DIR="packages/database/prisma/migrations/$MIGRATION_NAME"
if [ -e "$MIGRATION_DIR" ]; then
  echo "Refusing to overwrite existing migration: $MIGRATION_DIR" >&2
  exit 2
fi

mkdir -p "$MIGRATION_DIR"
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel packages/database/prisma/schema.prisma \
  --script > "$MIGRATION_DIR/migration.sql"

cat > packages/database/prisma/migrations/migration_lock.toml <<'TOML'
provider = "postgresql"
TOML

echo "Created $MIGRATION_DIR/migration.sql"
echo "Review the SQL before committing. Do not run this against a production database."
