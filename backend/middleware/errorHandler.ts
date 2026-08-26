import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { errorMessageOf, HttpError } from "../internal/httpError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ ok: false, error: "File exceeds 20MB limit" });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, error: err.message });
    return;
  }

  res.status(500).json({ ok: false, error: errorMessageOf(err) });
}
