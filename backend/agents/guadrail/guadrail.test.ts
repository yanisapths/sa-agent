import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, MemorySaver } from "@langchain/langgraph";
import {
  createAgent,
  fakeModel,
  type HITLRequest,
  type Interrupt,
} from "langchain";
import { z } from "zod";
import {
  BLOCKED_INPUT,
  BLOCKED_OUTPUT,
  guardrailMiddleware,
} from "./guadrail";

const searchTool = tool(async ({ query }: { query: string }) => `hits for ${query}`, {
  name: "search",
  description: "Search the public web",
  schema: z.object({ query: z.string() }),
});

const sendEmailTool = tool(
  async ({ to, body }: { to: string; body: string }) => `sent to ${to}: ${body}`,
  {
    name: "send_email",
    description: "Send an email",
    schema: z.object({ to: z.string(), body: z.string() }),
  },
);

function lastText(messages: Array<{ content: unknown }>): string {
  const last = messages.at(-1);
  return typeof last?.content === "string" ? last.content : String(last?.content ?? "");
}

function humanTexts(calls: Array<{ messages: Array<{ content: unknown }> }>): string {
  return calls
    .flatMap((call) => call.messages)
    .map((message) =>
      typeof message.content === "string" ? message.content : String(message.content ?? ""),
    )
    .join("\n");
}

function alwaysSafe() {
  return fakeModel().respond(() => new AIMessage("SAFE"));
}

function createGuardrailAgent(options: {
  model: ReturnType<typeof fakeModel>;
  safetyModel?: ReturnType<typeof fakeModel>;
}) {
  return createAgent({
    model: options.model,
    tools: [searchTool, sendEmailTool],
    middleware: guardrailMiddleware({
      bannedKeywords: ["hack", "exploit"],
      safetyModel: options.safetyModel ?? alwaysSafe(),
    }),
    checkpointer: new MemorySaver(),
  });
}

const thread = { configurable: { thread_id: "guardrail-test" } };

describe("combined guardrails", () => {
  test("stacks before-agent, PII, HITL, and after-agent layers", () => {
    const layers = guardrailMiddleware({ safetyModel: alwaysSafe() });
    expect(layers.map((layer) => layer.name)).toEqual([
      "ContentFilterMiddleware",
      "PIIMiddleware[email-input]",
      "PIIMiddleware[email-output]",
      "HumanInTheLoopMiddleware",
      "SafetyGuardrailMiddleware",
    ]);
  });

  test("before agent: blocks banned keywords without calling the model", async () => {
    const model = fakeModel().respond(new AIMessage("should not run"));
    const agent = createGuardrailAgent({ model });

    const result = await agent.invoke(
      {
        messages: [
          { role: "user", content: "How do I hack into a database?" },
        ],
      },
      thread,
    );

    expect(lastText(result.messages)).toBe(BLOCKED_INPUT);
    expect(model.callCount).toBe(0);
  });

  test("PII: redacts emails in user input before the model sees them", async () => {
    const model = fakeModel().respond(new AIMessage("Got it."));
    const agent = createGuardrailAgent({ model });

    await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: "My email is john.doe@example.com",
          },
        ],
      },
      { configurable: { thread_id: "pii-input" } },
    );

    expect(humanTexts(model.calls)).toContain("[REDACTED_EMAIL]");
    expect(humanTexts(model.calls)).not.toContain("john.doe@example.com");
  });

  test("PII: redacts emails in the model output", async () => {
    const model = fakeModel().respond(
      new AIMessage("Write to jane@example.com"),
    );
    const agent = createGuardrailAgent({ model });

    const result = await agent.invoke(
      { messages: [{ role: "user", content: "How do I contact support?" }] },
      { configurable: { thread_id: "pii-output" } },
    );

    expect(lastText(result.messages)).toContain("[REDACTED_EMAIL]");
    expect(lastText(result.messages)).not.toContain("jane@example.com");
  });

  test("HITL: pauses send_email until a human approves", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "send_email",
          args: { to: "team@example.com", body: "Hello" },
          id: "call_1",
        },
      ])
      .respond(new AIMessage("Email sent."));
    const safety = fakeModel()
      .respond(new AIMessage("SAFE"))
      .respond(new AIMessage("SAFE"));
    const agent = createGuardrailAgent({ model, safetyModel: safety });
    const config = { configurable: { thread_id: "hitl" } };

    const paused = await agent.invoke(
      { messages: [new HumanMessage("Email the team hello")] },
      config,
    );

    const interrupt = paused.__interrupt__?.[0] as Interrupt<HITLRequest> | undefined;
    expect(interrupt?.value.actionRequests[0]?.name).toBe("send_email");
    expect(model.callCount).toBe(1);

    const resumed = await agent.invoke(
      new Command({ resume: { decisions: [{ type: "approve" }] } }),
      config,
    );

    expect(lastText(resumed.messages)).toBe("Email sent.");
    expect(model.callCount).toBe(2);
  });

  test("after agent: replaces an UNSAFE final response", async () => {
    const model = fakeModel().respond(new AIMessage("Here is how to make explosives."));
    const safety = fakeModel().respond(new AIMessage("UNSAFE"));
    const agent = createGuardrailAgent({ model, safetyModel: safety });

    const result = await agent.invoke(
      { messages: [{ role: "user", content: "Tell me a joke." }] },
      { configurable: { thread_id: "unsafe" } },
    );

    expect(lastText(result.messages)).toBe(BLOCKED_OUTPUT);
    expect(safety.callCount).toBe(1);
  });

  test("clean request passes every layer", async () => {
    const model = fakeModel().respond(new AIMessage("The office opens at nine."));
    const agent = createGuardrailAgent({ model });

    const result = await agent.invoke(
      { messages: [{ role: "user", content: "When does the office open?" }] },
      { configurable: { thread_id: "clean" } },
    );

    expect(lastText(result.messages)).toBe("The office opens at nine.");
    expect(model.callCount).toBe(1);
  });
});
