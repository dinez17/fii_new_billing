$ErrorActionPreference = 'Stop'
function Check-Native([string]$step) { if ($LASTEXITCODE -ne 0) { throw $step } }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $root
$audit = Get-Content reports/migration/lisoft/fii-workbook-verification.json -Raw | ConvertFrom-Json
$packetHash = (Get-FileHash reports/migration/lisoft/native-import.json -Algorithm SHA256).Hash.ToLower()
if ($packetHash -ne $audit.packetSha256 -or !$audit.allDatesTotalsTaxableAmountsAndGstMatch -or !$audit.allCustomerNamesAndGstinsMatch -or $audit.invoiceRows -ne 899) { throw 'Workbook verification gate failed' }
$rehearsal = Get-Content backups/fii-workbook-20261027/import-rehearsal.json -Raw | ConvertFrom-Json
if ($rehearsal.mode -ne 'native-rehearsal' -or $rehearsal.packetHash -ne $packetHash -or !$rehearsal.otherTenantsUnchanged) { throw 'Rehearsal gate failed' }
$container = 'fii-billing-prod-crm-service-1'
docker cp scripts/migration/reset-fii-business.mjs "${container}:/app/scripts/migration/reset-fii-business.mjs"
Check-Native 'Copy reset script failed'
docker cp scripts/migration/import-native-lisoft.mjs "${container}:/app/scripts/migration/import-native-lisoft.mjs"
Check-Native 'Copy import script failed'
docker cp reports/migration/lisoft/native-import.json "${container}:/tmp/fii-native-import.json"
Check-Native 'Copy verified packet failed'
$paused = @('fii-billing-prod-api-gateway-1','fii-billing-prod-scheduler-1','fii-billing-prod-billing-worker-1','fii-billing-prod-ledger-worker-1','fii-billing-prod-notification-worker-1','fii-billing-prod-report-worker-1')
docker stop @paused | Out-Null
Check-Native 'Pause services failed'
$complete = $false
try {
    docker exec fii-billing-prod-postgres-1 pg_dump -U fii -d fii_billing -Fc -f /tmp/fii-workbook-final.dump
    Check-Native 'Final backup failed'
    docker cp fii-billing-prod-postgres-1:/tmp/fii-workbook-final.dump backups/fii-workbook-20261027/before-live-replacement.dump
    Check-Native 'Backup copy failed'
    $backupHash = (Get-FileHash backups/fii-workbook-20261027/before-live-replacement.dump -Algorithm SHA256).Hash.ToLower()
    $preview = docker exec $container node scripts/migration/reset-fii-business.mjs --replace-legacy-import
    Check-Native 'Live preflight failed'
    $expected = (Get-Content backups/fii-workbook-20261027/reset-rehearsal.json -Raw | ConvertFrom-Json).deletedCounts
    $counts = ($preview | ConvertFrom-Json).counts
    foreach ($key in $expected.PSObject.Properties.Name) {
        if ($counts.$key -ne $expected.$key) { throw "Business records changed since rehearsal: $key" }
    }
    foreach ($key in $counts.PSObject.Properties.Name) {
        if ($counts.$key -ne $expected.$key) { throw "Additional business records since rehearsal: $key" }
    }
    docker exec -e "RESET_FII_BACKUP_SHA256=$backupHash" $container node scripts/migration/reset-fii-business.mjs --apply --replace-legacy-import | Tee-Object backups/fii-workbook-20261027/live-reset.json
    Check-Native 'FII reset failed; services remain paused for recovery'
    docker exec -e "IMPORT_BACKUP_SHA256=$backupHash" -e "VERIFIED_IMPORT_PACKET_SHA256=$packetHash" $container node scripts/migration/import-native-lisoft.mjs /tmp/fii-native-import.json --apply | Tee-Object backups/fii-workbook-20261027/live-import.json
    Check-Native 'FII reimport failed; services remain paused for recovery'
    $complete = $true
} finally {
    if ($complete) { docker start @paused | Out-Null; Check-Native 'Restart services failed' }
}
