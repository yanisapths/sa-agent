import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { createWorkspaceHandler } from "./create";
import { deleteWorkspaceHandler } from "./delete";
import { listWorkspacesHandler } from "./list";
import { listMentionsHandler } from "./list-mentions";
import { pickFolderHandler } from "./pick";

const workspaces = Router();

workspaces.use(requireAuth);

workspaces.get("/", listWorkspacesHandler);
workspaces.get("/mentions", listMentionsHandler);
workspaces.post("/pick", pickFolderHandler);
workspaces.post("/", createWorkspaceHandler);
workspaces.delete("/:workspaceId", deleteWorkspaceHandler);

export { workspaces };
