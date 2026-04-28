import cors from "cors";
import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { ChromaClient } from "chromadb";
import { indexing } from "./agents/rag/indexing";
import { agent as ragAgent } from "./agents/rag/rag-model";

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
  }),
);
app.use(express.json({ limit: "4mb" }));

const upload = multer({ storage: multer.memoryStorage() });

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getSupabase() {
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getChroma() {
  const path = process.env.CHROMA_HOST || process.env.CHROMA_HOST;
  if (!path) throw new Error("Missing CHROMA_HOST (or CHROMA_HOST)");
  const auth = process.env.CHROMA_API_KEY
    ? { provider: "token", credentials: process.env.CHROMA_API_KEY }
    : undefined;

  const opts: ConstructorParameters<typeof ChromaClient>[0] = {
    path,
    auth,
    tenant: process.env.CHROMA_TENANT || undefined,
    database: process.env.CHROMA_DATABASE || undefined,
  };

  return new ChromaClient(opts);
}

function getOpenAI() {
  const key = requiredEnv("OPENAI_API_KEY");
  return new OpenAI({ apiKey: key });
}

function isApiSpecRequest(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("api spec") ||
    m.includes("api specification") ||
    m.includes("openapi") ||
    m.includes("swagger")
  );
}

function lastAssistantContent(result: unknown): string {
  const r = result as { messages?: Array<{ content?: unknown }> } | null;
  const last = r?.messages?.[r.messages.length - 1];
  const c = last?.content;
  if (typeof c === "string") return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

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

app.get("/supabase/:bucket/signed-url", async (req, res) => {
  try {
    const { bucket } = req.params;
    const path = z.string().min(1).parse(req.query.path);
    const expiresIn =
      typeof req.query.expiresIn === "string"
        ? Number(req.query.expiresIn)
        : 60;

    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);
    if (error) return res.status(400).json({ ok: false, error });
    return res.json({ ok: true, signedUrl: data.signedUrl });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

app.get("/supabase/:bucket/download", async (req, res) => {
  try {
    const { bucket } = req.params;
    const path = z.string().min(1).parse(req.query.path);
    const downloadName =
      typeof req.query.downloadName === "string"
        ? req.query.downloadName
        : null;

    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) return res.status(400).json({ ok: false, error });

    const arrayBuffer = await data.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    if (downloadName) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${downloadName.replaceAll('"', "")}"`,
      );
    }
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

app.post(
  "/supabase/:bucket/upload",
  upload.single("file"),
  async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    try {
      const bucket = z.string().min(1).parse(req.params.bucket);
      if (!req.file)
        return res.status(400).json({ ok: false, error: "Missing file" });

      const path =
        typeof req.body.path === "string" && req.body.path.trim().length
          ? req.body.path.trim()
          : req.file.originalname;
      const contentType =
        typeof req.body.contentType === "string" &&
        req.body.contentType.trim().length
          ? req.body.contentType.trim()
          : req.file.mimetype || "application/octet-stream";
      const upsert = req.body.upsert === "true" || req.body.upsert === true;

      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, req.file.buffer, { contentType, upsert });
      if (error) return res.status(400).json({ ok: false, error });
      return res.json({ ok: true, object: data });
    } catch (e) {
      return res.status(400).json({ ok: false, error: errorMessage(e) });
    }
  },
);

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

    const agentInputs = {
      messages: [{ role: "user", content: body.message }],
    };

    const result = await ragAgent.invoke(agentInputs);
    const content = lastAssistantContent(result);

    if (isApiSpecRequest(body.message)) {
      const data = tryParseJsonObject(content) ?? { result: content };
      return res.json({
        code: 2000,
        message: "Success.",
        data,
      });
    }

    const parsed = JSON.parse(content);
    return res.json({ ok: true, message: parsed });
  } catch (e) {
    return res.status(400).json({ ok: false, error: errorMessage(e) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`REST API listening on http://localhost:${port}`);
});
