import "../load-env";
import { saAgent } from "../agents";

/**
 * What one turn costs before the model reads a word of the question.
 *
 * Intercepts the request on its way to the gateway and prints the system
 * prompt and tool schemas separately, because the scaffolding deepagents
 * assembles — tool descriptions especially — dwarfs anything we write.
 * Run it after touching prompts, tools, subagents, or `agents/profile.ts`.
 *
 *   bun run tokens
 *
 * Nothing reaches the gateway: the fetch is stubbed and the process exits on
 * the first request, so this is free to run.
 */

const est = (s: string) => Math.round(s.length / 4);
const realFetch = globalThis.fetch;
// @ts-ignore
globalThis.fetch = async (input: any, init: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  let sys = 0;
  for (const m of body.messages) {
    if (m.role !== "system") continue;
    const parts = Array.isArray(m.content) ? m.content : [{ text: m.content }];
    parts.forEach((p: any, i: number) => {
      sys += est(p.text ?? "");
      console.log(`  sys[${i}] ${String(est(p.text ?? "")).padStart(5)} tok  ${String(p.text ?? "").slice(0, 50).replace(/\n/g, " ")}`);
    });
  }
  let tt = 0;
  for (const t of body.tools ?? []) {
    const n = est(JSON.stringify(t));
    tt += n;
    console.log(`  tool ${(t.function?.name ?? "?").padEnd(20)} ${String(n).padStart(5)} tok`);
  }
  console.log(`\nsystem ${sys} + tools ${tt} = payload ${est(String(init?.body ?? ""))} tok (${(body.tools ?? []).length} tools)`);
  process.exit(0);
};
await saAgent.invoke({ messages: [{ role: "user", content: "hello" }] }, { configurable: { thread_id: "probe" } });
