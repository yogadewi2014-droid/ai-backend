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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
      model: 'deepseek-chat',
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
    sma: 'gptMini',
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
// KONFIGURASI GAMBAR & OUTPUT
// ============================================
const IMAGE_CONFIG = {
  googleImagenApiKey: process.env.GOOGLE_IMAGEN_API_KEY,
  latexRendererUrl: process.env.LATEX_RENDERER_URL || 'https://latex.railway.app/render'
};

const pendingAcademicRequests = new Map();
const pendingOutputRequests = new Map();

// ============================================
// GAYA JAWABAN PER LEVEL
// ============================================
const answerStyle = {
  sd_smp: { maxTokens: 200, maxTokensDetail: 300, maxTokensArticle: 400, temperature: 0.5, requireFollowUp: true },
  sma: { maxTokens: 250, maxTokensArticle: 700, temperature: 0.5, requireFollowUp: true },
  mahasiswa: { maxTokens: 400, temperature: 0.6, requireFollowUp: false },
  dosen_politikus: { maxTokens: 2000, temperature: 0.7, requireFollowUp: false }
};

// ============================================
// PROMPT CACHING
// ============================================
const STATIC_PREFIX = `Anda adalah YENNI, asisten AI yang ramah dan membantu.
Ikuti aturan berikut:
1. Gunakan bahasa Indonesia yang baik dan benar
2. Jangan berhalusinasi atau mengada-ada
3. Jika tidak tahu, katakan "Saya tidak tahu"
4. Jangan menyebut nama agama atau Tuhan
5. Gunakan salam netral seperti "Halo" atau "Selamat pagi"`;

const INTENT_RULES = {
  default: `Jawab pertanyaan secara umum dengan ramah dan informatif.`,
  article_sd: `BUAT ARTIKEL UNTUK SD/SMP: Maksimal 300 kata, bahasa sederhana, akhiri ajakan diskusi.`,
  article_sma: `BUAT ARTIKEL UNTUK SMA: Maksimal 600 kata, bahasa jelas, beri contoh konkret.`,
  journal: `BUAT ARTIKEL JURNAL: Judul, Abstrak, Pendahuluan, Metode, Hasil, Pembahasan, Kesimpulan, Daftar Pustaka.`,
  sinta: `BUAT JURNAL SINTA: Judul max 12 kata, Abstrak Indonesia/Inggris max 250 kata, minimal 20 referensi.`,
  speech: `BUAT PIDATO: Pembukaan 15%, Isi 70% (data+cerita), Penutup 15%, gunakan kata "KITA".`
};

const basePrompts = {
  sd_smp: `${STATIC_PREFIX}\n\nAnda guru SD/SMP. Bahasa sederhana. Maksimal 3 kalimat. Akhiri "Ada yang mau ditanya lagi?".`,
  sma: `${STATIC_PREFIX}\n\nAnda guru SMA. Jawab 5 kalimat. Beri contoh. Akhiri "Butuh contoh soal?".`,
  mahasiswa: `${STATIC_PREFIX}\n\nAnda asisten riset. Jawab 7 kalimat. Sertakan 1 referensi.`,
  dosen_politikus: `${STATIC_PREFIX}\n\nAnda analis kebijakan. Jawab 5 kalimat padat. Fokus data & rekomendasi.`
};

const specialInstructions = {
  sd_smp_article: `\n\nFORMAT ARTIKEL SD/SMP: Maksimal 300 kata, bahasa sederhana, 3-4 paragraf, akhiri ajakan diskusi.`,
  sma_article: `\n\nFORMAT ARTIKEL SMA: Maksimal 600 kata, 5-7 paragraf, beri contoh, bahasa jelas dan logis.`,
  mahasiswa_journal: `\n\nFORMAT JURNAL: Judul, Abstrak 200 kata, Pendahuluan, Tinjauan Pustaka, Metode, Hasil, Pembahasan, Kesimpulan, Daftar Pustaka.`,
  dosen_sinta: `\n\nFORMAT JURNAL SINTA: Judul max 12 kata, Abstrak Indonesia/Inggris max 250 kata, minimal 20 referensi.`,
  dosen_speech: `\n\nFORMAT PIDATO: Pembukaan 15%, Isi 70% (data+cerita+emosi), Penutup 15%, gunakan kata "KITA".`
};

