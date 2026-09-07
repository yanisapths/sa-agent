import type { NextFunction, Request, Response } from "express";
import { listWorkspaces } from "../../internal/workspace/service";

export const listWorkspacesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await listWorkspaces(req.userId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
