# Agent Guide - Etherpad

Welcome to the Etherpad project. This guide provides essential context and instructions for AI agents and developers to effectively contribute to the codebase.

## Project Overview
Etherpad is a real-time collaborative editor designed to be lightweight, scalable, and highly extensible via plugins.

## Technical Stack
- **Runtime:** Node.js
- **Package Manager:** pnpm
- **Languages:** TypeScript (primary), JavaScript, CSS, HTML
- **Backend:** Express.js, Socket.io
- **Frontend:** Legacy core (`src/static`), New UI (`ui/`), Admin UI (`admin/`)
- **Build Tools:** Vite (for `ui` and `admin`), custom scripts in `bin/`
- **Testing:** Mocha (Backend), Vitest, Playwright, custom backend test suite

## Directory Structure
- `src/node/`: Backend logic, API, and database abstraction.
- `src/static/`: Core frontend logic (Legacy).
- `ui/`: Modern React-based user interface.
- `admin/`: Modern React-based administration interface.
- `bin/`: Utility and lifecycle scripts.
- `doc/`: Documentation in Markdown and Adoc formats.
- `src/tests/`: Test suites (backend, frontend, UI, admin).
- `var/`: Runtime data (logs, dirtyDB, etc. - ignored by git).
- `local_plugins/`: Directory for developing and testing plugins locally.

## Core Mandates & Conventions

### Coding Style
- **Indentation:** 2 spaces for all files (JS/TS/CSS/HTML).
- **No Tabs:** Use spaces only.
- **Comments:** Provide clear comments for complex logic.
- **Backward Compatibility:** Always ensure compatibility with older versions of the database and configuration files.

### Development Workflow
- **Branching:** Work in feature branches. Issue PRs against the `develop` branch.
- **Commits:** Maintain a linear history (no merge commits). Use meaningful messages in the format: `submodule: description`.
- **Feature Flags:** New features should be placed behind feature flags and disabled by default.
- **Deprecation:** Never remove features abruptly; deprecate them first with a `WARN` log.

### Testing & Validation
- **Requirement:** Every bug fix MUST include a regression test in the same commit.
- **Backend Tests:** Run `pnpm --filter ep_etherpad-lite run test` from the root.
- **Frontend Tests:** Accessible at `/tests/frontend` on a running instance.
- **Linting:** Run `pnpm run lint` to ensure style compliance.
- **Build:** Run `pnpm run build:etherpad` before production deployment.

## Key Concepts

### Easysync
The real-time synchronization engine. It is complex; refer to `doc/public/easysync/` before modifying core synchronization logic.

### Plugin Framework
Most functionality should be implemented as plugins (`ep_...`). Avoid modifying the core unless absolutely necessary.

### Settings
Configured via `settings.json`. A template is available at `settings.json.template`. Environment variables can override any setting using `"${ENV_VAR}"` or `"${ENV_VAR:default_value}"`.

## AI-Specific Guidance
AI/Agent contributions are explicitly welcomed by the maintainers, provided they strictly adhere to the guidelines in `CONTRIBUTING.md` and this guide. Always prioritize stability, readability, and compatibility.
