import express from "express";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import CircuitBreaker from "opossum";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

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

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log("✅ Supabase connected");

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
    ? `Kamu adalah guru profesional Indonesia yang menguasai Kurikulum Merdeka, CP, ATP, dan seluruh mata pelajaran SD, SMP, SMA, SMK. Jawab singkat, jelas, akurat, ramah, mudah dipahami siswa.`
    : `Kamu adalah guru ahli Indonesia yang menguasai Kurikulum Merdeka, CP, ATP, dan seluruh mata pelajaran SD, SMP, SMA, SMK. Jelaskan step-by-step dengan bahasa sederhana.`;
}

// ==========================
// OPENAI EXECUTOR
// ==========================
async function executeOpenAI({ model, systemPrompt, message, max_completion_tokens }) {
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
        max_completion_tokens,
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

// =========================
// GENERATE JWT TOKEN
// =========================
app.post("/token", (req, res) => {
  try {
    const { tenantId, userId, plan } = req.body;

    if (!tenantId || !userId || !plan) {
      return res.status(400).json({
        error: "tenantId, userId, dan plan wajib diisi"
      });
    }

    const token = jwt.sign(
      {
        tenantId,
        userId,
        plan
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    res.json({
      success: true,
      token
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// ==========================
// CHAT ENDPOINT
// ==========================
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "Message wajib diisi"
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: "Kamu adalah guru AI pintar Indonesia."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_completion_tokens: 500
    });
    console.log(JSON.stringify(response, null, 2));
    const reply =
      response.choices?.[0]?.message?.content?.trim() ||
      "Tidak ada jawaban";

    res.json({
      reply
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// ==========================
// START
// ==========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ V5 Lite Railway server jalan di port ${PORT}`);
});
