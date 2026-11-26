import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { type Product, type ProductInput } from "@/features/product/types";
import { type Connection, type ConnectionOf, type ConnectionSources } from "@/lib/connection";

import { type StorageMode } from "./store";

export const ENV_REF = /^SA_PRODUCT_[A-Z0-9_]+$/;
const ENV_HINT = "Use a name like SA_PRODUCT_CLUBCO_DATABASE_URL.";

const sourceSchema = z.enum(["browser", "env"]);

/**
 * Secret inputs start empty. `hasSaved*` says a value is already stored in
 * this browser; an empty input then keeps it. The saved value is never put
 * back into the form or the DOM.
 */
export const connectionsFormSchema = z
  .object({
    mode: z.enum(["device", "session", "passphrase"]),
    passphrase: z.string(),
    postgres: z.object({
      enabled: z.boolean(),
      source: sourceSchema,
      url: z.string().trim(),
      hasSavedUrl: z.boolean(),
      schema: z.string().trim(),
      urlEnv: z.string().trim(),
    }),
    confluence: z.object({
      enabled: z.boolean(),
      source: sourceSchema,
      baseUrl: z.string().trim(),
      spaceKey: z.string().trim(),
      siteUrl: z.string().trim(),
      username: z.string().trim(),
      token: z.string(),
      hasSavedToken: z.boolean(),
      usernameEnv: z.string().trim(),
      tokenEnv: z.string().trim(),
    }),
    jira: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().trim(),
      username: z.string().trim(),
      token: z.string(),
      hasSavedToken: z.boolean(),
    }),
  })
  .superRefine((values, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const isHttpUrl = (value: string) => /^https?:\/\/[^\s/]+/i.test(value);

    const { postgres, confluence, jira } = values;
    if (postgres.enabled) {
      if (postgres.source === "env") {
        if (!ENV_REF.test(postgres.urlEnv)) issue(["postgres", "urlEnv"], ENV_HINT);
      } else if (!postgres.url && !postgres.hasSavedUrl) {
        issue(["postgres", "url"], "Enter a postgresql:// URL.");
      } else if (postgres.url && !/^postgres(ql)?:\/\//i.test(postgres.url)) {
        issue(["postgres", "url"], "Use a postgresql:// URL.");
      }
    }
    if (confluence.enabled) {
      if (!confluence.spaceKey) issue(["confluence", "spaceKey"], "Enter the space key.");
      if (confluence.source === "browser" && !isHttpUrl(confluence.baseUrl)) {
        issue(["confluence", "baseUrl"], "Enter the site URL, e.g. https://acme.atlassian.net/wiki.");
      }
      if (confluence.source === "env") {
        for (const key of ["usernameEnv", "tokenEnv"] as const) {
          if (confluence[key] && !ENV_REF.test(confluence[key])) issue(["confluence", key], ENV_HINT);
        }
      }
      if (confluence.source === "browser" && confluence.username && !confluence.token && !confluence.hasSavedToken) {
        issue(["confluence", "token"], "A username needs a token.");
      }
    }
    if (jira.enabled) {
      if (!isHttpUrl(jira.baseUrl)) issue(["jira", "baseUrl"], "Enter the Jira URL.");
      if (!jira.token && !jira.hasSavedToken) issue(["jira", "token"], "Enter a token.");
    }
  });

export type ConnectionsFormValues = z.infer<typeof connectionsFormSchema>;

function savedOf<K extends Connection["kind"]>(
  saved: readonly Connection[],
  kind: K,
): ConnectionOf<K> | undefined {
  return saved.find((conn): conn is ConnectionOf<K> => conn.kind === kind);
}

export function connectionsDefaults(
  product: Product | null,
  saved: readonly Connection[],
  mode: StorageMode = "device",
): ConnectionsFormValues {
  const pg = savedOf(saved, "postgres");
  const cf = savedOf(saved, "confluence");
  const jr = savedOf(saved, "jira");
  const sources = product?.connectionSources ?? {};
  const docsEnv = product?.docs.source === "env";
  return {
    mode,
    passphrase: "",
    postgres: {
      enabled: Boolean(pg) || product?.db.source === "env",
      source: sources.postgres ?? (pg ? "browser" : product?.db.envVar ? "env" : "browser"),
      url: "",
      hasSavedUrl: Boolean(pg),
      schema: pg?.schema ?? product?.db.schema ?? "public",
      urlEnv: product?.db.envVar ?? "",
    },
    confluence: {
      enabled: Boolean(cf) || docsEnv,
      source: sources.confluence ?? (cf ? "browser" : docsEnv ? "env" : "browser"),
      baseUrl: cf?.baseUrl ?? "",
      spaceKey: cf?.spaceKey ?? product?.docs.spaceKey ?? "",
      siteUrl: product?.docs.siteUrl ?? "",
      username: cf?.username ?? "",
      token: "",
      hasSavedToken: Boolean(cf?.token),
      usernameEnv: product?.docs.usernameEnv ?? "",
      tokenEnv: product?.docs.tokenEnv ?? "",
    },
    jira: {
      enabled: Boolean(jr),
      baseUrl: jr?.baseUrl ?? "",
      username: jr?.username ?? "",
      token: "",
      hasSavedToken: Boolean(jr),
    },
  };
}

