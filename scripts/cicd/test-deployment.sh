#!/usr/bin/env bash
# Run in a disposable Linux container. Fake Docker/curl; no daemon or network.
set -Eeuo pipefail
repo="$(pwd)"
harness="$(mktemp -d /tmp/fii-cicd-test-XXXXXX)"
cleanup() { [[ "$harness" == /tmp/fii-cicd-test-* ]] && rm -rf -- "$harness"; }
trap cleanup EXIT
mkdir "$harness/bin"
cat > "$harness/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$HARNESS_LOG"
if [[ "$1" == info ]]; then exit 0; fi
if [[ "$1" == inspect ]]; then echo true; exit 0; fi
for arg in "$@"; do
  case "$arg" in
    config) exit 0 ;;
    ps) echo fake-container-id; exit 0 ;;
    pull) [[ "${FAIL_STAGE:-}" != pull ]]; exit ;;
    stop) exit 0 ;;
    exec) echo fake-custom-format-dump; exit 0 ;;
    run)
      for option in "$@"; do [[ "$option" != --no-build ]] || { echo 'Compose run does not accept --no-build' >&2; exit 2; }; done
      [[ "${FAIL_STAGE:-}" != migration ]]; exit ;;
    up) [[ "${FAIL_STAGE:-}" != startup ]]; exit ;;
  esac
done
exit 1
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$harness/bin/curl"
chmod +x "$harness/bin/docker" "$harness/bin/curl"
export PATH="$harness/bin:$PATH"
for stage in success pull migration startup; do
  root="$harness/$stage"
  release="$root/releases/new"
  mkdir -p "$root/shared/keys" "$release" "$root/releases/old"
  touch "$root/shared/.env" "$release/image.env"
  ln -s "$root/releases/old" "$root/current"
  export HARNESS_LOG="$root/commands.log"
  export FAIL_STAGE="$stage"
  if bash "$repo/scripts/cicd/deploy-fiimain.sh" "$root" "$release" > "$root/output.log" 2>&1; then
    [[ "$stage" == success ]]
    [[ "$(readlink "$root/current")" == "$release" ]]
    [[ "$(readlink "$root/previous")" == "$root/releases/old" ]]
  else
    [[ "$stage" != success ]]
    [[ "$(readlink "$root/current")" == "$root/releases/old" ]]
    if [[ "$stage" != pull ]]; then grep -q 'Application writers stopped' "$root/output.log"; fi
  fi
  if [[ "$stage" == pull ]]; then
    if grep -q ' stop ' "$HARNESS_LOG"; then echo 'Pull failure stopped live services' >&2; exit 1; fi
    [[ ! -d "$root/backups" ]]
  else
    [[ -s "$(find "$root/backups" -name '*.dump' -print -quit)" ]]
    stop_line="$(grep -n ' stop ' "$HARNESS_LOG" | head -1 | cut -d: -f1)"
    dump_line="$(grep -n 'pg_dump' "$HARNESS_LOG" | head -1 | cut -d: -f1)"
    migration_line="$(grep -n ' run ' "$HARNESS_LOG" | head -1 | cut -d: -f1)"
    (( stop_line < dump_line && dump_line < migration_line ))
    if grep -q 'pg_restore\|db:seed\|down -v' "$HARNESS_LOG"; then echo 'Unexpected restore/seed/delete command' >&2; exit 1; fi
  fi
  echo "PASS deployment scenario: $stage"
done
