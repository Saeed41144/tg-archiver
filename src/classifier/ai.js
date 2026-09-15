// AI Classifier — real Vision AI.
// Providers:
//  - gemini  (Google AI Studio key) — default
//  - openai  (Vision: gpt-4o-mini)
//  - local   (keyword fallback only)
//
// The AI key is set interactively via /setai (stored in data/ai.json, never committed).
// It can also be provided via .env: GEMINI_API_KEY / OPENAI_API_KEY

const fs = require('fs');
const cfg = require('../config');

const KEYWORDS = [
  { cat: 'کارت_ملی', keys: ['meli', 'کارت ملی', 'melli', 'id card'] },
  { cat: 'پاسپورت', keys: ['passport', 'پاسپورت', 'passport card'] },
  { cat: 'شناسنامه', keys: ['شناسنامه', 'shenasname', 'birth certificate'] },
  { cat: 'مدرک_تحصیلی', keys: ['diploma', 'دیپلم', 'مدرک', 'لیسانس', 'کارشناسی', 'تحصیلی'] },
  { cat: 'قرارداد', keys: ['contract', 'قرارداد', 'قرارداد کاری'] },
  { cat: 'فاکتور', keys: ['invoice', 'فاکتور', 'رسید', 'factor'] },
  { cat: 'قبض', keys: ['قبض', 'bill', 'برق', 'گاز', 'تلفن'] },
  { cat: 'تحویل', keys: ['card', 'کارت', 'بانکی', 'cartes'] },
  { cat: 'عکس_شخصی', keys: ['شخصی', 'selfie', 'personal'] },
];

function classifyByFilename(filename) {
  const name = String(filename || '').toLowerCase();
  for (const { cat, keys } of KEYWORDS) {
    if (keys.some((k) => name.includes(k.toLowerCase()))) return cat;
  }
  return 'سایر';
}

// ---- stored AI key management ----
function readAi() {
  if (!fs.existsSync(cfg.aiFile)) return {};
  try { return JSON.parse(fs.readFileSync(cfg.aiFile, 'utf8')); } catch (e) { return {}; }
}
function writeAi(data) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(cfg.aiFile, JSON.stringify(data, null, 2));
}
function getAiKey() {
  const stored = readAi();
  return stored.geminiKey || cfg.geminiApiKey || null;
}
function getOpenAiKey() {
  const stored = readAi();
  return stored.openaiKey || cfg.openaiApiKey || null;
}
function hasAi() {
  return !!(getAiKey() || getOpenAiKey());
}

// ---- Gemini Vision ----
async function geminiClassify(imageBase64, mimeType, filename) {
  const key = getAiKey();
  if (!key) return null;
  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const parts = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } });
  }
  if (filename) {
    parts.push({ text: `File name: ${filename}` });
  }
  const body = {
    contents: [{ parts: [
      { text: `You are a document archiver. Classify this image/file into EXACTLY ONE of these categories (return only the category word, nothing else):
کارت_ملی, پاسپورت, شناسنامه, مدرک_تحصیلی, قرارداد, فاکتور, قبض, عکس_شخصی, سایر
Also describe the document in 1 short Persian phrase. Output format:
CATEGORY=<category>
DESC=<short Persian description>`},
      ...parts,
    ] }],
    generationConfig: { temperature: 0.1 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gemini ' + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseAiOutput(text);
}

// ---- OpenAI Vision ----
async function openaiClassify(imageBase64, mimeType, filename) {
  const key = getOpenAiKey();
  if (!key) return null;
  const body = {
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Classify this file into EXACTLY ONE category: کارت_ملی, پاسپورت, شناسنامه, مدرک_تحصیلی, قرارداد, فاکتور, قبض, عکس_شخصی, سایر.
Output format exactly:
CATEGORY=<category>
DESC=<short Persian description>
${filename ? 'File name: ' + filename : ''}` },
        ...(imageBase64 ? [{ type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } }] : []),
      ],
    }],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('OpenAI ' + res.status);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseAiOutput(text);
}

function parseAiOutput(text) {
  let cat = null, desc = '';
  const catMatch = text.match(/CATEGORY\s*=\s*(.+)/i);
  if (catMatch) {
    const raw = catMatch[1].trim();
    const known = ['کارت_ملی', 'پاسپورت', 'شناسنامه', 'مدرک_تحصیلی', 'قرارداد', 'فاکتور', 'قبض', 'عکس_شخصی', 'سایر'];
    cat = known.find((k) => raw.includes(k) || k.includes(raw.replace('_', ' ').trim())) || 'سایر';
  }
  const descMatch = text.match(/DESC\s*=\s*(.+)/i);
  if (descMatch) desc = descMatch[1].trim();
  return { category: cat, description: desc };
}

// ---- main classify (tries AI first, then keyword fallback) ----
async function classify(imageBase64, mimeType, filename) {
  let ai = null;
  try {
    if (cfg.aiProvider === 'openai' && getOpenAiKey()) {
      ai = await openaiClassify(imageBase64, mimeType, filename);
    } else if (getAiKey()) {
      ai = await geminiClassify(imageBase64, mimeType, filename);
    }
  } catch (e) {
    ai = null;
  }
  if (ai && ai.category && ai.category !== 'سایر') {
    return { category: ai.category, description: ai.description, ai: true };
  }
  return { category: classifyByFilename(filename), description: '', ai: false };
}

module.exports = { classify, classifyByFilename, hasAi, readAi, writeAi, getAiKey, getOpenAiKey };