function getIntent(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  if (lowerMsg.includes('artikel') && (lowerMsg.includes('sd') || lowerMsg.includes('smp'))) return 'article_sd';
  if (lowerMsg.includes('artikel') && lowerMsg.includes('sma')) return 'article_sma';
  if (lowerMsg.includes('jurnal') || lowerMsg.includes('skripsi') || lowerMsg.includes('paper')) return 'journal';
  if (lowerMsg.includes('sinta') || lowerMsg.includes('jurnal nasional')) return 'sinta';
  if (lowerMsg.includes('pidato') || lowerMsg.includes('speech') || lowerMsg.includes('orasi')) return 'speech';
  return 'default';
}

async function buildSystemPrompt(level, userId, userMessage) {
  const intent = getIntent(userMessage);
  let prompt = basePrompts[level] || basePrompts.sma;
  prompt += `\n\n${INTENT_RULES[intent] || INTENT_RULES.default}`;
  
  let longTermMemory = null;
  if (supabase) {
    const cacheKey = `longmem:${userId}`;
    longTermMemory = await getCache(cacheKey);
    if (!longTermMemory) {
      try {
        const { data } = await supabase.from('long_term_memory').select('summary').eq('user_id', userId).single();
        if (data?.summary) { longTermMemory = data.summary; await setCache(cacheKey, longTermMemory, 43200); }
      } catch(e) {}
    }
  }
  if (longTermMemory) prompt += `\n\nCatatan tentang pengguna: ${longTermMemory}`;
  
  const lowerMsg = userMessage.toLowerCase();
  const isAskingArticle = lowerMsg.includes('artikel') || lowerMsg.includes('tulisan') || lowerMsg.includes('buatkan');
  if (level === 'sd_smp' && isAskingArticle) prompt += specialInstructions.sd_smp_article;
  else if (level === 'sma' && isAskingArticle) prompt += specialInstructions.sma_article;
  else if (level === 'mahasiswa' && (lowerMsg.includes('jurnal') || lowerMsg.includes('skripsi'))) prompt += specialInstructions.mahasiswa_journal;
  else if (level === 'dosen_politikus' && lowerMsg.includes('sinta')) prompt += specialInstructions.dosen_sinta;
  else if (level === 'dosen_politikus' && (lowerMsg.includes('pidato') || lowerMsg.includes('speech'))) prompt += specialInstructions.dosen_speech;
  prompt += `\n\nJangan berhalusinasi. Jika tidak tahu, katakan "Saya tidak tahu".`;
  return prompt;
}

function getTimeOfDay() { const hour = new Date().getHours(); if (hour < 12) return 'pagi'; if (hour < 18) return 'siang'; return 'malam'; }

// ============================================
// PENYIMPANAN LEVEL USER
// ============================================
const userLevels = new Map();
const userHasChosen = new Map();

async function getUserLevel(userId, platform) {
  const sessionLevel = await getUserSession(userId, platform);
  if (sessionLevel) return sessionLevel;
  return userLevels.get(`${userId}:${platform}`) || 'sd_smp';
}
async function setUserLevel(userId, platform, level) {
  await setUserSession(userId, platform, level);
  userLevels.set(`${userId}:${platform}`, level);
  console.log(`[LEVEL] ${platform}:${userId} → ${level}`);
}
async function hasUserChosenLevel(userId, platform) {
  const session = await getCache(`session:${userId}:${platform}`);
  if (session) return true;
  return userHasChosen.get(`${userId}:${platform}`) || false;
}
async function setUserChosenLevel(userId, platform, chosen = true) { userHasChosen.set(`${userId}:${platform}`, chosen); }

// ============================================
// LOGGER
// ============================================
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err?.message || err || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data) : '')
};

function getLevelInfoText() {
  return `${getRandomGreeting()}\n\n💰 *Pilih Level Belajar Anda*:\n\n/level_sd - *SD/SMP* - ${CONFIG.levelPrices.sd_smp}\n/level_sma - *SMA* - ${CONFIG.levelPrices.sma}\n/level_mahasiswa - *Mahasiswa* - ${CONFIG.levelPrices.mahasiswa}\n/level_dosen - *Dosen/Politikus* - ${CONFIG.levelPrices.dosen_politikus}\n\n**Yenni - Sahabat AI Anda** 💙`;
}

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
// SUPABASE & CACHE
// ============================================
let supabase = null;
if (CONFIG.supabase.url && CONFIG.supabase.key) {
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  logger.info('Supabase connected');
}

