import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { getFile } from "../../internal/artifactStore/service";

export const getFileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const fileId = queryString(req.params.fileId);
    if (!fileId) throw new HttpError(400, "fileId is required");
    const data = await getFile(req.userId, fileId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
