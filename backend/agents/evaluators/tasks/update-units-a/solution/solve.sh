#!/bin/bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path

path = Path("/app/sales.csv")
if not path.exists():
    path = Path("sales.csv")
text = path.read_text()
lines = []
for line in text.splitlines():
    if line.startswith("Widget A,"):
        lines.append("Widget A,50,5,250")
    else:
        lines.append(line)
path.write_text("\n".join(lines) + "\n")
PY
