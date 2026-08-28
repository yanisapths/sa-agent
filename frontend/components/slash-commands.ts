export interface SlashCommand {
  token: string;
  aliases: string[];
  label: string;
  description: string;
  chipLabel: string;
  promptPrefix: string;
}

/** MCP-backed slash commands. `/jira` reads an Atlassian user story. */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    token: "/jira",
    aliases: ["/mcp", "/story"],
    label: "Atlassian Jira",
    description: "Read a user story by ticket key",
    chipLabel: "Jira",
    promptPrefix: "Read user story",
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
  }).slice(0, 6);
}

export function composeSlashMessage(
  text: string,
  commands: readonly SlashCommand[],
): string {
  const trimmed = text.trim();
  if (commands.length === 0) return trimmed;

  let message = trimmed;
  for (const command of commands) {
    if (message.toLowerCase().includes(command.promptPrefix.toLowerCase())) {
      continue;
    }
    message = message
      ? `${command.promptPrefix} ${message}`
      : command.promptPrefix;
  }
  return message;
}
