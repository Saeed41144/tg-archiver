// AI Classifier — Phase 3.
// Currently: keyword-based fallback by filename.
// Later: plug Gemini/OpenAI Vision here (classify(documentPath) -> category)

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

// Future: async classify(path, filename) -> use Vision AI
async function classify(path, filename) {
  return classifyByFilename(filename);
}

module.exports = { classify, classifyByFilename, KEYWORDS };
