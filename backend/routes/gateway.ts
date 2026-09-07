import { Router, type NextFunction, type Request, type Response } from "express";
import { chatModels } from "../internal/gateway/models";
import { fetchQuota } from "../internal/gateway/quota";
import { optionalAuth } from "../middleware/requireAuth";

/**
 * What the GUI needs to know about the gateway itself: which models this
 * virtual key can reach, and what it has spent against its budget.
 *
 * Both are `optionalAuth`, matching `/chat` — the chat GUI has always worked
 * without signing in. Quota does expose the key's budget and spend, so if this
 * ever leaves a development machine, `requireAuth` on the quota route is the
 * change to make.
 */

async function modelsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ ok: true, models: await chatModels() });
  } catch (err) {
    next(err);
  }
}

async function quotaHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ ok: true, quota: await fetchQuota() });
  } catch (err) {
    next(err);
  }
}

const gateway = Router();
gateway.get("/models", optionalAuth, modelsHandler);
gateway.get("/quota", optionalAuth, quotaHandler);

export { gateway };
