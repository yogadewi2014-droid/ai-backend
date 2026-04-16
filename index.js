// ============================================
// AI LEARNING BACKEND v3.0 - MULTI PLATFORM
// Identitas: YENNI - Sahabat AI Anda
// ============================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { createClient: createRedisClient } = require('redis');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// SALAM SEMUA AGAMA
// ============================================
const greetings = {
  islam: 'Assalamualaikum warahmatullahi wabarakatuh 🤲',
  kristen: 'Salam sejahtera untuk kita semua ✝️',
  katolik: 'Salam damai di dalam Tuhan Yesus 🕊️',
  hindu: 'Om Swastiastu 🕉️',
  buddha: 'Om Mani Padme Hum 🙏',
  konghucu: 'Wei De Dong Tian, salam kebajikan ☯️'
};

function getRandomGreeting() {
  const allGreetings = Object.values(greetings);
  return allGreetings[Math.floor(Math.random() * allGreetings.length)];
}

// ============================================
// KONFIGURASI
// ============================================
const CONFIG = {
  ai: {
    gptMini: {
      url: 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      pricePer1KInput: 0.00015,
      pricePer1KOutput: 0.0006,
      timeout: 30000
    },
    deepseekV32: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-v3.2',
      pricePer1KInput: 0.002,
      pricePer1KOutput: 0.003,
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
      pricePer1KInput: 0.0025,
      pricePer1KOutput: 0.01,
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
  searchKeywords: ['terkini', 'berita', 'cuaca', '2025', '2026', 'sekarang', 'hari ini', 'update'],
  mathKeywords: ['hitung', 'matematika', 'kalkulus', 'aljabar', 'coding', 'python'],
  fallbackChain: {
    gptMini: ['deepseekV32', 'gpt5'],
    deepseekV32: ['gpt5', 'gptMini'],
    deepseekReasoning: ['gpt5', 'deepseekV32'],
    gpt5: ['gptMini', 'deepseekReasoning']
  }
};

// ============================================
// GAYA JAWABAN PER LEVEL
// ============================================
const answerStyle = {
  sd_smp: {
    maxTokens: 200,
    maxTokensDetail: 300,
    maxTokensArticle: 400,
    temperature: 0.5,
    requireFollowUp: true
  },
  sma: {
    maxTokens: 250,
    maxTokensArticle: 700,
    temperature: 0.5,
    requireFollowUp: true
  },
  mahasiswa: {
    maxTokens: 400,
    temperature: 0.6,
    requireFollowUp: false
  },
  dosen_politikus: {
    maxTokens: 2000,
    temperature: 0.7,
    requireFollowUp: false
  }
};

// ============================================
// BASE PROMPTS
// ============================================
const basePrompts = {
  sd_smp: `Anda guru SD/SMP. Bahasa sederhana. Maksimal 3 kalimat. Salam netral "Halo". Akhiri "Ada yang mau ditanya lagi?". JANGAN sebut agama.`,
  sma: `Anda guru SMA. Jawab 5 kalimat. Beri contoh. Salam "Halo". Akhiri "Butuh contoh soal?". JANGAN sebut agama.`,
  mahasiswa: `Anda asisten riset. Jawab 7 kalimat. Sertakan 1 referensi. Salam "Halo".`,
  dosen_politikus: `Anda analis kebijakan. Jawab 5 kalimat padat. Fokus data & rekomendasi. Salam "Selamat pagi/siang/sore".`
};

// ============================================
// INSTRUKSI KHUSUS
// ============================================
const specialInstructions = {
  sd_smp_article: `\n\nFORMAT ARTIKEL SD/SMP: Maksimal 300 kata, bahasa sederhana, 3-4 paragraf, akhiri ajakan diskusi.`,
  sma_article: `\n\nFORMAT ARTIKEL SMA: Maksimal 600 kata, 5-7 paragraf, beri contoh, bahasa jelas dan logis.`,
  mahasiswa_journal: `\n\nFORMAT JURNAL: Judul, Abstrak 200 kata, Pendahuluan, Tinjauan Pustaka, Metode, Hasil, Pembahasan, Kesimpulan, Daftar Pustaka.`,
  dosen_sinta: `\n\nFORMAT JURNAL SINTA: Judul max 12 kata, Abstrak Indonesia/Inggris max 250 kata, minimal 20 referensi.`,
  dosen_speech: `\n\nFORMAT PIDATO: Pembukaan 15%, Isi 70% (data+cerita+emosi), Penutup 15%, gunakan kata "KITA".`
};

// ============================================
// FUNGSI MEMBANGUN PROMPT
// ============================================
function buildSystemPrompt(level, userMessage) {
  let prompt = basePrompts[level] || basePrompts.sma;
  const lowerMsg = (userMessage || '').toLowerCase();
  
  const isAskingArticle = lowerMsg.includes('artikel') || lowerMsg.includes('tulisan') || lowerMsg.includes('buatkan');
  
  if (level === 'sd_smp' && isAskingArticle) prompt += specialInstructions.sd_smp_article;
  else if (level === 'sma' && isAskingArticle) prompt += specialInstructions.sma_article;
  else if (level === 'mahasiswa' && (lowerMsg.includes('jurnal') || lowerMsg.includes('skripsi'))) prompt += specialInstructions.mahasiswa_journal;
  else if (level === 'dosen_politikus' && lowerMsg.includes('sinta')) prompt += specialInstructions.dosen_sinta;
  else if (level === 'dosen_politikus' && (lowerMsg.includes('pidato') || lowerMsg.includes('speech'))) prompt += specialInstructions.dosen_speech;
  
  prompt += `\n\nJangan berhalusinasi. Jika tidak tahu, katakan "Saya tidak tahu".`;
  return prompt;
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'pagi';
  if (hour < 18) return 'siang';
  return 'malam';
}

// ============================================
// PENYIMPANAN LEVEL USER
// ============================================
const userLevels = new Map();
const userHasChosen = new Map();

function getUserLevel(userId, platform) {
  return userLevels.get(`${userId}:${platform}`) || 'sd_smp';
}

function setUserLevel(userId, platform, level) {
  userLevels.set(`${userId}:${platform}`, level);
  console.log(`[LEVEL] ${platform}:${userId} → ${level}`);
}

function hasUserChosenLevel(userId, platform) {
  return userHasChosen.get(`${userId}:${platform}`) || false;
}

function setUserChosenLevel(userId, platform, chosen = true) {
  userHasChosen.set(`${userId}:${platform}`, chosen);
}

// ============================================
// LOGGER
// ============================================
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err?.message || err || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data) : '')
};

