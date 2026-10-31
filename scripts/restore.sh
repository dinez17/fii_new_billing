#!/usr/bin/env bash
# Restore a pg_dump custom-format file into a target database.
# Usage: DATABASE_URL=postgres://... ./scripts/restore.sh backups/<stamp>/db.dump
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL of the TARGET database}"
DUMP="${1:?usage: restore.sh <path/to/db.dump|archive.tar.gz.age>}"
[ -f "$DUMP" ] || { echo "no such dump: $DUMP"; exit 1; }

TMP=""
cleanup() { [ -z "$TMP" ] || rm -rf -- "$TMP"; }
trap cleanup EXIT

case "$DUMP" in
  *.age)
    : "${BACKUP_AGE_IDENTITY:?set BACKUP_AGE_IDENTITY to the age private-key file}"
    command -v age >/dev/null 2>&1 || { echo "age is required to decrypt this backup"; exit 1; }
    TMP="$(mktemp -d)"
    age -d -i "$BACKUP_AGE_IDENTITY" -o "$TMP/archive.tar.gz" "$DUMP"
    tar -C "$TMP" -xzf "$TMP/archive.tar.gz"
    (cd "$TMP" && sha256sum -c SHA256SUMS)
    DUMP="$TMP/db.dump"
    ;;
esac

echo "This will DROP and recreate objects in the explicitly configured target database."
read -r -p "Type 'restore' to continue: " confirm
[ "$confirm" = "restore" ] || { echo "aborted"; exit 1; }

# --clean --if-exists drops existing objects first; single-transaction so a
# failure rolls back instead of leaving a half-restored DB.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --single-transaction --dbname "$DATABASE_URL" "$DUMP"

echo "✓ restore complete. Run 'pnpm db:deploy' if the dump predates a migration."
