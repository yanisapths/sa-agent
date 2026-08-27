---
name: skill-name
description: One sentence on what this skill does, followed by the triggers that should load it. The agent reads only this frontmatter at startup, so the triggers decide whether the rest of the file is ever loaded.
---

# Skill Name

What this skill is for, in one or two sentences.

## Procedure

Numbered steps, naming the tool used at each one. Ground the work in live data
before producing output.

1. `list_tables` / `describe_tables` — establish what actually exists.
2. `inspect_relationships` — establish how the entities join.
3. Produce the deliverable.
4. `run_sql` — verify any query before handing it over.

## Rules

Constraints the agent must not violate. Be specific and testable — "parameters
as `$1`, never interpolation" rather than "write safe SQL".

## Examples

A short worked example of the expected output shape.
