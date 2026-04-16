// ============================================
// AI LEARNING BACKEND v3.0 - MULTI PLATFORM
// Identitas: YENNI - Sahabat AI Anda
// Salam semua agama Indonesia
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
// SALAM SEMUA AGAMA DI INDONESIA
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
// KONFIGURASI API & HARGA 2026
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
// GAYA JAWABAN PER LEVEL (DENGAN maxTokens UNTUK ARTIKEL)
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
// BASE SYSTEM PROMPT (RINGKAS & HEMAT TOKEN)
// ============================================
const basePrompts = {
  sd_smp: `Anda guru SD/SMP. Bahasa sederhana. Maksimal 3 kalimat. Salam netral "Halo". Akhiri "Ada yang mau ditanya lagi?". JANGAN sebut agama, Tuhan, "Amin".`,
  sma: `Anda guru SMA. Jawab 5 kalimat. Beri contoh. Salam "Halo". Akhiri "Butuh contoh soal?". JANGAN sebut agama.`,
  mahasiswa: `Anda asisten riset. Jawab 7 kalimat. Sertakan 1 referensi. Salam "Halo". JANGAN sentuh agama kecuali diminta.`,
  dosen_politikus: `Anda analis kebijakan. Jawab 5 kalimat padat. Fokus data & rekomendasi. Salam "Selamat pagi/siang/sore". JANGAN bahas agama kecuali relevan.`
};

// ============================================
// INSTRUKSI KHUSUS (HANYA DIPANGGIL JIKA DIPERLUKAN)
// ============================================
const specialInstructions = {
  // SD-SMP: artikel sederhana
  sd_smp_article: `\n\nFORMAT ARTIKEL SEDERHANA UNTUK SD/SMP:
- Panjang: MAKSIMAL 300 kata (3-4 paragraf pendek)
- Gunakan bahasa yang sangat sederhana seperti bicara dengan anak umur 10 tahun
- Beri imajinasi (contoh: "bayangkan seperti...")
- Struktur: Pembukaan (apa itu) → Isi (bagaimana cara kerjanya) → Penutup (kesimpulan singkat)
- JANGAN gunakan istilah teknis rumit
- Akhiri dengan: "Coba diskusikan dengan temanmu atau tanya gurunya!"`,
  
  // SMA: artikel umum
  sma_article: `\n\nFORMAT ARTIKEL UNTUK SMA:
- Panjang: MAKSIMAL 600 kata (5-7 paragraf)
- Gunakan bahasa yang jelas, logis, mudah dipahami
- Berikan contoh kasus atau soal sederhana
- Struktur: Pendahuluan (latar belakang) → Pembahasan (2-3 poin utama) → Contoh → Kesimpulan
- Sertakan 1-2 istilah teknis dengan penjelasan singkat
- Akhiri dengan: "Ada yang ingin ditanyakan dari artikel ini?"`,
  
  // Mahasiswa: jurnal ilmiah
  mahasiswa_journal: `\n\nFORMAT JURNAL ILMIAH MAHASISWA:
- Panjang: MAKSIMAL 1500 kata
- Struktur: Judul → Abstrak (200 kata) → Pendahuluan → Tinjauan Pustaka → Metode → Hasil → Pembahasan → Kesimpulan → Daftar Pustaka
- Gunakan bahasa ilmiah, sertakan referensi (penulis, tahun)
- Minimal 5 referensi dari jurnal atau buku`,
  
  // Dosen: jurnal SINTA
  dosen_sinta: `\n\nFORMAT JURNAL SINTA:
- Panjang: MAKSIMAL 2500 kata
- Judul max 12 kata. Abstrak Indonesia & Inggris max 250 kata.
- Pendahuluan (latar+state of the art+gap)
- Tinjauan pustaka (minimal 20 referensi, 80% jurnal)
- Metode lengkap. Hasil & pembahasan. Kesimpulan.
- Daftar pustaka minimal 25 referensi, format APA 7th`,
  
  // Dosen: pidato
  dosen_speech: `\n\nFORMAT PIDATO:
- Pembukaan 15% (salam→sapaan→emosi→tujuan)
- Isi 70%: data (30%), cerita/emosi (40%), kredibilitas (10%)
- Penutup 15% (rangkuman→ajakan→penutup kuat)
- Gunakan kata "KITA", variasi kalimat, tanda tanya retoris`
};