let redisClient = null;
let redisConnected = false;
const memoryCache = new Map();

async function initRedis() {
  if (!process.env.REDIS_URL) { logger.info('Redis not configured, using memory cache'); return; }
  try {
    redisClient = createRedisClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => logger.warn('Redis error:', err.message));
    await redisClient.connect();
    redisConnected = true;
    logger.info('Redis connected');
  } catch (err) { logger.warn('Redis failed, using memory cache'); redisConnected = false; }
}
initRedis();

async function getCache(key) {
  if (redisConnected && redisClient) { const data = await redisClient.get(key); return data ? JSON.parse(data) : null; }
  const cached = memoryCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.data;
  return null;
}
async function setCache(key, data, ttlSeconds = 3600) {
  if (redisConnected && redisClient) { await redisClient.setEx(key, ttlSeconds, JSON.stringify(data)); }
  else { memoryCache.set(key, { data, expiry: Date.now() + (ttlSeconds * 1000) }); }
}
async function delCache(key) {
  if (redisConnected && redisClient) { await redisClient.del(key); }
  else { memoryCache.delete(key); }
}

async function setUserSession(userId, platform, level) { await setCache(`session:${userId}:${platform}`, { level, lastActive: Date.now() }, 86400); }
async function getUserSession(userId, platform) { const session = await getCache(`session:${userId}:${platform}`); return session ? session.level : null; }

async function setSummaryCache(userId, summary, platform = 'general') { await setCache(`summary:${userId}:${platform}`, { summary, updatedAt: Date.now() }, 43200); }
async function getSummaryCache(userId, platform = 'general') { const data = await getCache(`summary:${userId}:${platform}`); return data ? data.summary : null; }
async function updateSummaryCache(userId, newSummary, platform = 'general') {
  const existing = await getSummaryCache(userId, platform);
  if (existing) { await setSummaryCache(userId, `${existing}\n${newSummary}`, platform); }
  else { await setSummaryCache(userId, newSummary, platform); }
}

// ============================================
// FUNGSI BANTUAN
// ============================================
function estimateCost(modelName, inputTokens, outputTokens = 300) {
  const model = CONFIG.ai[modelName];
  if (!model) return 0;
  return ((inputTokens / 1000) * model.pricePer1KInput) + ((outputTokens / 1000) * model.pricePer1KOutput);
}
function selectModel(level) { return { model: CONFIG.levelModelMap[level] || 'gptMini', reason: 'by_level' }; }

