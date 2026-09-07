import type { NextFunction, Request, Response } from "express";
import { HttpError, queryNumber, queryString } from "../../internal/httpError";
import { getArtifactBytes } from "../../internal/artifactStore/service";

export const downloadFileHandler = async (
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

    const file = await getArtifactBytes(req.userId, fileId, version);
    const filename = file.name.replace(/"/g, "");
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(file.buffer.length));
    return res.send(file.buffer);
  } catch (err) {
    next(err);
  }
};
