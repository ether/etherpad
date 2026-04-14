# Claude Code Guidelines for Etherpad

## PR Requirements

- **Every PR must include test coverage.** Bug fixes need regression tests. New features need unit/integration tests. No exceptions.
- Backend tests go in `src/tests/backend/specs/`
- Frontend (Playwright) tests go in `src/tests/frontend-new/specs/`
- Run tests locally before submitting a PR

## Running Tests

```bash
# Install dependencies
pnpm install

# Type check
pnpm run ts-check

# Backend tests
pnpm run test

# Frontend Playwright tests (requires running server)
pnpm run test-ui
```

## Project Structure

- `src/` — main application (ep_etherpad-lite package)
- `bin/` — CLI scripts
- `admin/` — admin UI
- `ui/` — frontend UI build
- Plugin packages live in `src/plugin_packages/`
- Uses pnpm workspaces (not npm)
