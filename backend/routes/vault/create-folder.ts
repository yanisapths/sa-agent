import type { NextFunction, Request, Response } from "express";
import {
  createFolder,
  parseCreateFolderInput,
} from "../../internal/vault/service";

export const createFolderHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = parseCreateFolderInput(req.body);
    const data = await createFolder(req.userId, input);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
