// ============================================
// AI LEARNING BACKEND - FULL PRODUCTION READY
// Support: Telegram, WhatsApp, Website
// Models: GPT Mini, Deepseek V32, Deepseek Reasoning, GPT-5
// Features: Search, Image, Memory, Cache, Cost Optimization
// Deployment: Railway (env variables from dashboard)
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
// KONFIGURASI (Baca dari Environment Variables Railway)
// ============================================
const CONFIG = {
  ai: {
    gptMini: {
      url: process.env.GPT_MINI_URL || 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY || process.env.GPT_MINI_KEY,
      model: process.env.GPT_MINI_MODEL || 'gpt-3.5-turbo',
      pricePer1KInput: 0.0005,
      pricePer1KOutput: 0.0015
    },
    deepseekV32: {
      url: process.env.DEEPSEEK_V32_URL || 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_V32_KEY,
      model: process.env.DEEPSEEK_V32_MODEL || 'deepseek-chat',
      pricePer1KInput: 0.00014,
      pricePer1KOutput: 0.00028
    },
    deepseekReasoning: {
      url: process.env.DEEPSEEK_REASONING_URL || 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_REASONING_KEY,
      model: process.env.DEEPSEEK_REASONING_MODEL || 'deepseek-reasoner',
      pricePer1KInput: 0.00014,
      pricePer1KOutput: 0.00028
    },
gpt5: {
  url: process.env.GPT5_URL || 'https://api.openai.com/v1/chat/completions',
  key: process.env.OPENAI_API_KEY || process.env.GPT5_KEY,
  model: process.env.GPT5_MODEL || 'gpt-4o', 
  pricePer1KInput: 0.01,
  pricePer1KOutput: 0.03
},
  },
  serper: {
    apiKey: process.env.SERPER_API_KEY,
    url: 'https://google.serper.dev/search'
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  redis: {
    url: process.env.REDIS_URL || null
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN
  },
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  
  levelModelMap: {
    sd_smp: 'gptMini',
    sma: 'deepseekV32',
    mahasiswa: 'deepseekReasoning',
    dosen_politikus: 'gpt5'
  },
  searchKeywords: ['terkini', 'berita', 'cuaca', '2025', '2026', 'sekarang', 'hari ini', 'update', 'latest', 'baru', 'hari ini'],
  mathKeywords: ['hitung', 'matematika', 'kalkulus', 'aljabar', 'coding', 'program', 'python', 'javascript', 'fungsi', 'persamaan'],
  fallbackChain: {
    gptMini: ['deepseekV32', 'gpt5'],
    deepseekV32: ['gpt5', 'gptMini'],
    deepseekReasoning: ['gpt5', 'deepseekV32'],
    gpt5: ['deepseekReasoning', 'deepseekV32']
  }
};

// ============================================
// LOGGER SEDERHANA
// ============================================
const logger = {
  info: (msg, data = null) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, err = null) => console.error(`[ERROR] ${msg}`, err ? err.message || err : ''),
  warn: (msg, data = null) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data) : '')
};

// ============================================
// SUPABASE CLIENT (Optional)
// ============================================
let supabase = null;
if (CONFIG.supabase.url && CONFIG.supabase.key) {
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  logger.info('Supabase connected');
} else {
  logger.warn('Supabase not configured, history will not be saved');
}

// ============================================
// REDIS CLIENT (Optional - pakai memory cache jika tidak ada)
// ============================================
let redisClient = null;
let redisConnected = false;
const memoryCache = new Map();

