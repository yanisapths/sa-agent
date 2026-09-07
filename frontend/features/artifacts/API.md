# Artifacts API

Generated files and phase results. File bytes go to Supabase Storage bucket `artifacts`; metadata stays in Postgres. Mention tokens (`@Artifacts/discuss.md`) are how Chat Agent references them.

Base URL: `{AGENT_API}/v1/artifacts`

Auth: `Bearer <token>` on every request (same token as Vault).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/files?threadId=` | List logical files (latest version) |
| GET | `/files/:fileId` | File + version list |
| GET | `/files/:fileId/content?version=` | Text preview payload |
| GET | `/files/:fileId/download?version=` | Attachment download |
| PUT | `/files/:fileId` | `{ "content": "..." }` — new version |
| POST | `/files/:fileId/copy` | Duplicate as a new file |
| DELETE | `/files/:fileId` | Delete file and all versions |
| DELETE | `/files/:fileId/versions/:version` | Delete one version |
| GET | `/mentions?q=&limit=` | `@Artifacts/...` autocomplete |
