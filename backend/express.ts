import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { chat } from "./routes/chat";
import { chats } from "./routes/chats";
import { gateway } from "./routes/gateway";
import { artifacts } from "./routes/artifacts";
import { vault } from "./routes/vault";
import { workspaces } from "./routes/workspaces";
import { products } from "./routes/products";
import { sounds } from "./routes/sounds";

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: config.corsOrigins,
    allowedHeaders: ["Content-Type", "Authorization", "X-SA-Connections"],
  }),
);
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/chat", chat);
app.use("/v1/chats", chats);
app.use("/v1/gateway", gateway);
app.use("/v1/vault", vault);
app.use("/v1/artifacts", artifacts);
app.use("/v1/workspaces", workspaces);
app.use("/v1/products", products);
app.use("/v1/sounds", sounds);
app.use(errorHandler);

const onListen = () => {
  console.log(`REST API listening on http://${config.host || "localhost"}:${config.port}`);
};
if (config.host) app.listen(config.port, config.host, onListen);
else app.listen(config.port, onListen);
