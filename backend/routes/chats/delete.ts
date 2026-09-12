import type { NextFunction, Request, Response } from "express";
import { deleteThread } from "../../internal/chats/service";
import { HttpError, queryString } from "../../internal/httpError";

export const deleteThreadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const threadId = queryString(req.params.threadId);
    if (!threadId) throw new HttpError(400, "threadId is required");
    const data = await deleteThread(req.userId, threadId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
