import type { NextFunction, Request, Response } from "express";
import {
  createWorkspace,
  parseCreateWorkspaceInput,
} from "../../internal/workspace/service";

export const createWorkspaceHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = parseCreateWorkspaceInput(req.body);
    const data = await createWorkspace(req.userId, input);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
