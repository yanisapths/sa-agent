import type { NextFunction, Request, Response } from "express";
import { pickFolderInFinder } from "../../internal/workspace/pick";

export const pickFolderHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const path = await pickFolderInFinder();
    return res.json({ ok: true, data: { path } });
  } catch (err) {
    next(err);
  }
};
