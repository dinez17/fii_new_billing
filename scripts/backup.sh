#!/usr/bin/env bash
# Backup Postgres (custom format) and MinIO objects to ./backups/<timestamp>/.
# Usage: DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (postgres://user:pass@host:port/db)}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR:-backups}/${STAMP}"
umask 077
mkdir -p "$OUT"
if [ "${BACKUP_REQUIRE_OFFSITE:-false}" = "true" ] && { [ -z "${BACKUP_S3_URI:-}" ] || [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; }; then
  echo "Encrypted off-site backup configuration is required"; exit 1
fi

echo "→ pg_dump → $OUT/db.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$OUT/db.dump" "$DATABASE_URL"

# Optional MinIO/object backup — needs `mc` configured with an alias `local`.
if command -v mc >/dev/null 2>&1; then
  BUCKET="${MINIO_BUCKET:-fii-billing}"
  echo "→ mc mirror local/$BUCKET → $OUT/objects"
  mc mirror --overwrite "local/${BUCKET}" "$OUT/objects" || { echo "Object backup failed; backup is incomplete"; exit 1; }
elif [ "${BACKUP_REQUIRE_OBJECTS:-false}" = "true" ]; then
  echo "MinIO client is required for the configured object backup"; exit 1
fi

(cd "$OUT" && sha256sum db.dump > SHA256SUMS && { [ ! -d objects ] || find objects -type f -print0 | sort -z | xargs -0 -r sha256sum >> SHA256SUMS; })

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
touch "$OUT/.complete"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo 'BACKUP_KEEP must be positive'; exit 1; }
ROOT="$(realpath "${BACKUP_DIR:-backups}")"
mapfile -d '' COMPLETE < <(find "$ROOT" -mindepth 2 -maxdepth 2 -type f -name .complete -printf '%h\0' | sort -zr)
for (( index=KEEP; index<${#COMPLETE[@]}; index++ )); do
  OLD="$(realpath "${COMPLETE[index]}")"
  [[ "$OLD" == "$ROOT"/* ]] || { echo 'Retention path escaped backup root'; exit 1; }
  rm -rf -- "$OLD"
done

echo "✓ backup complete: $OUT"
du -sh "$OUT"
