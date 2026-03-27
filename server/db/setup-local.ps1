# â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
#  Local dev setup â€" PostgreSQL via Docker + run migrations
#  Usage: .\server\db\setup-local.ps1
# â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
$ErrorActionPreference = "Stop"

$ContainerName = "cap-postgres"
$PgUser        = "cap_user"
$PgPass        = "cap_dev_pass"
$PgDb          = "claim_analytics"
$PgPort        = 5432

Write-Host "=== Claim Analytics â€" Local DB Setup ===" -ForegroundColor Cyan

# Check if container already exists
$existing = docker ps -a --format '{{.Names}}' 2>$null | Where-Object { $_ -eq $ContainerName }
$running  = docker ps    --format '{{.Names}}' 2>$null | Where-Object { $_ -eq $ContainerName }

if ($running) {
    Write-Host "[OK] PostgreSQL container '$ContainerName' is already running." -ForegroundColor Green
} elseif ($existing) {
    Write-Host "[->] Starting existing container '$ContainerName'..." -ForegroundColor Yellow
    docker start $ContainerName | Out-Null
} else {
    Write-Host "[->] Creating PostgreSQL container '$ContainerName'..." -ForegroundColor Yellow
    docker run -d `
        --name $ContainerName `
        -p "${PgPort}:5432" `
        -e "POSTGRES_USER=$PgUser" `
        -e "POSTGRES_PASSWORD=$PgPass" `
        -e "POSTGRES_DB=$PgDb" `
        postgres:16-alpine | Out-Null
}

# Wait for PostgreSQL to be ready
Write-Host "[->] Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
for ($i = 1; $i -le 30; $i++) {
    $ready = docker exec $ContainerName pg_isready -U $PgUser -d $PgDb 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] PostgreSQL is ready." -ForegroundColor Green
        break
    }
    if ($i -eq 30) {
        Write-Host "[FAIL] PostgreSQL did not become ready in time." -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds 1
}

# Run migrations
Write-Host "[->] Running migrations..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://${PgUser}:${PgPass}@localhost:${PgPort}/${PgDb}"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir "migrate.js")

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host "DATABASE_URL=$env:DATABASE_URL"
Write-Host "You can now run: npm run dev  (from server/)"
