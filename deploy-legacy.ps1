# ==============================================================================
# 6D Test & Task Management Tool - Deploy Script
#
# Ships ttmt-api + ttmt-ui (Postgres/Redis come from public images, pulled
# directly on the remote - nothing to build/transfer for those). The
# automation runner (ttmt-runner) is deliberately NOT built or started here -
# this product is manual-testing-only for now; see docker-compose.yml if that
# changes later.
#
# Runs alongside qaasr on the same host - different project name, different
# containers/networks/volumes (all "ttmt-*"/"6d-ttmt"), different ports
# (3200/4200/5433 vs qaasr's), different remote directory. No overlap.
#
# Usage:
#   .\deploy.ps1                                  # build + deploy (first run creates everything)
#   .\deploy.ps1 -Mode full                       # release + DB dump/restore (see note below)
#   .\deploy.ps1 -SSH my-alias                    # override SSH alias/host
#   .\deploy.ps1 -RemoteComposeCmd 'docker-compose'   # force a specific compose invocation
#                                                      # (default: auto-detected against the remote,
#                                                      # under sudo, since root's plugin availability
#                                                      # can differ from your login user's)
#
# First-time setup: just run with defaults. The remote directory is created
# automatically, Postgres/Redis/schema are created fresh on first boot (the
# API container runs `prisma db push` every start), and a bootstrap
# SUPER_ADMIN account is seeded automatically IF you've set SEED_ADMIN_EMAIL /
# SEED_ADMIN_PASSWORD in your local .env before running this (see
# .env.example) - there is no self-registration path to becoming an admin,
# so without this you'd have no way to log in until you create one another
# way (e.g. temporarily set OPEN_REGISTRATION=true, register, promote via SQL).
#
# -Mode full is only useful if you already have local data (test cycles,
# tasks, etc.) you want to push to a currently-running remote instance's
# database, overwriting it. Not needed for a brand-new remote - there's
# nothing there yet to overwrite, and full mode assumes the remote stack
# already exists so it can stop it before restoring.
# ==============================================================================

param(
    [ValidateSet('release', 'full')]
    [string]$Mode = 'release',
    [string]$SSH  = 'qa-infinity',
    [string]$RemoteDir = '/data/6d-test-task-management-tool',
    # Left unset by default -> auto-detected against the remote (see PHASE 0).
    # Pass this explicitly only to force a specific one and skip detection.
    [string]$RemoteComposeCmd
)
$RemoteComposeCmdExplicit = $PSBoundParameters.ContainsKey('RemoteComposeCmd')

$ErrorActionPreference = 'Stop'
$ProjectName = '6d-ttmt'
$Services    = 'ttmt-postgres ttmt-redis ttmt-api ttmt-ui'
$TmpDir      = "$PSScriptRoot\.deploy-tmp"

# -- Helpers -------------------------------------------------------------------
function Log-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Log-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Log-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red; exit 1 }

function Run-SSH {
    param([string]$cmd)
    ssh $SSH $cmd
    if ($LASTEXITCODE -ne 0) { Log-Error "Remote command failed: $cmd" }
}

# Same as Run-SSH but tolerates failure - used for best-effort/idempotent
# steps (e.g. the seed script) where a non-zero exit shouldn't abort deploy.
function Run-SSH-Soft {
    param([string]$cmd)
    ssh $SSH $cmd
    if ($LASTEXITCODE -ne 0) { Log-Warn "Remote command reported a non-zero exit (continuing): $cmd" }
}

function Run-SCP {
    param([string]$local, [string]$remote)
    scp $local "${SSH}:${remote}"
    if ($LASTEXITCODE -ne 0) { Log-Error "SCP failed: $local -> $remote" }
}

