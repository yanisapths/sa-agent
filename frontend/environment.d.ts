declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_AGENT_API?: string;
    NEXT_PUBLIC_VAULT_TOKEN?: string;
    /**
     * Groundwork docs site root. Guide links are built as `<root>/guides/<slug>`.
     * Omit to hide them. A product's own Confluence link now comes from its
     * `siteUrl` (Default: `CONFLUENCE_SITE_URL` in backend/.env).
     */
    NEXT_PUBLIC_DOCS_URL?: string;
  }
}
