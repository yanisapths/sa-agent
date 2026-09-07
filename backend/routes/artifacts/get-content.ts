import type { NextFunction, Request, Response } from "express";
import { HttpError, queryNumber, queryString } from "../../internal/httpError";
import { getContent } from "../../internal/artifactStore/service";

export const getContentHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const fileId = queryString(req.params.fileId);
    if (!fileId) throw new HttpError(400, "fileId is required");
    const versionRaw = queryString(req.query.version);
    const version = versionRaw
      ? queryNumber(req.query.version, Number.NaN)
      : undefined;
    if (versionRaw && !Number.isFinite(version)) {
      throw new HttpError(400, "version must be a number");
    }
    const data = await getContent(req.userId, fileId, version);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
