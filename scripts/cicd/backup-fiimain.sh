#!/usr/bin/env bash
# Private daily operator DB backup using PostgreSQL's matching client version.
set -Eeuo pipefail
umask 077
root=/opt/fii-billing
[[ -L "$root/current" && -f "$root/shared/final-cutover.flag" ]] || { echo 'Final production cutover has not completed' >&2; exit 2; }
exec 9>"$root/.backup.lock"
flock -n 9 || exit 0
mkdir -p "$root/backups/daily"
file="$root/backups/daily/database-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT
docker exec fii-billing-prod-postgres-1 pg_dump -U fii -d fii_billing --format=custom --no-owner --no-privileges > "$partial"
[[ -s "$partial" ]]
mv "$partial" "$file"
sha256sum "$file" > "$file.sha256"
# No automatic removal: choose retention after off-host backups are configured.
printf 'Private production database backup completed: %s\n' "$file"
