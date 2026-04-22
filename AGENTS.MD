# Agent Guide - Etherpad

Welcome to the Etherpad project. This guide provides essential context and instructions for AI agents and developers to effectively contribute to the codebase.

## Project Overview
Etherpad is a real-time collaborative editor designed to be lightweight, scalable, and highly extensible via plugins.

## Technical Stack
- **Runtime:** Node.js >= 20.0.0
- **Package Manager:** pnpm (>= 8.3.0)
- **Languages:** TypeScript (primary for new code), JavaScript (legacy), CSS, HTML
- **Backend:** Express.js 5, Socket.io 4
- **Frontend:** Legacy core (`src/static`), Modern React UI (`ui/`), Admin UI (`admin/`)
- **Database:** ueberdb2 abstraction (supports dirtyDB, MySQL, PostgreSQL, Redis)
- **Build Tools:** Vite (for `ui` and `admin`), esbuild, tsx
- **Testing:** Mocha (backend), Playwright (frontend E2E), Vitest (unit)
- **Auth:** JWT (jose library), OIDC provider

## Directory Structure
- `src/node/` - Backend logic, API handlers, database models, hooks
- `src/static/` - Core frontend logic (legacy jQuery-based editor)
- `src/static/js/pluginfw/` - Plugin framework (installer, hook system)
- `src/tests/` - Test suites (backend, frontend, container)
- `ui/` - Modern React OIDC login UI (Vite + TypeScript)
- `admin/` - Modern React admin panel (Vite + TypeScript + Radix UI)
- `bin/` - CLI utilities, build scripts, plugin management tools
- `bin/plugins/` - Plugin maintenance scripts (checkPlugin.ts, updateCorePlugins.sh)
- `doc/` - Documentation (VitePress + Markdown/AsciiDoc)
- `local_plugins/` - Directory for developing and testing plugins locally
- `var/` - Runtime data (logs, dirtyDB, etc. - ignored by git)

## Quick Start

```bash
pnpm install                                    # Install all dependencies
pnpm run build:etherpad                         # Build admin UI and static assets
pnpm --filter ep_etherpad-lite run dev          # Start dev server (port 9001)
pnpm --filter ep_etherpad-lite run prod         # Start production server
```

## Core Mandates & Conventions

### Coding Style
- **Indentation:** 2 spaces for all files (JS/TS/CSS/HTML). No tabs.
- **TypeScript:** All new code should be TypeScript. Strict mode is enabled.
- **Comments:** Provide clear comments for complex logic only.
- **Backward Compatibility:** Always ensure compatibility with older versions of the database and configuration files.

### Development Workflow
- **Branching:** Work in feature branches. Issue PRs against the `develop` branch. Never PR directly to `master`.
- **Commits:** Maintain a linear history (no merge commits). Use meaningful messages in the format: `submodule: description`.
- **Feature Flags:** New features should be placed behind feature flags and disabled by default.
- **Deprecation:** Never remove features abruptly; deprecate them first with a `WARN` log.
- **Forks:** For etherpad-lite changes, commit to `johnmclear/etherpad-lite` fork on a new branch, then PR to `ether/etherpad`. For plugins (`ep_*` repos), committing directly is acceptable.

### Testing & Validation
- **Requirement:** Every bug fix MUST include a regression test in the same commit.
- **Always run tests locally before pushing to CI.**
- **Linting:** `pnpm run lint`
- **Type Check:** `pnpm --filter ep_etherpad-lite run ts-check`
- **Build:** `pnpm run build:etherpad` before production deployment

#### Running Backend Tests Locally

Backend tests use Mocha with tsx and run against a real server instance (started automatically by the test harness). No separate server process is needed.

```bash
# Run ALL backend tests (includes plugin tests)
pnpm --filter ep_etherpad-lite run test

# Run only utility tests (faster, ~5s timeout)
pnpm --filter ep_etherpad-lite run test-utils

# Run a single test file directly
cd src && cross-env NODE_ENV=production npx mocha --import=tsx --timeout 120000 tests/backend/specs/YOUR_TEST.ts

# Run unit tests (Vitest)
cd src && npx vitest
```

- Tests run with `NODE_ENV=production`.
- Default timeout is 120 seconds per test.
- Test files live in `src/tests/backend/specs/`.
- Plugin backend tests live in `node_modules/ep_*/static/tests/backend/specs/` (at repo root) and are included automatically by the test script.

#### Running Frontend E2E Tests Locally

Frontend tests use Playwright. **You must have a running Etherpad server** before launching them — the Playwright config does not auto-start the server.

**Before running frontend or admin tests, ensure Playwright browsers are installed.** Check and install if needed:

