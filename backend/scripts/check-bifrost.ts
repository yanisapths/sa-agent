import "../load-env";
import { config } from "../config";
import { gatewayHeaders, gatewayModel, gatewayUrl, isGatewayModel } from "../agents/model";

/**
 * Proves the gateway works before the agent depends on it: the same client,
 * headers, and endpoint the harness uses.
 *
 *   bun run check:bifrost
 *   bun run check:bifrost -- --models   # model ids this key can reach
 *   bun run check:bifrost -- --claude   # the surface Claude Code would use
 */

const PASS = "  ok  ";
const FAIL = " fail ";

let failed = false;

function report(ok: boolean, label: string, detail = ""): void {
  if (!ok) failed = true;
  console.log(`[${ok ? PASS : FAIL}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function mask(secret: string): string {
  if (!secret) return "(unset)";
  return secret.length <= 8
    ? "*".repeat(secret.length)
    : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function checkEnv(): boolean {
  console.log("Environment\n");
  report(config.bifrost.enabled, "BIFROST_BASE_URL", config.bifrost.baseUrl || "unset");
  report(Boolean(config.bifrost.apiKey), "BIFROST_API_KEY", mask(config.bifrost.apiKey));
  report(true, "BIFROST_AUTH_HEADER", config.bifrost.authHeader);
  report(true, "BIFROST_MAX_TOKENS", String(config.bifrost.maxTokens));
  report(
    !/^(node|undici|python-urllib)/i.test(config.bifrost.userAgent),
    "BIFROST_USER_AGENT",
    config.bifrost.userAgent,
  );

  console.log("\nPhase models\n");
  for (const [phase, id] of Object.entries(config.model)) {
    const gateway = isGatewayModel(id);
    const prefix = id.split("/")[0];
    const known = config.bifrost.providers.includes(prefix);
    report(
      !gateway || known,
      phase.padEnd(12),
      gateway
        ? known
          ? `${id} (gateway)`
          : `${id} — "${prefix}" is not routed here: ${config.bifrost.providers.join(", ")}`
        : `${id} (direct, not through the gateway)`,
    );
  }

  return !failed;
}

async function listModels(): Promise<void> {
  const url = `${gatewayUrl()}/models`;
  console.log(`\nGET ${url}\n`);

  const response = await fetch(url, { headers: gatewayHeaders() });
  if (!response.ok) {
    report(false, "list models", `${response.status} ${(await response.text()).slice(0, 200)}`);
    return;
  }

  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  const ids = (body.data ?? []).map((row) => row.id).filter(Boolean).sort();
  report(ids.length > 0, "list models", `${ids.length} reachable`);
  for (const id of ids) console.log(`         ${id}`);
}

const WEATHER_TOOL = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

async function checkChat(id: string): Promise<void> {
  console.log(`\nPOST ${gatewayUrl()}/chat/completions — ${id}\n`);

  try {
    const reply = await gatewayModel(id).invoke("Reply with the single word: ready");
    const text = reply.text.trim();
    report(text.length > 0, "chat", text ? text.slice(0, 60) : "empty content");

    const usage = reply.usage_metadata;
    if (usage) {
      const reasoning = usage.output_token_details?.reasoning ?? 0;
      report(
        true,
        "tokens",
        `in ${usage.input_tokens}, out ${usage.output_tokens}` +
          (reasoning ? ` (${reasoning} reasoning — they count against max_tokens)` : ""),
      );
    }
  } catch (error) {
    report(false, "chat", error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    const reply = await gatewayModel(id)
      .bindTools([WEATHER_TOOL])
      .invoke("What is the weather in Bangkok? Use the tool.");
    const call = reply.tool_calls?.[0];
    report(
      Boolean(call),
      "native tool calling",
      call ? `${call.name}(${JSON.stringify(call.args)})` : "model answered without tool_calls",
    );
  } catch (error) {
    report(false, "native tool calling", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Claude Code talks the Anthropic Messages API, not Chat Completions. It gets
 * its own check because both the endpoint and the auth differ: a subscription
 * login sends an OAuth bearer and ignores ANTHROPIC_API_KEY, so the virtual
 * key has to ride in its own header. Send the bogus bearer too, to prove the
 * header wins the way it does in a real session.
 */
async function checkClaudeSurface(): Promise<void> {
  const base = `${config.bifrost.baseUrl}/anthropic`;
  const model = process.env.CLAUDE_BIFROST_MODEL || "huawei_claude/glm-5.2";
  console.log(`\nPOST ${base}/v1/messages — ${model}\n`);

  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      [config.bifrost.authHeader]: config.bifrost.apiKey,
      Authorization: "Bearer sk-ant-oat01-not-a-real-subscription-token",
      "User-Agent": config.bifrost.userAgent,
    },
    body: JSON.stringify({
      model,
      max_tokens: config.bifrost.maxTokens,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    report(false, "anthropic surface", `${response.status} ${text.slice(0, 200)}`);
    return;
  }

  const body = JSON.parse(text) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
  const said = body.content?.find((part) => part.type === "text")?.text?.trim();

  report(Boolean(said), "anthropic surface", said || `no text (stop_reason: ${body.stop_reason})`);
  report(
    true,
    "key header wins",
    `${config.bifrost.authHeader} authenticated past a subscription bearer token`,
  );

  await checkClaudeTools(base, model);
  console.log(`\n  source scripts/claude-bifrost.sh   # then run claude`);
}

/**
 * The one that decides whether Claude Code is usable at all: without
 * Anthropic-shaped `tool_use` it cannot read a file, run a command, or reach
 * the sa-knowledge MCP tools. A model can hold a conversation and still fail
 * this.
 */
async function checkClaudeTools(base: string, model: string): Promise<void> {
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      [config.bifrost.authHeader]: config.bifrost.apiKey,
      "User-Agent": config.bifrost.userAgent,
    },
    body: JSON.stringify({
      model,
      max_tokens: config.bifrost.maxTokens,
      tools: [
        {
          name: WEATHER_TOOL.function.name,
          description: WEATHER_TOOL.function.description,
          input_schema: WEATHER_TOOL.function.parameters,
        },
      ],
      messages: [
        { role: "user", content: "What is the weather in Bangkok? Use the tool." },
      ],
    }),
  });

  if (!response.ok) {
    report(false, "tool use", `${response.status} ${(await response.text()).slice(0, 200)}`);
    return;
  }

  const body = (await response.json()) as {
    content?: Array<{ type?: string; name?: string; input?: unknown }>;
    stop_reason?: string;
  };
  const call = body.content?.find((part) => part.type === "tool_use");

  report(
    Boolean(call),
    "tool use",
    call
      ? `${call.name}(${JSON.stringify(call.input)})`
      : `no tool_use block (stop_reason: ${body.stop_reason})`,
  );
}

async function main(): Promise<void> {
  const wantModels = process.argv.includes("--models");
  const wantClaude = process.argv.includes("--claude");

  if (!checkEnv()) {
    console.log("\nFix the environment above first.");
    process.exit(1);
  }

  if (wantModels) {
    await listModels();
  } else if (wantClaude) {
    await checkClaudeSurface();
  } else {
    const gatewayPhases = Object.values(config.model).filter(isGatewayModel);
    const unique = [...new Set(gatewayPhases)];
    if (unique.length === 0) {
      console.log("\nNo phase uses a gateway model. Nothing to call.");
    }
    for (const id of unique) await checkChat(id);
  }

  console.log(failed ? "\nSomething is off — see the failures above." : "\nAll good.");
  process.exit(failed ? 1 : 0);
}

await main();
