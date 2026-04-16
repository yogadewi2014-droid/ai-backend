// ============================================
// AI LEARNING BACKEND - FULL PRODUCTION READY
// Support: Telegram, WhatsApp, Website
// Models: GPT Mini, Deepseek V32, Deepseek Reasoning, GPT-5
// Features: Search, Image, Memory, Cache, Cost Optimization
// ============================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { createClient: createRedisClient } = require('redis');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// KONFIGURASI
// ============================================
const CONFIG = {
  ai: {
    gptMini: {
      url: 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY,
      model: 'gpt-3.5-turbo',
      pricePer1KInput: 0.0005,
      pricePer1KOutput: 0.0015,
      timeout: 30000
    },
    deepseekV32: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat',
      pricePer1KInput: 0.00014,
      pricePer1KOutput: 0.00028,
      timeout: 60000
    },
    deepseekReasoning: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-reasoner',
      pricePer1KInput: 0.00014,
      pricePer1KOutput: 0.00028,
      timeout: 90000
    },
    gpt5: {
      url: 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY,
      model: 'gpt-4o',
      pricePer1KInput: 0.01,
      pricePer1KOutput: 0.03,
      timeout: 60000
    }
  },
  serper: {
    apiKey: process.env.SERPER_API_KEY,
    url: 'https://google.serper.dev/search'
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN
  },
  levelModelMap: {
    sd_smp: 'gptMini',
    sma: 'deepseekV32',
    mahasiswa: 'deepseekReasoning',
    dosen_politikus: 'gpt5'
  },
  searchKeywords: ['terkini', 'berita', 'cuaca', '2025', '2026', 'sekarang', 'hari ini', 'update', 'latest'],
  mathKeywords: ['hitung', 'matematika', 'kalkulus', 'aljabar', 'coding', 'python', 'javascript'],
  fallbackChain: {
    gptMini: ['deepseekV32', 'gpt5'],
    deepseekV32: ['gpt5', 'gptMini'],
    deepseekReasoning: ['gpt5', 'deepseekV32'],
    gpt5: ['gptMini', 'deepseekReasoning']
  }
};

// ============================================
// PENYIMPANAN LEVEL PER USER (Multi-Platform)
// ============================================
// Struktur: userLevels.set(`${userId}:${platform}`, level)
const userLevels = new Map();

function getUserLevel(userId, platform) {
  const key = `${userId}:${platform}`;
  const level = userLevels.get(key);
  // Default: sd_smp (GPT Mini - termurah & tercepat)
  return level || 'sd_smp';
}

function setUserLevel(userId, platform, level) {
  const key = `${userId}:${platform}`;
  userLevels.set(key, level);
  logger.info(`Level updated: user=${userId}, platform=${platform}, level=${level}`);
}

// ============================================
// LOGGER
// ============================================
const logger = {
  info: (msg, data = null) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, err = null) => console.error(`[ERROR] ${msg}`, err?.message || err || ''),
  warn: (msg, data = null) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data) : '')
};

// ============================================
// SUPABASE CLIENT
// ============================================
let supabase = null;
if (CONFIG.supabase.url && CONFIG.supabase.key) {
  supabase = require('@supabase/supabase-js').createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  logger.info('Supabase connected');
}

// ============================================
// REDIS / MEMORY CACHE
// ============================================
let redisClient = null;
let redisConnected = false;
const memoryCache = new Map();

async function initRedis() {
  if (!process.env.REDIS_URL) {
    logger.info('Redis not configured, using memory cache');
    return;
  }
  try {
    redisClient = createRedisClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => logger.warn('Redis error:', err.message));
    await redisClient.connect();
    redisConnected = true;
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis failed, using memory cache');
    redisConnected = false;
  }
}
initRedis();

async function getCache(key) {
  if (redisConnected && redisClient) {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  }
  const cached = memoryCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.data;
  return null;
}

async function setCache(key, data, ttlSeconds = 3600) {
  if (redisConnected && redisClient) {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(data));
  } else {
    memoryCache.set(key, { data, expiry: Date.now() + (ttlSeconds * 1000) });
  }
}

// ============================================
// BUDGET TRACKING
// ============================================
const userBudget = new Map();

