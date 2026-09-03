import { config } from "../../config";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";

export function vaultBucket() {
  return getSupabase().storage.from(config.supabase.vaultBucket);
}

export function vaultObjectKey(
  userId: string,
  folderId: string,
  fileId: string,
  filename: string,
): string {
  const parts = [
    config.supabase.vaultFolder,
    userId,
    folderId,
    `${fileId}-${filename}`,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join("/");
}

export function vaultStoragePath(objectKey: string): string {
  const bucket = config.supabase.vaultBucket;
  if (objectKey === bucket || objectKey.startsWith(`${bucket}/`)) {
    return objectKey;
  }
  return `${bucket}/${objectKey}`;
}

export async function uploadVaultObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await vaultBucket().upload(objectKey, body, {
    contentType,
    upsert: false,
  });
  throwIfError(error);
}

/**
 * `row.storage_path` is the raw object key. Do not pass the value from
 * `toFileResponse`, which prefixes the bucket name for display.
 */
export async function downloadVaultObject(objectKey: string): Promise<Buffer> {
  const { data, error } = await vaultBucket().download(objectKey);
  throwIfError(error);
  if (!data) throw new HttpError(404, "Vault object is missing from storage.");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeVaultObjects(objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const { error } = await vaultBucket().remove(objectKeys);
  throwIfError(error);
}
