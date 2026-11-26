import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { toProductFields, type ConnectionsFormValues } from "@/features/connections/form";

import { type ProductInput, type ProfileImport } from "./types";

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Name the product.").max(80),
  repoPath: z.string().trim().max(1024),
  repoName: z.string().trim().max(80),
  index: z.object({
    apiSpecCollection: z.string().trim(),
    ddlCollection: z.string().trim(),
  }),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const productFormDefaults: ProductFormValues = {
  name: "",
  repoPath: "",
  repoName: "",
  index: { apiSpecCollection: "", ddlCollection: "" },
};

export function useProductForm() {
  return useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormDefaults,
  });
}

export function folderName(absPath: string): string {
  const parts = absPath.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** The request body for `POST /v1/products`. Carries env-var names, never values. */
export function toProductInput(values: ProductFormValues, connections: ConnectionsFormValues): ProductInput {
  const index = {
    ...(values.index.apiSpecCollection ? { apiSpecCollection: values.index.apiSpecCollection } : {}),
    ...(values.index.ddlCollection ? { ddlCollection: values.index.ddlCollection } : {}),
  };
  return {
    name: values.name,
    ...toProductFields(connections),
    index,
    ...(values.repoPath
      ? { repo: { name: values.repoName || folderName(values.repoPath), path: values.repoPath } }
      : {}),
  };
}

/** Prefill from a committed `.sa/product.json`. */
export function applyImport(
  imported: NonNullable<ProfileImport["profile"]>,
  connections: ConnectionsFormValues,
): ConnectionsFormValues {
  const next = structuredClone(connections);
  if (imported.db) {
    next.postgres = {
      ...next.postgres,
      enabled: true,
      source: "env",
      urlEnv: imported.db.urlEnv,
      schema: imported.db.schema,
    };
  }
  if (imported.docs.provider === "confluence") {
    next.confluence = {
      ...next.confluence,
      enabled: true,
      source: "env",
      spaceKey: imported.docs.spaceKey,
      baseUrl: imported.docs.baseUrl ?? "",
      siteUrl: imported.docs.siteUrl ?? "",
      usernameEnv: imported.docs.usernameEnv ?? "",
      tokenEnv: imported.docs.tokenEnv ?? "",
    };
  }
  return next;
}