const TEST_NEEDED: Record<"postgres" | "confluence" | "jira", string> = {
  postgres: "a postgresql:// URL",
  confluence: "the site URL and space key",
  jira: "the Jira URL and token",
};

/**
 * Connections the Test button should send. Empty browser fields must not
 * hit the API: Default would otherwise test backend/.env and report success.
 */
export function connectionsForTest(
  values: ConnectionsFormValues,
  saved: readonly Connection[],
  kind: "postgres" | "confluence" | "jira",
): { connections: Connection[] } | { detail: string } {
  const usesEnv =
    (kind === "postgres" && values.postgres.enabled && values.postgres.source === "env") ||
    (kind === "confluence" && values.confluence.enabled && values.confluence.source === "env");
  if (usesEnv) return { connections: [] };

  if (kind === "confluence" && values.confluence.enabled && values.confluence.source === "browser") {
    if (!values.confluence.baseUrl || !values.confluence.spaceKey) {
      return { detail: `Enter ${TEST_NEEDED.confluence} first.` };
    }
  }

  const connections = toConnections(values, saved).filter((conn) => conn.kind === kind);
  if (connections.length === 0) {
    return { detail: `Enter ${TEST_NEEDED[kind]} first.` };
  }
  return { connections };
}

/** Browser-held connections to store. A blank secret keeps the saved one. */
export function toConnections(values: ConnectionsFormValues, saved: readonly Connection[]): Connection[] {
  const out: Connection[] = [];
  const { postgres, confluence, jira } = values;
  if (postgres.enabled && postgres.source === "browser") {
    const url = postgres.url || (postgres.hasSavedUrl ? savedOf(saved, "postgres")?.url : undefined);
    if (url) out.push({ kind: "postgres", url, schema: postgres.schema || "public" });
  }
  if (confluence.enabled && confluence.source === "browser" && confluence.baseUrl && confluence.spaceKey) {
    const token =
      confluence.token || (confluence.hasSavedToken ? savedOf(saved, "confluence")?.token : undefined);
    out.push({
      kind: "confluence",
      baseUrl: confluence.baseUrl,
      spaceKey: confluence.spaceKey,
      ...(confluence.username && token ? { username: confluence.username } : {}),
      ...(token ? { token } : {}),
    });
  }
  if (jira.enabled) {
    const token = jira.token || (jira.hasSavedToken ? savedOf(saved, "jira")?.token : undefined);
    if (token) {
      out.push({
        kind: "jira",
        baseUrl: jira.baseUrl,
        token,
        ...(jira.username ? { username: jira.username } : {}),
      });
    }
  }
  return out;
}

/** Non-secret product fields: env-var names, space key, sources. Stored on the server. */
export function toProductFields(
  values: ConnectionsFormValues,
): Pick<ProductInput, "db" | "docs" | "connectionSources"> {
  const { postgres, confluence } = values;
  const sources: ConnectionSources = {};
  if (postgres.enabled) sources.postgres = postgres.source;
  if (confluence.enabled) sources.confluence = confluence.source;
  if (values.jira.enabled) sources.jira = "browser";

  const db = {
    ...(postgres.enabled && postgres.source === "env" ? { urlEnv: postgres.urlEnv } : {}),
    schema: postgres.schema || "public",
  };

  const docs: ProductInput["docs"] = confluence.enabled
    ? {
        provider: "confluence",
        spaceKey: confluence.spaceKey,
        ...(confluence.baseUrl ? { baseUrl: confluence.baseUrl } : {}),
        ...(confluence.siteUrl ? { siteUrl: confluence.siteUrl } : {}),
        ...(confluence.source === "env" && confluence.usernameEnv
          ? { usernameEnv: confluence.usernameEnv }
          : {}),
        ...(confluence.source === "env" && confluence.tokenEnv ? { tokenEnv: confluence.tokenEnv } : {}),
      }
    : { provider: "none" };

  return { db, docs, connectionSources: sources };
}

function envPrefix(slug: string): string {
  return `SA_PRODUCT_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/** For "Copy as .env lines". Values come from what is entered or saved here. */
export function envLines(values: ConnectionsFormValues, saved: readonly Connection[], slug: string): string {
  const prefix = envPrefix(slug);
  const lines: string[] = [];
  for (const conn of toConnections(values, saved)) {
    if (conn.kind === "postgres") lines.push(`${prefix}_DATABASE_URL=${conn.url}`);
    if (conn.kind === "confluence") {
      if (conn.username) lines.push(`${prefix}_CONFLUENCE_USERNAME=${conn.username}`);
      if (conn.token) lines.push(`${prefix}_CONFLUENCE_TOKEN=${conn.token}`);
    }
  }
  return lines.join("\n");
}

export function useConnectionsForm(defaults: ConnectionsFormValues) {
  return useForm<ConnectionsFormValues>({
    resolver: zodResolver(connectionsFormSchema),
    defaultValues: defaults,
    mode: "onSubmit",
  });
}
