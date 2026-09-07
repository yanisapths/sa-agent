import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { copyFile, parseCopyInput } from "../../internal/artifactStore/service";

export const copyFileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const fileId = queryString(req.params.fileId);
    if (!fileId) throw new HttpError(400, "fileId is required");
    const { name } = parseCopyInput(req.body);
    const data = await copyFile(req.userId, fileId, name);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
