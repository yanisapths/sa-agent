import { z } from "zod";

/**
 * Phase keys for per-product model defaults. Same names as `config.model`, so
 * `modelFor(phase, product)` can fall back to the env value by key.
 */
export const MODEL_PHASES = [
  "orchestrator",
  "discuss",
  "plan",
  "execute",
  "test",
  "review",
  "pvtDiscuss",
  "pvtPlan",
  "pvtExecute",
] as const;

export type ModelPhase = (typeof MODEL_PHASES)[number];

/**
 * An env-var NAME, never a value. The prefix is what stops a profile from
 * pointing at `SUPABASE_SERVICE_ROLE_KEY` or any other backend secret.
 */
export const ENV_REF = z.string().regex(/^SA_PRODUCT_[A-Z0-9_]+$/, {
  message: "must be an env-var name starting with SA_PRODUCT_",
});

export const PRODUCT_SLUG = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, {
    message: "lowercase letters, digits and dashes, up to 40 characters",
  })
  .refine((slug) => slug !== "default", { message: "`default` is reserved" });

export const docsProfileSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("confluence"),
    spaceKey: z.string().trim().min(1),
    baseUrl: z.url().optional(),
    siteUrl: z.url().optional(),
    usernameEnv: ENV_REF.optional(),
    tokenEnv: ENV_REF.optional(),
  }),
  z.object({ provider: z.literal("none") }),
]);

export const indexProfileSchema = z.object({
  apiSpecCollection: z.string().trim().min(1).optional(),
  ddlCollection: z.string().trim().min(1).optional(),
});

/** The single source for the products API, `.sa/product.json` and its generated JSON schema. */
export const productProfileSchema = z.object({
  id: PRODUCT_SLUG,
  name: z.string().trim().min(1).max(80),
  db: z
    .object({ urlEnv: ENV_REF, schema: z.string().trim().min(1).default("public") })
    .optional(),
  docs: docsProfileSchema.default({ provider: "none" }),
  index: indexProfileSchema.default({}),
  models: z.partialRecord(z.enum(MODEL_PHASES), z.string().trim().min(1)).optional(),
});

export type ProductProfile = z.infer<typeof productProfileSchema>;
export type DocsProfile = z.infer<typeof docsProfileSchema>;
export type IndexProfile = z.infer<typeof indexProfileSchema>;
