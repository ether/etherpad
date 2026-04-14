---
name: Fix failing tests, don't remove them
description: When a test fails, fix the underlying issue or the test — never remove the test to make CI green
type: feedback
---

If a test fails, don't remove it — fix it. Either fix the underlying code so the test passes, or fix the test if it's wrong.

**Why:** User explicitly corrected this behavior. Removing tests to pass CI hides bugs.

**How to apply:** When a test fails, diagnose the root cause. If the code is wrong, fix the code. If the test assertion is wrong, fix the assertion. Never delete a test just because it's failing.
