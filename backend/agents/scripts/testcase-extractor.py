#!/usr/bin/env python3
"""Normalise a PVT case-list CSV into one JSON object per case.

Used by pvt-discuss: pass the file the user named (or the parked
/artifacts/pvt-cases.csv). Keeps source ids so later scripts match the sheet.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

DEVICES = frozenset({"Desktop", "Mobile or Tablet"})

# Spreadsheet section titles seen so far. Any other row whose first cell is
# the only populated cell is treated as a section header as well.
KNOWN_SECTIONS = frozenset(
    {
        "Aster Notification (Achievement)",
        "Aster Notification Setting (Achievement)",
        "Profile Page (Support Achievement)",
        "Revamp - Achievements Page",
    }
)

TEST_ID_PREFIX = "PVT_"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract PVT test cases from a CSV case list.",
    )
    parser.add_argument(
        "csv_file",
        type=Path,
        help="Path to the case-list CSV the user supplied",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Write JSON here. Default: <csv-stem>.json next to the CSV. Use - for stdout.",
    )
    return parser.parse_args()


def is_blank_row(row: list[str]) -> bool:
    return not row or all(not cell.strip() for cell in row)


def is_section_row(row: list[str]) -> bool:
    first = row[0].strip() if row else ""
    if not first or first in DEVICES:
        return False
    rest_empty = all(not cell.strip() for cell in row[1:])
    return first in KNOWN_SECTIONS or rest_empty


def cell(row: list[str], index: int) -> str:
    if len(row) <= index:
        return ""
    return row[index].strip()


def precondition_from_steps(test_steps: str) -> str:
    if not test_steps:
        return ""
    lines = test_steps.split("\n")
    precondition_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("0."):
            precondition_lines.append(stripped)
        elif stripped.startswith("1."):
            break
    return " ".join(precondition_lines)


def timing_from_text(combined: str) -> tuple[bool, list[str]]:
    timing_sensitive = False
    timing_conditions: list[str] = []

    if "start_date" in combined or "start" in combined:
        timing_sensitive = True
        if (
            "<= now" in combined
            or "now or earlier" in combined
            or "starts immediately" in combined
        ):
            timing_conditions.append("started_date_at <= now()")
        if "future" in combined:
            timing_conditions.append("start_date in future")

    if "7 days" in combined or "expir" in combined:
        timing_sensitive = True
        if "less than 7 days" in combined:
            timing_conditions.append("< 7 days remaining")

    if "daily" in combined and "10:00" in combined:
        timing_sensitive = True
        timing_conditions.append("daily 10:00 AM job trigger")

    return timing_sensitive, timing_conditions


def data_from_text(combined: str) -> list[str]:
    precondition_data: list[str] = []

    if "admin" in combined and "create" in combined:
        precondition_data.append("Achievement exists in database")

    if "display on" in combined:
        precondition_data.append("display=true")

    if "display off" in combined:
        precondition_data.append("display=false")

    if "toggle" in combined:
        precondition_data.append("Admin performs toggle action")

    if "target group" in combined:
        precondition_data.append("Target group defined/modified")
        if "all users" in combined:
            precondition_data.append("target_group_mode='all_users'")
        if "individual" in combined:
            precondition_data.append("target_group_mode='individual'")

    if "notification" in combined and "previous" in combined:
        precondition_data.append("User previously received achievement notification")

    if "claimable" in combined or "whitelist" in combined or "approved" in combined:
        precondition_data.append("User approval/whitelist status required")

    return precondition_data


def extract_cases(csv_file: Path) -> list[dict]:
    cases: list[dict] = []
    current_section: str | None = None
    current_device: str | None = None

    with csv_file.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if is_blank_row(row):
                continue

            if is_section_row(row):
                current_section = row[0].strip()
                continue

            if row[0].strip() in DEVICES:
                current_device = row[0].strip()
                continue

            if not current_section or not current_device:
                continue

            test_id = cell(row, 1)
            if not test_id.startswith(TEST_ID_PREFIX):
                continue

            summary = cell(row, 2)
            test_steps = cell(row, 3)
            expected_result = cell(row, 4)
            pos_neg = cell(row, 5)
            priority = cell(row, 12)

            combined = f"{summary} {test_steps} {expected_result}".lower()
            timing_sensitive, timing_conditions = timing_from_text(combined)
            precondition_data = data_from_text(combined)

            cases.append(
                {
                    "test_id": test_id,
                    "section": current_section,
                    "device": current_device,
                    "summary": summary[:200],
                    "steps": test_steps,
                    "expected_result": expected_result,
                    "positive_negative": pos_neg,
                    "priority": priority if priority else "Not specified",
                    "precondition_text": precondition_from_steps(test_steps)[:300],
                    "precondition_data": sorted(set(precondition_data)),
                    "timing_sensitive": timing_sensitive,
                    "timing_conditions": sorted(set(timing_conditions)),
                }
            )

    return cases


def resolve_output(csv_file: Path, output: Path | None) -> Path | None:
    if output is None:
        return csv_file.with_suffix(".json")
    if str(output) == "-":
        return None
    return output


def main() -> int:
    args = parse_args()
    csv_file: Path = args.csv_file

    if not csv_file.is_file():
        print(f"error: CSV not found: {csv_file}", file=sys.stderr)
        return 1

    cases = extract_cases(csv_file)
    payload = json.dumps(cases, indent=2, ensure_ascii=False)

    destination = resolve_output(csv_file, args.output)
    if destination is None:
        print(payload)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(payload + "\n", encoding="utf-8")
        print(f"Extracted {len(cases)} test cases")
        print(f"Output written to: {destination}")

    by_section: dict[str, int] = defaultdict(int)
    for case in cases:
        by_section[case["section"]] += 1

    print("\nSummary by section:", file=sys.stderr)
    for section, count in sorted(by_section.items()):
        print(f"  {section}: {count} cases", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
