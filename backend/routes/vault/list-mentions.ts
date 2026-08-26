import type { NextFunction, Request, Response } from "express";
import { queryNumber, queryString } from "../../internal/httpError";
import { listMentions } from "../../internal/vault/service";

export const listMentionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await listMentions(
      req.userId,
      queryString(req.query.q),
      queryNumber(req.query.limit, 8),
    );
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
