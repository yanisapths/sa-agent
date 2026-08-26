import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { getSupabase } from "../database/supabase";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    if (config.vault.devToken && token === config.vault.devToken) {
      req.userId = config.vault.defaultUserId;
      next();
      return;
    }

    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    req.userId = data.user.id;
    next();
  } catch (err) {
    next(err);
  }
}
