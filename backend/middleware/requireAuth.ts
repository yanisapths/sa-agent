import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { getSupabase } from "../database/supabase";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function userIdFromToken(token: string): Promise<string | null> {
  if (config.vault.devToken && token === config.vault.devToken) {
    return config.vault.defaultUserId;
  }

  const { data, error } = await getSupabase().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
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

    const userId = await userIdFromToken(token);
    if (!userId) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Sets `req.userId` when a valid token is present and does nothing when it is
 * not. Chat has always worked unauthenticated, so it stays that way; a vault
 * mention is the only part that needs an identity, and it degrades to "I could
 * not read that file" rather than reading someone else's vault. Never fall
 * back to `config.vault.defaultUserId` here — that is a cross-user read.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req.headers.authorization);
    if (token) {
      const userId = await userIdFromToken(token);
      if (userId) req.userId = userId;
    }
    next();
  } catch (err) {
    next(err);
  }
}
