/** Keeps `tools/core/knowledge.ts` provider-agnostic. Only Confluence ships. */
export interface DocsProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<string>;
  fetch(refs: string[]): Promise<string>;
  /** One cheap call for the connection test. Returns a human-readable detail. */
  test(): Promise<string>;
}
