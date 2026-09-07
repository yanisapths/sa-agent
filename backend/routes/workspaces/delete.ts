import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { deleteWorkspace } from "../../internal/workspace/service";

export const deleteWorkspaceHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const workspaceId = queryString(req.params.workspaceId);
    if (!workspaceId) throw new HttpError(400, "workspaceId is required");
    const data = await deleteWorkspace(req.userId, workspaceId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