// ============================================
// TEKS LEVEL INFO
// ============================================
function getLevelInfoText() {
  return `${getRandomGreeting()}

💰 *Pilih Level Belajar Anda*:

/level_sd - *SD/SMP* - ${CONFIG.levelPrices.sd_smp}
/level_sma - *SMA* - ${CONFIG.levelPrices.sma}
/level_mahasiswa - *Mahasiswa* - ${CONFIG.levelPrices.mahasiswa}
/level_dosen - *Dosen/Politikus* - ${CONFIG.levelPrices.dosen_politikus}

**Yenni - Sahabat AI Anda** 💙`;
}

// ============================================
// RESPON SAPAAN
// ============================================
function getGreetingResponse(text, level) {
  const lowerText = text.toLowerCase().trim();
  const greetingsList = ['hai', 'halo', 'hi', 'hey', 'assalamualaikum', 'salam'];
  const askingWho = ['siapa kamu', 'nama kamu', 'yenni'];
  
  if (greetingsList.some(g => lowerText.includes(g)) || askingWho.some(q => lowerText.includes(q))) {
    const responses = {
      sd_smp: `Hai! 👋 Aku **Yenni**, sahabat AI kamu. Ada yang bisa aku bantu? 🌟\n\n${getRandomGreeting()}`,
      sma: `Halo! 👋 **Yenni** di sini. Ada yang mau ditanyakan? 📚\n\n${getRandomGreeting()}`,
      mahasiswa: `Halo. Saya **Yenni**, asisten riset. Ada topik yang mau didiskusikan? 🎓\n\n${getRandomGreeting()}`,
      dosen_politikus: `Selamat ${getTimeOfDay()}. Saya **Yenni**, siap membantu analisis Anda. 📊\n\n${getRandomGreeting()}`
    };
    return responses[level] || responses.sma;
  }
  return null;
}

// ============================================
// SUPABASE
// ============================================
let supabase = null;
if (CONFIG.supabase.url && CONFIG.supabase.key) {
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  logger.info('Supabase connected');
}

// ============================================
// CACHE
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
  if (userData.dailyUsage + estimatedCostUSD > 0.5) return { allowed: false };
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

