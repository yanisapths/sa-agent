import type { NextFunction, Request, Response } from "express";
import { queryString } from "../../internal/httpError";
import { listFiles } from "../../internal/artifactStore/service";

export const listFilesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await listFiles(req.userId, queryString(req.query.threadId));
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
