#!/usr/bin/env bash
# Backup Postgres (custom format) and MinIO objects to ./backups/<timestamp>/.
# Usage: DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (postgres://user:pass@host:port/db)}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR:-backups}/${STAMP}"
mkdir -p "$OUT"

echo "→ pg_dump → $OUT/db.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$OUT/db.dump" "$DATABASE_URL"

# Optional MinIO/object backup — needs `mc` configured with an alias `local`.
if command -v mc >/dev/null 2>&1; then
  BUCKET="${MINIO_BUCKET:-fii-billing}"
  echo "→ mc mirror local/$BUCKET → $OUT/objects"
  mc mirror --overwrite "local/${BUCKET}" "$OUT/objects" || echo "  (skipped: mc alias 'local' or bucket not found)"
fi

sha256sum "$OUT/db.dump" > "$OUT/SHA256SUMS"

# Production backups must be encrypted before leaving the host. Set an age
# recipient such as age1...; the matching private key stays offline.
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null 2>&1 || { echo "age is required when BACKUP_AGE_RECIPIENT is set"; exit 1; }
  ARCHIVE_FILES="db.dump SHA256SUMS"
  [ ! -d "$OUT/objects" ] || ARCHIVE_FILES="$ARCHIVE_FILES objects"
  # shellcheck disable=SC2086 -- intentional word splitting of fixed filenames
  tar -C "$OUT" -czf "$OUT/archive.tar.gz" $ARCHIVE_FILES
  age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT/archive.tar.gz.age" "$OUT/archive.tar.gz"
  rm -f "$OUT/archive.tar.gz" "$OUT/db.dump"
  [ ! -d "$OUT/objects" ] || rm -rf -- "$OUT/objects"
fi

# Optional off-host copy to an S3-compatible immutable/versioned bucket.
if [ -n "${BACKUP_S3_URI:-}" ]; then
  command -v aws >/dev/null 2>&1 || { echo "aws CLI is required when BACKUP_S3_URI is set"; exit 1; }
  aws s3 cp "$OUT" "${BACKUP_S3_URI%/}/$STAMP/" --recursive --only-show-errors
fi

# retention: keep the newest N daily backups
KEEP="${BACKUP_KEEP:-14}"
ls -1dt "${BACKUP_DIR:-backups}"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "✓ backup complete: $OUT"
du -sh "$OUT"
