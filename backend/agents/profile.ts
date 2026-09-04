import { registerHarnessProfile } from "deepagents";

/**
 * What the harness sends before it sends anything of ours.
 *
 * `createDeepAgent` assembles its own middleware stack — a to-do list, a
 * filesystem, a subagent spawner — and every one of those puts a tool schema
 * and a prompt section on the wire on every turn. Measured on the orchestrator,
 * that scaffolding was ~7k of an ~11.5k request for a one-word question.
 *
 * A harness profile is the supported way to trim it: `createDeepAgent` resolves
 * one per model and applies its exclusions after all tool-injecting middleware
 * have run.
 *
 * Scope: `resolveModel` hands back a `ChatOpenAI` for every `provider/model`
 * gateway id, and the profile lookup keys an instance by its class, so the
 * `openai` key is exactly "everything routed through Bifrost". Direct
 * `provider:model` ids resolve by their own spec and keep their built-in
 * profile — including the prompt tuning registered for the Anthropic models —
 * so the local fallback is untouched and still pays for the scaffolding below.
 */
const GATEWAY_PROFILE_KEY = "openai";

let registered = false;

export function registerGatewayHarness(): void {
  if (registered) return;
  registered = true;

  registerHarnessProfile(GATEWAY_PROFILE_KEY, {
    /**
     * The to-do list is 3k of schema and prompt for a loop that already has
     * one: phases are the plan, and every phase ends at a human gate. Dropping
     * the middleware takes the `write_todos` tool and its prompt section
     * together — excluding the tool alone would leave the prompt telling the
     * model to call something that is no longer there.
     */
    excludedMiddleware: ["todoListMiddleware"],
    /**
     * The orchestrator reads and writes named artifact paths. It never searches
     * for them. Exclusions apply to the main agent only, so specialists — the
     * coder especially — keep `glob` and `grep`.
     */
    excludedTools: ["glob", "grep"],
    /**
     * Routing is the whole job here: an unlabelled catch-all subagent is a way
     * to skip a phase, and it would inherit the orchestrator's tools to do it.
     */
    generalPurposeSubagent: { enabled: false },
  });
}
