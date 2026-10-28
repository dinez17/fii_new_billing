#!/usr/bin/env bash
# Existing, bootstrapped installation only. Never seed or initialize production.
set -Eeuo pipefail
umask 077
ROOT="${1:?deployment root required}"
RELEASE="${2:?release directory required}"
[[ "$ROOT" =~ ^/[a-zA-Z0-9/_-]+$ && "$ROOT" != / && "$ROOT" != *'..'* ]] || exit 2
[[ "$RELEASE" == "$ROOT"/releases/* && -d "$RELEASE" ]] || exit 2
[[ -f "$ROOT/shared/.env" && -d "$ROOT/shared/keys" && -f "$RELEASE/image.env" ]] || { echo 'Provision shared .env, keys and the initial database first.' >&2; exit 2; }
[[ ! -e "$ROOT/current" || -L "$ROOT/current" ]] || { echo 'current must be a symlink, not a directory' >&2; exit 2; }
command -v flock >/dev/null
command -v curl >/dev/null
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 2; }
cd "$RELEASE"
compose=(docker compose --env-file "$ROOT/shared/.env" --env-file "$RELEASE/image.env" -f docker-compose.prod.yml -f deploy/fiimain.compose.yml -f deploy/registry.compose.yml)
apps=(api-gateway auth-service crm-service settings-service billing-service payment-service purchase-service inventory-service expense-service accounting-service hr-service helpdesk-service ledger-worker billing-worker notification-worker report-worker scheduler)
web=(admin-web superadmin-web customer-portal)
maintenance=0
backup=""
failure() {
  code=$?
  trap - ERR
  if (( maintenance )); then
    "${compose[@]}" stop "${apps[@]}" || true
    printf 'Deployment failed. Application writers stopped. Database backup: %s\nInspect migration status before recovery; no automatic database rollback was attempted.\n' "$backup" >&2
  fi
  exit "$code"
}
trap failure ERR
"${compose[@]}" config --quiet
docker info >/dev/null
for service in postgres redis kafka minio; do
  id="$("${compose[@]}" ps -q "$service")"
  [[ -n "$id" && "$(docker inspect --format '{{.State.Running}}' "$id")" == true ]] || { echo "Infrastructure $service must already be running" >&2; exit 2; }
done
"${compose[@]}" pull migrate "${apps[@]}" "${web[@]}"
mkdir -p "$ROOT/backups"
backup="$ROOT/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$RELEASE").dump"
maintenance=1
"${compose[@]}" stop "${apps[@]}"
"${compose[@]}" exec -T postgres pg_dump -U fii -d fii_billing --format=custom --no-owner --no-privileges > "$backup"
[[ -s "$backup" ]]
sha256sum "$backup" > "$backup.sha256"
"${compose[@]}" run --rm --no-deps -T --interactive=false --pull never migrate </dev/null
"${compose[@]}" up -d --no-deps --no-build --pull never "${apps[@]}" "${web[@]}"
healthy=0
for ((attempt=1; attempt<=30; attempt++)); do
  running=1
  for service in "${apps[@]}" "${web[@]}"; do
    id="$("${compose[@]}" ps -q "$service")"
    if [[ -z "$id" || "$(docker inspect --format '{{.State.Running}}' "$id")" != true ]]; then running=0; break; fi
  done
  if (( running )) && curl -fsS http://127.0.0.1:18080/healthz >/dev/null && curl -fsS http://127.0.0.1:18080/readyz >/dev/null && curl -fsS http://127.0.0.1:8000/ >/dev/null && curl -fsS http://127.0.0.1:8002/ >/dev/null && curl -fsS http://127.0.0.1:8001/ >/dev/null; then healthy=1; break; fi
  sleep 4
done
(( healthy )) || { echo 'Deployment health checks failed' >&2; false; }
old="$(readlink "$ROOT/current" || true)"
if [[ -n "$old" ]]; then ln -s "$old" "$ROOT/.previous-$$"; mv -Tf "$ROOT/.previous-$$" "$ROOT/previous"; fi
ln -s "$RELEASE" "$ROOT/.current-$$"
mv -Tf "$ROOT/.current-$$" "$ROOT/current"
maintenance=0
trap - ERR
printf 'Deployment successful: %s\nPre-deploy backup: %s\n' "$RELEASE" "$backup"
