import type { NextFunction, Request, Response } from "express";
import { listProducts } from "../../internal/product/service";

export const listProductsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await listProducts(req.userId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
