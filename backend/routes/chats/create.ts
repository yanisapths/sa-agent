import type { NextFunction, Request, Response } from "express";
import { createThread } from "../../internal/chats/service";

export const createThreadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await createThread(req.userId);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