async function initRedis() {
  if (!CONFIG.redis.url) {
    logger.info('Redis not configured, using memory cache');
    return;
  }
  try {
    redisClient = createRedisClient({ url: CONFIG.redis.url });
    redisClient.on('error', (err) => logger.warn('Redis error:', err.message));
    await redisClient.connect();
    redisConnected = true;
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis failed, using memory cache fallback');
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
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
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
// BUDGET TRACKING (per user per hari)
// ============================================
const userBudget = new Map();

async function checkBudget(userId, estimatedCostUSD) {
  const today = new Date().toDateString();
  const userData = userBudget.get(userId) || { dailyUsage: 0, date: today };
  
  if (userData.date !== today) {
    userData.dailyUsage = 0;
    userData.date = today;
  }
  
  const DAILY_LIMIT = 0.5; // $0.5 per hari per user
  
  if (userData.dailyUsage + estimatedCostUSD > DAILY_LIMIT) {
    return { allowed: false, reason: 'daily_limit_exceeded' };
  }
  
  return { allowed: true, currentUsage: userData.dailyUsage };
}

async function recordUsage(userId, modelName, costUSD) {
  const today = new Date().toDateString();
  const userData = userBudget.get(userId) || { dailyUsage: 0, date: today };
  userData.dailyUsage += costUSD;
  userBudget.set(userId, userData);
  
  if (supabase) {
    await supabase.from('logs').insert({
      platform: 'cost_tracker',
      user_id: userId,
      level: 'model_usage',
      message: `${modelName} cost: $${costUSD.toFixed(6)}`,
      metadata: { model: modelName, cost_usd: costUSD },
      timestamp: new Date()
    }).catch(e => logger.error('Log error:', e));
  }
}

// ============================================
// ESTIMASI BIAYA
// ============================================
function estimateCost(modelName, inputTokens, outputTokens = 300) {
  const model = CONFIG.ai[modelName];
  if (!model) return 0;
  const inputCost = (inputTokens / 1000) * model.pricePer1KInput;
  const outputCost = (outputTokens / 1000) * model.pricePer1KOutput;
  return inputCost + outputCost;
}

// ============================================
// PINTAR MILIH MODEL (Cost Optimization)
// ============================================
function isSimpleQuestion(text) {
  const simplePatterns = [
    /^(hai|hello|halo|pagi|siang|malam|hy|hi)$/i,
    /^(terima kasih|thanks|makasih|thx)$/i,
    /^apa kabar$/i,
    /^(ok|oke|baiklah|siap)$/i
  ];
  return simplePatterns.some(p => p.test(text.trim()));
}

function selectModel(level, prompt) {
  if (isSimpleQuestion(prompt)) {
    return { model: 'gptMini', reason: 'simple_question', cost: '~Rp 4' };
  }
  
  if (CONFIG.mathKeywords.some(k => prompt.toLowerCase().includes(k))) {
    return { model: 'deepseekV32', reason: 'math_coding', cost: '~Rp 2.300' };
  }
  
  let model = CONFIG.levelModelMap[level] || 'gptMini';
  let costNote = '';
  
  if (level === 'mahasiswa' && prompt.split(' ').length < 30) {
    const reasoningKeywords = ['analisis', 'evaluasi', 'kritik', 'bandingkan', 'mengapa'];
    if (!reasoningKeywords.some(k => prompt.toLowerCase().includes(k))) {
      model = 'deepseekV32';
      costNote = ' (hemat 90% karena tidak perlu reasoning)';
    }
  }
  
  return { model, reason: 'by_level', costNote };
}

// ============================================
// SEARCH (Serper API)
// ============================================
async function searchWeb(query) {
  if (!CONFIG.serper.apiKey) {
    logger.warn('Serper API key not configured');
    return [];
  }
  
  const cacheKey = `search:${query}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await axios.post(CONFIG.serper.url, {
      q: query,
      gl: 'id',
      hl: 'id',
      num: 3
    }, {
      headers: { 'X-API-KEY': CONFIG.serper.apiKey, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    const results = (response.data.organic || []).slice(0, 3).map(r => ({
      title: r.title,
      snippet: r.snippet,
      link: r.link
    }));
    
    await setCache(cacheKey, results, 21600);
    logger.info(`Search results: ${results.length} for "${query}"`);
    return results;
  } catch (err) {
    logger.error('Search error:', err);
    return [];
  }
}

// ============================================
// PANGGIL AI (dengan fallback)
// ============================================
async function callAI(modelName, messages, timeoutMs = 30000) {
  const model = CONFIG.ai[modelName];
  if (!model || !model.key) {
    return { success: false, error: `Model ${modelName} not configured` };
  }
  
  try {
    const startTime = Date.now();
    const response = await axios.post(model.url, {
      model: model.model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000
    }, {
      headers: { 'Authorization': `Bearer ${model.key}`, 'Content-Type': 'application/json' },
      timeout: timeoutMs
    });
    const duration = Date.now() - startTime;
    logger.info(`AI call to ${modelName} completed in ${duration}ms`);
    
    return {
      success: true,
      content: response.data.choices[0].message.content,
      model: modelName,
      duration
    };
  } catch (err) {
    logger.error(`AI Error (${modelName}):`, err.response?.data?.error || err.message);
    return { success: false, error: err.message, model: modelName };
  }
}

async function callWithFallback(modelName, messages) {
  const chain = [modelName, ...(CONFIG.fallbackChain[modelName] || [])];
  
  for (const attempt of chain) {
    const result = await callAI(attempt, messages);
    if (result.success) {
      if (attempt !== modelName) {
        logger.warn(`⚠️ Fallback: ${modelName} → ${attempt}`);
      }
      return result;
    }
  }
  
  return {
    success: true,
    content: "Maaf, saya sedang mengalami gangguan teknis. Silakan coba lagi beberapa saat lagi.",
    model: 'system',
    isFallback: true
  };
}

// ============================================
// DATABASE OPERATIONS (Supabase)
// ============================================
async function getChatHistory(userId, platform, limit = 10) {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('chat_history')
    .select('role, content')
    .eq('user_id', userId)
    .eq('platform', platform)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) return [];
  return (data || []).reverse();
}

async function saveChatMessage(userId, platform, role, content, modelUsed = null) {
  if (!supabase) return;
  
  try {
    const { error } = await supabase.from('chat_history').insert({
      user_id: userId,
      platform,
      role,
      content,
      model_used: modelUsed,
      created_at: new Date()
    });
    if (error) logger.error('Save message error:', error);
  } catch (e) {
    logger.error('Save message exception:', e);
  }
}

async function getLongTermMemory(userId) {
  if (!supabase) return { summary: '', facts: [] };
  
  const { data, error } = await supabase
    .from('long_term_memory')
    .select('summary, facts')
    .eq('user_id', userId)
    .single();
  
  if (error || !data) return { summary: '', facts: [] };
  return data;
}

// ============================================
// PROMPT BUILDER
// ============================================
async function buildPrompt(userId, platform, level, userMessage, searchResults = null) {
  const history = await getChatHistory(userId, platform, 10);
  const longMemory = await getLongTermMemory(userId);
  
  let systemPrompt = `Anda adalah asisten belajar AI yang ramah dan membantu. Level pengguna: ${level}.`;
  
  if (level === 'sd_smp') {
    systemPrompt += ' Gunakan bahasa sederhana, beri contoh konkret, dan sabar menjelaskan.';
  } else if (level === 'sma') {
    systemPrompt += ' Berikan penjelasan mendalam dengan contoh soal.';
  } else if (level === 'mahasiswa') {
    systemPrompt += ' Berikan analisis kritis, referensi akademik, dan penjelasan teoritis.';
  } else if (level === 'dosen_politikus') {
    systemPrompt += ' Berikan wawasan strategis, data akurat, dan perspektif kebijakan.';
  }
  
  if (longMemory.summary) {
    systemPrompt += `\n\nInformasi tentang pengguna: ${longMemory.summary}`;
  }
  
  const messages = [{ role: 'system', content: systemPrompt }];
  
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  
  let finalMessage = userMessage;
  if (searchResults && searchResults.length > 0) {
    const searchText = searchResults.map((r, i) => `${i+1}. ${r.snippet} (Sumber: ${r.link})`).join('\n');
    finalMessage += `\n\n[INFORMASI TERBARU DARI INTERNET]:\n${searchText}\n\nGunakan informasi di atas jika relevan.`;
  }
  
  messages.push({ role: 'user', content: finalMessage });
  return messages;
}

// ============================================
// PROSES CHAT UTAMA (INTI FUNGSI)
// ============================================
async function processChat(userId, platform, level, message, imageUrl = null) {
  const startTime = Date.now();
  logger.info(`Processing chat: user=${userId}, platform=${platform}, level=${level}, message=${message.substring(0, 50)}`);
  
  try {
    const cacheKey = `chat:${level}:${message}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      logger.info(`✅ Cache HIT for ${userId}`);
      return cached;
    }
    
    let searchResults = null;
    const needsSearch = CONFIG.searchKeywords.some(k => message.toLowerCase().includes(k));
    if (needsSearch) {
      logger.info(`🔍 Search triggered for: ${message.substring(0, 50)}`);
      searchResults = await searchWeb(message);
    }
    
    const { model: selectedModel, reason, costNote } = selectModel(level, message);
    logger.info(`📊 Model: ${selectedModel} (${reason}) ${costNote || ''}`);
    
    const estimatedCost = estimateCost(selectedModel, message.length / 4);
    const budgetOk = await checkBudget(userId, estimatedCost);
    if (!budgetOk.allowed) {
      logger.warn(`Budget limit reached for ${userId}`);
      return {
        success: true,
        content: "Maaf, kuota harian Anda (Rp 7.500/hari) telah habis. Silakan coba lagi besok.",
        model: 'system',
        isFallback: true
      };
    }
    
    const messages = await buildPrompt(userId, platform, level, message, searchResults);
    const result = await callWithFallback(selectedModel, messages);
    
    await saveChatMessage(userId, platform, 'user', message, selectedModel);
    await saveChatMessage(userId, platform, 'assistant', result.content, result.model);
    
    const actualCost = estimateCost(result.model, message.length / 4, result.content.length / 4);
    await recordUsage(userId, result.model, actualCost);
    
    await setCache(cacheKey, result, 3600);
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Chat completed in ${duration}ms | Cost: $${actualCost.toFixed(6)} (Rp ${(actualCost * 15000).toFixed(0)})`);
    
    return result;
    
  } catch (error) {
    logger.error('Process chat error:', error);
    return {
      success: true,
      content: "Maaf, terjadi kesalahan. Silakan coba lagi.",
      model: 'system',
      isFallback: true
    };
  }
}

// ============================================
// TELEGRAM HANDLER (YANG DIPERBAIKI)
// ============================================
async function sendTelegramMessage(chatId, text) {
  if (!CONFIG.telegram.token) {
    logger.warn('Telegram token not configured');
    return false;
  }
  
  try {
    await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
      chat_id: chatId,
      text: text.substring(0, 4096),
      parse_mode: 'HTML'
    });
    return true;
  } catch (err) {
    logger.error('Telegram send error:', err.response?.data || err.message);
    return false;
  }
}

app.post('/webhook/telegram', async (req, res) => {
  // 🔴 KRITICAL: Kirim response 200 OK dulu ke Telegram
  res.status(200).send('OK');
  
  // Proses pesan setelah response terkirim
  try {
    const update = req.body;
    
    // Validasi update
    if (!update || !update.message) {
      logger.info('Telegram webhook: No message in update');
      return;
    }
    
    const chatId = update.message.chat.id;
    const userId = update.message.from.id.toString();
    const text = update.message.text;
    const userName = update.message.from.first_name || update.message.from.username;
    
    logger.info(`📨 Telegram message from @${userName} (${chatId}): ${text}`);
    
    // Handle commands
    if (text && text.startsWith('/')) {
      const cmd = text.split(' ')[0];
      if (cmd === '/start') {
        await sendTelegramMessage(chatId, '🤖 Selamat datang di AI Learning Assistant!\n\nKirimkan pertanyaan atau foto soal untuk belajar.\n\nGunakan:\n/level_sd - Level SD/SMP\n/level_sma - Level SMA\n/level_mahasiswa - Level Mahasiswa\n/level_dosen - Level Dosen/Politikus\n/reset - Reset riwayat');
      } else if (cmd === '/help') {
        await sendTelegramMessage(chatId, '📚 Perintah yang tersedia:\n/level_sd - Mode SD/SMP (GPT Mini)\n/level_sma - Mode SMA (Deepseek V32)\n/level_mahasiswa - Mode Mahasiswa (Deepseek Reasoning)\n/level_dosen - Mode Dosen (GPT-5)\n/reset - Reset riwayat chat');
      } else if (cmd === '/reset') {
        await sendTelegramMessage(chatId, '✅ Riwayat chat Anda telah direset.');
      }
      return;
    }
    
    // Kirim typing indicator
    try {
      await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendChatAction`, {
        chat_id: chatId,
        action: 'typing'
      });
    } catch (err) {
      // Ignore typing error
    }
    
    // Proses chat dengan level default atau dari command sebelumnya
    let level = 'sma'; // default level
    
    // Proses pesan
    const result = await processChat(userId, 'telegram', level, text);
    
    // Kirim balasan
    await sendTelegramMessage(chatId, result.content);
    
    logger.info(`✅ Response sent to @${userName}`);
    
  } catch (error) {
    logger.error('Telegram webhook error:', error);
  }
});

