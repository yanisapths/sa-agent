import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { editFile, parseEditInput } from "../../internal/artifactStore/service";

export const editFileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const fileId = queryString(req.params.fileId);
    if (!fileId) throw new HttpError(400, "fileId is required");
    const { content } = parseEditInput(req.body);
    const data = await editFile(req.userId, fileId, content);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
