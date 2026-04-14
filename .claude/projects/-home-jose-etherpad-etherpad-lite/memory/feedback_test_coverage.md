---
name: PR test coverage requirement
description: Every PR must include test coverage — regression tests for bug fixes, unit/integration tests for features
type: feedback
---

Every PR must include test coverage. Bug fixes need regression tests, features need unit/integration tests.

**Why:** User explicitly requires this as a non-negotiable part of the PR workflow.

**How to apply:** Before submitting any PR, ensure there are corresponding tests. Backend tests in `src/tests/backend/specs/`, frontend Playwright tests in `src/tests/frontend-new/specs/`. Run tests locally before pushing.
