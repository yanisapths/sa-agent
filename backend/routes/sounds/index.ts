import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { soundHandler } from "./get";

const sounds = Router();

sounds.use(requireAuth);

sounds.get("/pending", soundHandler("PENDING"));
sounds.get("/ready", soundHandler("READY"));

export { sounds };
