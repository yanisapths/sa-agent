export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  supabase: {
    vaultBucket: process.env.SUPABASE_VAULT_BUCKET || "vault",
    /** Optional object-key prefix inside the bucket, e.g. `vault`. */
    vaultFolder: process.env.VAULT_STORAGE_FOLDER || "",
  },
  vault: {
    defaultUserId: process.env.VAULT_DEFAULT_USER_ID || "user_1",
    devToken: process.env.VAULT_DEV_TOKEN || "",
    maxFileBytes: 20 * 1024 * 1024,
  },
} as const;
