const index = require('../storage/index');

// Agents register categories they "own" and can retrieve files on request.
const agents = [];

function registerAgent({ name, categories, description }) {
  agents.push({ name, categories, description: description || '' });
  return agents.length - 1;
}

function findAgent(category) {
  return agents.find((a) => a.categories.includes(category)) || null;
}

function list() {
  return agents;
}

// Build the default set of Persian document agents.
function initDefaultAgents() {
  if (agents.length) return;
  registerAgent({ name: '🪪 مدارک هویتی', categories: ['کارت_ملی', 'پاسپورت', 'شناسنامه'], description: 'کارت ملی، پاسپورت، شناسنامه' });
  registerAgent({ name: '🎓 مدارک تحصیلی', categories: ['مدرک_تحصیلی'], description: 'دیپلم، مدرک تحصیلی' });
  registerAgent({ name: '📄 قراردادها', categories: ['قرارداد'], description: 'قرارداد کاری/مالی' });
  registerAgent({ name: '🧾 مالی', categories: ['فاکتور', 'قبض', 'تحویل'], description: 'فاکتور، رسید، قبض' });
  registerAgent({ name: '🖼️ عکس‌ها', categories: ['عکس_شخصی'], description: 'عکس‌های شخصی' });
  registerAgent({ name: '📂 سایر', categories: ['سایر'], description: 'سایر اسناد' });
}

// Natural-language request → find matching agent(s) and return relevant records.
function dispatch(request, opts = {}) {
  initDefaultAgents();
  const q = String(request || '').toLowerCase();
  const byCat = {};
  index.read().forEach((r) => {
    byCat[r.category] = byCat[r.category] || [];
    byCat[r.category].push(r);
  });
  // Natural-language aliases for each category (Persian + common variations).
  const aliases = {
    'کارت_ملی': ['کارت ملی', 'ملی', 'id', 'شناسایی'],
    'پاسپورت': ['پاسپورت', 'پاسپر', 'passport', 'گذرنامه'],
    'شناسنامه': ['شناسنامه', 'شناس'],
    'مدرک_تحصیلی': ['مدرک', 'دیپلم', 'لیسانس', 'تحصیلی', 'دانشگاه'],
    'قرارداد': ['قرارداد', 'contract'],
    'فاکتور': ['فاکتور', 'رسید', 'invoice', 'factor'],
    'قبض': ['قبض', 'bill', 'برق', 'گاز', 'تلفن'],
    'تحویل': ['کارت', 'بانکی', 'تحویل', 'ارسال'],
    'عکس_شخصی': ['عکس', 'شخصی', 'selfie', 'پروفایل'],
  };

  const matched = [];
  const requestedCategories = [];
  for (const cat of Object.keys(aliases)) {
    if (aliases[cat].some((a) => q.includes(a))) requestedCategories.push(cat);
  }
  // Also match by agent name.
  for (const agent of agents) {
    if (q.includes(agent.name)) {
      requestedCategories.push(...agent.categories);
    }
  }
  const unique = [...new Set(requestedCategories)];
  for (const cat of unique) {
    if (byCat[cat]) matched.push(...byCat[cat]);
  }
  // Filter by keyword if provided
  if (opts.keyword) {
    const k = String(opts.keyword).toLowerCase();
    return matched.filter((r) =>
      (r.caption || '').toLowerCase().includes(k) ||
      (r.category || '').toLowerCase().includes(k) ||
      (r.tags || []).some((t) => String(t).toLowerCase().includes(k))
    );
  }
  return matched;
}

module.exports = { registerAgent, findAgent, list, initDefaultAgents, dispatch };
