import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { createThreadHandler } from "./create";
import { deleteThreadHandler } from "./delete";
import { getThreadHandler } from "./get";
import { listThreadsHandler } from "./list";

const chats = Router();

chats.use(requireAuth);

chats.get("/", listThreadsHandler);
chats.post("/", createThreadHandler);
chats.get("/:threadId", getThreadHandler);
chats.delete("/:threadId", deleteThreadHandler);

export { chats };
