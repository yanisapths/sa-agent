export interface SlashCommand {
  token: string;
  aliases: string[];
  label: string;
  description: string;
  chipLabel: string;
  /**
   * Prepended to the message so the router reads the intent as prose. Empty for
   * phase and style commands, which travel as structured fields instead.
   */
  promptPrefix: string;
  /** Drives the icon and the mutual-exclusion rule below. */
  kind: "mcp" | "phase" | "style";
  /**
   * The backend specialist to pin for this turn — one of the `owner` names in
   * `backend/agents/harness.ts`. Sent as the `phase` field on `/chat`, which
   * takes the choice away from the router.
   */
  phase?: string;
  /**
   * Reply style for this turn — sent as the `style` field on `/chat`. Style
   * chips stick across sends until dismissed.
   */
  style?: string;
}

export const CAVEMAN_COMMAND: SlashCommand = {
  token: "/caveman",
  aliases: ["/cave"],
  label: "Caveman",
  description: "Short declarative replies. No fluff. Default on; dismiss to refuse",
  chipLabel: "Caveman",
  promptPrefix: "",
  kind: "style",
  style: "caveman",
};

/**
 * Slash commands come in three kinds.
 *
 * `/jira` is an MCP command: it rewrites the message so the agent knows to read
 * a ticket. The phase commands name which specialist runs, deterministically,
 * instead of leaving it to the router. `/caveman` is the default sticky style:
 * it does not rewrite the text, starts on, and survives across sends until the
 * chip is dismissed.
 *
 * The `sa-` prefix is the feature loop; `pvt-` is the separate Production
 * Verification Test prep track. They are not phases of one another.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    token: "/jira",
    aliases: ["/mcp", "/story"],
    label: "Atlassian Jira",
    description: "Read a user story by ticket key",
    chipLabel: "Jira",
    promptPrefix: "Read user story",
    kind: "mcp",
  },
  CAVEMAN_COMMAND,
  {
    token: "/sa-discuss",
    aliases: ["/discuss"],
    label: "Discuss",
    description: "Ground the request, map fields, list gaps",
    chipLabel: "Discuss",
    promptPrefix: "",
    kind: "phase",
    phase: "discuss",
  },
  {
    token: "/sa-plan",
    aliases: ["/plan"],
    label: "Plan",
    description: "Spec, Mermaid flow, and an execute checklist",
    chipLabel: "Plan",
    promptPrefix: "",
    kind: "phase",
    phase: "plan",
  },
  {
    token: "/sa-execute",
    aliases: ["/execute"],
    label: "Execute",
    description: "Implement the approved plan",
    chipLabel: "Execute",
    promptPrefix: "",
    kind: "phase",
    phase: "execute",
  },
  {
    token: "/sa-test",
    aliases: ["/test"],
    label: "Test",
    description: "Quiz the change against discuss and plan",
    chipLabel: "Test",
    promptPrefix: "",
    kind: "phase",
    phase: "test",
  },
  {
    token: "/sa-review",
    aliases: ["/review"],
    label: "Review",
    description: "Findings and required refactors before ship",
    chipLabel: "Review",
    promptPrefix: "",
    kind: "phase",
    phase: "review",
  },
  {
    token: "/pvt-discuss",
    aliases: [],
    label: "PVT Discuss",
    description: "Inventory the test cases against the live schema",
    chipLabel: "PVT Discuss",
    promptPrefix: "",
    kind: "phase",
    phase: "pvt-discuss",
  },
  {
    token: "/pvt-plan",
    aliases: [],
    label: "PVT Plan",
    description: "Group cases into scenarios and lay out the script set",
    chipLabel: "PVT Plan",
    promptPrefix: "",
    kind: "phase",
    phase: "pvt-plan",
  },
  {
    token: "/pvt-execute",
    aliases: [],
    label: "PVT Execute",
    description: "Generate the numbered, owner-tagged SQL scripts",
    chipLabel: "PVT Execute",
    promptPrefix: "",
    kind: "phase",
    phase: "pvt-execute",
  },
];

const SLASH_TOKEN_AT_END = /(?:^|\s)\/([^\s]*)\s?$/;

export function matchSlashQuery(value: string): string | null {
  const match = value.match(SLASH_TOKEN_AT_END);
  return match ? match[1] : null;
}

export function consumeSlashToken(value: string): string {
  return value.replace(SLASH_TOKEN_AT_END, (token) =>
    token.startsWith(" ") ? " " : "",
  );
}

export function findSlashCommand(token: string): SlashCommand | undefined {
  const normalized = token.startsWith("/")
    ? token.toLowerCase()
    : `/${token.toLowerCase()}`;
  return SLASH_COMMANDS.find(
    (command) =>
      command.token === normalized || command.aliases.includes(normalized),
  );
}

export function isPhaseCommand(command: SlashCommand): boolean {
  return command.kind === "phase";
}

export function isStyleCommand(command: SlashCommand): boolean {
  return command.kind === "style";
}

/** The phase to send with the turn, or `undefined` to let the router decide. */
export function selectedPhase(
  commands: readonly SlashCommand[],
): string | undefined {
  return commands.find(isPhaseCommand)?.phase;
}

/** Sticky reply style. Caveman is on unless the chip is gone. */
export function selectedStyle(
  commands: readonly SlashCommand[],
): "caveman" | "off" {
  return commands.find(isStyleCommand)?.style === "caveman" ? "caveman" : "off";
}

/**
 * A phase replaces any phase already picked — a turn runs exactly one
 * specialist, so two phase chips could not both be honoured. Style chips
 * likewise replace each other. `/jira` is orthogonal and coexists with
 * whichever phase or style is active.
 */
export function withSlashCommand(
  commands: readonly SlashCommand[],
  next: SlashCommand,
): SlashCommand[] {
  if (commands.some((item) => item.token === next.token)) return [...commands];
  const kept = isPhaseCommand(next)
    ? commands.filter((item) => !isPhaseCommand(item))
    : isStyleCommand(next)
      ? commands.filter((item) => !isStyleCommand(item))
      : [...commands];
  return [...kept, next];
}

export function filterSlashCommands(
  query: string,
  activeTokens: readonly string[],
): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((command) => {
    if (activeTokens.includes(command.token)) return false;
    const haystack = [
      command.token,
      ...command.aliases,
      command.label,
      command.description,
      command.chipLabel,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q) || command.token.slice(1).startsWith(q);
  }).slice(0, 11);
}

export function composeSlashMessage(
  text: string,
  commands: readonly SlashCommand[],
): string {
  const trimmed = text.trim();
  if (commands.length === 0) return trimmed;

  let message = trimmed;
  for (const command of commands) {
    /** Phase and style commands travel as a field and must not touch the text. */
    if (!command.promptPrefix) continue;
    if (message.toLowerCase().includes(command.promptPrefix.toLowerCase())) {
      continue;
    }
    message = message
      ? `${command.promptPrefix} ${message}`
      : command.promptPrefix;
  }
  return message;
}