# Reads a single KEY=value out of the local .env (last match wins, matching
# how shells/dotenv-style loaders treat repeated keys). Returns '' if unset.
function Read-EnvVar {
    param([string]$key)
    $line = Get-Content "$PSScriptRoot\.env" -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

# -- Banner --------------------------------------------------------------------
Write-Host ""
Write-Host "  6D Test & Task Management Tool - Deploy" -ForegroundColor DarkCyan
Write-Host "  Mode   : $Mode" -ForegroundColor White
Write-Host "  Target : $SSH  ->  $RemoteDir" -ForegroundColor White
Write-Host ""

if (-not (Test-Path "$PSScriptRoot\.env")) {
    Log-Error ".env not found at $PSScriptRoot\.env - copy .env.example to .env and fill it in first."
}

if ($Mode -eq 'full') {
    Log-Warn "FULL MIGRATION mode - this will stop remote services and overwrite the remote database with your local one."
    $confirm = Read-Host "  Type YES to continue"
    if ($confirm -ne 'YES') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
}

# ==============================================================================
# PHASE 0 - Detect remote docker compose invocation (fail fast, before
# spending time building/transferring images, if neither is usable)
# ==============================================================================
if ($RemoteComposeCmdExplicit) {
    Log-Step "Using explicit -RemoteComposeCmd '$RemoteComposeCmd'"
} else {
    Log-Step "Detecting docker compose on $SSH (checked as root, since every later call runs under sudo)"
    # Root's plugin availability can differ from your login user's -- the v2
    # `docker compose` plugin is commonly installed per-user under
    # ~/.docker/cli-plugins, which `sudo` (running as root, different $HOME)
    # won't see even if it works fine without sudo. Probing under sudo here
    # is what actually predicts whether PHASE 6+ will work.
    $probe = ssh $SSH "sudo docker compose version >/dev/null 2>&1 && echo V2 || (sudo docker-compose version >/dev/null 2>&1 && echo V1 || echo NONE)"
    switch ($probe.Trim()) {
        'V2' { $RemoteComposeCmd = 'docker compose' }
        'V1' { $RemoteComposeCmd = 'docker-compose' }
        default {
            Log-Error "Neither 'sudo docker compose' nor 'sudo docker-compose' works on $SSH. Install Docker Compose there (or grant root access to the existing per-user plugin), or pass -RemoteComposeCmd explicitly once you know which to use."
        }
    }
    Log-Ok "Using '$RemoteComposeCmd' on remote (auto-detected)"
}

# -- Temp dir ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# ==============================================================================
# PHASE 1 - Build images
# ==============================================================================
Log-Step "Building Docker images"

Push-Location $PSScriptRoot
docker compose -p $ProjectName build ttmt-api ttmt-ui
if ($LASTEXITCODE -ne 0) { Log-Error "Docker build failed" }
Log-Ok "Images built"

# ==============================================================================
# PHASE 2 - Save images to tars
# ==============================================================================
Log-Step "Saving images to tar files"

$images = @(
    @{ name = 'ttmt-api'; tar = "$TmpDir\ttmt-api.tar" },
    @{ name = 'ttmt-ui';  tar = "$TmpDir\ttmt-ui.tar"  }
)

foreach ($img in $images) {
    Write-Host "    Saving $($img.name)..." -NoNewline
    docker save "$($img.name):latest" -o $img.tar
    if ($LASTEXITCODE -ne 0) { Log-Error "docker save failed for $($img.name)" }
    $sizeMB = [math]::Round((Get-Item $img.tar).Length / 1MB, 1)
    Write-Host " $sizeMB MB" -ForegroundColor Gray
}
Log-Ok "All images saved"

# ==============================================================================
# PHASE 3 - Full migration: dump DB (full mode only)
# ==============================================================================
if ($Mode -eq 'full') {
    $pgUser = Read-EnvVar 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'ttmt' }
    $pgDb   = Read-EnvVar 'POSTGRES_DB';   if (-not $pgDb)   { $pgDb   = 'ttmt' }

    Log-Step "Dumping PostgreSQL database from local container"
    docker exec ttmt-postgres pg_dump -U $pgUser $pgDb -f /tmp/ttmt-dump.sql
    if ($LASTEXITCODE -ne 0) { Log-Error "pg_dump failed" }
    docker cp ttmt-postgres:/tmp/ttmt-dump.sql "$TmpDir\ttmt-dump.sql"
    if ($LASTEXITCODE -ne 0) { Log-Error "docker cp dump failed" }
    Log-Ok "DB dump saved"
}

# ==============================================================================
# PHASE 4 - Copy config files
# ==============================================================================
Log-Step "Copying config files to tmp"

Copy-Item "$PSScriptRoot\docker-compose.yml" "$TmpDir\docker-compose.yml" -Force
Copy-Item "$PSScriptRoot\.env"               "$TmpDir\.env"               -Force
if (Test-Path "$PSScriptRoot\docker-compose.override.yml") {
    Copy-Item "$PSScriptRoot\docker-compose.override.yml" "$TmpDir\docker-compose.override.yml" -Force
}
if (Test-Path "$PSScriptRoot\nginx\nginx.conf") {
    New-Item -ItemType Directory -Force -Path "$TmpDir\nginx" | Out-Null
    Copy-Item "$PSScriptRoot\nginx\nginx.conf" "$TmpDir\nginx\nginx.conf" -Force
}
if (Test-Path "$PSScriptRoot\scripts\backup-db.sh") {
    New-Item -ItemType Directory -Force -Path "$TmpDir\scripts" | Out-Null
    Copy-Item "$PSScriptRoot\scripts\backup-db.sh" "$TmpDir\scripts\backup-db.sh" -Force
}
Log-Ok "Config files ready"