function selectModel(level, prompt) {
  let model = CONFIG.levelModelMap[level] || 'gptMini';
  return { model, reason: 'by_level' };
}

// ============================================
// SEARCH
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
    const results = (response.data.organic || []).slice(0, 3).map(r => ({ title: r.title, snippet: r.snippet }));
    await setCache(cacheKey, results, 21600);
    return results;
  } catch (err) {
    return [];
  }
}

// ============================================
// PANGGIL AI
// ============================================
async function callAI(modelName, messages, level = 'sma', timeoutMs = null, isArticle = false) {
  const model = CONFIG.ai[modelName];
  if (!model || !model.key) return { success: false, error: `Model ${modelName} not configured` };
  
  const style = answerStyle[level] || answerStyle.sma;
  let maxTokens = style.maxTokens;
  if (isArticle && style.maxTokensArticle) maxTokens = style.maxTokensArticle;
  
  try {
    const response = await axios.post(model.url, {
      model: model.model,
      messages: messages,
      temperature: style.temperature,
      max_tokens: maxTokens
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

async function callWithFallback(modelName, messages, level, isArticle = false) {
  const chain = [modelName, ...(CONFIG.fallbackChain[modelName] || [])];
  for (const attempt of chain) {
    const result = await callAI(attempt, messages, level, null, isArticle);
    if (result.success) {
      if (attempt !== modelName) logger.warn(`Fallback: ${modelName} → ${attempt}`);
      return result;
    }
  }
  return { success: true, content: "Maaf, layanan sedang sibuk. Silakan coba lagi nanti.", model: 'system' };
}

// ============================================
// DATABASE
// ============================================
async function saveChatMessage(userId, platform, role, content, modelUsed = null) {
  if (!supabase) return;
  try {
    await supabase.from('chat_history').insert({
      user_id: userId, platform, role, content, model_used: modelUsed, created_at: new Date()
    });
  } catch (e) {
    logger.error('Save error:', e.message);
  }
}

async function getChatHistory(userId, platform, limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('chat_history').select('role, content').eq('user_id', userId).eq('platform', platform).order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data || []).reverse();
}

// ============================================
// PROSES CHAT
// ============================================
async function processChat(userId, platform, level, message) {
  const startTime = Date.now();
  let result = null;
  logger.info(`Processing: ${userId}, ${platform}, ${level}, ${message.substring(0, 50)}`);
  
  const greetingResponse = getGreetingResponse(message, level);
  if (greetingResponse) {
    return { success: true, content: greetingResponse, model: 'system' };
  }
  
  try {
    const cacheKey = `chat:${level}:${message}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;
    
    let searchResults = null;
    if (CONFIG.searchKeywords.some(k => message.toLowerCase().includes(k))) {
      searchResults = await searchWeb(message);
    }
    
    const { model: selectedModel } = selectModel(level, message);
    const budgetOk = await checkBudget(userId, 0.001);
    if (!budgetOk.allowed) {
      return { success: true, content: "Maaf, kuota harian Anda telah habis.", model: 'system' };
    }
    
    const history = await getChatHistory(userId, platform, 10);
    const systemPrompt = buildSystemPrompt(level, message);
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const h of history) messages.push({ role: h.role, content: h.content });
    
    let finalMessage = message;
    if (searchResults?.length) {
      finalMessage += `\n\n[Hasil pencarian]:\n${searchResults.map(r => `- ${r.snippet}`).join('\n')}`;
    }
    messages.push({ role: 'user', content: finalMessage });
    
    const isArticle = (level === 'sd_smp' || level === 'sma') && 
      (message.toLowerCase().includes('artikel') || message.toLowerCase().includes('tulisan'));
    
    result = await callWithFallback(selectedModel, messages, level, isArticle);
    
    await saveChatMessage(userId, platform, 'user', message, selectedModel);
    await saveChatMessage(userId, platform, 'assistant', result.content, result.model);
    await setCache(cacheKey, result, 3600);
    
    logger.info(`✅ Completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    logger.error('Process error:', error);
    return result || { success: true, content: "Maaf, terjadi kesalahan. Silakan coba lagi.", model: 'system' };
  }
}

// ============================================
// TELEGRAM HANDLER
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

async function sendTelegramTyping(chatId) {
  if (!CONFIG.telegram.token) return;
  try {
    await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing'
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
    
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      
      if (cmd === '/start') {
        await sendTelegramMessage(chatId, getLevelInfoText());
        return;
      }
      
      let level = null;
      if (cmd === '/level_sd' || cmd === '/levelsdsmp') level = 'sd_smp';
      else if (cmd === '/level_sma' || cmd === '/levelsma') level = 'sma';
      else if (cmd === '/level_mahasiswa' || cmd === '/levelmahasiswa') level = 'mahasiswa';
      else if (cmd === '/level_dosen' || cmd === '/leveldosen') level = 'dosen_politikus';
      
      if (level) {
        setUserLevel(userId, platform, level);
        setUserChosenLevel(userId, platform, true);
        await sendTelegramMessage(chatId, `✅ Level: ${CONFIG.levelNames[level]} - ${CONFIG.levelPrices[level]}\nSekarang kirim pertanyaan Anda!`);
        return;
      }
      
      await sendTelegramMessage(chatId, 'Perintah tidak dikenal. Gunakan /start');
      return;
    }
    
    if (!hasUserChosenLevel(userId, platform)) {
      await sendTelegramMessage(chatId, getLevelInfoText());
      return;
    }
    
    const userLevel = getUserLevel(userId, platform);
    await sendTelegramTyping(chatId);
    const result = await processChat(userId, platform, userLevel, text);
    await sendTelegramMessage(chatId, result.content);
    
  } catch (err) {
    logger.error('Telegram error:', err);
  }
});

// ============================================
// WEBSITE API
// ============================================
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

app.get('/api/level/status/:userId', (req, res) => {
  const { userId } = req.params;
  const { platform = 'website' } = req.query;
  res.json({ userId, platform, hasChosen: hasUserChosenLevel(userId, platform), level: getUserLevel(userId, platform) });
});

app.post('/api/level', (req, res) => {
  const { userId, level, platform = 'website' } = req.body;
  const validLevels = ['sd_smp', 'sma', 'mahasiswa', 'dosen_politikus'];
  if (!userId || !level || !validLevels.includes(level)) {
    return res.status(400).json({ error: 'userId dan level required' });
  }
  setUserLevel(userId, platform, level);
  setUserChosenLevel(userId, platform, true);
  res.json({ success: true, message: `Level changed to ${level}` });
});

app.post('/api/chat', async (req, res) => {
  const { message, userId, level, platform = 'website' } = req.body;
  if (!message || !userId) return res.status(400).json({ error: 'message dan userId required' });
  
  let userLevel = level;
  if (!userLevel) {
    if (!hasUserChosenLevel(userId, platform)) {
      return res.status(400).json({ error: 'Belum pilih level', message: 'Silakan pilih level via POST /api/level' });
    }
    userLevel = getUserLevel(userId, platform);
  }
  
  const result = await processChat(userId, platform, userLevel, message);
  res.json({ reply: result.content, model: result.model });
});

// ============================================
// WHATSAPP HANDLER
// ============================================
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('OK');
  try {
    const { from, message } = req.body;
    if (!from || !message) return;
    
    const userId = from;
    const platform = 'whatsapp';
    
    let level = null;
    if (message === '/level_sd') level = 'sd_smp';
    else if (message === '/level_sma') level = 'sma';
    else if (message === '/level_mahasiswa') level = 'mahasiswa';
    else if (message === '/level_dosen') level = 'dosen_politikus';
    
    if (level) {
      setUserLevel(userId, platform, level);
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to ${level}`);
      return;
    }
    
    if (!hasUserChosenLevel(userId, platform)) {
      console.log(`[WA] User ${from} belum pilih level`);
      return;
    }
    
    const userLevel = getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, message);
    console.log(`[WA] Response to ${from}: ${result.content.substring(0, 100)}...`);
    
  } catch (err) {
    logger.error('WhatsApp error:', err);
  }
});

// ============================================
// HEALTH & ROOT
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', redis: redisConnected, supabase: !!supabase, telegram: !!CONFIG.telegram.token });
});

app.get('/', (req, res) => {
  res.json({ name: 'Yenni - Sahabat AI Anda', version: '3.0.0', status: 'running' });
});

// ============================================
// CLEANUP
// ============================================
cron.schedule('0 * * * *', async () => {
  logger.info('🧹 Running cleanup...');
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
╔════════════════════════════════════════════════════════════════════╗
║                 🤖 YENNI - SAHABAT AI ANDA 🤖                       ║
╠════════════════════════════════════════════════════════════════════╣
║  ✅ Server running on port ${PORT}                                      ║
║  ✅ YENNI siap membantu! 🚀                                         ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
