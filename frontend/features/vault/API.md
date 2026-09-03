# Vault API

Knowledge library. Folders organize files. File bytes go to Supabase Storage; metadata stays in Postgres. Mention tokens (`@Requirements/prd.md`) are how Chat Agent and Spec Design Agent reference vault items.

Base URL: `{AGENT_API}/v1/vault`

Auth: `Bearer <token>` on every request.

---

# API Specification: List Vault Folders

## Endpoint

```
GET /v1/vault/folders
```

## Description

Returns every folder the current user owns, including nested file metadata. Used to render the Vault library and to seed `@` mention suggestions.

## Authentication

BearerAuth

## Query Parameters

| Parameter | Type   | Required | Default | Description        |
| --------- | ------ | -------- | ------- | ------------------ |
| `q`       | string | no       | -       | Filter by name     |

## Response

### Success Response (200 OK)

```json
{
  "ok": true,
  "data": [
    {
      "id": "fld_req",
      "name": "Requirements",
      "description": "Product and business requirement docs",
      "files": [
        {
          "id": "fil_prd",
          "name": "prd.md",
          "size": 12400,
          "mimeType": "text/markdown",
          "storagePath": "vault/fld_req/fil_prd-prd.md",
          "createdAt": "2026-08-26T05:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

# API Specification: Create Vault Folder

## Endpoint

```
POST /v1/vault/folders
```

## Description

Creates an empty folder. `name` must be unique per user. The mention token is `@` plus the name with spaces replaced by `-`.

## Authentication

BearerAuth

## Request Body

| Parameter     | Type   | Required | Default | Description              |
| ------------- | ------ | -------- | ------- | ------------------------ |
| `name`        | string | yes      | -       | 1–80 characters          |
| `description` | string | no       | `""`    | Short purpose, max 240   |

```json
{
  "name": "Requirements",
  "description": "Product and business requirement docs"
}
```

## Response

### Success Response (201 Created)

```json
{
  "ok": true,
  "data": {
    "id": "fld_req",
    "name": "Requirements",
    "description": "Product and business requirement docs",
    "files": []
  }
}
```

### 409 Conflict

```json
{ "ok": false, "error": "Folder name already exists" }
```

---

# API Specification: Upload Vault File

## Endpoint

```
POST /v1/vault/files
```

## Description

Uploads a file into a folder. Multipart form. Bytes are stored in Supabase Storage bucket `vault` at `{userId}/{folderId}/{fileId}-{filename}`. Metadata is inserted into `vault_files`. Temp uploads from Spec Design Agent should call this after the user confirms persist.

## Authentication

BearerAuth

## Request Parameters

| Parameter   | Type   | Required | Default | Description                         |
| ----------- | ------ | -------- | ------- | ----------------------------------- |
| `folderId`  | string | yes      | -       | Target folder id (form field)       |
| `file`      | file   | yes      | -       | One file, max 20MB                  |
| `description` | string | no     | `""`    | Optional note (form field)          |

Accepted types: `image/*`, `.pdf`, `.md`, `.txt`, `.csv`, `.json`, `.ts`, `.tsx`, `.sql`, `.docx`, `.xlsx`.

## Response

### Success Response (201 Created)

```json
{
  "ok": true,
  "data": {
    "id": "fil_prd",
    "folderId": "fld_req",
    "name": "prd.md",
    "size": 12400,
    "mimeType": "text/markdown",
    "storagePath": "vault/user_1/fld_req/fil_prd-prd.md",
    "mentionToken": "@Requirements/prd.md",
    "createdAt": "2026-08-26T05:00:00.000Z"
  }
}
```

### 413 Payload Too Large

```json
{ "ok": false, "error": "File exceeds 20MB limit" }
```

---

# API Specification: List Vault Mentions

## Endpoint

```
GET /v1/vault/mentions
```

## Description

Autocomplete for `@` in chat. Returns folders and files. Chat Agent and Spec Design Agent attach selected tokens on the message so the LLM can load those objects.

## Authentication

BearerAuth

## Query Parameters

| Parameter | Type   | Required | Default | Description              |
| --------- | ------ | -------- | ------- | ------------------------ |
| `q`       | string | no       | `""`    | Text after `@`           |
| `limit`   | number | no       | `8`     | Max items, 1–20          |

## Response

### Success Response (200 OK)

```json
{
  "ok": true,
  "data": [
    {
      "token": "@Requirements",
      "label": "Requirements",
      "kind": "folder",
      "folderId": "fld_req",
      "fileId": null
    },
    {
      "token": "@Requirements/prd.md",
      "label": "Requirements / prd.md",
      "kind": "file",
      "folderId": "fld_req",
      "fileId": "fil_prd"
    }
  ]
}
```

---

# API Specification: Delete Vault File

## Endpoint

```
DELETE /v1/vault/files/{fileId}
```

## Description

Removes metadata and the Supabase Storage object.

## Authentication

BearerAuth

## Response

### Success Response (200 OK)

```json
{ "ok": true, "data": { "id": "fil_prd" } }
```

### 404 Not Found

```json
{ "ok": false, "error": "File not found" }
```

---

# API Specification: Delete Vault Folder

## Endpoint

```
DELETE /v1/vault/folders/{folderId}
```

## Description

Deletes a folder and every file in it (storage + rows).

## Authentication

BearerAuth

## Response

### Success Response (200 OK)

```json
{ "ok": true, "data": { "id": "fld_req" } }
```

---

## Notes

- Chat and Spec messages that include `@tokens` may send `mentions: string[]`
  alongside `message`; `POST /chat` also scans `message` for tokens, so either
  works and an explicit list wins. The backend hydrates the file contents into
  the prompt before generation (`routes/chat.ts`, `resolveMentions` in
  `internal/vault/service.ts`).
- Mention hydration needs `Authorization: Bearer <token>` on the **chat**
  request — chat does not otherwise require auth, and an unsigned request
  leaves the tokens as text. Caps: 5 files, 1 MB each, 4 MB total; `.pdf`,
  `.docx`, and `.xlsx` are named but not decoded.
- Spec Design Agent uploads are temp first (`POST /v1/vault/files` with a later persist flag can wait). For v1, upload directly into a folder.
- Frontend calls `{AGENT_API}/v1/vault` from `features/vault/service.ts`. Set `NEXT_PUBLIC_AGENT_API` and `NEXT_PUBLIC_VAULT_TOKEN`.
