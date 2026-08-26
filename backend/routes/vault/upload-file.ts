import type { NextFunction, Request, Response } from "express";
import { HttpError, queryString } from "../../internal/httpError";
import { uploadFile } from "../../internal/vault/service";

export const uploadFileHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const file = req.file;
    if (!file) throw new HttpError(400, "file is required");

    const data = await uploadFile(req.userId, {
      folderId: queryString(req.body?.folderId),
      description: queryString(req.body?.description),
      file: {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
    });

    return res.status(201).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
