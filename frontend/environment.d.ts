declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_AGENT_API?: string;
    NEXT_PUBLIC_VAULT_TOKEN?: string;
    /** Confluence space or site home. Omit to hide the sidebar docs link. */
    NEXT_PUBLIC_DOCS_URL?: string;
  }
}
