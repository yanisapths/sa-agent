---
name: pvt-prep
description: Prepare a Production Verification Test — turn test cases (CSV, table, or Jira) into grouped scenarios and a numbered, owner-tagged SQL script set for PRD. Use when the user asks about PVT, production verification, a PVT window, data prep for PRD, or SRE-run database scripts.
---

# PVT Prep

A PVT runs in a short window on the production database, and every statement
there is run by someone else. The deliverable is therefore not a test plan —
it is a **script set another person can execute in order without asking you
anything**.

Two constraints drive every decision:

1. **Window time is the scarce resource.** Data that could have been staged
   before the window must not be created inside it.
2. **Every SRE round trip costs the window.** Batch what SRE runs; hand them
   the fewest scripts that still keep the phases separable.

## Procedure

1. **Intake the cases.** Read the source the user names — CSV, markdown table,
   or a Jira story. Do not restate cases you cannot find; list them as gaps.
2. **Ground them.** `describe_tables` and `inspect_relationships` on every
   table a case touches. A case whose column does not exist is a finding, not
   a script.
3. **Check the blast radius.** `simulate_impact` on each table or column the
   scripts will write. PRD writes that reach an endpoint or job nobody
   expected are the ones that hurt.
4. **Group.** Collapse the cases into the smallest set of scenarios that can
   share one data setup (see below).
5. **Sequence.** Assign each scenario to a script in the numbered set, with an
   owner suffix.
6. **Verify.** Prove every `SELECT` you hand over with `run_sql`. Never run a
   write from this skill — the scripts are artifacts, not actions.

## Test case intake

Accept a CSV or table with at least: case id, scenario, precondition data,
steps, expected result. Map anything else onto those five. When a column is
missing, say which cases are unusable without it.

Normalise to one row per case and keep the source id — the SRE-facing scripts
and the result log are read side by side, so the ids must match.

## Grouping

Cases group when they share the same precondition rows and do not mutate what
another case in the group asserts.

- Same table, same fixture, read-only assertions → one group, one setup.
- Two cases that write the same row → different groups, or a patch script per
  case (`-pvt-01`, `-pvt-02`).
- A case needing a state transition (`pending → approved`) is its own patch
  step; do not fold it into the shared seed.
- Order groups so the destructive ones run last.

State for each group: which cases it covers, the rows it needs, and which
script provides them.

## Script set

Numbered, strictly ascending in run order, owner named in the filename:

| Script | Owner | Purpose |
| --- | --- | --- |
| `01-setup-db_devops.sql` | devops | DDL: tables, columns, indexes, grants |
| `02-seed-db_sre.sql` | sre | reference and master data every group needs |
| `03-patch-data_sre.sql` | sre | shared precondition patch for all groups |
| `04-patch-data-pvt-01_sre.sql` | sre | precondition for PVT group 01 |
| `05-patch-data-pvt-02_sre.sql` | sre | precondition for PVT group 02 |
| `06-clear-data-pvt_sre.sql` | sre | remove PVT-created data after the window |
| `08-rollback_devops_(optional).sql` | devops | undo `01` — run only on abort |
| `09-rollback_sre_(optional).sql` | sre | undo `02`–`05` — run only on abort |

- `NN-<action>[-pvt-NN]_<owner>.sql`. Numbers are unique and never reused;
  gaps are fine and leave room to insert a step late.
- `_(optional)` marks a script that runs only if the test fails or aborts.
- One owner per script. Do not mix DDL and data in the same file — they are run
  by different people, often at different times.
- Add one `-pvt-NN` patch script per group only when the groups conflict. Two
  scripts that could have been one cost an SRE round trip.

## Script rules

- Every script opens with a header comment: what it does, who runs it, when,
  which cases depend on it, and its matching rollback script.
- Idempotent: `ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`, `IF NOT EXISTS`.
  Assume it will be run twice.
- Wrap data scripts in `BEGIN; … COMMIT;` and state the isolation level when it
  matters.
- Every `UPDATE` and `DELETE` carries a key-scoped `WHERE`. An unqualified one
  in a PRD script is a critical finding.
- End each script with a verification `SELECT` that prints affected row counts,
  so the operator knows it worked without asking you.
- Parameters as literals, not `$1` — these run in `psql`, not a driver. Keep
  the literals in a single `WITH` or variable block at the top of the file.
- Never `SELECT *` from a production table into a log. Name the columns.
- No PII in comments, filenames, or verification output.

## Rollback

Rollback is written at the same time as the script it undoes, not after the
window opens. State what it cannot restore — a row that existed before `02` and
was updated by `03` needs its prior value captured in `03`, or the rollback is
a lie.
