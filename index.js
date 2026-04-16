// ============================================
// AI LEARNING BACKEND v3.0 - MULTI PLATFORM
// Fitur: Tanya Level di Awal (Telegram, WA, Website)
// Default: User HARUS pilih level sebelum chat
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
  levelNames: {
    sd_smp: 'SD/SMP (GPT Mini)',
    sma: 'SMA (Deepseek V32)',
    mahasiswa: 'Mahasiswa (Deepseek Reasoning)',
    dosen_politikus: 'Dosen/Politikus (GPT-5)'
  },
  levelPrices: {
    sd_smp: '~Rp 4/chat ⚡ cepat',
    sma: '~Rp 2.300/chat',
    mahasiswa: '~Rp 2.300/chat',
    dosen_politikus: '~Rp 211/chat'
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
const userLevels = new Map();        // key: "userId:platform" → level
const userHasChosen = new Map();     // key: "userId:platform" → boolean (sudah pilih level)

function getUserLevel(userId, platform) {
  const key = `${userId}:${platform}`;
  return userLevels.get(key) || 'sd_smp';
}

function setUserLevel(userId, platform, level) {
  const key = `${userId}:${platform}`;
  userLevels.set(key, level);
  console.log(`[LEVEL] ${platform}:${userId} → ${level}`);
}

function hasUserChosenLevel(userId, platform) {
  const key = `${userId}:${platform}`;
  return userHasChosen.get(key) || false;
}

function setUserChosenLevel(userId, platform, chosen = true) {
  const key = `${userId}:${platform}`;
  userHasChosen.set(key, chosen);
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
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  logger.info('Supabase connected');
} else {
  logger.warn('Supabase not configured');
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

function getLevelInfoText() {
  return `
💰 *Pilih Level Belajar Anda* (berpengaruh pada biaya):

/level_sd - *SD/SMP* (GPT Mini)
   Biaya: ${CONFIG.levelPrices.sd_smp}

/level_sma - *SMA* (Deepseek V32)
   Biaya: ${CONFIG.levelPrices.sma}

/level_mahasiswa - *Mahasiswa* (Deepseek Reasoning)
   Biaya: ${CONFIG.levelPrices.mahasiswa}

/level_dosen - *Dosen/Politikus* (GPT-5)
   Biaya: ${CONFIG.levelPrices.dosen_politikus}

Ketik perintah di atas untuk memilih level.
`;
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
    const messages = [{ role: 'system', content: `Anda asisten belajar level ${level}. Jawab dengan bahasa Indonesia yang baik dan benar.` }];
    for (const h of history) messages.push({ role: h.role, content: h.content });
    let finalMessage = message;
    if (searchResults?.length) {
      finalMessage += `\n\n[Hasil pencarian dari internet]:\n${searchResults.map(r => `- ${r.snippet}`).join('\n')}`;
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
// TELEGRAM HANDLER (Dengan Tanya Level di Awal)
// ============================================
async function sendTelegramMessage(chatId, text) {
  if (!CONFIG.telegram.token) return;
  try {
    await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
      chat_id: chatId,
      text: text.substring(0, 4096),
      parse_mode: 'Markdown'
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
    const text = update.message.text || '';
    const platform = 'telegram';
    
    // Handle commands
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0];
      
      if (cmd === '/start') {
        await sendTelegramMessage(chatId, getLevelInfoText());
        return;
      }
      
      if (cmd === '/level_sd') {
        setUserLevel(userId, platform, 'sd_smp');
        setUserChosenLevel(userId, platform, true);
        await sendTelegramMessage(chatId, '✅ Level: SD/SMP (GPT Mini) - Biaya ~Rp 4/chat\nSekarang kirim pertanyaan Anda!');
        return;
      }
      
      if (cmd === '/level_sma') {
        setUserLevel(userId, platform, 'sma');
        setUserChosenLevel(userId, platform, true);
        await sendTelegramMessage(chatId, '✅ Level: SMA (Deepseek V32) - Biaya ~Rp 2.300/chat\nSekarang kirim pertanyaan Anda!');
        return;
      }
      
      if (cmd === '/level_mahasiswa') {
        setUserLevel(userId, platform, 'mahasiswa');
        setUserChosenLevel(userId, platform, true);
        await sendTelegramMessage(chatId, '✅ Level: Mahasiswa (Deepseek Reasoning) - Biaya ~Rp 2.300/chat\nSekarang kirim pertanyaan Anda!');
        return;
      }
      
      if (cmd === '/level_dosen') {
        setUserLevel(userId, platform, 'dosen_politikus');
        setUserChosenLevel(userId, platform, true);
        await sendTelegramMessage(chatId, '✅ Level: Dosen/Politikus (GPT-5) - Biaya ~Rp 211/chat\nSekarang kirim pertanyaan Anda!');
        return;
      }
      
      if (cmd === '/reset_level') {
        setUserChosenLevel(userId, platform, false);
        await sendTelegramMessage(chatId, '🔄 Level telah direset. Kirim /start untuk memilih level baru.');
        return;
      }
      
      await sendTelegramMessage(chatId, 'Perintah tidak dikenal. Gunakan /start untuk melihat daftar perintah.');
      return;
    }
    
    // ========== PENGECEKAN: Apakah user sudah pilih level? ==========
    const sudahPilihLevel = hasUserChosenLevel(userId, platform);
    
    if (!sudahPilihLevel) {
      await sendTelegramMessage(chatId, getLevelInfoText());
      return;
    }
    
    // User sudah pilih level, proses chat
    const userLevel = getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, text);
    await sendTelegramMessage(chatId, result.content);
    
  } catch (err) {
    logger.error('Telegram error:', err);
  }
});

