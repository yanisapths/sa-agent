---
name: security-review
description: Review a change for security defects against OWASP Top 10:2025 and the organization's browser-side hardening baseline — access control, injection, secrets, authentication, logging, cookie and storage rules, and mandatory HTTP security headers. Use when reviewing a diff for security, threat-modelling a design, or checking client-side storage, cookies, and headers.
---

# Security review

Find the defects a functional review misses. Every finding names the risk, the
file and line, the concrete attack, and the fix.

## Procedure

1. Establish the attack surface of the change: new or changed endpoints, new
   query parameters, new SQL, new storage, new dependencies, new config.
   `simulate_impact` on what it touches — an authorization gap matters more on
   an endpoint three features depend on.
2. Walk `references/owasp-top-10.md`. For each risk, ask what in *this* change
   could realize it. Skip a risk explicitly rather than silently.
3. For anything the browser touches — cookies, `localStorage`, headers, HTML
   injection, iframes — apply `references/web-browser.md` as a hard baseline,
   not a suggestion.
4. Confirm the data you are reasoning about is real: `describe_tables` for what
   a column actually holds, `get_doc_page` for what an endpoint actually
   advertises. A speculative finding about an invented column is noise.
5. Report as **critical** (exploitable now), **high**, **suggestion**, and state
   what you checked and found clean.

## What to check first

These are where this codebase's defects land, in order of how often:

- **Authorization on the identifier.** An endpoint taking `:reward_id` or
  `:employee_id` must prove the caller may act on *that* row, not merely that
  the caller is authenticated. A `WHERE id = $1` with no owner or role
  predicate is IDOR (A01).
- **SQL built by concatenation.** Parameters are `$1`. `fmt.Sprintf` into a
  query, or an interpolated `ORDER BY`/table name, is injection (A05).
- **Secrets in the repo or the client.** Hardcoded keys, tokens, wallet
  credentials, connection strings; anything under `NEXT_PUBLIC_` is public by
  construction (A04).
- **Untrusted HTML.** Rich text must pass an allowlist sanitizer before storage
  and must not reach `dangerouslySetInnerHTML` unsanitized (A05).
- **Uploads.** Extension and content-type checked against an allowlist before
  the file is copied anywhere, and the stored name generated rather than taken
  from the client (A05, A08).
- **Errors that leak.** A driver error, stack trace, or internal path in a
  response body tells an attacker about the schema (A02, A10).
- **Fail-open.** An error path that continues, defaults to permitted, or skips
  the check it could not complete (A10).
- **Logs.** Security-relevant actions — auth, permission changes, data patches,
  on-chain transactions — must be logged with actor and target, and must not log
  tokens, signatures, or personal data (A09).
- **Transactions.** A read-then-write invariant without the isolation level or
  the constraint to enforce it is a race an attacker can drive (A06, A08).
- **Dependencies.** New packages: are they the real ones, pinned, and from the
  approved proxy (A03).

## Client-side baseline

From `references/web-browser.md`, the rules that fail a review outright:

- Session identifiers live in cookies with `HttpOnly`, `Secure`, and
  `SameSite` (`Strict` or `Lax`). All three are required, not preferred.
- `localStorage` and `sessionStorage` hold non-sensitive cached data only —
  they have no flag that stops JavaScript reading them.
- Production must send `Strict-Transport-Security: max-age=31536000;
  includeSubDomains`, a `Content-Security-Policy` with at least
  `default-src 'self'; frame-ancestors 'self';`, and
  `X-Content-Type-Options: nosniff`.
- Widening a CSP or adding a remote asset domain is a finding until the source
  is reviewed.

## References

- `references/owasp-top-10.md` — OWASP Top 10:2025, one row per risk with the
  typical examples and the upstream URL.
- `references/web-browser.md` — the organization's browser security guideline:
  storage and cookie rules, mandatory HTTP security headers.

Frontend implementation conventions are in `frontend`; Go handler and SQL
conventions are in `backend-go`; the release and runbook gates are in
`backend-code-review`.