# ==============================================================================
# PHASE 5 - Transfer to remote server
# ==============================================================================
Log-Step "Transferring files to $SSH"

# Detect first-time vs. rolling deploy - purely informational (the up -d
# below behaves correctly either way), but it's worth being explicit: on a
# fresh remote, Postgres/Redis are pulled from Docker Hub and initialized by
# `docker compose up -d` itself (nothing to build/transfer for them - only
# ttmt-api/ttmt-ui are custom images). On every deploy after that, Postgres
# and Redis already exist with the same image/config, so compose's own
# reconciliation leaves them running untouched (data in their named volumes
# persists) and only recreates whichever of ttmt-api/ttmt-ui just got a new
# image - that's the "subsequent releases only push config + images" you get
# for free from `up -d`, not something this script special-cases.
$remoteExists = ssh $SSH "test -f $RemoteDir/docker-compose.yml && echo EXISTS || echo NEW"
$isFirstDeploy = $remoteExists -notmatch 'EXISTS'
if ($isFirstDeploy) {
    Log-Warn "No existing deployment found at $RemoteDir - first-time setup. Postgres/Redis will be pulled and initialized fresh on this run."
} else {
    Log-Ok "Existing deployment found at $RemoteDir - rolling update (Postgres/Redis keep their existing data untouched)."
}

Run-SSH "mkdir -p $RemoteDir"

foreach ($img in $images) {
    $remotePath = "$RemoteDir/$(Split-Path $img.tar -Leaf)"
    Write-Host "    Uploading $(Split-Path $img.tar -Leaf)..." -NoNewline
    Run-SCP $img.tar $remotePath
    Write-Host " done" -ForegroundColor Gray
}

if (-not $isFirstDeploy) {
    # POSTGRES_USER/PASSWORD/DB only take effect the FIRST time Postgres
    # initializes its (empty) data directory - changing them afterwards
    # doesn't change the DB's actual credentials, it just makes ttmt-api
    # start failing to authenticate against data that's already there.
    $remotePgPassLine  = ssh $SSH "grep -E '^POSTGRES_PASSWORD=' $RemoteDir/.env 2>/dev/null | tail -1"
    $remotePgPassValue = if ($remotePgPassLine) { ($remotePgPassLine -split '=', 2)[1].Trim().Trim('"').Trim("'") } else { $null }
    $localPgPassValue  = Read-EnvVar 'POSTGRES_PASSWORD'
    if ($remotePgPassValue -and ($remotePgPassValue -ne $localPgPassValue)) {
        Log-Warn "POSTGRES_PASSWORD in your local .env differs from what's already deployed at $RemoteDir/.env."
        Log-Warn "Changing it now will NOT change the running database's real password - ttmt-api will fail to connect after this deploy."
        Log-Warn "If you really need to rotate it, change the password inside Postgres itself first (ALTER ROLE), then update .env to match."
        $confirmPg = Read-Host "  Type YES to deploy anyway with the new .env"
        if ($confirmPg -ne 'YES') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
    }
}

Run-SCP "$TmpDir\docker-compose.yml" "$RemoteDir/docker-compose.yml"
Run-SCP "$TmpDir\.env"               "$RemoteDir/.env"

if (Test-Path "$TmpDir\docker-compose.override.yml") {
    Run-SCP "$TmpDir\docker-compose.override.yml" "$RemoteDir/docker-compose.override.yml"
}

if (Test-Path "$TmpDir\nginx\nginx.conf") {
    Run-SSH "mkdir -p $RemoteDir/nginx"
    Run-SCP "$TmpDir\nginx\nginx.conf" "$RemoteDir/nginx/nginx.conf"
}

if (Test-Path "$TmpDir\scripts\backup-db.sh") {
    Run-SSH "mkdir -p $RemoteDir/scripts $RemoteDir/backups"
    Run-SCP "$TmpDir\scripts\backup-db.sh" "$RemoteDir/scripts/backup-db.sh"
    Run-SSH "chmod +x $RemoteDir/scripts/backup-db.sh"
}

if ($Mode -eq 'full') {
    Run-SCP "$TmpDir\ttmt-dump.sql" "$RemoteDir/ttmt-dump.sql"
}