// ============================================
// WEBSITE API (Dengan Pengecekan Level)
// ============================================

// Endpoint untuk mendapatkan informasi level yang tersedia
app.get('/api/levels', (req, res) => {
  res.json({
    levels: [
      { id: 'sd_smp', name: CONFIG.levelNames.sd_smp, price: CONFIG.levelPrices.sd_smp },
      { id: 'sma', name: CONFIG.levelNames.sma, price: CONFIG.levelPrices.sma },
      { id: 'mahasiswa', name: CONFIG.levelNames.mahasiswa, price: CONFIG.levelPrices.mahasiswa },
      { id: 'dosen_politikus', name: CONFIG.levelNames.dosen_politikus, price: CONFIG.levelPrices.dosen_politikus }
    ]
  });
});

// Endpoint untuk cek apakah user sudah pilih level
app.get('/api/level/status/:userId', async (req, res) => {
  const { userId } = req.params;
  const { platform = 'website' } = req.query;
  const hasChosen = hasUserChosenLevel(userId, platform);
  const level = getUserLevel(userId, platform);
  res.json({ userId, platform, hasChosen, level, levelInfo: CONFIG.levelNames[level] });
});

// Endpoint untuk ganti level (dan tandai sudah pilih)
app.post('/api/level', async (req, res) => {
  const { userId, level, platform = 'website' } = req.body;
  const validLevels = ['sd_smp', 'sma', 'mahasiswa', 'dosen_politikus'];
  
  if (!userId || !level || !validLevels.includes(level)) {
    return res.status(400).json({ 
      error: 'userId dan level (sd_smp/sma/mahasiswa/dosen_politikus) required' 
    });
  }
  
  setUserLevel(userId, platform, level);
  setUserChosenLevel(userId, platform, true);
  res.json({ success: true, message: `Level changed to ${level}`, levelInfo: CONFIG.levelNames[level] });
});

// Endpoint chat utama (dengan pengecekan level)
app.post('/api/chat', async (req, res) => {
  const { message, userId, level, platform = 'website' } = req.body;
  
  if (!message || !userId) {
    return res.status(400).json({ error: 'message dan userId required' });
  }
  
  // Jika user tidak mengirim level di request, cek dari storage
  let userLevel = level;
  if (!userLevel) {
    const hasChosen = hasUserChosenLevel(userId, platform);
    if (!hasChosen) {
      return res.status(400).json({ 
        error: 'Belum pilih level', 
        message: 'Silakan pilih level terlebih dahulu via POST /api/level',
        availableLevels: ['sd_smp', 'sma', 'mahasiswa', 'dosen_politikus']
      });
    }
    userLevel = getUserLevel(userId, platform);
  }
  
  const result = await processChat(userId, platform, userLevel, message);
  res.json({ reply: result.content, model: result.model });
});

