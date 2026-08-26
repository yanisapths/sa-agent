export type Role = "user" | "assistant";
export type RespType = "api" | "sql" | "text" | "openapi" | "code" | "api_spec";
export interface UIMessagePart {
  type: RespType;
  text: string;
}

export interface UIMessage {
  id: string;
  role: Role;
  parts: UIMessagePart[];
}
