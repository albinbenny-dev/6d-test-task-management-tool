# ==============================================================================
# 6D Test & Task Management Tool - Release (git-sync)
#
# Ships releases via git instead of transferring built Docker images:
#   1. Pushes the given ref (branch or tag) to GitHub.
#   2. SSHes into the remote and runs scripts/release.sh <ref>, which pulls
#      that ref and rebuilds ttmt-api/ttmt-ui FROM SOURCE on the remote (it
#      has internet access, so there's nothing to build locally anymore).
#
# The remote must already be a git clone of this repo - see the one-time
# setup instructions at the top of scripts/release.sh. Postgres/Redis and
# their data volumes are never touched by a release; only ttmt-api/ttmt-ui
# get rebuilt and restarted.
#
# Usage:
#   .\deploy.ps1                          # push + deploy current branch (main)
#   .\deploy.ps1 -Ref v1.1.0              # deploy an existing tag
#   .\deploy.ps1 -Tag v1.1.0              # create tag v1.1.0 at HEAD, push it, deploy it
#   .\deploy.ps1 -SSH my-alias
#
# Rolling back is just deploying an older tag:
#   .\deploy.ps1 -Ref v1.0.0
#
# For DB-migration mode (pushing your local database to the remote) or the
# old tar-transfer flow, see deploy-legacy.ps1 - unrelated to how code ships
# now, so it wasn't folded into this script.
# ==============================================================================

param(
    [string]$Ref = 'main',
    [string]$Tag,
    [string]$SSH = 'qa-server',
    [string]$RemoteDir = '/data/autoab/6d-test-task-management-tool',
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'

function Log-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Log-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Log-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  6D Test & Task Management Tool - Release" -ForegroundColor DarkCyan
Write-Host "  Target : $SSH -> $RemoteDir" -ForegroundColor White
Write-Host ""

# ==============================================================================
# PHASE 1 - Resolve the ref to deploy
# ==============================================================================
if ($Tag) {
    Log-Step "Tagging HEAD as $Tag"
    git tag $Tag
    if ($LASTEXITCODE -ne 0) { Log-Error "git tag failed - does $Tag already exist? (git tag -d $Tag to remove it locally)" }
    $Ref = $Tag
    Log-Ok "Tagged $(git rev-parse --short HEAD) as $Tag"
}

$dirty = git status --porcelain
if ($dirty) {
    Log-Warn "You have uncommitted changes - they will NOT be part of this release:"
    Write-Host $dirty -ForegroundColor Yellow
}

# ==============================================================================
# PHASE 2 - Push to GitHub
# ==============================================================================
if (-not $SkipPush) {
    Log-Step "Pushing $Ref to origin"
    git push origin $Ref
    if ($LASTEXITCODE -ne 0) { Log-Error "git push failed" }
    Log-Ok "Pushed"
} else {
    Log-Warn "Skipping push (-SkipPush) - assuming $Ref already exists on origin"
}

# ==============================================================================
# PHASE 3 - Trigger the remote release
# ==============================================================================
Log-Step "Running scripts/release.sh $Ref on $SSH"
ssh $SSH "cd $RemoteDir && ./scripts/release.sh '$Ref'"
if ($LASTEXITCODE -ne 0) { Log-Error "Remote release failed - see output above" }

Write-Host ""
Write-Host "  Release complete!" -ForegroundColor Green
Write-Host "  Ref    : $Ref" -ForegroundColor White
Write-Host "  Target : $SSH -> $RemoteDir" -ForegroundColor White
Write-Host "  URL    : http://<server>:3200" -ForegroundColor White
Write-Host ""