```bash
# Check which browsers are installed
cd src && npx playwright install --dry-run

# Install all browsers and their system dependencies (must run from src/)
cd src && npx playwright install
cd src && sudo npx playwright install-deps
```

If `sudo` is unavailable, install system dependencies for webkit manually:
```bash
# Check which system libraries are missing for webkit
ldd ~/.cache/ms-playwright/webkit-*/minibrowser-wpe/MiniBrowser 2>&1 | grep "not found"
```

If browsers or system dependencies are missing, tests will fail silently or timeout — **always verify browser installation before debugging test failures.**

```bash
# 1. Start the dev server in a separate terminal
pnpm --filter ep_etherpad-lite run dev

# 2. Run frontend E2E tests
pnpm --filter ep_etherpad-lite run test-ui

# 3. Run with interactive Playwright UI (useful for debugging)
pnpm --filter ep_etherpad-lite run test-ui:ui

# Run a single test file
cd src && cross-env NODE_ENV=production npx playwright test tests/frontend-new/specs/YOUR_TEST.spec.ts
```

- Tests expect the server at `localhost:9001`.
- Test files live in `src/tests/frontend-new/specs/`.
- Runs against chromium and firefox by default (webkit is disabled).
- Playwright config is at `src/playwright.config.ts`.

#### Running Admin Panel Tests Locally

```bash
# Requires a running server and Playwright browsers installed (same as frontend tests)
pnpm --filter ep_etherpad-lite run test-admin

# Interactive UI mode
pnpm --filter ep_etherpad-lite run test-admin:ui
```

- Admin tests run with `--workers 1` (sequential) on chromium and firefox only.
- Test files live in `src/tests/frontend-new/admin-spec/`.

### Backend Test Auth
Tests use JWT authentication, not API keys. Pattern:
```typescript
import * as common from 'ep_etherpad-lite/tests/backend/common';

const agent = await common.init();  // Starts server, returns supertest agent
const token = await common.generateJWTToken();
agent.get('/api/1/endpoint').set('authorization', token);
```
Do not use `APIKEY.txt` — it may not exist in the test environment.

## Key Concepts

### Easysync
The real-time synchronization engine. It is complex; refer to `doc/public/easysync/` before modifying core synchronization logic.

### Plugin Framework
Most functionality should be implemented as plugins (`ep_*`). Avoid modifying the core unless absolutely necessary.

**Plugin structure:**
```
ep_myplugin/
├── ep.json              # Hook declarations (server_hooks, client_hooks)
├── index.js             # Server-side hook implementations
├── package.json
├── static/
│   ├── js/              # Client-side code
│   ├── css/
│   └── tests/
│       ├── backend/specs/    # Backend tests (Mocha)
│       └── frontend-new/     # Frontend tests (Playwright)
├── templates/           # EJS templates
└── locales/             # i18n files
```

**Plugin management:**
```bash
pnpm run plugins i ep_plugin_name       # Install from npm
pnpm run plugins i --path ../plugin     # Install from local path
pnpm run plugins rm ep_plugin_name      # Remove
pnpm run plugins ls                     # List installed
```

**Plugin installation internals:** Plugins are installed to `src/plugin_packages/` via `live-plugin-manager`, which stores them at `src/plugin_packages/.versions/ep_name@version/`. Symlinks are created: `src/node_modules/ep_name` → `src/plugin_packages/ep_name` → `.versions/ep_name@ver/`.

### Plugin Repositories
- **Monorepo:** `ether/ether-plugins` contains 80+ plugins with shared CI/publishing
- **Standalone repos:** Individual `ether/ep_*` repos still exist for many plugins
- **Plugin CI templates:** `bin/plugins/lib/` contains workflow templates pushed to standalone plugin repos via `checkPlugin.ts`
- **Shared pipelines:** `ether/ether-pipelines` contains reusable GitHub Actions workflows for plugin CI

### Settings
Configured via `settings.json`. A template is available at `settings.json.template`. Environment variables can override any setting using `"${ENV_VAR}"` or `"${ENV_VAR:default_value}"`.

## Monorepo Structure

This project uses pnpm workspaces. The workspaces are:
- `src/` - Core Etherpad (package: `ep_etherpad-lite`)
- `bin/` - CLI tools and plugin scripts
- `ui/` - Login UI
- `admin/` - Admin panel
- `doc/` - Documentation

Root-level commands operate across all workspaces. Use `pnpm --filter <package>` to target specific workspaces.

## AI-Specific Guidance
AI/Agent contributions are explicitly welcomed by the maintainers, provided they strictly adhere to the guidelines in `CONTRIBUTING.md` and this guide. Always prioritize stability, readability, and compatibility.
