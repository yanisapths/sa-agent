import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../internal/httpError";
import { importProfile } from "../../internal/product/service";

export const importProductHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const folder = typeof raw.path === "string" ? raw.path.trim() : "";
    if (!folder) throw new HttpError(400, "path is required.");
    return res.json({ ok: true, data: importProfile(folder) });
  } catch (err) {
    next(err);
  }
};
