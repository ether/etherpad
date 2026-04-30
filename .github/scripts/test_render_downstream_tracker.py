#!/usr/bin/env python3
"""Smoke tests for render-downstream-tracker.py.

Run from the repo root with: python3 .github/scripts/test_render_downstream_tracker.py
Exits 0 on success, non-zero with a diff on failure.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "render_downstream_tracker", HERE / "render-downstream-tracker.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def write(tmpdir: Path, content: str) -> Path:
    p = tmpdir / "catalog.yml"
    p.write_text(textwrap.dedent(content))
    return p


def expect_value_error(tmpdir: Path, content: str, needle: str) -> None:
    p = write(tmpdir, content)
    try:
        mod.render(p, "1.0", "ether/etherpad")
    except ValueError as e:
        assert needle in str(e), f"expected {needle!r} in {e!r}"
        return
    raise AssertionError(f"expected ValueError containing {needle!r}")


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        tmpdir = Path(td)

        # File targets render as /blob/HEAD/, directory targets render as
        # /tree/HEAD/. The two are not interchangeable on GitHub.
        body = mod.render(write(tmpdir, """
            downstreams:
              - name: A file target
                repo: foo/bar
                update_type: external_pr
                file: src/thing.sh
              - name: A dir target
                repo: foo/baz
                update_type: external_auto
                path: charts/etherpad
        """), "1.0", "ether/etherpad")
        assert "/blob/HEAD/src/thing.sh" in body, body
        assert "/tree/HEAD/charts/etherpad" in body, body

        # Validation errors must be raised as ValueError (caught by main()
        # and printed as a single CI-friendly line).
        expect_value_error(tmpdir, "[]\n", "must be a mapping")
        expect_value_error(tmpdir, "downstreams: not-a-list\n", "must be a list")
        expect_value_error(tmpdir, """
            downstreams:
              - "string item"
        """, "must be a mapping")
        expect_value_error(tmpdir, """
            downstreams:
              - name: missing-update_type
        """, "missing required")
        expect_value_error(tmpdir, """
            downstreams:
              - name: Both
                update_type: external_pr
                path: dir/
                file: file.txt
        """, "both `path` and `file`")

        # Unknown / typo'd update_type must be rejected, not silently dropped.
        expect_value_error(tmpdir, """
            downstreams:
              - name: Typo
                update_type: external-pr
        """, "unknown update_type")

        # IO and YAML parse errors must surface cleanly via main(), not a
        # bare traceback. Drive main() and check stderr/exit shape.
        import io
        import contextlib

        # Missing catalog file → exit 1 with a single stderr line.
        argv_backup = sys.argv
        try:
            sys.argv = ["render-downstream-tracker.py", str(tmpdir / "nope.yml"), "1.0", "ether/x"]
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
                rc = mod.main()
            assert rc == 1, rc
            err = stderr.getvalue()
            assert "render-downstream-tracker:" in err, err
            assert "FileNotFoundError" in err or "OSError" in err, err
        finally:
            sys.argv = argv_backup

        # Malformed YAML → exit 1 with a single stderr line.
        bad_yaml = tmpdir / "bad.yml"
        bad_yaml.write_text("downstreams: [unbalanced\n")
        try:
            sys.argv = ["render-downstream-tracker.py", str(bad_yaml), "1.0", "ether/x"]
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
                rc = mod.main()
            assert rc == 1, rc
            err = stderr.getvalue()
            assert "render-downstream-tracker:" in err, err
        finally:
            sys.argv = argv_backup

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
