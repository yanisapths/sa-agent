import { config } from "./config";
import { getSupabase } from "./database/supabase";
import { throwIfError } from "./internal/httpError";

export function vaultBucket() {
  return getSupabase().storage.from(config.supabase.vaultBucket);
}

export function vaultObjectKey(
  userId: string,
  folderId: string,
  fileId: string,
  filename: string,
): string {
  const parts = [config.supabase.vaultFolder, userId, folderId, `${fileId}-${filename}`]
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

export async function removeVaultObjects(objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const { error } = await vaultBucket().remove(objectKeys);
  throwIfError(error);
}
