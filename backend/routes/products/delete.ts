import type { NextFunction, Request, Response } from "express";
import { deleteProduct } from "../../internal/product/service";

export const deleteProductHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await deleteProduct(req.userId, String(req.params.productId));
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
