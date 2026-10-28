#!/usr/bin/env bash
# Run by the server administrator with sudo. Does not change other nginx sites.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo' >&2; exit 2; }
shared=/opt/fii-billing/shared
mode="${1:-prepare}"
site=/etc/nginx/sites-available/fii-billing
link=/etc/nginx/sites-enabled/fii-billing
[[ "$mode" == prepare || "$mode" == https ]] || exit 2
if [[ "$mode" == https ]]; then
  [[ -f "$shared/public-ready.flag" ]] || { echo 'Final data cutover and credential verification must complete before public access.' >&2; exit 2; }
  for domain in sales.fiitech.in customer.fiitech.in platform.fiitech.in; do
    getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx '202.61.120.82' || { echo "Update the A record for $domain to 202.61.120.82 first." >&2; exit 2; }
  done
  certbot certonly --webroot -w /var/www/fii-billing-acme --cert-name fii-billing-prod \
    -d sales.fiitech.in -d customer.fiitech.in -d platform.fiitech.in \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --deploy-hook 'nginx -t && systemctl reload nginx'
  config="$shared/fiitech.nginx.https.conf"
else
  install -d -m 755 /var/www/fii-billing-acme/.well-known/acme-challenge
  printf 'fii-main-billing-48dcbf74\n' > /var/www/fii-billing-acme/.well-known/acme-challenge/fii-probe
  chmod 644 /var/www/fii-billing-acme/.well-known/acme-challenge/fii-probe
  config="$shared/fiitech.nginx.http.conf"
fi
[[ -f "$config" ]]
backup="/var/backups/fii-billing-nginx-$(date -u +%Y%m%dT%H%M%SZ).conf"
existed=0
if [[ -e "$site" ]]; then cp -p "$site" "$backup"; existed=1; fi
install -m 644 -o root -g root "$config" "$site"
if [[ ! -e "$link" ]]; then ln -s "$site" "$link"; fi
if ! nginx -t; then
  if (( existed )); then cp -p "$backup" "$site"; else rm -f "$link" "$site"; fi
  echo 'Configuration check failed; previous billing site restored. Nginx was not reloaded.' >&2
  exit 1
fi
systemctl reload nginx
printf 'Billing nginx %s configuration installed. Other sites were retained.\n' "$mode"
