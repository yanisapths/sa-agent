import { z } from "zod";

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean(),
  description: z.string(),
  schema: z
    .object({ type: z.string() })
    .passthrough(),
});

const responseSchema = z.object({
  description: z.string(),
  schema: z.record(z.string(), z.unknown()),
  example: z.unknown().nullable(),
});

export const textArtifactSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const codeArtifactSchema = z.object({
  type: z.literal("code"),
  language: z.string(),
  filename: z.string(),
  title: z.string(),
  description: z.string(),
  code: z.string(),
});

export const apiSpecArtifactSchema = z.object({
  type: z.literal("api_spec"),
  method: z.string(),
  endpoint: z.string(),
  description: z.string(),
  auth: z.string(),
  parameters: z.array(parameterSchema),
  responses: z.record(z.string(), responseSchema),
  componentSchemas: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()).optional(),
});

export const sqlArtifactSchema = z.object({
  type: z.literal("sql"),
  dialect: z.string(),
  sql: z.string(),
  reasoning: z.string(),
});

export const diagramArtifactSchema = z.object({
  type: z.literal("diagram"),
  diagramType: z.string(),
  title: z.string(),
  content: z.string(),
});

export const chatArtifactSchema = z.discriminatedUnion("type", [
  textArtifactSchema,
  codeArtifactSchema,
  apiSpecArtifactSchema,
  sqlArtifactSchema,
  diagramArtifactSchema,
]);

export type ChatArtifact = z.infer<typeof chatArtifactSchema>;
export type ChatResponseType = ChatArtifact["type"];

export const CHAT_RESPONSE_TYPES = [
  "text",
  "code",
  "api_spec",
  "sql",
  "diagram",
] as const satisfies readonly ChatResponseType[];

export const CHAT_JSON_CONTRACT = `Reply with one JSON object whose type is one of ${CHAT_RESPONSE_TYPES.join(", ")}.
Shapes:
{"type":"text","text":"..."}
{"type":"code","language":"go","filename":"handler.go","title":"...","description":"...","code":"..."}
{"type":"api_spec","method":"GET","endpoint":"/path","description":"...","auth":"","parameters":[],"responses":{},"componentSchemas":{}}
{"type":"sql","dialect":"postgresql","sql":"...","reasoning":"..."}
{"type":"diagram","diagramType":"flowchart","title":"...","content":"..."}`;
