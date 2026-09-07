import type { NextFunction, Request, Response } from "express";
import {
  downloadNotificationSound,
  type NotificationSound,
} from "../../internal/sounds/storage";

export function soundHandler(kind: NotificationSound) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const buffer = await downloadNotificationSound(kind);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Length", String(buffer.length));
      return res.send(buffer);
    } catch (err) {
      next(err);
    }
  };
}
