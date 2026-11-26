import type { NextFunction, Request, Response } from "express";
import { createThread } from "../../internal/chats/service";
import { assertProductOwner } from "../../internal/product/service";

export const createThreadHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const productId =
      typeof raw.productId === "string" && raw.productId.trim() ? raw.productId.trim() : undefined;
    await assertProductOwner(req.userId, productId);
    const data = await createThread(req.userId, undefined, undefined, productId);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
