#!/usr/bin/env python3
import csv
import json
from pathlib import Path

expected = json.loads(Path("/tests/expected.json").read_text())
candidates = [Path("/app/sales.csv"), Path("sales.csv")]
csv_path = next((path for path in candidates if path.exists()), None)

reward_dir = Path("/logs/verifier")
reward_dir.mkdir(parents=True, exist_ok=True)

if csv_path is None:
    (reward_dir / "reward.txt").write_text("0\n")
    raise SystemExit(0)

rows = list(csv.DictReader(csv_path.open()))
row = next((item for item in rows if item.get("Product") == expected["product"]), None)
if row is None:
    (reward_dir / "reward.txt").write_text("0\n")
    raise SystemExit(0)

units = float(row["Units Sold"])
price = float(row["Unit Price"])
revenue = float(row["Revenue"])
ok = units == float(expected["units"]) and abs(revenue - units * price) < 1e-6
(reward_dir / "reward.txt").write_text("1\n" if ok else "0\n")
(reward_dir / "reward.json").write_text(
    json.dumps(
        {
            "reward": 1.0 if ok else 0.0,
            "units_correct": 1.0 if units == float(expected["units"]) else 0.0,
            "revenue_correct": 1.0 if abs(revenue - units * price) < 1e-6 else 0.0,
        }
    )
)