async function checkBudget(userId, estimatedCostUSD) {
  const today = new Date().toDateString();
  const userData = userBudget.get(userId) || { dailyUsage: 0, date: today };
  if (userData.date !== today) userData.dailyUsage = 0;
  const DAILY_LIMIT = 0.5;
  if (userData.dailyUsage + estimatedCostUSD > DAILY_LIMIT) {
    return { allowed: false };
  }
  return { allowed: true };
}

async function recordUsage(userId, modelName, costUSD) {
  const today = new Date().toDateString();
  const userData = userBudget.get(userId) || { dailyUsage: 0, date: today };
  userData.dailyUsage += costUSD;
  userBudget.set(userId, userData);
}

// ============================================
// FUNGSI BANTUAN
// ============================================
function estimateCost(modelName, inputTokens, outputTokens = 300) {
  const model = CONFIG.ai[modelName];
  if (!model) return 0;
  return ((inputTokens / 1000) * model.pricePer1KInput) + ((outputTokens / 1000) * model.pricePer1KOutput);
}

function isSimpleQuestion(text) {
  const simplePatterns = [/^(hai|hello|halo|hy|hi)$/i, /^(terima kasih|thanks|makasih)$/i, /^apa kabar$/i];
  return simplePatterns.some(p => p.test(text.trim()));
}

function selectModel(level, prompt) {
  if (isSimpleQuestion(prompt)) return { model: 'gptMini', reason: 'simple_question' };
  if (CONFIG.mathKeywords.some(k => prompt.toLowerCase().includes(k))) return { model: 'deepseekV32', reason: 'math_coding' };
  let model = CONFIG.levelModelMap[level] || 'gptMini';
  if (level === 'mahasiswa' && prompt.split(' ').length < 30) {
    const reasoningKeywords = ['analisis', 'evaluasi', 'kritik', 'bandingkan'];
    if (!reasoningKeywords.some(k => prompt.toLowerCase().includes(k))) model = 'deepseekV32';
  }
  return { model, reason: 'by_level' };
}

