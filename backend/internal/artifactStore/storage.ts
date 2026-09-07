import { config } from "../../config";
import { getSupabase } from "../../database/supabase";
import { HttpError, throwIfError } from "../httpError";

export function artifactsBucket() {
  return getSupabase().storage.from(config.supabase.artifactsBucket);
}

export function artifactObjectKey(
  userId: string,
  fileId: string,
  version: number,
  filename: string,
): string {
  const parts = [
    config.supabase.artifactsFolder,
    userId,
    fileId,
    `v${version}-${filename}`,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join("/");
}

export async function uploadArtifactObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await artifactsBucket().upload(objectKey, body, {
    contentType,
    upsert: false,
  });
  throwIfError(error);
}

export async function downloadArtifactObject(
  objectKey: string,
): Promise<Buffer> {
  const { data, error } = await artifactsBucket().download(objectKey);
  throwIfError(error);
  if (!data) {
    throw new HttpError(404, "Artifact object is missing from storage.");
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeArtifactObjects(
  objectKeys: string[],
): Promise<void> {
  if (objectKeys.length === 0) return;
  const { error } = await artifactsBucket().remove(objectKeys);
  throwIfError(error);
}
