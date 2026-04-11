import express from "express";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import CircuitBreaker from "opossum";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// ==========================
// ENV VALIDATION
// ==========================
const requiredEnv = [
  "OPENAI_API_KEY",
  "JWT_SECRET",
  "REDIS_URL",
  "SUPABASE_URL",
  "SUPABASE_KEY"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`${key} missing`);
  }
}

// ==========================
// CLIENTS
// ==========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const redis = new Redis(process.env.REDIS_URL);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ==========================
// VALID MODELS
// ==========================
const ALLOWED_MODELS = ["gpt-5-nano", "gpt-5-mini", "gpt-5"];

// ==========================
// REQUEST ID
// ==========================
function generateRequestId() {
  return crypto.randomUUID();
}

// ==========================
// LOGGING
// ==========================
function logEvent(type, data) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    ...data
  }));
}

// ==========================
// JWT AUTH
// ==========================
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.tenant = {
      tenantId: decoded.tenantId,
      userId: decoded.userId,
      plan: decoded.plan
    };

    next();

  } catch {
    return res.status(401).json({
      error: "Invalid token"
    });
  }
}

app.use("/chat", authMiddleware);

// ==========================
// RATE LIMITER
// ==========================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use("/chat", limiter);

// ==========================
// SAFE REDIS CACHE
// ==========================
async function getCache(key) {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function setCache(key, value, ttl = 900) {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch {}
}

// ==========================
// MODEL ROUTER
// LOGIC ASLI TETAP
// ==========================
function pilihModel(message) {
  const text = message.toLowerCase();

  if (text.includes("jelaskan") || text.includes("detail")) {
    return "gpt-5-mini";
  }

  if (message.length < 50) return "gpt-5-nano";
  if (message.length < 200) return "gpt-5-mini";
  return "gpt-5";
}

// ==========================
// MODE BELAJAR
// ==========================
function modeBelajar(message) {
  const text = message.toLowerCase();

  if (
    text.includes("jelaskan") ||
    text.includes("detail") ||
    text.includes("lebih lengkap")
  ) {
    return "detail";
  }

  return "singkat";
}

// ==========================
// TOKEN LIMIT
// ==========================
function limitOutput(mode) {
  if (mode === "singkat") return 80;
  return 250;
}

// ==========================
// PLAN ACCESS
// ==========================
function enforcePlanAccess(plan, model) {
  if (plan === "free" && model === "gpt-5") {
    return "gpt-5-mini";
  }

  return model;
}

// ==========================
// PROMPT BUILDER
// ==========================
function buildPrompt(mode) {
  return mode === "singkat"
    ? `Kamu adalah guru profesional Indonesia yang menguasai Kurikulum Merdeka, CP, ATP, dan seluruh mata pelajaran SD, SMP, SMA, SMK. Jawab singkat, jelas, akurat, ramah, mudah dipahami siswa. Jangan mengarang; jika tidak yakin katakan jujur. Jika pertanyaan di luar pelajaran, jawab sopan lalu arahkan kembali ke konteks belajar.`

    : `Kamu adalah guru ahli Indonesia yang menguasai Kurikulum Merdeka, CP, ATP, dan seluruh mata pelajaran SD, SMP, SMA, SMK. Jelaskan step-by-step dengan bahasa sederhana, contoh nyata, dan analogi bila perlu agar siswa benar-benar paham konsep. Jangan mengarang; pecah materi kompleks menjadi bagian kecil. Jika di luar pelajaran, jawab singkat lalu arahkan kembali ke pembelajaran.`;
}

// ==========================
// OPENAI EXECUTOR
// ==========================
async function executeOpenAI({ model, systemPrompt, message, max_tokens }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    return response;

  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ==========================
// CIRCUIT BREAKER
// ==========================
const breaker = new CircuitBreaker(executeOpenAI, {
  timeout: 20000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
});

// ==========================
// RETRY BACKOFF
// ==========================
async function retryWithBackoff(fn, retries = 3) {
  let delay = 1000;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

// ==========================
// FALLBACK CASCADE
// ==========================
async function callWithFallback(message, systemPrompt, model, max_tokens) {
  const fallbackChain = {
    "gpt-5": ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
    "gpt-5-mini": ["gpt-5-mini", "gpt-5-nano"],
    "gpt-5-nano": ["gpt-5-nano"]
  };

  for (const currentModel of fallbackChain[model]) {
    try {
      return await retryWithBackoff(() =>
        breaker.fire({
          model: currentModel,
          systemPrompt,
          message,
          max_tokens
        })
      );
    } catch {}
  }

  throw new Error("All fallback models failed");
}

// ==========================
// SAVE LOG ASYNC LIGHTWEIGHT
// ==========================
async function saveUsageLog(data) {
  supabase.from("ai_logs").insert([data]).then().catch(console.error);
}

// ==========================
// ROOT
// ==========================
app.get("/", (req, res) => {
  res.send("V5 Lite Railway Ready 🚀");
});

// ==========================
// HEALTH
// ==========================
app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    redis: redis.status,
    breakerOpen: breaker.opened
  });
});

// ==========================
// CHAT
// ==========================
app.post("/chat", async (req, res) => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    const { message } = req.body;
    const { tenantId, userId, plan } = req.tenant;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message wajib diisi"
      });
    }

    const cacheKey =
      `${tenantId}:${userId}:${message.trim().toLowerCase()}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        cached: true
      });
    }

    let model = pilihModel(message);
    model = enforcePlanAccess(plan, model);

    if (!ALLOWED_MODELS.includes(model)) {
      model = "gpt-5-mini";
    }

    const mode = modeBelajar(message);
    const max_tokens = limitOutput(mode);
    const systemPrompt = buildPrompt(mode);

    const response = await callWithFallback(
      message,
      systemPrompt,
      model,
      max_tokens
    );

    const totalTokens =
      response.usage?.total_tokens || 0;

    const result = {
      reply: response.choices[0].message.content,
      mode,
      model,
      requestId,
      cached: false
    };

    await setCache(cacheKey, result);

    saveUsageLog({
      request_id: requestId,
      tenant_id: tenantId,
      user_id: userId,
      model,
      mode,
      total_tokens: totalTokens,
      latency_ms: Date.now() - startTime,
      created_at: new Date().toISOString()
    });

    return res.json(result);

  } catch (error) {
    logEvent("error", {
      requestId,
      error: error.message
    });

    return res.status(500).json({
      error: error.message || "Terjadi kesalahan server"
    });
  }
});

// ==========================
// START
// ==========================
app.listen(PORT, () => {
  console.log(`V5 Lite Railway server jalan di port ${PORT}`);
});
