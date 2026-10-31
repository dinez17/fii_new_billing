#!/usr/bin/env bash
# Restore into a disposable, network-isolated container; never accepts a target DB URL.
set -euo pipefail
DUMP="${1:?usage: recovery-drill.sh db.dump expected-sha256 [evidence.json]}"
EXPECTED="${2:?expected dump SHA256 is required}"
REPORT="${3:-recovery-drill-evidence.json}"
[[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Invalid expected checksum'; exit 1; }
[ -f "$DUMP" ] || { echo 'Backup file not found'; exit 1; }
ACTUAL="$(sha256sum "$DUMP" | cut -d ' ' -f1)"
[ "${ACTUAL,,}" = "${EXPECTED,,}" ] || { echo 'Backup checksum mismatch'; exit 1; }
NAME="fii-restore-drill-$(date +%s)-$RANDOM"
PASSWORD="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
START="$(date +%s)"
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASSWORD" postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  [ "$attempt" -lt 60 ] || { echo 'Recovery database did not start'; exit 1; }
  sleep 1
done
# Fresh disposable database only: no --clean, no source host networking.
docker exec -i "$NAME" pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -U postgres -d postgres < "$DUMP"
COUNTS="$(docker exec -i "$NAME" psql -U postgres -d postgres -At <<'SQL'
SELECT json_build_object('tenants',(SELECT count(*) FROM "Tenant"),'invoices',(SELECT count(*) FROM "Invoice"),'payments',(SELECT count(*) FROM "Payment"),'customers',(SELECT count(*) FROM "Customer"));
SQL
)"
SECONDS_USED="$(( $(date +%s) - START ))"
printf '{"verifiedAt":"%s","dumpSha256":"%s","restoreSeconds":%s,"databaseCounts":%s,"scope":"database restore only; verify object files, encryption keys and application login/PDF separately"}\n' "$(date -u +%FT%TZ)" "$ACTUAL" "$SECONDS_USED" "$COUNTS" > "$REPORT"
chmod 600 "$REPORT"
echo "Recovery database verified. Evidence: $REPORT"
