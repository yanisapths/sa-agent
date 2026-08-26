import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { deleteFolder } from "../../internal/vault/service";

export const deleteFolderHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const folderId = queryString(req.params.folderId);
    if (!folderId) throw new HttpError(400, "folderId is required");
    const data = await deleteFolder(req.userId, folderId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
