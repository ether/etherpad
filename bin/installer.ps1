# Etherpad one-line installer for Windows (PowerShell).
#
# Usage:
#   irm https://raw.githubusercontent.com/ether/etherpad-lite/master/bin/installer.ps1 | iex
#
# Optional environment variables:
#   $env:ETHERPAD_DIR     Directory to install into (default: .\etherpad-lite)
#   $env:ETHERPAD_BRANCH  Branch / tag to clone (default: master)
#   $env:ETHERPAD_REPO    Repo URL (default: https://github.com/ether/etherpad-lite.git)
#   $env:ETHERPAD_RUN     If "1", start Etherpad after install
#   $env:NO_COLOR         If set, disables coloured output

#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

# ---------- pretty output ----------
$useColor = -not $env:NO_COLOR
function Write-Step([string]$msg) {
    if ($useColor) { Write-Host "==> $msg" -ForegroundColor Green }
    else           { Write-Host "==> $msg" }
}
function Write-Warn([string]$msg) {
    if ($useColor) { Write-Host "==> $msg" -ForegroundColor Yellow }
    else           { Write-Host "==> $msg" }
}
function Write-Fatal([string]$msg) {
    if ($useColor) { Write-Host "==> $msg" -ForegroundColor Red }
    else           { Write-Host "==> $msg" }
    exit 1
}

function Test-Cmd([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# ---------- defaults ----------
$EtherpadDir    = if ($env:ETHERPAD_DIR)    { $env:ETHERPAD_DIR }    else { 'etherpad-lite' }
$EtherpadBranch = if ($env:ETHERPAD_BRANCH) { $env:ETHERPAD_BRANCH } else { 'master' }
$EtherpadRepo   = if ($env:ETHERPAD_REPO)   { $env:ETHERPAD_REPO }   else { 'https://github.com/ether/etherpad-lite.git' }
$RequiredNodeMajor = 18

Write-Step 'Etherpad installer'

# ---------- prerequisite checks ----------
if (-not (Test-Cmd git)) {
    Write-Fatal 'git is required but not installed. See https://git-scm.com/download/win'
}
if (-not (Test-Cmd node)) {
    Write-Fatal "Node.js is required (>= $RequiredNodeMajor). Install it from https://nodejs.org"
}

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $RequiredNodeMajor) {
    $nodeVer = (node --version)
    Write-Fatal "Node.js >= $RequiredNodeMajor required. You have $nodeVer."
}

if (-not (Test-Cmd pnpm)) {
    Write-Step 'Installing pnpm globally'
    if (-not (Test-Cmd npm)) {
        Write-Fatal "npm not found. Install Node.js >= $RequiredNodeMajor."
    }
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        Write-Fatal 'Failed to install pnpm. Install it manually: https://pnpm.io/installation'
    }
    if (-not (Test-Cmd pnpm)) {
        Write-Fatal 'pnpm install reported success but pnpm is still not on PATH. Open a new shell and re-run.'
    }
}

# ---------- clone ----------
if (Test-Path $EtherpadDir) {
    if (Test-Path (Join-Path $EtherpadDir '.git')) {
        Write-Warn "$EtherpadDir already exists; pulling latest changes."
        Push-Location $EtherpadDir
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fatal "git pull failed in existing $EtherpadDir" }
        Pop-Location
    } else {
        Write-Fatal "$EtherpadDir exists and is not a git checkout. Aborting."
    }
} else {
    Write-Step "Cloning Etherpad ($EtherpadBranch) into $EtherpadDir"
    git clone --depth 1 --branch $EtherpadBranch $EtherpadRepo $EtherpadDir
    if ($LASTEXITCODE -ne 0) { Write-Fatal 'git clone failed.' }
}

Push-Location $EtherpadDir

# ---------- install + build ----------
Write-Step 'Installing dependencies (pnpm i)'
pnpm i
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fatal 'pnpm i failed.' }

Write-Step 'Building Etherpad (pnpm run build:etherpad)'
pnpm run build:etherpad
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fatal 'pnpm run build:etherpad failed.' }

# ---------- done ----------
Write-Host ''
if ($useColor) { Write-Host "🎉 Etherpad is installed in $EtherpadDir" -ForegroundColor Green }
else           { Write-Host "Etherpad is installed in $EtherpadDir" }
Write-Host 'To start Etherpad:'
Write-Host "  cd $EtherpadDir; pnpm run prod"
Write-Host 'Then open http://localhost:9001 in your browser.'
Write-Host ''

if ($env:ETHERPAD_RUN -eq '1') {
    Write-Step 'Starting Etherpad on http://localhost:9001'
    pnpm run prod
}