// ============================================
// FUNGSI MEMBANGUN SYSTEM PROMPT (HEMAT TOKEN!)
// ============================================
function buildSystemPrompt(level, userMessage) {
  let prompt = basePrompts[level] || basePrompts.sma;
  const lowerMsg = (userMessage || '').toLowerCase();
  
  // Deteksi apakah user minta artikel/tulisan
  const isAskingArticle = lowerMsg.includes('artikel') || lowerMsg.includes('tulisan') || 
                          lowerMsg.includes('buatkan') || lowerMsg.includes('buatin') ||
                          lowerMsg.includes('bantu buat') || lowerMsg.includes('tugas');
  
  // KHUSUS SD-SMP: artikel sederhana
  if (level === 'sd_smp' && isAskingArticle) {
    prompt += specialInstructions.sd_smp_article;
  }
  // KHUSUS SMA: artikel umum
  else if (level === 'sma' && isAskingArticle) {
    prompt += specialInstructions.sma_article;
  }
  // MAHASISWA: jurnal ilmiah
  else if (level === 'mahasiswa' && (lowerMsg.includes('jurnal') || lowerMsg.includes('paper') || 
      lowerMsg.includes('skripsi') || lowerMsg.includes('tesis') || lowerMsg.includes('karya ilmiah'))) {
    prompt += specialInstructions.mahasiswa_journal;
  }
  // DOSEN: jurnal SINTA
  else if (level === 'dosen_politikus' && (lowerMsg.includes('sinta') || lowerMsg.includes('jurnal nasional') || 
      lowerMsg.includes('publikasi') || lowerMsg.includes('artikel jurnal'))) {
    prompt += specialInstructions.dosen_sinta;
  }
  // DOSEN: pidato
  else if (level === 'dosen_politikus' && (lowerMsg.includes('pidato') || lowerMsg.includes('speech') || 
      lowerMsg.includes('orasi') || lowerMsg.includes('kampanye') || lowerMsg.includes('sambutan'))) {
    prompt += specialInstructions.dosen_speech;
  }
  
  // Instruksi anti-halu untuk semua level
  prompt += `\n\nPENTING: Jangan mengada-ada atau berhalusinasi. Jika tidak tahu, katakan "Saya tidak tahu". Gunakan bahasa yang natural seperti manusia biasa.`;
  
  return prompt;
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'pagi';
  if (hour < 18) return 'siang';
  return 'malam';
}

// ============================================
// PENYIMPANAN LEVEL PER USER
// ============================================
const userLevels = new Map();
const userHasChosen = new Map();

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
// TEKS LEVEL INFO
// ============================================
function getLevelInfoText() {
  const salam = getRandomGreeting();
  return `
${salam}

💰 *Pilih Level Belajar Anda* (berpengaruh pada biaya):

/level_sd - *SD/SMP* (GPT Mini)
   Biaya: ${CONFIG.levelPrices.sd_smp}

/level_sma - *SMA* (Deepseek V32)
   Biaya: ${CONFIG.levelPrices.sma}

/level_mahasiswa - *Mahasiswa* (Deepseek Reasoning)
   Biaya: ${CONFIG.levelPrices.mahasiswa}

/level_dosen - *Dosen/Politikus* (GPT-5)
   Biaya: ${CONFIG.levelPrices.dosen_politikus}

Ketik perintah di atas (contoh: /level_sd) untuk memilih level.

Salam hangat, **Yenni - Sahabat AI Anda** 💙
`;
}

