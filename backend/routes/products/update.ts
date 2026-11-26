import type { NextFunction, Request, Response } from "express";
import { parseProductPatch, updateProduct } from "../../internal/product/service";

export const updateProductHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const patch = parseProductPatch(req.body);
    const data = await updateProduct(req.userId, String(req.params.productId), patch);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
