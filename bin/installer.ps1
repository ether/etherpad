# Etherpad one-line installer for Windows (PowerShell).
#
# Usage:
#   irm https://raw.githubusercontent.com/ether/etherpad-lite/master/bin/installer.ps1 | iex
#
# Optional environment variables:
#   $env:ETHERPAD_DIR     Directory to install into (default: .\etherpad-lite)
#   $env:ETHERPAD_BRANCH  Branch / tag to clone (default: master)
#   $env:ETHERPAD_REPO    Repo URL (default: https://github.com/ether/etherpad.git)
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
$EtherpadRepo   = if ($env:ETHERPAD_REPO)   { $env:ETHERPAD_REPO }   else { 'https://github.com/ether/etherpad.git' }
$RequiredNodeMajor = 20

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
        Write-Warn "$EtherpadDir already exists; updating to $EtherpadBranch."
        Push-Location $EtherpadDir
        try {
            # Verify the existing checkout points at the expected remote.
            $existingRemote = (git remote get-url origin 2>$null)
            if ($existingRemote -and $existingRemote -ne $EtherpadRepo) {
                Write-Fatal "$EtherpadDir is checked out from '$existingRemote', expected '$EtherpadRepo'. Refusing to overwrite."
            }

            # Refuse to clobber meaningful local changes. pnpm-lock.yaml is
            # excluded because `pnpm i` rewrites it during installation,
            # which would otherwise make every re-run of the installer fail.
            $statusLines = (git status --porcelain) -split "`n" |
                Where-Object { $_ -and ($_ -notmatch '\bpnpm-lock\.yaml$') }
            if ($statusLines) {
                $statusLines | ForEach-Object { Write-Host $_ }
                Write-Fatal "$EtherpadDir has uncommitted changes. Commit/stash them or remove the directory."
            }

            git fetch --tags --prune origin
            if ($LASTEXITCODE -ne 0) { Write-Fatal "git fetch failed in $EtherpadDir" }

            # Discard any pnpm-lock.yaml changes from a prior pnpm install
            # so the subsequent checkout doesn't refuse to overwrite.
            git checkout -- pnpm-lock.yaml 2>$null

            # Switch to the requested branch / tag and fast-forward to it.
            git show-ref --verify --quiet "refs/remotes/origin/$EtherpadBranch"
            $isBranch = ($LASTEXITCODE -eq 0)
            git show-ref --verify --quiet "refs/tags/$EtherpadBranch"
            $isTag = ($LASTEXITCODE -eq 0)

            if ($isBranch) {
                git checkout -B $EtherpadBranch "origin/$EtherpadBranch"
                if ($LASTEXITCODE -ne 0) { Write-Fatal "git checkout $EtherpadBranch failed" }
            } elseif ($isTag) {
                git checkout --detach "refs/tags/$EtherpadBranch"
                if ($LASTEXITCODE -ne 0) { Write-Fatal "git checkout tag $EtherpadBranch failed" }
            } else {
                Write-Fatal "Branch or tag '$EtherpadBranch' not found on origin."
            }

            $installedRev = (git rev-parse --short HEAD)
            Write-Step "Updated $EtherpadDir to $EtherpadBranch @ $installedRev"
        } finally {
            Pop-Location
        }
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
