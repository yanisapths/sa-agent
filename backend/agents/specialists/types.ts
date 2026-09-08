export const GROUNDING = `Ground every claim in list_tables / describe_tables /
inspect_relationships, or in live docs (search_docs then get_doc_page)
and search_schema_docs. Never invent a table, column, or endpoint.
Do not answer from search_docs snippets — read 1–3 full pages. If the
first search is ambiguous, search again with a narrower term (budget
4–6 docs tool calls). Cite page paths. Write your artifact to the path
named in the task. Return a short report, not raw tool dumps.
When a local project folder is attached, ls / read_file / glob / grep
see that repo from / (e.g. /internal/handler/voting). /artifacts is
phase scratch; /resources is skills; mentioned vault files are at
/vault/folder/file (edit_file / write_file save back to the vault).
Do not pass a host path like /Users/…. workspace_ls / workspace_read /
workspace_grep also work with paths relative to the folder root.`;

export type SpecialistSpec = {
  owner: string;
  claudeName: string;
  claudeFile: string;
  description: string;
  disallowedTools?: readonly string[];
  systemPrompt: string;
  pluginBody: string;
};
