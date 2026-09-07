import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { chat } from "./routes/chat";
import { gateway } from "./routes/gateway";
import { artifacts } from "./routes/artifacts";
import { vault } from "./routes/vault";
import { workspaces } from "./routes/workspaces";
import { sounds } from "./routes/sounds";

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: config.corsOrigins,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/chat", chat);
app.use("/v1/gateway", gateway);
app.use("/v1/vault", vault);
app.use("/v1/artifacts", artifacts);
app.use("/v1/workspaces", workspaces);
app.use("/v1/sounds", sounds);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`REST API listening on http://localhost:${config.port}`);
});
