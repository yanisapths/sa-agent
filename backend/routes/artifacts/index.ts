import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { copyFileHandler } from "./copy-file";
import { deleteFileHandler } from "./delete-file";
import { deleteVersionHandler } from "./delete-version";
import { downloadFileHandler } from "./download-file";
import { editFileHandler } from "./edit-file";
import { getContentHandler } from "./get-content";
import { getFileHandler } from "./get-file";
import { listFilesHandler } from "./list-files";
import { listMentionsHandler } from "./list-mentions";

const artifacts = Router();

artifacts.use(requireAuth);

artifacts.get("/files", listFilesHandler);
artifacts.get("/files/:fileId", getFileHandler);
artifacts.get("/files/:fileId/content", getContentHandler);
artifacts.get("/files/:fileId/download", downloadFileHandler);
artifacts.put("/files/:fileId", editFileHandler);
artifacts.post("/files/:fileId/copy", copyFileHandler);
artifacts.delete("/files/:fileId", deleteFileHandler);
artifacts.delete("/files/:fileId/versions/:version", deleteVersionHandler);
artifacts.get("/mentions", listMentionsHandler);

export { artifacts };
