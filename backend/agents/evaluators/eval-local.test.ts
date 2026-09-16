import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "langchain";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildChatAgent, chatSystemPrompt, CHAT_TOOLS } from "../chat-agent";
import { chatFixtureTools } from "./chat-fixtures";
import { createCodingEvalAgent } from "./coding-agent";
import { runEvalTask } from "./eval-harness";
import {
  deterministicTestsEvaluator,
  harborReward,
  jsonContractEvaluator,
  judgeActual,
  lastAiText,
  maxTurnsEvaluator,
  runEvaluators,
  toolNamesFromMessages,
  unitsUpdatedEvaluator,
  unitsUpdatedWorkspaceEvaluator,
} from "./evaluator";
import { withIsolatedSandbox } from "./sandbox";
import { FIXTURES_ROOT, loadEvalTasks } from "./task";

function scriptedChat(model: ReturnType<typeof fakeModel>) {
  return buildChatAgent({
    model,
    tools: chatFixtureTools(),
    session: false,
  });
}

describe("local eval wiring", () => {
  test("loads conversational and coding YAML tasks", async () => {
    const tasks = await loadEvalTasks();
    const ids = tasks.map((task) => task.id).sort();
    expect(ids).toEqual([
      "explain-schema-empathy_1",
      "fix-auth-bypass_1",
      "greeting_1",
      "invent-endpoint_1",
      "invoices-table_1",
      "jira-ticket_1",
      "no-web-search_1",
      "update-units_1",
    ]);
    expect(chatSystemPrompt()).toContain("Keep replies short");
    expect(chatFixtureTools().map((tool) => tool.name)).toEqual([...CHAT_TOOLS]);
  });

  test("chatAgent builder: greeting stays JSON and skips tools", async () => {
    const model = fakeModel()
      .respond(
        new AIMessage('{"type":"text","text":"You are welcome."}'),
      )
      .respond(() => new AIMessage("SAFE"));
    const agent = scriptedChat(model);
    const result = await agent.invoke({
      messages: [{ role: "user", content: "thanks" }],
    });
    const outputs = {
      messages: result.messages,
      text: lastAiText(result.messages),
    };
    const scores = await runEvaluators(
      [
        jsonContractEvaluator,
        maxTurnsEvaluator(2),
      ],
      { outputs },
    );
    expect(toolNamesFromMessages(result.messages)).toEqual([]);
    expect(harborReward(scores)).toBe(1);
  });

  test("chat fixtures: search_docs returns the invoices table", async () => {
    const search = chatFixtureTools().find((item) => item.name === "search_docs");
    const page = chatFixtureTools().find((item) => item.name === "get_doc_page");
    if (!search || !page) throw new Error("missing fixtures");
    const hits = String(await search.invoke({ query: "billing" }));
    expect(hits).toContain("invoices");
    const body = String(
      await page.invoke({ paths: ["billing/overview"] }),
    );
    expect(body).toContain("GET /invoices");
    expect(body).toContain("no POST /orders/v2/export");
  });

  test("eval harness runs greeting_1 with a scripted model", async () => {
    const [task] = await loadEvalTasks({ taskId: "greeting_1" });
    const model = fakeModel()
      .respond(new AIMessage('{"type":"text","text":"You are welcome."}'))
      .respond(() => new AIMessage("SAFE"));
    const result = await runEvalTask(task, { model });
    expect(result.passed).toBe(true);
    expect(result.tools).toEqual([]);
  });

  test("hidden auth tests fail on the bug and pass on the reference solution", async () => {
    const fixture = path.join(FIXTURES_ROOT, "coding/auth-bypass");
    const broken = await deterministicTestsEvaluator({
      command: "bun tests/verify.ts",
      cwd: fixture,
      env: { EVAL_WORKSPACE: path.join(fixture, "workspace") },
    })({ outputs: {} });
    expect(broken.score).toBe(false);

    const root = await mkdtemp(path.join(tmpdir(), "sa-eval-auth-sol-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src/auth.ts"),
        await readFile(path.join(fixture, "solution/auth.ts"), "utf8"),
      );
      const fixed = await deterministicTestsEvaluator({
        command: "bun tests/verify.ts",
        cwd: fixture,
        env: { EVAL_WORKSPACE: root },
      })({ outputs: {} });
      expect(fixed.score).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("slim coder can patch auth via workspace_write", async () => {
    const fixtureDir = path.join(FIXTURES_ROOT, "coding/auth-bypass/workspace");
    const solution = await readFile(
      path.join(FIXTURES_ROOT, "coding/auth-bypass/solution/auth.ts"),
      "utf8",
    );
    const reward = await withIsolatedSandbox(
      { name: "auth", fixtureDir },
      async (sandbox) => {
        const model = fakeModel()
          .respondWithTools([
            {
              name: "workspace_write",
              args: { path: "src/auth.ts", content: solution },
              id: "call_w",
            },
          ])
          .respond(new AIMessage("Patched src/auth.ts to reject empty passwords."));
        const agent = createCodingEvalAgent(model, sandbox);
        const result = await agent.invoke({
          messages: [
            {
              role: "user",
              content: "Fix the empty password bypass in src/auth.ts",
            },
          ],
        });
        expect(toolNamesFromMessages(result.messages)).toContain(
          "workspace_write",
        );
        const patched = await sandbox.readText("src/auth.ts");
        expect(patched).toContain("return false");
        const verify = await deterministicTestsEvaluator({
          command: "bun tests/verify.ts",
          cwd: path.join(FIXTURES_ROOT, "coding/auth-bypass"),
          env: { EVAL_WORKSPACE: sandbox.root },
        })({ outputs: {} });
        return verify;
      },
    );
    expect(reward.score).toBe(true);
  });

  test("units fixture solution matches the units grader", async () => {
    const csv = await readFile(
      path.join(FIXTURES_ROOT, "coding/units/solution/sales.csv"),
      "utf8",
    );
    expect(
      unitsUpdatedEvaluator({ csv, product: "Widget A", units: 50 }).score,
    ).toBe(true);
  });

  test("eval harness runs invoices-table_1 with a scripted judge", async () => {
    const [task] = await loadEvalTasks({ taskId: "invoices-table_1" });
    const model = fakeModel()
      .respond(
        new AIMessage(
          '{"type":"text","text":"Billing records live in the invoices table."}',
        ),
      )
      .respond(() => new AIMessage("SAFE"));
    const judge = fakeModel()
      .respond(new AIMessage("1 names invoices"))
      .respond(new AIMessage("1 grounded in tools"));
    const result = await runEvalTask(task, { model, judge });
    expect(result.passed).toBe(true);
    expect(result.transcript).toContain("invoices");
  });

  test("coding rubric actual includes a workspace diff hunk", async () => {
    const fixtureDir = path.join(FIXTURES_ROOT, "coding/auth-bypass/workspace");
    const solution = await readFile(
      path.join(FIXTURES_ROOT, "coding/auth-bypass/solution/auth.ts"),
      "utf8",
    );
    await withIsolatedSandbox({ name: "diff", fixtureDir }, async (sandbox) => {
      await sandbox.writeText("src/auth.ts", solution);
      const actual = judgeActual({
        messages: [
          {
            type: "ai",
            content: "",
            tool_calls: [
              {
                name: "workspace_write",
                args: { path: "src/auth.ts", content: solution },
              },
            ],
          },
        ],
        workspace: sandbox.root,
        fixtureDir,
      });
      expect(actual).toContain("WORKSPACE DIFF:");
      expect(actual).toContain("-  if (!user.password) return true;");
      expect(actual).toContain("return false");
      expect(actual).toContain('workspace_write({"path":"src/auth.ts"');
    });
  });

  test("slim coder grep and ls walk the fixture tree", async () => {
    const fixtureDir = path.join(FIXTURES_ROOT, "coding/auth-bypass/workspace");
    await withIsolatedSandbox({ name: "grep", fixtureDir }, async (sandbox) => {
      const listed = await sandbox.ls(".", 2);
      expect(listed).toContain("src/auth.ts");
      const hits = await sandbox.grep("authenticate", ".");
      expect(hits).toContain("src/auth.ts");
      expect(hits).toContain("authenticate");

      const model = fakeModel()
        .respondWithTools([
          { name: "workspace_ls", args: { path: ".", depth: 2 }, id: "ls" },
        ])
        .respondWithTools([
          {
            name: "workspace_grep",
            args: { pattern: "authenticate", path: "." },
            id: "grep",
          },
        ])
        .respond(new AIMessage("Found src/auth.ts"));
      const agent = createCodingEvalAgent(model, sandbox);
      const result = await agent.invoke({
        messages: [{ role: "user", content: "Find authenticate" }],
      });
      const names = toolNamesFromMessages(result.messages);
      expect(names).toContain("workspace_ls");
      expect(names).toContain("workspace_grep");
    });
  });

  test("sandbox rejects path traversal", async () => {
    await withIsolatedSandbox({ name: "jail" }, async (sandbox) => {
      const marker = `sa-eval-escape-${Date.now()}.txt`;
      const outside = path.join(sandbox.root, "..", marker);
      const written = await sandbox.writeText(`../${marker}`, "pwned");
      expect(written).toMatch(/escape|outside|project/i);
      expect(existsSync(outside)).toBe(false);
      const read = await sandbox.readText("../package.json");
      expect(read).toMatch(/escape|outside|project/i);
    });
  });

  test("import-time process.exit cannot pass hidden auth tests", async () => {
    const fixture = path.join(FIXTURES_ROOT, "coding/auth-bypass");
    const root = await mkdtemp(path.join(tmpdir(), "sa-eval-auth-cheat-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src/auth.ts"),
        `console.log("ok");\nprocess.exit(0);\nexport function authenticate() { return true }\n`,
      );
      const cheated = await deterministicTestsEvaluator({
        command: "bun tests/verify.ts",
        cwd: fixture,
        env: { EVAL_WORKSPACE: root },
      })({ outputs: {} });
      expect(cheated.score).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval harness runs explain-schema-empathy_1 across two turns", async () => {
    const [task] = await loadEvalTasks({ taskId: "explain-schema-empathy_1" });
    const json = '{"type":"text","text":"The invoices table holds billing."}';
    const model = fakeModel()
      .respond(new AIMessage(json))
      .respond(() => new AIMessage("SAFE"))
      .respond(new AIMessage(json))
      .respond(() => new AIMessage("SAFE"));
    const judge = fakeModel()
      .respond(new AIMessage("1 empathy"))
      .respond(new AIMessage("1 resolution"))
      .respond(new AIMessage("1 grounded"));
    const result = await runEvalTask(task, { model, judge });
    expect(result.passed).toBe(true);
    expect(result.metrics.n_turns).toBe(2);
  });

  test("eval harness grades update-units_1 after workspace_write", async () => {
    const [task] = await loadEvalTasks({ taskId: "update-units_1" });
    const csv = await readFile(
      path.join(FIXTURES_ROOT, "coding/units/solution/sales.csv"),
      "utf8",
    );
    const model = fakeModel()
      .respondWithTools([
        {
          name: "workspace_write",
          args: { path: "sales.csv", content: csv },
          id: "call_u",
        },
      ])
      .respond(new AIMessage("Updated Widget A units."));
    const result = await runEvalTask(task, { model });
    expect(result.passed).toBe(true);
  });

  test("units_updated scores false when the csv is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sa-eval-units-missing-"));
    try {
      const result = await unitsUpdatedWorkspaceEvaluator({
        product: "Widget A",
        units: 50,
      })({ outputs: { workspace: root } });
      expect(result.score).toBe(false);
      expect(result.comment).toMatch(/missing|not found/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
