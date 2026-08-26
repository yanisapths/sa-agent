# sa-agent backend

Ready-to-use Node + Express REST API:

- Supabase Storage: list files, upload, download, public/signed URLs
- Chroma Cloud: collections, upsert, query, answer (RAG)

## Setup

1. Install

```bash
npm install
```

2. Configure env

```bash
cp .env.example .env
```

Fill in:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `SUPABASE_VAULT_BUCKET` (Storage bucket, default `vault`)
- `VAULT_STORAGE_FOLDER` (object-key prefix inside the bucket)
- `VAULT_DEV_TOKEN` / `VAULT_DEFAULT_USER_ID` for local Bearer auth
- `CHROMA_HOST` and `CHROMA_API_KEY` (plus optional `CHROMA_TENANT` / `CHROMA_DATABASE`)
- `OPENAI_API_KEY`

Create the `vault` Storage bucket, then run `sql/vault.sql` in the Supabase SQL editor.

3. Run

```bash
npm run dev
```

## Endpoints

### Health

- `GET /health`

### Vault (`Authorization: Bearer <token>` on every request)

- `GET /v1/vault/folders?q=`
- `POST /v1/vault/folders` body: `{ "name": "Requirements", "description": "" }`
- `DELETE /v1/vault/folders/:folderId`
- `POST /v1/vault/files` multipart: `folderId`, `file`, optional `description`
- `DELETE /v1/vault/files/:fileId`
- `GET /v1/vault/mentions?q=&limit=8`

Local auth: send `VAULT_DEV_TOKEN`. Production: a Supabase user access token.

### Supabase Storage

- `GET /supabase/buckets`
- `GET /supabase/:bucket/files?prefix=&limit=&offset=`
- `GET /supabase/:bucket/public-url?path=...`
- `GET /supabase/:bucket/signed-url?path=...&expiresIn=60`
- `GET /supabase/:bucket/download?path=...`
- `POST /supabase/:bucket/upload` (multipart `file`, optional `path`, `contentType`, `upsert=true|false`)

### Chroma Cloud (RAG)

- `POST /rag/collections` body: `{ "name": "docs" }`
- `POST /rag/upsert` body:
  `{ "collection":"docs", "documents":[{"id":"1","text":"...","metadata":{"source":"x"}}] }`
- `POST /rag/query` body: `{ "collection":"docs", "query":"...", "k":5 }`
- `POST /rag/answer` body: `{ "collection":"docs", "question":"...", "k":5 }`
