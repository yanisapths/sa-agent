import type { NextFunction, Request, Response } from "express";
import { HttpError, queryNumber, queryString } from "../../internal/httpError";
import { deleteVersion } from "../../internal/artifactStore/service";

export const deleteVersionHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const fileId = queryString(req.params.fileId);
    const version = queryNumber(req.params.version, Number.NaN);
    if (!fileId) throw new HttpError(400, "fileId is required");
    if (!Number.isFinite(version)) {
      throw new HttpError(400, "version must be a number");
    }
    const data = await deleteVersion(req.userId, fileId, version);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
