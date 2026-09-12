import type { NextFunction, Request, Response } from "express";
import { listThreads } from "../../internal/chats/service";
import { CHAT_LIST_PAGE_SIZE } from "../../internal/chats/types";
import { queryNumber, queryString } from "../../internal/httpError";

export const listThreadsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await listThreads(req.userId, {
      limit: queryNumber(req.query.limit, CHAT_LIST_PAGE_SIZE),
      cursor: queryString(req.query.cursor) || undefined,
    });
    return res.json({
      ok: true,
      data: result.data,
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    next(err);
  }
};
