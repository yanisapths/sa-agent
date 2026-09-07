#!/usr/bin/env python3
"""Write generated files into an output directory.

JSON on stdin:
  { "files": [{ "name": "export.sql", "content": "...", "mimeType": "..." }] }

Argv: output directory. Prints a manifest on stdout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: write_files.py <output_dir>", file=sys.stderr)
        return 2

    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as err:
        print(f"invalid JSON on stdin: {err}", file=sys.stderr)
        return 1

    files = payload.get("files") if isinstance(payload, dict) else None
    if not isinstance(files, list):
        print("payload.files must be an array", file=sys.stderr)
        return 1

    written: list[dict[str, object]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        raw_name = str(item.get("name") or "")
        name = Path(raw_name).name
        if not name or name in {".", ".."}:
            continue
        dest = out / name
        content = item.get("content")
        text = "" if content is None else str(content)
        dest.write_text(text, encoding="utf-8")
        written.append(
            {
                "name": name,
                "path": str(dest),
                "size": dest.stat().st_size,
                "mimeType": str(item.get("mimeType") or ""),
            }
        )

    json.dump({"ok": True, "files": written}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
