import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { errorMessageOf, HttpError } from "../internal/httpError";
import {
  CONNECTIONS_HEADER,
  parseConnections,
  scrubSecrets,
} from "../internal/product/connections";

/** A driver error can echo the user's connection string; scrub with the request's own connections. */
function scrubbed(req: Request, message: string): string {
  try {
    return scrubSecrets(message, parseConnections(req.headers[CONNECTIONS_HEADER]));
  } catch {
    return scrubSecrets(message, []);
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
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
    res.status(err.status).json({ ok: false, error: scrubbed(req, err.message) });
    return;
  }

  res.status(500).json({ ok: false, error: scrubbed(req, errorMessageOf(err)) });
}
