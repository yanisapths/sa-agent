High

1. Isolation unit test is broken after the fixture move

evaluator.test.ts still copies evaluators/fixtures as the sandbox root and expects sales.csv at that root. The CSV now lives at fixtures/coding/units/workspace/sales.csv. I ran the tests: sandboxes A and B update units in isolation fails with [0, 0] instead of [1, 1]. createUnitsAgent then reads a missing file, so this no longer proves trials do not contaminate each other.

2. Auth hidden tests can be gamed with stdout JSON

verify.ts treats the child’s entire stdout as JSON.parse and only then checks authenticate fields. probe-auth.ts imports agent code first. A workspace src/auth.ts that prints the expected object and exits 0 never has to implement authenticate:

process.stdout.write(
JSON.stringify({
empty: false,
null: false,
missing: false,
wrong: false,
correct: true,
}),
);
process.exit(0);
The new cheat test only covers console.log("ok"); process.exit(0), which fails JSON parse. A forged payload would pass deterministic_tests. Emit JSON from the probe on a dedicated fd, or take the last JSON line after the import returns.

Medium 3. json_contract only scores the last message

jsonContractEvaluator uses outputs.text ?? lastAiText(...), and lastAiText is messages.at(-1) of any role, not the last AI artifact. For explain-schema-empathy_1, turn 1 can be non-JSON as long as turn 2 is. Same hole if a tool or other trailing message is last. Conversational YAML still relies on this grader as if the whole reply stream were a chat artifact.

4. “Grounded in tools” is not enforced in code

invoices-table_1 and no-web-search_1 have no required_tools. The invoices harness test passes a JSON reply with no tool calls and a scripted judge of 1. Live runs depend on the LLM judge not rubber-stamping invented “invoices”. If that assertion matters, add required_tools (and keep the judge for quality).

5. lastAiText name vs behavior

outputsOf always sets text from lastAiText. Coding summaries are fine; chat JSON is not if the last message is not the artifact. Walk backward for the last AI message without tool_calls.

Low 6. Probe stdout is brittle for a real fix that logs

Any console.log in auth.ts at import time prefixes stdout and makes JSON.parse fail, scoring a correct patch as fail.

7. Leftover Harbor / LangSmith surface

eval:harbor is gone, but harborReward, writeHarborRewardTxt, and withLangSmithSandbox remain. The remote sandbox still concatenates `${root}/${rel}` with no jail, and ls/grep are stubs. Harmless if unused; easy to mistake for a supported path.