// ============================================
// RESPON SAPAAN
// ============================================
function getGreetingResponse(text, level) {
  const lowerText = text.toLowerCase().trim();
  const greetingsList = ['hai', 'hello', 'halo', 'hi', 'hey', 'assalamualaikum', 'salam', 'selamat pagi', 'selamat siang', 'selamat malam', 'om swastiastu', 'salam sejahtera'];
  const askingWho = ['siapa kamu', 'siapa anda', 'nama kamu', 'nama anda', 'kenalan', 'perkenalkan', 'yenni'];
  
  const isGreeting = greetingsList.some(g => lowerText.includes(g));
  const isAskingWho = askingWho.some(q => lowerText.includes(q));
  
  if (isGreeting || isAskingWho || (text.length < 15 && isGreeting)) {
    const responses = {
      sd_smp: `Hai! 👋 Aku **Yenni**, sahabat AI kamu. Ada yang bisa aku bantu belajar hari ini? 🌟\n\n${getRandomGreeting()}`,
      sma: `Halo! 👋 **Yenni** di sini, siap bantu belajar. Ada yang mau ditanyakan? 📚\n\n${getRandomGreeting()}`,
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
  const simplePatterns = [/^(hai|hello|halo|hy|hi)$/i, /^(terima kasih|thanks|makasih)$/i];
  return simplePatterns.some(p => p.test(text.trim()));
}

function selectModel(level, prompt) {
  if (isSimpleQuestion(prompt)) return { model: 'gptMini', reason: 'simple_question' };
  if (CONFIG.mathKeywords.some(k => prompt.toLowerCase().includes(k))) return { model: 'deepseekV32', reason: 'math_coding' };
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
async function callAI(modelName, messages, level = 'sma', timeoutMs = null, isArticle = false) {
  const model = CONFIG.ai[modelName];
  if (!model || !model.key) return { success: false, error: `Model ${modelName} not configured` };
  
  const style = answerStyle[level] || answerStyle.sma;
  
  let maxTokens = style.maxTokens;
  if (isArticle && style.maxTokensArticle) {
    maxTokens = style.maxTokensArticle;
  }
  
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
  return { success: true, content: "Maaf, layanan sedang sibuk. Silakan coba lagi nanti.", model: 'system', isFallback: true };
}

// ============================================
// DATABASE
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
  
  const greetingResponse = getGreetingResponse(message, level);
  if (greetingResponse) {
    return { success: true, content: greetingResponse, model: 'system', isGreeting: true };
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
    const estimatedCost = estimateCost(selectedModel, message.length / 4);
    const budgetOk = await checkBudget(userId, estimatedCost);
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
    
    const isArticle = (level === 'sd_smp' || level === 'sma') && (
      message.toLowerCase().includes('artikel') || message.toLowerCase().includes('tulisan') ||
      message.toLowerCase().includes('buatkan') || message.toLowerCase().includes('tugas')
    );
    
    result = await callWithFallback(selectedModel, messages, level, isArticle);
    
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
  } catch (err) {
    console.log('[Telegram] Typing indicator error:', err.message);
  }
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
        const priceMsg = CONFIG.levelPrices[level];
        await sendTelegramMessage(chatId, `✅ Level: ${CONFIG.levelNames[level]} - Biaya ${priceMsg}\nSekarang kirim pertanyaan Anda!`);
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
    
    const sudahPilihLevel = hasUserChosenLevel(userId, platform);
    if (!sudahPilihLevel) {
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
  const hasChosen = hasUserChosenLevel(userId, platform);
  const level = getUserLevel(userId, platform);
  res.json({ userId, platform, hasChosen, level, levelInfo: CONFIG.levelNames[level] });
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
    const hasChosen = hasUserChosenLevel(userId, platform);
    if (!hasChosen) {
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
    if (message === '/level_sd' || message === '/levelsdsmp') level = 'sd_smp';
    else if (message === '/level_sma' || message === '/levelsma') level = 'sma';
    else if (message === '/level_mahasiswa' || message === '/levelmahasiswa') level = 'mahasiswa';
    else if (message === '/level_dosen' || message === '/leveldosen') level = 'dosen_politikus';
    
    if (level) {
      setUserLevel(userId, platform, level);
      setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to ${level}`);
      return;
    }
    
    const sudahPilihLevel = hasUserChosenLevel(userId, platform);
    if (!sudahPilihLevel) {
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
╔══════════════════════════════════════════════════════════════════════════════╗
║                 🤖 YENNI - SAHABAT AI ANDA 🤖                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ✅ Server running on port ${PORT}                                               
