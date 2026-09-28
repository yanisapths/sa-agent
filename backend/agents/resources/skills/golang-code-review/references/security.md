# Go Security (review checklist)

Read this for auth, payments, user input, and external API code. Critical if exploitable; important if defense-in-depth is missing.

## SQL Injection Prevention

Parameterized queries only. Never concatenate user input into SQL.

```go
query := "SELECT * FROM users WHERE email = $1"
db.Query(ctx, query, email)
```

Flag `fmt.Sprintf`, string `+`, or `fmt.Fprintf` that build SQL from request data, including `ORDER BY` / column names from the client. Identifiers must be allowlisted, not interpolated.

## Input validation and sanitization

Validate at the handler/DTO boundary before the service runs. Reject unknown enum values. Bound string lengths and collection sizes. Sanitize HTML with an allowlist if rich text is stored. Check upload extensions/MIME before blob copy.

## Authentication and passwords

- Hash passwords with bcrypt (or argon2); never MD5/SHA for passwords.
- Compare hashes with the library's constant-time helper, not `==` on decoded bytes you built yourself.
- Tokens, reset codes, and API keys: `crypto/rand`, not `math/rand`.

```go
b := make([]byte, 32)
if _, err := rand.Read(b); err != nil {
    return "", err
}
```

## Authorization

Every tenant-scoped read/write must enforce `school_id` (see `teetsh-patterns.md`). Object-level checks belong in the query or an explicit service guard — not only in the UI.

Do not trust client-supplied user IDs, roles, or school IDs without binding them to the authenticated session.

## TLS and outbound HTTP

- Production HTTP clients use TLS 1.2+; do not set `InsecureSkipVerify: true`.
- Set client timeouts; unbounded `http.Get` is a resource exhaustion bug.
- Do not log secrets, raw authorization headers, or full payment payloads.

## Payments and external APIs

- Verify webhooks with the provider's signature scheme; do not process unsigned callbacks.
- Treat provider IDs as untrusted until looked up server-side.
- Idempotency keys on charge/create paths so retries cannot double-bill.

## Secrets and crypto

- Secrets from env/secret manager, never committed constants.
- Use `crypto/rand` and standard library AES/TLS; do not invent schemes.
- JWT: verify signature and expiry; reject `alg=none`.

## Common findings to treat as critical

- SQL built from strings
- Missing `school_id` on tenant data
- Password stored reversible or hashed with a fast hash
- Authz check only on the client
- SSRF via unchecked outbound URLs
- Path traversal in file names (`filepath.Base` + allowlist, never join raw user paths)