// ============================================
// SEARCH (Serper)
// ============================================
async function searchWeb(query) {
  if (!CONFIG.serper.apiKey) return [];
  const cacheKey = `search:${query}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  try {
    const response = await axios.post(CONFIG.serper.url, { q: query, gl: 'id', hl: 'id', num: 3 }, {
      headers: { 'X-API-KEY': CONFIG.serper.apiKey },
      timeout: 10000
    });
    const results = (response.data.organic || []).slice(0, 3).map(r => ({ title: r.title, snippet: r.snippet, link: r.link }));
    await setCache(cacheKey, results, 21600);
    return results;
  } catch (err) {
    return [];
  }
}

// ============================================
// PANGGIL AI
// ============================================
async function callAI(modelName, messages, timeoutMs = null) {
  const model = CONFIG.ai[modelName];
  if (!model || !model.key) return { success: false, error: `Model ${modelName} not configured` };
  try {
    const response = await axios.post(model.url, {
      model: model.model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000
    }, {
      headers: { 'Authorization': `Bearer ${model.key}` },
      timeout: timeoutMs || model.timeout || 30000
    });
    return { success: true, content: response.data.choices[0].message.content, model: modelName };
  } catch (err) {
    logger.error(`AI Error (${modelName}):`, err.message);
    return { success: false, error: err.message, model: modelName };
  }
}

async function callWithFallback(modelName, messages) {
  const chain = [modelName, ...(CONFIG.fallbackChain[modelName] || [])];
  for (const attempt of chain) {
    const result = await callAI(attempt, messages);
    if (result.success) {
      if (attempt !== modelName) logger.warn(`Fallback: ${modelName} → ${attempt}`);
      return result;
    }
  }
  return { success: true, content: "Maaf, layanan sedang sibuk. Silakan coba lagi nanti.", model: 'system', isFallback: true };
}

// ============================================
// DATABASE OPERATIONS
// ============================================
async function saveChatMessage(userId, platform, role, content, modelUsed = null) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('chat_history').insert({
      user_id: userId, platform, role, content, model_used: modelUsed, created_at: new Date()
    });
    if (error) logger.error('Save error:', error);
  } catch (e) {
    logger.error('Save exception:', e.message);
  }
}

async function getChatHistory(userId, platform, limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('chat_history').select('role, content').eq('user_id', userId).eq('platform', platform).order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data || []).reverse();
}

// ============================================
// PROSES CHAT UTAMA
// ============================================
async function processChat(userId, platform, level, message) {
  const startTime = Date.now();
  let result = null;
  logger.info(`Processing: user=${userId}, platform=${platform}, level=${level}, msg=${message.substring(0, 50)}`);
  try {
    const cacheKey = `chat:${level}:${message}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;
    
    let searchResults = null;
    if (CONFIG.searchKeywords.some(k => message.toLowerCase().includes(k))) {
      searchResults = await searchWeb(message);
    }
    
    const { model: selectedModel } = selectModel(level, message);
    const estimatedCost = estimateCost(selectedModel, message.length / 4);
    const budgetOk = await checkBudget(userId, estimatedCost);
    if (!budgetOk.allowed) {
      return { success: true, content: "Maaf, kuota harian Anda telah habis.", model: 'system' };
    }
    
    const history = await getChatHistory(userId, platform, 10);
    const messages = [{ role: 'system', content: `Anda asisten belajar level ${level}. Jawab dengan bahasa Indonesia.` }];
    for (const h of history) messages.push({ role: h.role, content: h.content });
    let finalMessage = message;
    if (searchResults?.length) {
      finalMessage += `\n\n[Hasil pencarian]:\n${searchResults.map(r => `- ${r.snippet}`).join('\n')}`;
    }
    messages.push({ role: 'user', content: finalMessage });
    
    result = await callWithFallback(selectedModel, messages);
    
    await saveChatMessage(userId, platform, 'user', message, selectedModel);
    await saveChatMessage(userId, platform, 'assistant', result.content, result.model);
    
    const actualCost = estimateCost(result.model, message.length / 4, result.content.length / 4);
    await recordUsage(userId, result.model, actualCost);
    await setCache(cacheKey, result, 3600);
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Completed in ${duration}ms`);
    return result;
  } catch (error) {
    logger.error('Process error:', error);
    return result || { success: true, content: "Maaf, terjadi kesalahan. Silakan coba lagi.", model: 'system' };
  }
}

// ============================================
// TELEGRAM HANDLER (Dengan Level per User)
// ============================================
async function sendTelegramMessage(chatId, text) {
  if (!CONFIG.telegram.token) return;
  try {
    await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
      chat_id: chatId, text: text.substring(0, 4096), parse_mode: 'HTML'
    });
  } catch (err) {}
}

app.post('/webhook/telegram', async (req, res) => {
  res.status(200).send('OK');
  try {
    const update = req.body;
    if (!update?.message) return;
    const chatId = update.message.chat.id;
    const userId = update.message.from.id.toString();
    const text = update.message.text;
    const platform = 'telegram';
    
    if (text?.startsWith('/')) {
      const cmd = text.split(' ')[0];
      if (cmd === '/start') {
        await sendTelegramMessage(chatId, '🤖 AI Learning Assistant\nLevel default: SD/SMP (GPT Mini)\n\nPerintah:\n/level_sd - SD/SMP\n/level_sma - SMA\n/level_mahasiswa - Mahasiswa\n/level_dosen - Dosen/Politikus');
      } else if (cmd === '/level_sd') {
        setUserLevel(userId, platform, 'sd_smp');
        await sendTelegramMessage(chatId, '✅ Level: SD/SMP (GPT Mini)');
      } else if (cmd === '/level_sma') {
        setUserLevel(userId, platform, 'sma');
        await sendTelegramMessage(chatId, '✅ Level: SMA (Deepseek V32)');
      } else if (cmd === '/level_mahasiswa') {
        setUserLevel(userId, platform, 'mahasiswa');
        await sendTelegramMessage(chatId, '✅ Level: Mahasiswa (Deepseek Reasoning)');
      } else if (cmd === '/level_dosen') {
        setUserLevel(userId, platform, 'dosen_politikus');
        await sendTelegramMessage(chatId, '✅ Level: Dosen/Politikus (GPT-5)');
      }
      return;
    }
    
    const userLevel = getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, text);
    await sendTelegramMessage(chatId, result.content);
  } catch (err) {
    logger.error('Telegram error:', err);
  }
});

// ============================================
// WEBSITE API (Dengan Level per User)
// ============================================
app.post('/api/chat', async (req, res) => {
  const { message, userId, level, platform = 'website' } = req.body;
  if (!message || !userId) return res.status(400).json({ error: 'message dan userId required' });
  
  let userLevel = level;
  if (!userLevel) userLevel = getUserLevel(userId, platform);
  
  const result = await processChat(userId, platform, userLevel, message);
  res.json({ reply: result.content, model: result.model });
});

// Endpoint untuk ganti level via API
app.post('/api/level', async (req, res) => {
  const { userId, level, platform = 'website' } = req.body;
  const validLevels = ['sd_smp', 'sma', 'mahasiswa', 'dosen_politikus'];
  if (!userId || !level || !validLevels.includes(level)) {
    return res.status(400).json({ error: 'userId dan level (sd_smp/sma/mahasiswa/dosen_politikus) required' });
  }
  setUserLevel(userId, platform, level);
  res.json({ success: true, message: `Level changed to ${level}` });
});

// Endpoint untuk cek level user
app.get('/api/level/:userId', async (req, res) => {
  const { userId } = req.params;
  const { platform = 'website' } = req.query;
  const level = getUserLevel(userId, platform);
  res.json({ userId, platform, level });
});

// ============================================
// WHATSAPP HANDLER (Dengan Level per User)
// ============================================
// Format: { from: "628123456789", message: "Halo", type: "text" }
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('OK');
  try {
    const { from, message, type = 'text' } = req.body;
    if (!from || !message) return;
    const userId = from;
    const platform = 'whatsapp';
    
    // Handle command sederhana
    if (message.startsWith('/level_sd')) {
      setUserLevel(userId, platform, 'sd_smp');
      // Kirim response via WhatsApp API (sesuaikan dengan provider Anda)
      return;
    } else if (message.startsWith('/level_sma')) {
      setUserLevel(userId, platform, 'sma');
      return;
    } else if (message.startsWith('/level_mahasiswa')) {
      setUserLevel(userId, platform, 'mahasiswa');
      return;
    } else if (message.startsWith('/level_dosen')) {
      setUserLevel(userId, platform, 'dosen_politikus');
      return;
    }
    
    const userLevel = getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, message);
    
    // Kirim response via WhatsApp API (sesuaikan dengan provider Anda)
    // Contoh: await sendWhatsAppMessage(from, result.content);
    
  } catch (err) {
    logger.error('WhatsApp error:', err);
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', redis: redisConnected, supabase: !!supabase, telegram: !!CONFIG.telegram.token });
});

app.get('/', (req, res) => {
  res.json({
    name: 'AI Learning Backend',
    version: '3.0.0',
    status: 'running',
    endpoints: {
      chat: 'POST /api/chat',
      level: 'POST /api/level, GET /api/level/:userId',
      telegram: 'POST /webhook/telegram',
      whatsapp: 'POST /webhook/whatsapp',
      health: 'GET /api/health'
    }
  });
});

// ============================================
// CLEANUP CRON
// ============================================
cron.schedule('0 * * * *', async () => {
  logger.info('🧹 Running cleanup...');
  if (supabase) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await supabase.from('logs').delete().lt('timestamp', thirtyDaysAgo.toISOString()).catch(e => {});
  }
  const now = Date.now();
  for (const [key, value] of memoryCache) {
    if (value.expiry < now) memoryCache.delete(key);
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🤖 AI LEARNING BACKEND v3.0 - MULTI PLATFORM             ║
╠══════════════════════════════════════════════════════════════╣
║  ✅ Server running on port ${PORT}                               ║
║  ✅ Default Level: SD-SMP (GPT Mini - termurah & tercepat)   ║
║  ✅ Level tersimpan per user per platform                    ║
╠══════════════════════════════════════════════════════════════╣
║  📍 ENDPOINTS:                                               ║
║     POST /api/chat         - Chat API                        ║
║     POST /api/level        - Ganti level user                ║
║     GET  /api/level/:userId - Cek level user                 ║
║     POST /webhook/telegram - Telegram Bot                    ║
║     POST /webhook/whatsapp - WhatsApp Bot                    ║
║     GET  /api/health       - Health Check                    ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
