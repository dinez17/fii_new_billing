#!/usr/bin/env bash
# Initial production data cutover. Retains original staging volumes unchanged.
set -Eeuo pipefail
umask 077
root=/opt/fii-billing
release="$root/releases/48dcbf74-bootstrap"
shared="$root/shared"
cd "$release"
[[ ! -e "$shared/final-cutover.flag" ]] || { echo 'Final cutover already completed' >&2; exit 2; }
for volume in fii-billing-prod_live_20261028_pgdata fii-billing-prod_live_20261028_miniodata; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then echo "Cutover volume already exists: $volume; review before retrying" >&2; exit 2; fi
done
compose=(docker compose --env-file "$shared/.env" --env-file image.env -f docker-compose.prod.yml -f deploy/fiimain.compose.yml -f deploy/registry.compose.yml)
"${compose[@]}" stop api-gateway auth-service crm-service settings-service billing-service payment-service purchase-service inventory-service expense-service accounting-service hr-service helpdesk-service admin-web superadmin-web customer-portal postgres minio
cp -p "$shared/.env" "$shared/.env.staging-saved"
python3 - <<'PY'
import json,pathlib,os
p=pathlib.Path('/opt/fii-billing/shared/.env')
values=json.loads(pathlib.Path('/opt/fii-billing/backups/cutover-infrastructure.json').read_text())
allowed={'FII_POSTGRES_VOLUME','FII_REDIS_VOLUME','FII_KAFKA_VOLUME','FII_MINIO_VOLUME','FII_POSTGRES_IMAGE','FII_REDIS_IMAGE','FII_KAFKA_IMAGE','FII_MINIO_IMAGE','FII_MINIO_PULL_POLICY','INTERNAL_BACKUP_ENABLED'}
assert set(values)==allowed
lines=[line for line in p.read_text().splitlines() if line.split('=',1)[0] not in values]
p.write_text('\n'.join(lines+[k+'='+json.dumps(v) for k,v in values.items()])+'\n');os.chmod(p,0o600)
PY
"${compose[@]}" config --quiet
"${compose[@]}" create --force-recreate --no-build --pull never postgres minio
backend="$(sed -n 's/^FII_BACKEND_IMAGE=//p' image.env)"
docker run --rm --network none --user 0 --entrypoint sh \
  --mount type=volume,source=fii-billing-prod_live_20261028_miniodata,target=/data \
  --mount "type=bind,source=$root/backups,target=/backup,readonly" \
  "$backend" -c 'test -z "$(find /data -mindepth 1 -print -quit)" && tar -xzf /backup/final-objects.tar.gz -C /data'
"${compose[@]}" up -d --no-deps --no-build --pull never postgres minio
for ((attempt=1; attempt<=30; attempt++)); do
  if docker exec fii-billing-prod-postgres-1 pg_isready -U fii -d fii_billing >/dev/null; then break; fi
  sleep 1
done
tables="$(docker exec fii-billing-prod-postgres-1 psql -U fii -d fii_billing -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
[[ "$tables" == 0 ]]
docker cp "$root/backups/final-db.dump" fii-billing-prod-postgres-1:/tmp/fiimain-final.dump
docker exec fii-billing-prod-postgres-1 pg_restore -U fii -d fii_billing --single-transaction --no-owner --no-privileges /tmp/fiimain-final.dump
"${compose[@]}" run --rm --no-deps -T --interactive=false --pull never migrate </dev/null
"${compose[@]}" run --rm --no-deps -T --interactive=false --pull never --entrypoint node \
  -v "$shared/database-fingerprint.mjs:/tmp/database-fingerprint.mjs:ro" \
  auth-service /tmp/database-fingerprint.mjs > "$root/backups/target-final-fingerprint.log" </dev/null
python3 - <<'PY'
import json,pathlib
p=pathlib.Path('/opt/fii-billing/backups')
def load(name):
 text=(p/name).read_text(encoding='utf-8-sig')
 return json.loads(next(line.split('=',1)[1] for line in text.splitlines() if line.startswith('FII_DATABASE_FINGERPRINT=')))
a=load('source-final-fingerprint.log');b=load('target-final-fingerprint.log')
assert a==b, 'Exact full database fingerprints differ; do not resume writers'
evidence={'all_models_identical':True,'models':len(a['tables']),'rows':sum(x['count'] for x in a['tables'].values())}
(p/'final-data-verification.json').write_text(json.dumps(evidence,indent=2))
print(json.dumps(evidence))
PY
printf 'Exact final source database restored and fingerprint-verified.\n' > "$shared/final-cutover.flag"
printf 'Final data cutover verified. Source application must remain stopped.\n'