// ============================================
// WHATSAPP HANDLER (Dengan Tanya Level di Awal)
// ============================================
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('OK');
  try {
    const { from, message, type = 'text' } = req.body;
    if (!from || !message) return;
    
    const userId = from;
    const platform = 'whatsapp';
    
    // Handle command level
    if (message === '/level_sd') {
      setUserLevel(userId, platform, 'sd_smp');
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to sd_smp (GPT Mini)`);
      // TODO: Kirim response ke WhatsApp: "✅ Level: SD/SMP - Biaya ~Rp 4/chat"
      return;
    }
    
    if (message === '/level_sma') {
      setUserLevel(userId, platform, 'sma');
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to sma (Deepseek V32)`);
      return;
    }
    
    if (message === '/level_mahasiswa') {
      setUserLevel(userId, platform, 'mahasiswa');
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to mahasiswa (Deepseek Reasoning)`);
      return;
    }
    
    if (message === '/level_dosen') {
      setUserLevel(userId, platform, 'dosen_politikus');
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to dosen_politikus (GPT-5)`);
      return;
    }
    
    if (message === '/start' || message === '/help') {
      console.log(`[WA] Help requested by ${from}`);
      // TODO: Kirim response ke WhatsApp dengan info level
      return;
    }
    
    // Cek apakah user sudah pilih level
    const sudahPilihLevel = hasUserChosenLevel(userId, platform);
    
    if (!sudahPilihLevel) {
      console.log(`[WA] User ${from} belum pilih level, kirim prompt`);
      // TODO: Kirim response ke WhatsApp: getLevelInfoText() dalam format teks biasa
      return;
    }
    
    // User sudah pilih level, proses chat
    const userLevel = getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, message);
    
    // TODO: Kirim response ke WhatsApp: result.content
    console.log(`[WA] Response to ${from}: ${result.content.substring(0, 100)}...`);
    
  } catch (err) {
    logger.error('WhatsApp error:', err);
  }
});

// ============================================
// HEALTH CHECK & ROOT
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    redis: redisConnected, 
    supabase: !!supabase, 
    telegram: !!CONFIG.telegram.token,
    version: '3.0.0'
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'AI Learning Backend',
    version: '3.0.0',
    status: 'running',
    features: {
      level_selection: 'User MUST choose level before chatting',
      default_level: 'sd_smp (GPT Mini)'
    },
    endpoints: {
      chat: 'POST /api/chat',
      level: 'POST /api/level, GET /api/level/status/:userId, GET /api/levels',
      telegram: 'POST /webhook/telegram',
      whatsapp: 'POST /webhook/whatsapp',
      health: 'GET /api/health'
    }
  });
});

// ============================================
// CLEANUP CRON (setiap jam)
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
╔══════════════════════════════════════════════════════════════════════════════╗
║              🤖 AI LEARNING BACKEND v3.0 - MULTI PLATFORM                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ✅ Server running on port ${PORT}                                                ║
║  ✅ Default: User HARUS pilih level sebelum chat (transparent pricing)        ║
║  ✅ Level tersimpan per user per platform                                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  📍 ENDPOINTS:                                                                ║
║     GET  /                    - Info server                                   ║
║     GET  /api/health          - Health check                                  ║
║     GET  /api/levels          - Daftar level & biaya                          ║
║     POST /api/chat            - Chat API (wajib pilih level dulu)             ║
║     POST /api/level           - Ganti level user                              ║
║     GET  /api/level/status/:userId - Cek level user                           ║
║     POST /webhook/telegram    - Telegram Bot Webhook                          ║
║     POST /webhook/whatsapp    - WhatsApp Bot Webhook                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  💰 LEVEL & BIAYA (transparan ke user):                                       ║
║     sd_smp        : Rp 4/chat (GPT Mini)                                      ║
║     sma           : Rp 2.300/chat (Deepseek V32)                              ║
║     mahasiswa     : Rp 2.300/chat (Deepseek Reasoning)                        ║
║     dosen_politikus: Rp 211/chat (GPT-5/GPT-4o)                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
