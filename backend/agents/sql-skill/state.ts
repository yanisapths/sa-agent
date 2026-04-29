import { StateSchema } from "@langchain/langgraph";
import { context, createMiddleware, tool, type ToolRuntime } from "langchain";
import { z } from "zod";

const SkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  content: z.string(),
});

export type Skill = z.infer<typeof SkillSchema>;

export const SKILLS: Skill[] = [
  {
    name: "trait_assessment_schema",
    description:
      "Database schema and business logic for the trait assessment system including questions, choices, trait definitions, and compatibility.",
    content: `
# Trait Assessment Schema

## Tables

### trait_question
- id (PRIMARY KEY, SERIAL)
- question VARCHAR(500)
- answer_type VARCHAR(10) CHECK IN ('choice', 'rating')

### trait_choice
- id (PRIMARY KEY, SERIAL)
- trait_question_id (FOREIGN KEY -> trait_question)
- choice VARCHAR(255)  -- NULL for rating-type questions
- score INT            -- 1 or 2 for choice-type; 1–5 for rating-type

### trait_info
- id (PRIMARY KEY, SERIAL)
- name VARCHAR(255)
- image VARCHAR(255)
- definition VARCHAR(255)
- description VARCHAR(500)
- primary_color VARCHAR(255)
- secondary_color VARCHAR(255)
- trait_compatible_info JSONB  -- e.g. [{"trait_id": 2, "compatibility_percent": 80}]

## Business Logic

**Question types**:
- \`choice\`: A/B questions (q1–q10). Each has exactly 2 choices with text, score = 1 or 2.
- \`rating\`: Likert scale questions (q11–q24). Each has 5 choices with choice = NULL, score = 1–5.

**Total questions**: 24 (10 choice + 14 rating)

**trait_compatible_info JSONB structure**:
Each trait_info row stores an array of compatible traits:
\`[{"trait_id": 4, "compatibility_percent": 80}, ...]\`
To query compatible traits, use \`jsonb_array_elements\` or join via application layer.

**10 personality traits (id → name)**:
1 = Commander, 2 = Cipher, 3 = Inventor, 4 = Guardian, 5 = Pulse,
6 = Pathfinder, 7 = Shifter, 8 = Engineer, 9 = Medic, 10 = Striker

## Example Queries

-- List all questions with their answer type and choices
SELECT
    tq.id        AS question_id,
    tq.question,
    tq.answer_type,
    tc.id        AS choice_id,
    tc.choice,
    tc.score
FROM trait_question tq
JOIN trait_choice tc ON tc.trait_question_id = tq.id
ORDER BY tq.id, tc.score;

-- Get all traits with their compatible trait names (unnested)
SELECT
    ti.id,
    ti.name,
    (compat->>'trait_id')::int            AS compatible_trait_id,
    tc_info.name                           AS compatible_trait_name,
    (compat->>'compatibility_percent')::int AS compatibility_percent
FROM trait_info ti,
     jsonb_array_elements(ti.trait_compatible_info) AS compat
JOIN trait_info tc_info ON tc_info.id = (compat->>'trait_id')::int
ORDER BY ti.id, compatibility_percent DESC;
    `,
  },
  {
    name: "trait_user_progress",
    description:
      "Database schema and business logic for tracking employee trait assessment progress, answers, and results.",
    content: `
# Trait User Progress Schema

## Tables

### trait_user_answer_log
- id (PRIMARY KEY, SERIAL)
- emp_id VARCHAR(100)
- trait_choice_id (FOREIGN KEY -> trait_choice)
- created_at TIMESTAMPTZ DEFAULT NOW()
- updated_at TIMESTAMPTZ DEFAULT NOW()

**Note**: This table is a temporary log. Rows are hard-deleted after the trait
result is calculated. Its presence indicates the employee is InProgress.

### trait_user_result
- id (PRIMARY KEY, SERIAL)
- emp_id VARCHAR(100)
- trait_id (FOREIGN KEY -> trait_info)
- created_at TIMESTAMPTZ DEFAULT NOW()

**Note**: One employee can have multiple rows (one per assessment attempt).
The latest row by created_at is the current active result.

## Indexes
- idx_answer_log_emp   ON trait_user_answer_log(emp_id)
- idx_answer_log_choice ON trait_user_answer_log(trait_choice_id)
- idx_user_result_emp  ON trait_user_result(emp_id)
- idx_user_result_trait ON trait_user_result(trait_id)

## Business Logic

**User status derivation** (priority order):
1. \`InProgress\`: emp_id has rows in trait_user_answer_log
2. \`Played\`    : emp_id has rows in trait_user_result (and no answer log)
3. \`NotStart\`  : emp_id has no rows in either table

**Latest result**: ORDER BY created_at DESC LIMIT 1 on trait_user_result.

**Assessment progress**:
Total questions = 24. Progress = COUNT of rows in trait_user_answer_log for emp_id.

**Answer log choice_id mapping** (seed data reference):
- choice IDs 1–20 belong to A/B questions (q1–q10, 2 choices each)
- choice IDs 21–90 belong to rating questions (q11–q24, 5 choices each)
  e.g. q11 choices: ids 21–25 (scores 1–5)

## Example Queries

-- Get current status for an employee
SELECT
    CASE
        WHEN log_count > 0 THEN 'InProgress'
        WHEN result_count > 0 THEN 'Played'
        ELSE 'NotStart'
    END AS status
FROM (
    SELECT
        (SELECT COUNT(1) FROM trait_user_answer_log WHERE emp_id = $1) AS log_count,
        (SELECT COUNT(1) FROM trait_user_result       WHERE emp_id = $1) AS result_count
) s;

-- Get latest trait result with full trait info for an employee
SELECT
    tur.id,
    tur.emp_id,
    ti.name         AS trait_name,
    ti.definition,
    ti.description,
    ti.primary_color,
    ti.secondary_color,
    ti.image,
    ti.trait_compatible_info,
    tur.created_at
FROM trait_user_result tur
JOIN trait_info ti ON ti.id = tur.trait_id
WHERE tur.emp_id = $1
ORDER BY tur.created_at DESC
LIMIT 1;

-- Count answered questions vs total (progress indicator)
SELECT
    COUNT(tual.id)                        AS answered,
    (SELECT COUNT(1) FROM trait_question) AS total
FROM trait_user_answer_log tual
WHERE tual.emp_id = $1;

-- Get all answer logs for an employee with question and score detail
SELECT
    tual.id,
    tq.question,
    tq.answer_type,
    tc.choice,
    tc.score,
    tual.created_at
FROM trait_user_answer_log tual
JOIN trait_choice  tc ON tc.id = tual.trait_choice_id
JOIN trait_question tq ON tq.id = tc.trait_question_id
WHERE tual.emp_id = $1
ORDER BY tq.id;
    `,
  },
];
