#!/usr/bin/env python3
"""Render the downstream-bump tracking issue body from docs/downstreams.yml.

Called from .github/workflows/release-downstreams.yml. Kept as a
standalone script (rather than inline yaml-munging in the workflow) so
the format is easy to tweak without re-running CI to eyeball it — run
locally with:

    python3 .github/scripts/render-downstream-tracker.py \\
        docs/downstreams.yml 2.6.1 ether/etherpad-lite

Usage: render-downstream-tracker.py <catalog.yml> <version> <repo>
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

GROUPS: list[tuple[str, str]] = [
    ("automatic",           "🚀 Automatic (this repo handles it)"),
    ("manual_ci",           "🧩 Manual bump in this repo"),
    ("external_auto",       "🤖 Externally automated"),
    ("external_pr",         "✉️  Needs a PR we send"),
    ("external_issue",      "📨 Needs an issue we file"),
    ("external_maintainer", "🤝 Maintained externally — poke if stale"),
    ("stale",               "⚠️  Known stale — informational only"),
]


def render(catalog_path: Path, version: str, repo: str) -> str:
    with catalog_path.open() as f:
        catalog = yaml.safe_load(f)
    if not isinstance(catalog, dict):
        raise ValueError(
            f"{catalog_path}: top-level must be a mapping, "
            f"got {type(catalog).__name__}"
        )
    items = catalog.get("downstreams", [])
    if not isinstance(items, list):
        raise ValueError(
            f"{catalog_path}: `downstreams` must be a list, "
            f"got {type(items).__name__}"
        )
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(
                f"{catalog_path}: downstreams[{idx}] must be a mapping, "
                f"got {type(item).__name__}"
            )
        if "name" not in item or "update_type" not in item:
            raise ValueError(
                f"{catalog_path}: downstreams[{idx}] missing required "
                f"`name` and/or `update_type`"
            )
        # Reject typo'd update_type values up front. Without this, an entry
        # with `update_type: external-pr` (dash instead of underscore) is
        # silently dropped from the rendered checklist because render() only
        # iterates the GROUPS allowlist below.
        allowed = {g[0] for g in GROUPS}
        if item["update_type"] not in allowed:
            raise ValueError(
                f"{catalog_path}: downstreams[{idx}] ({item['name']}) "
                f"has unknown update_type {item['update_type']!r}; "
                f"expected one of {sorted(allowed)}"
            )
        if "path" in item and "file" in item:
            raise ValueError(
                f"{catalog_path}: downstreams[{idx}] ({item['name']}) "
                f"sets both `path` and `file`; use `file` for files and "
                f"`path` for directories, not both"
            )

    out: list[str] = []
    out.append(f"## Downstream distribution checklist for `{version}`\n")
    out.append(
        "Auto-opened by `.github/workflows/release-downstreams.yml` on "
        "release publish.\n"
    )
    out.append(
        f"Source of truth: [`docs/downstreams.yml`](https://github.com/"
        f"{repo}/blob/develop/docs/downstreams.yml).\n"
    )
    out.append(
        "Tick items as you verify them. Anything still unchecked a week "
        "after release is a candidate for follow-up.\n"
    )

    for update_type, heading in GROUPS:
        matches = [i for i in items if i.get("update_type") == update_type]
        if not matches:
            continue
        out.append(f"\n### {heading}\n")
        for item in matches:
            out.append(_render_item(item, repo))

    return "\n".join(out)


def _render_item(item: dict, repo: str) -> str:
    name = item["name"]
    target_repo = item.get("repo")
    # `file:` deep-links to a single file (GitHub /blob/...).
    # `path:` deep-links to a directory (GitHub /tree/...).
    # `/blob/<dir>` and `/tree/<file>` both 404 on GitHub, so the two
    # must be distinguished. The renderer trusts the YAML key — see
    # render() for the both-set guard.
    file_path = item.get("file")
    dir_path = item.get("path")
    workflow = item.get("workflow")
    notes = item.get("notes", "").strip()

    # Primary link: deep-link to the file/dir if we know one, otherwise
    # to the repo root. `HEAD` avoids pinning to a stale default-branch
    # name (`main` vs `master` vs `develop`).
    link = ""
    if target_repo:
        base = f"https://github.com/{target_repo}"
        if file_path:
            link = f" — [`{target_repo}/{file_path}`]({base}/blob/HEAD/{file_path})"
        elif dir_path:
            link = f" — [`{target_repo}/{dir_path}`]({base}/tree/HEAD/{dir_path})"
        else:
            link = f" — [`{target_repo}`]({base})"
    if workflow:
        workflow_url = f"https://github.com/{repo}/blob/develop/{workflow}"
        link += f" · [workflow]({workflow_url})"

    lines = [f"- [ ] **{name}**{link}"]
    if notes:
        # Indent notes under the checkbox so GitHub renders them as part
        # of the list item rather than a sibling paragraph.
        for note_line in notes.splitlines():
            lines.append(f"      {note_line}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    catalog_path = Path(sys.argv[1])
    version = sys.argv[2]
    repo = sys.argv[3]
    try:
        body = render(catalog_path, version, repo)
    except (ValueError, OSError, yaml.YAMLError) as e:
        # Surface validation, IO, and YAML parse errors as a clean CI
        # failure with a single actionable line, instead of a Python
        # traceback. A missing/unreadable catalog or syntactically broken
        # YAML is a bad-input case, not a bug in this script.
        print(f"render-downstream-tracker: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