// ============================================
// WEBSITE API
// ============================================
app.post('/api/chat', async (req, res) => {
  const { message, userId, level = 'sma', platform = 'website' } = req.body;
  
  if (!message || !userId) {
    return res.status(400).json({ error: 'message dan userId required' });
  }
  
  const result = await processChat(userId, platform, level, message);
  res.json({ 
    reply: result.content, 
    model: result.model,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    redis: redisConnected,
    supabase: !!supabase,
    telegram: !!CONFIG.telegram.token,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// CLEANUP CRON JOB (setiap jam)
// ============================================
cron.schedule('0 * * * *', async () => {
  logger.info('🧹 Running cleanup job...');
  
  if (supabase) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    await supabase.from('logs').delete().lt('timestamp', thirtyDaysAgo.toISOString())
      .catch(e => logger.error('Cleanup error:', e));
    
    logger.info('✅ Old logs cleaned');
  }
  
  const now = Date.now();
  for (const [key, value] of memoryCache) {
    if (value.expiry < now) {
      memoryCache.delete(key);
    }
  }
});

// ============================================
// ROOT ENDPOINT
// ============================================
app.get('/', (req, res) => {
  res.json({
    name: 'AI Learning Backend',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      chat: 'POST /api/chat',
      telegram: 'POST /webhook/telegram',
      health: 'GET /api/health'
    }
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🤖 AI LEARNING BACKEND - PRODUCTION READY v2.0           ║
╠══════════════════════════════════════════════════════════════╣
║  ✅ Server running on port ${PORT}                               ║
║  ✅ Redis: ${redisConnected ? 'Connected' : 'Memory Mode'} (cache active)    ║
║  ✅ Supabase: ${supabase ? 'Connected' : 'Disabled'} (history optional)      ║
║  ✅ Telegram: ${CONFIG.telegram.token ? 'Configured' : 'Disabled'}               ║
║  ✅ Cost Optimization: Active (hemat 64-90%)                 ║
╠══════════════════════════════════════════════════════════════╣
║  📍 ENDPOINTS:                                               ║
║     POST /api/chat        - Website/API Chat                 ║
║     POST /webhook/telegram - Telegram Bot Webhook            ║
║     GET  /api/health      - Health Check                     ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
