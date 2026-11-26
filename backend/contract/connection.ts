import { z } from "zod";

export const CONNECTION_KINDS = ["postgres", "confluence", "jira", "figma"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const CONNECTION_SOURCES = ["browser", "env"] as const;
export type ConnectionSource = (typeof CONNECTION_SOURCES)[number];

export const postgresConnectionSchema = z.object({
  kind: z.literal("postgres"),
  url: z.url(),
  schema: z.string().trim().min(1).default("public"),
});

/** Token optional: some Confluence spaces are readable anonymously. */
export const confluenceConnectionSchema = z.object({
  kind: z.literal("confluence"),
  baseUrl: z.url(),
  spaceKey: z.string().trim().min(1),
  username: z.string().trim().min(1).optional(),
  token: z.string().min(1).optional(),
});

export const jiraConnectionSchema = z.object({
  kind: z.literal("jira"),
  baseUrl: z.url(),
  username: z.string().trim().min(1).optional(),
  token: z.string().min(1),
});

export const figmaConnectionSchema = z.object({
  kind: z.literal("figma"),
  token: z.string().min(1),
});

export const connectionSchema = z
  .discriminatedUnion("kind", [
    postgresConnectionSchema,
    confluenceConnectionSchema,
    jiraConnectionSchema,
    figmaConnectionSchema,
  ])
  .superRefine((conn, ctx) => {
    if (conn.kind === "confluence" && conn.username && !conn.token) {
      ctx.addIssue({ code: "custom", path: ["token"], message: "username needs a token" });
    }
  });

export type Connection = z.infer<typeof connectionSchema>;
export type PostgresConnection = z.infer<typeof postgresConnectionSchema>;
export type ConfluenceConnection = z.infer<typeof confluenceConnectionSchema>;
export type JiraConnection = z.infer<typeof jiraConnectionSchema>;
export type FigmaConnection = z.infer<typeof figmaConnectionSchema>;

export type ConnectionOf<K extends ConnectionKind> = Extract<Connection, { kind: K }>;

/** At most one connection per kind, so the array is bounded by the kind count. */
export const connectionListSchema = z
  .array(connectionSchema)
  .max(CONNECTION_KINDS.length)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const conn of list) {
      if (seen.has(conn.kind)) {
        ctx.addIssue({ code: "custom", message: `more than one ${conn.kind} connection` });
      }
      seen.add(conn.kind);
    }
  });

export const connectionSourcesSchema = z.partialRecord(
  z.enum(CONNECTION_KINDS),
  z.enum(CONNECTION_SOURCES),
);

export type ConnectionSources = z.infer<typeof connectionSourcesSchema>;