Log-Ok "All files transferred"

# ==============================================================================
# PHASE 6 - Load images and (re)start on remote
# ==============================================================================
Log-Step "Loading images on remote server"

foreach ($img in $images) {
    $tarName = Split-Path $img.tar -Leaf
    Write-Host "    Loading $tarName..." -NoNewline
    Run-SSH "sudo docker load -i $RemoteDir/$tarName"
    Write-Host " done" -ForegroundColor Gray
}
Log-Ok "Images loaded"

if ($Mode -eq 'full') {
    $pgUser = Read-EnvVar 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'ttmt' }
    $pgDb   = Read-EnvVar 'POSTGRES_DB';   if (-not $pgDb)   { $pgDb   = 'ttmt' }

    Log-Step "Stopping API for full migration (Postgres/Redis stay up so we can restore into them)"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d ttmt-postgres ttmt-redis"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName stop ttmt-api"

    Log-Step "Restoring database"
    Run-SSH "sudo docker exec ttmt-postgres psql -U $pgUser -c `"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$pgDb' AND pid <> pg_backend_pid();`""
    Run-SSH "sudo docker exec ttmt-postgres psql -U $pgUser -c 'DROP DATABASE IF EXISTS $pgDb;'"
    Run-SSH "sudo docker exec ttmt-postgres psql -U $pgUser -c 'CREATE DATABASE $pgDb;'"
    Run-SSH "sudo docker cp $RemoteDir/ttmt-dump.sql ttmt-postgres:/tmp/ttmt-dump.sql"
    Run-SSH "sudo docker exec ttmt-postgres psql -U $pgUser -d $pgDb -f /tmp/ttmt-dump.sql"
    Log-Ok "Database restored"

    Log-Step "Starting all services"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d --no-build $Services"
} else {
    Log-Step "Rolling (re)start on remote"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d --no-build $Services"
}

Log-Ok "Services (re)started"

# ==============================================================================
# PHASE 7 - Health check
# ==============================================================================
Log-Step "Waiting for API health check"

$healthy = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 5
    $result = ssh $SSH "curl -sf http://localhost:4200/health 2>/dev/null && echo OK || echo FAIL"
    if ($result -match 'OK') { $healthy = $true; break }
    Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
}

if ($healthy) {
    Log-Ok "API is healthy"
} else {
    Log-Warn "API health check timed out - check logs with:"
    Write-Host "    ssh $SSH 'sudo docker logs ttmt-api --tail 50'" -ForegroundColor Yellow
}

# ==============================================================================
# PHASE 8 - Bootstrap admin account (idempotent - skips if it already exists)
# ==============================================================================
if ($healthy) {
    Log-Step "Seeding bootstrap admin (skips silently if SEED_ADMIN_EMAIL is unset, or the user already exists)"
    Run-SSH-Soft "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName exec -T ttmt-api sh -c 'cd packages/api && pnpm db:seed'"
}

# ==============================================================================
# PHASE 9 - Install/refresh the nightly DB backup cron job (idempotent -
# re-running this always ends with exactly one correct entry, never
# duplicates, even if $RemoteDir ever changes between deploys)
# ==============================================================================
if (Test-Path "$PSScriptRoot\scripts\backup-db.sh") {
    Log-Step "Installing nightly backup cron job (03:00 daily, 14-day retention, on-host only)"
    $cronLine = "0 3 * * * $RemoteDir/scripts/backup-db.sh >>$RemoteDir/backups/cron.log 2>&1"
    $cronCmd  = "(crontab -l 2>/dev/null | grep -v backup-db.sh; echo '$cronLine') | crontab -"
    Run-SSH-Soft $cronCmd
    Log-Ok "Backup cron installed - dumps land in $RemoteDir/backups, check $RemoteDir/backups/backup.log"
}

# ==============================================================================
# PHASE 10 - Disk usage
# ==============================================================================
Log-Step "Remote disk usage"
Run-SSH "df -h /data"

# -- Cleanup -------------------------------------------------------------------
Log-Step "Cleaning up local temp files"
Remove-Item -Recurse -Force $TmpDir
Log-Ok "Done"

Pop-Location

Write-Host ""
Write-Host "  Deployment complete!" -ForegroundColor Green
Write-Host "  Mode   : $Mode" -ForegroundColor White
Write-Host "  Target : $SSH -> $RemoteDir" -ForegroundColor White
Write-Host "  URL    : http://<server>:3200" -ForegroundColor White
Write-Host ""
