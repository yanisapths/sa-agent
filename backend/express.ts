import cors from "cors";
import "dotenv/config";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { chatAgent } from "./agents/chat/agent";
import { indexing } from "./agents/rag/indexing";

import { getSupabase } from "./database/supabase";
import {
  cleanQuery,
  errorMessage,
  isApiSpecRequest,
  lastAssistantContent,
  tryParseJsonObject,
} from "./helpers";

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
  }),
);
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// -----------------------------
// Supabase Storage REST
// -----------------------------

app.get("/supabase/buckets", async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.listBuckets();
    if (error) return res.status(400).json({ ok: false, error });
    return res.json({ ok: true, buckets: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

app.get("/supabase/:bucket/files", async (req, res) => {
  try {
    const { bucket } = req.params;
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    const offset =
      typeof req.query.offset === "string" ? Number(req.query.offset) : 0;

    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return res.status(400).json({ ok: false, error });
    return res.json({ ok: true, files: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: errorMessage(e) });
  }
});

app.get("/supabase/:bucket/public-url", async (req, res) => {
  try {
    const { bucket } = req.params;
    const path = z.string().min(1).parse(req.query.path);
    const supabase = getSupabase();
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return res.json({ ok: true, publicUrl: data.publicUrl });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// -----------------------------
// Chroma Cloud RAG REST
// -----------------------------

app.post("/rag/index", async (req, res) => {
  try {
    const body = z
      .object({
        url: z.string().url(),
      })
      .parse(req.body);

    const result = await indexing({ path: body.url });
    return res.json({ ok: true, indexed: result.splits, url: body.url });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

// -----------------------------
// Chat (RAG Agent)
// -----------------------------
app.post("/chat", async (req, res) => {
  try {
    const body = z
      .object({
        message: z.string().min(1),
      })
      .parse(req.body);

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    const result = await chatAgent.invoke(
      {
        messages: [{ role: "user", content: body.message }],
      },
      config,
    );

    const content = lastAssistantContent(result);

    if (isApiSpecRequest(body.message)) {
      const raw = tryParseJsonObject(content) ?? { result: content };
      const data = cleanQuery(raw) as Record<string, unknown>;
      return res.json({
        code: 2000,
        message: "Success.",
        data,
      });
    }

    const parsed = tryParseJsonObject(content);
    if (parsed) {
      return res.json({ ok: true, message: cleanQuery(parsed) });
    }
    return res.json({ ok: true, message: cleanQuery(content) });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`REST API listening on http://localhost:${port}`);
});
