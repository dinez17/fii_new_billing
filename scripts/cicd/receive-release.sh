#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SHA="${1:?commit required}"
ROOT="${2:?deployment root required}"
UPLOAD="${3:?upload directory required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ && "$ROOT" =~ ^/[a-zA-Z0-9/_-]+$ && "$ROOT" != / && "$ROOT" != *'..'* ]] || exit 2
[[ "$UPLOAD" =~ ^\.fii-cicd-[0-9]+-[0-9]+$ ]] || exit 2
[[ -d "$ROOT/shared/keys" && -f "$ROOT/shared/.env" ]] || { echo 'Server provisioning is incomplete' >&2; exit 2; }
incoming="$HOME/$UPLOAD"
release="$ROOT/releases/$SHA-${UPLOAD#.fii-cicd-}"
[[ ! -e "$release" ]] || { echo 'Release directory already exists; use a new run attempt' >&2; exit 2; }
mkdir -p "$release"
tar -xzf "$incoming/source.tar.gz" -C "$release"
cp "$incoming/image.env" "$incoming/release.json" "$release/"
ln -s "$ROOT/shared/.env" "$release/.env"
ln -s "$ROOT/shared/keys" "$release/keys"
bash "$release/scripts/cicd/deploy-fiimain.sh" "$ROOT" "$release"
rm -f "$incoming/source.tar.gz" "$incoming/image.env" "$incoming/release.json"
rmdir "$incoming"