async function searchWeb(query) {
  if (!CONFIG.serper.apiKey) return [];
  const cacheKey = `search:${query}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  try {
    const response = await axios.post(CONFIG.serper.url, { q: query, gl: 'id', hl: 'id', num: 3 }, { headers: { 'X-API-KEY': CONFIG.serper.apiKey }, timeout: 10000 });
    const results = (response.data.organic || []).slice(0, 3).map(r => ({ title: r.title, snippet: r.snippet }));
    await setCache(cacheKey, results, 21600);
    return results;
  } catch (err) { return []; }
}

// ============================================
// INPUT GAMBAR (OCR)
// ============================================
async function processImageInput(imageUrl, userQuestion, targetModel, level) {
  try {
    console.log(`🖼️ [OCR] Download gambar dari: ${imageUrl}`);
    
    // Tambahkan headers untuk akses file Telegram
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer', 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    console.log(`🖼️ [OCR] Gambar terdownload, size: ${imageResponse.data.length} bytes`);
    const base64Image = Buffer.from(imageResponse.data).toString('base64');
    
    const ocrMessages = [
      { role: 'system', content: 'Anda adalah OCR. Ekstrak teks dari gambar ini. Jika ada soal matematika, tulis dalam format LaTeX.' },
      { role: 'user', content: [
        { type: 'text', text: userQuestion || 'Ekstrak teks dari gambar ini:' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
      ] }
    ];
    
    console.log(`🖼️ [OCR] Kirim ke GPT Mini untuk OCR...`);
    const ocrResult = await callAI('gptMini', ocrMessages, 'sd_smp');
    if (!ocrResult.success) return { success: false, error: 'Gagal membaca gambar' };
    
    console.log(`🖼️ [OCR] Hasil OCR: ${ocrResult.content.substring(0, 100)}...`);
    
    const finalMessages = [
      { role: 'system', content: `Analisis gambar: ${ocrResult.content}. Jawab pertanyaan user.` },
      { role: 'user', content: userQuestion || 'Jelaskan gambar ini.' }
    ];
    
    const finalResult = await callAI(targetModel, finalMessages, level);
    return { success: true, content: finalResult.content };
  } catch (err) { 
    console.error(`🖼️ [OCR] ERROR: ${err.message}`);
    return { success: false, error: err.message }; 
  }
}
// ============================================
// ACADEMIC WRITING
// ============================================
function isAcademicWritingRequest(message, level) {
  if (level !== 'mahasiswa' && level !== 'dosen_politikus') return false;
  const keywords = ['artikel', 'jurnal', 'paper', 'skripsi', 'tesis', 'karya ilmiah', 'essay', 'makalah', 'proposal'];
  return keywords.some(k => message.toLowerCase().includes(k));
}
function askForAcademicDetails(level, originalMessage) {
  const questions = {
    mahasiswa: `📝 *Saya akan bantu buat ${originalMessage.substring(0, 50)}...*\n\nMohon berikan detail:\n1️⃣ Topik utama\n2️⃣ Tujuan (tugas/jurnal)\n3️⃣ Panjang (halaman/kata)\n4️⃣ Referensi (APA/MLA/Harvard)\n\nKetik *LANJUT* setelah mengisi detail.`,
    dosen_politikus: `📊 *Academic Writing Assistant*\n\nDetail yang diperlukan:\n1️⃣ Topik/Isu\n2️⃣ Jenis publikasi (Jurnal SINTA/prosiding)\n3️⃣ Target audiens\n4️⃣ Panjang naskah\n5️⃣ Format (IMRAD/essay)\n\nKetik *LANJUT* setelah mengisi detail.`
  };
  return questions[level] || questions.mahasiswa;
}
async function askOutputFormat(userId, content, model, level) {
  pendingOutputRequests.set(userId, { content, model, level });
  return `✅ *Konten selesai!*\n\nPilih format:\n/format_text - Teks\n/format_pdf - PDF\n/format_docx - DOCX`;
}
async function generatePdf(content, title = 'Document') {
  try {
    const response = await axios.post('https://api.pdf.co/v1/pdf/convert/from/html', { html: `<html><body><h1>${title}</h1>${content.replace(/\n/g,'<br>')}</body></html>`, name: `${title}.pdf` }, { headers: { 'x-api-key': process.env.PDF_CO_API_KEY }, timeout: 30000 });
    return { success: true, url: response.data.url };
  } catch (err) { return { success: false, error: err.message }; }
}
async function generateDocx(content, title = 'Document') {
  try {
    const response = await axios.post('https://api.pdf.co/v1/docx/convert/from/html', { html: `<html><body><h1>${title}</h1>${content.replace(/\n/g,'<br>')}</body></html>`, name: `${title}.docx` }, { headers: { 'x-api-key': process.env.PDF_CO_API_KEY }, timeout: 30000 });
    return { success: true, url: response.data.url };
  } catch (err) { return { success: false, error: err.message }; }
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
    const response = await axios.post(model.url, { model: model.model, messages, temperature: style.temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${model.key}` }, timeout: timeoutMs || model.timeout || 30000 });
    if (response.data.usage?.prompt_cache_hit_tokens) { const hit = response.data.usage.prompt_cache_hit_tokens; const total = hit + (response.data.usage.prompt_cache_miss_tokens||0); console.log(`🔥 [${modelName}] Cache: ${total>0?((hit/total)*100).toFixed(1):0}% hit`); }
    return { success: true, content: response.data.choices[0].message.content, model: modelName };
  } catch (err) { logger.error(`AI Error (${modelName}):`, err.message); return { success: false, error: err.message, model: modelName }; }
}
async function callWithFallback(modelName, messages, level, isArticle = false) {
  const chain = [modelName, ...(CONFIG.fallbackChain[modelName] || [])];
  for (const attempt of chain) {
    const result = await callAI(attempt, messages, level, null, isArticle);
    if (result.success) { if (attempt !== modelName) logger.warn(`Fallback: ${modelName} → ${attempt}`); return result; }
  }
  return { success: true, content: "Maaf, layanan sedang sibuk.", model: 'system' };
}

