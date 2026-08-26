import type { NextFunction, Request, Response } from "express";
import { queryString } from "../../internal/httpError";
import { listFolders } from "../../internal/vault/service";

export const listFoldersHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await listFolders(req.userId, queryString(req.query.q));
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
