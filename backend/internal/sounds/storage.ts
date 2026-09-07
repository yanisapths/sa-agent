import { config } from "../../config";
import { getSupabase } from "../../database/supabase";
import { HttpError, errorMessageOf } from "../httpError";

export type NotificationSound = "PENDING" | "READY";

export function soundsBucket() {
  return getSupabase().storage.from(config.supabase.soundsBucket);
}

export function soundsObjectKey(kind: NotificationSound): string {
  const folder = config.supabase.soundsFolder.replace(/^\/+|\/+$/g, "");
  return `${folder}/${kind}.mp3`;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const body = error as { statusCode?: string | number; message?: string };
  if (String(body.statusCode ?? "") === "404") return true;
  const message = (body.message ?? "").toLowerCase();
  return message.includes("not found") || message.includes("does not exist");
}

export async function downloadNotificationSound(
  kind: NotificationSound,
): Promise<Buffer> {
  const objectKey = soundsObjectKey(kind);
  const { data, error } = await soundsBucket().download(objectKey);
  if (error) {
    if (isMissingObject(error)) {
      throw new HttpError(
        404,
        `Notification sound ${config.supabase.soundsBucket}/${objectKey} is missing from storage.`,
      );
    }
    throw new HttpError(500, errorMessageOf(error));
  }
  if (!data) {
    throw new HttpError(
      404,
      `Notification sound ${config.supabase.soundsBucket}/${objectKey} is missing from storage.`,
    );
  }
  return Buffer.from(await data.arrayBuffer());
}
