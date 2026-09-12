import type { NextFunction, Request, Response } from "express";
import { getThreadDetail } from "../../internal/chats/service";
import { HttpError, queryString } from "../../internal/httpError";

export const getThreadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const threadId = queryString(req.params.threadId);
    if (!threadId) throw new HttpError(400, "threadId is required");
    const data = await getThreadDetail(req.userId, threadId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