async function saveChatMessage(userId, platform, role, content, modelUsed = null) {
  if (!supabase) return;
  try { await supabase.from('chat_history').insert({ user_id: userId, platform, role, content, model_used: modelUsed, created_at: new Date() }); }
  catch(e) { logger.error('Save error:', e.message); }
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
async function processChat(userId, platform, level, message, imageUrl = null) {
  const startTime = Date.now();
  let result = null;
  logger.info(`Processing: ${userId}, ${platform}, ${level}, ${message.substring(0, 50)}`);
  
  if (imageUrl) {
    let targetModel = level === 'sd_smp' ? 'gptMini' : (level === 'sma' ? 'deepseekV32' : (level === 'mahasiswa' ? 'deepseekReasoning' : 'gpt5'));
    const imageResult = await processImageInput(imageUrl, message, targetModel, level);
    if (imageResult.success) return { success: true, content: imageResult.content, model: targetModel };
    return { success: true, content: `Gagal proses gambar: ${imageResult.error}`, model: 'system' };
  }
  
  const greetingResponse = getGreetingResponse(message, level);
  if (greetingResponse) return { success: true, content: greetingResponse, model: 'system' };
  
  const pendingKey = `${userId}:${platform}`;
  const existingPending = pendingAcademicRequests.get(pendingKey);
  
  if (isAcademicWritingRequest(message, level) && !existingPending) {
    pendingAcademicRequests.set(pendingKey, { level, platform, originalMessage: message, collectedDetails: null, step: 'waiting_for_details' });
    return { success: true, content: askForAcademicDetails(level, message), model: 'system', isAcademicHold: true };
  }
  
  const pendingRequest = pendingAcademicRequests.get(pendingKey);
  if (pendingRequest && pendingRequest.step === 'waiting_for_details' && !message.startsWith('/')) {
    if (message.toLowerCase().includes('lanjut')) {
      pendingRequest.step = 'processing';
      pendingAcademicRequests.set(pendingKey, pendingRequest);
      const detailPrompt = `Buatkan ${pendingRequest.originalMessage}\n\nDetail: ${pendingRequest.collectedDetails || message}\nBuatkan dengan kualitas tinggi.`;
      let targetModel = pendingRequest.level === 'mahasiswa' ? 'deepseekReasoning' : 'gpt5';
      const aiResult = await callWithFallback(targetModel, [{ role: 'user', content: detailPrompt }], pendingRequest.level);
      pendingAcademicRequests.delete(pendingKey);
      const formatQuestion = await askOutputFormat(userId, aiResult.content, aiResult.model, pendingRequest.level);
      return { success: true, content: `${aiResult.content}\n\n${formatQuestion}`, model: aiResult.model };
    } else {
      pendingRequest.collectedDetails = pendingRequest.collectedDetails ? `${pendingRequest.collectedDetails}\n${message}` : message;
      pendingAcademicRequests.set(pendingKey, pendingRequest);
      return { success: true, content: "Detail dicatat. Kirim *LANJUT* untuk mulai menulis.", model: 'system' };
    }
  }
  
  if (message.startsWith('/format_')) {
    const format = message.replace('/format_', '').toLowerCase();
    const outputData = pendingOutputRequests.get(userId);
    if (!outputData) return { success: true, content: "Tidak ada konten. Buat artikel dulu.", model: 'system' };
    if (format === 'text') { pendingOutputRequests.delete(userId); return { success: true, content: outputData.content, model: outputData.model }; }
    if (format === 'pdf') { const pdf = await generatePdf(outputData.content); pendingOutputRequests.delete(userId); return { success: true, content: pdf.success ? `📄 PDF: ${pdf.url}` : `Gagal: ${pdf.error}`, model: outputData.model }; }
    if (format === 'docx') { const docx = await generateDocx(outputData.content); pendingOutputRequests.delete(userId); return { success: true, content: docx.success ? `📝 DOCX: ${docx.url}` : `Gagal: ${docx.error}`, model: outputData.model }; }
  }
  
  try {
    const cacheKey = `chat:${level}:${message}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;
    
    let searchResults = null;
    if (CONFIG.searchKeywords.some(k => message.toLowerCase().includes(k))) searchResults = await searchWeb(message);
    const { model: selectedModel } = selectModel(level);
    const history = await getChatHistory(userId, platform, 10);
    const systemPrompt = await buildSystemPrompt(level, userId, message);
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const h of history) messages.push({ role: h.role, content: h.content });
    let finalMessage = message;
    if (searchResults?.length) finalMessage += `\n\n[Hasil pencarian]:\n${searchResults.map(r => `- ${r.snippet}`).join('\n')}`;
    messages.push({ role: 'user', content: finalMessage });
    const isArticle = (level === 'sd_smp' || level === 'sma') && (message.toLowerCase().includes('artikel') || message.toLowerCase().includes('tulisan'));
    result = await callWithFallback(selectedModel, messages, level, isArticle);
    await saveChatMessage(userId, platform, 'user', message, selectedModel);
    await saveChatMessage(userId, platform, 'assistant', result.content, result.model);
    await setCache(cacheKey, result, 3600);
    await updateSummaryCache(userId, `Q: ${message.substring(0,100)}...\nA: ${result.content.substring(0,100)}...`, platform);
    logger.info(`✅ Completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    logger.error('Process error:', error);
    return result || { success: true, content: "Maaf, terjadi kesalahan.", model: 'system' };
  }
}

// ============================================
// TELEGRAM HANDLER
// ============================================
async function sendTelegramMessage(chatId, text) {
  if (!CONFIG.telegram.token) return;
  try { await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, { chat_id: chatId, text: text.substring(0,4096), parse_mode: 'Markdown' }); } catch(e) {}
}
async function sendTelegramTyping(chatId) {
  if (!CONFIG.telegram.token) return;
  try { await axios.post(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendChatAction`, { chat_id: chatId, action: 'typing' }); } catch(e) {}
}

app.post('/webhook/telegram', async (req, res) => {
  res.status(200).send('OK');
  try {
    const update = req.body;
    if (!update?.message) return;
    
    // ========== LOG UNTUK DEBUG ==========
    console.log(`📨 [WEBHOOK] Pesan dari ${update.message.from.id}: "${update.message.text || '[GAMBAR]'}"`);
    
    const chatId = update.message.chat.id;
    const userId = update.message.from.id.toString();
    const text = update.message.text || '';
    const platform = 'telegram';
    let imageUrl = null;
    
    // ========== LOG DETEKSI GAMBAR ==========
    console.log(`📸 [DEBUG] Cek foto: ada? ${!!update.message.photo}, jumlah: ${update.message.photo?.length || 0}`);
    
    if (update.message.photo && update.message.photo.length > 0) {
      console.log(`📸 GAMBAR DETEKSI! Jumlah foto: ${update.message.photo.length}`);
      const photo = update.message.photo[update.message.photo.length-1];
      const fileInfo = await axios.get(`https://api.telegram.org/bot${CONFIG.telegram.token}/getFile?file_id=${photo.file_id}`);
      imageUrl = `https://api.telegram.org/file/bot${CONFIG.telegram.token}/${fileInfo.data.result.file_path}`;
      console.log(`📸 URL GAMBAR: ${imageUrl}`);
    } else {
      console.log(`📸 TIDAK ADA GAMBAR - teks: "${text.substring(0, 50)}"`);
    }
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      if (cmd === '/start') { await sendTelegramMessage(chatId, getLevelInfoText()); return; }
      let level = null;
      if (cmd === '/level_sd' || cmd === '/levelsdsmp') level = 'sd_smp';
      else if (cmd === '/level_sma' || cmd === '/levelsma') level = 'sma';
      else if (cmd === '/level_mahasiswa' || cmd === '/levelmahasiswa') level = 'mahasiswa';
      else if (cmd === '/level_dosen' || cmd === '/leveldosen') level = 'dosen_politikus';
      if (level) { await setUserLevel(userId, platform, level); await setUserChosenLevel(userId, platform, true); await sendTelegramMessage(chatId, `✅ Level: ${CONFIG.levelNames[level]} - ${CONFIG.levelPrices[level]}\nSekarang kirim pertanyaan!`); return; }
      await sendTelegramMessage(chatId, 'Perintah tidak dikenal. Gunakan /start');
      return;
    }
        if (!await hasUserChosenLevel(userId, platform)) {
      await sendTelegramMessage(chatId, getLevelInfoText());
      return;
    }
    
    const userLevel = await getUserLevel(userId, platform);
    await sendTelegramTyping(chatId);
    const result = await processChat(userId, platform, userLevel, text, imageUrl);
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

app.get('/api/level/status/:userId', async (req, res) => {
  const { userId } = req.params;
  const { platform = 'website' } = req.query;
  res.json({ userId, platform, hasChosen: await hasUserChosenLevel(userId, platform), level: await getUserLevel(userId, platform) });
});

app.post('/api/level', async (req, res) => {
  const { userId, level, platform = 'website' } = req.body;
  const validLevels = ['sd_smp', 'sma', 'mahasiswa', 'dosen_politikus'];
  if (!userId || !level || !validLevels.includes(level)) {
    return res.status(400).json({ error: 'userId dan level required' });
  }
  await setUserLevel(userId, platform, level);
  await setUserChosenLevel(userId, platform, true);
  res.json({ success: true, message: `Level changed to ${level}` });
});

app.post('/api/chat', async (req, res) => {
  const { message, userId, level, platform = 'website', imageUrl } = req.body;
  if (!message || !userId) return res.status(400).json({ error: 'message dan userId required' });
  
  let userLevel = level;
  if (!userLevel) {
    if (!await hasUserChosenLevel(userId, platform)) {
      return res.status(400).json({ error: 'Belum pilih level', message: 'Silakan pilih level via POST /api/level' });
    }
    userLevel = await getUserLevel(userId, platform);
  }
  
  const result = await processChat(userId, platform, userLevel, message, imageUrl);
  res.json({ reply: result.content, model: result.model });
});

// ============================================
// GENERATE GAMBAR (Google Gemini Free Tier)
// ============================================
app.post('/api/generate-image', async (req, res) => {
  const { prompt, aspectRatio = '1:1' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured. Get free key from https://aistudio.google.com/' });
  }
  
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: `Generate a detailed image prompt for: ${prompt}. Return only the prompt text.` }] }] }
    );
    const enhancedPrompt = response.data.candidates?.[0]?.content?.parts?.[0]?.text || prompt;
    res.json({ success: true, enhancedPrompt: enhancedPrompt, message: 'Gunakan prompt ini di DALL-E atau Midjourney untuk generate gambar.' });
  } catch (err) {
    logger.error('Gemini error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// RENDER LATEX
// ============================================
app.post('/api/render-latex', async (req, res) => {
  const { latex } = req.body;
  if (!latex) return res.status(400).json({ error: 'latex required' });
  try {
    const response = await axios.post(IMAGE_CONFIG.latexRendererUrl, { latex: latex, format: 'png', dpi: 120 }, { timeout: 10000 });
    res.json({ success: true, imageUrl: response.data.url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// WHATSAPP HANDLER
// ============================================
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('OK');
  try {
    const { from, message, imageUrl } = req.body;
    if (!from || !message) return;
    
    const userId = from;
    const platform = 'whatsapp';
    
    let level = null;
    if (message === '/level_sd') level = 'sd_smp';
    else if (message === '/level_sma') level = 'sma';
    else if (message === '/level_mahasiswa') level = 'mahasiswa';
    else if (message === '/level_dosen') level = 'dosen_politikus';
    
    if (level) {
      await setUserLevel(userId, platform, level);
      await setUserChosenLevel(userId, platform, true);
      console.log(`[WA] User ${from} set level to ${level}`);
      return;
    }
    
    if (!await hasUserChosenLevel(userId, platform)) {
      console.log(`[WA] User ${from} belum pilih level`);
      return;
    }
    
    const userLevel = await getUserLevel(userId, platform);
    const result = await processChat(userId, platform, userLevel, message, imageUrl);
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
║  ✅ Prompt Caching aktif (DeepSeek/OpenAI)                         ║
║  ✅ Session Cache (Redis/Memory)                                   ║
║  ✅ Summary Cache (Redis/Memory)                                   ║
║  ✅ Response Cache (Redis/Memory)                                  ║
║  ✅ Long Term Memory (Supabase + Redis)                            ║
║  ✅ Input Gambar (OCR via GPT Mini)                                ║
║  ✅ Generate Gambar (Gemini + DALL-E prompt)                       ║
║  ✅ LaTeX Renderer                                                 ║
║  ✅ Academic Writing (tanya detail dulu)                           ║
║  ✅ Output Format (Text/PDF/DOCX)                                  ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
