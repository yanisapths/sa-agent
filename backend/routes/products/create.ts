import type { NextFunction, Request, Response } from "express";
import { createProduct, parseProductInput } from "../../internal/product/service";

export const createProductHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = parseProductInput(req.body);
    const data = await createProduct(req.userId, input);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
