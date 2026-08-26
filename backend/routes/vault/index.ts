import { Router } from "express";
import multer from "multer";
import { config } from "../../config";
import { requireAuth } from "../../middleware/requireAuth";
import { createFolderHandler } from "./create-folder";
import { deleteFileHandler } from "./delete-file";
import { deleteFolderHandler } from "./delete-folder";
import { listFoldersHandler } from "./list-folders";
import { listMentionsHandler } from "./list-mentions";
import { uploadFileHandler } from "./upload-file";

const vault = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.vault.maxFileBytes },
});

vault.use(requireAuth);

vault.get("/folders", listFoldersHandler);
vault.post("/folders", createFolderHandler);
vault.delete("/folders/:folderId", deleteFolderHandler);

vault.post("/files", upload.single("file"), uploadFileHandler);
vault.delete("/files/:fileId", deleteFileHandler);

vault.get("/mentions", listMentionsHandler);

export { vault };
