const TelegramBot = require('node-telegram-bot-api');
const cfg = require('./config');
const allowlist = require('./storage/allowlist');
const channel = require('./storage/channel');
const index = require('./storage/index');
const ai = require('./classifier/ai');
const registry = require('./agents/registry');

if (!cfg.token || cfg.token === 'REPLACE_ME') {
  console.error('❌ BOT_TOKEN is not set. Copy .env.example to .env and fill it.');
  process.exit(1);
}

const bot = new TelegramBot(cfg.token, { polling: true });

// ---------- middleware: access control ----------
function guardOwner(msg) {
  return allowlist.isOwner(msg.from.id);
}
function guardAllowed(msg) {
  return allowlist.isAllowed(msg.from.id);
}
function isCommand(text, name) {
  return text && text.startsWith('/' + name);
}

// ---------- helpers ----------
async function reply(chatId, text, parse = 'Markdown', keyboard) {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: parse,
      reply_markup: keyboard,
    });
  } catch (e) { /* ignore */ }
}

function extractFileId(msg) {
  const d = msg.document || (msg.photo && msg.photo[msg.photo.length - 1]);
  if (!d) return null;
  return d.file_id;
}
function extractMime(msg) {
  return (msg.document && msg.document.mime_type) || 'image/jpeg';
}
function extractName(msg) {
  return (msg.document && msg.document.file_name) || 'photo';
}

// ---------- owner commands ----------
async function handleAddUser(msg, args) {
  if (!guardOwner(msg)) return reply(msg.chat.id, '⛔ فقط مالک می‌تواند کاربر اضافه کند.');
  const target = (args || '').trim().replace(/^@/, '');
  if (!target) return reply(msg.chat.id, 'استفاده: `/adduser @username`');

  try {
    const u = await bot.getChat('@' + target);
    if (allowlist.exists(u.id)) return reply(msg.chat.id, `ℹ️ ${target} از قبل در لیست است.`);
    allowlist.addUser(u.id);
    reply(msg.chat.id, `✅ کاربر @${target} (id: ${u.id}) اضافه شد.`);
  } catch (e) {
    reply(msg.chat.id, '❌ یوزرنیم پیدا نشد یا کاربر ربات را شروع نکرده است.');
  }
}

async function handleRemoveUser(msg, args) {
  if (!guardOwner(msg)) return reply(msg.chat.id, '⛔ فقط مالک می‌تواند کاربر را حذف کند.');
  const target = (args || '').trim().replace(/^@/, '');
  if (!target) return reply(msg.chat.id, 'استفاده: `/removeuser @username`');
  try {
    const u = await bot.getChat('@' + target);
    if (allowlist.removeUser(u.id)) reply(msg.chat.id, `🗑️ کاربر @${target} حذف شد.`);
    else reply(msg.chat.id, 'ℹ️ این کاربر توی لیست نبود یا مالک است.');
  } catch (e) {
    reply(msg.chat.id, '❌ یوزرنیم پیدا نشد.');
  }
}

async function handleListUsers(msg) {
  if (!guardOwner(msg)) return reply(msg.chat.id, '⛔ فقط مالک.');
  const l = allowlist.list();
  const fmt = (ids) => ids.length ? ids.map((i) => `• \`${i}\``).join('\n') : '—';
  reply(msg.chat.id, `👑 *Owners:*\n${fmt(l.owners)}\n\n👤 *Users:*\n${fmt(l.users)}`);
}

// ---------- AI key management (owner) ----------
async function handleSetAi(msg, args) {
  if (!guardOwner(msg)) return reply(msg.chat.id, '⛔ فقط مالک.');
  const text = (args || '').trim();

  if (!text) {
    const has = ai.hasAi();
    reply(msg.chat.id, has
      ? '🤖 *کلید هوش مصنوعی تنظیم شده است.*\nبرای تغییر: `/setai <کلید>`\nحذف: `/setai off`'
      : '🤖 برای فعال‌سازی تشخیص خودکار، ابتدا یک کلید AI اضافه کن:\n\n`/setai <کلید Gemini>`  (پیش‌فرض)\n`/setai openai <کلید>`  (OpenAI)\n\nکلید در data/ai.json ذخیره می‌شود و در GitHub نمی‌رود.');
    return;
  }

  if (text === 'off') {
    ai.writeAi({});
    reply(msg.chat.id, '🗑️ کلید AI حذف شد. تشخیص با نام فایل عمل می‌کند.');
    return;
  }

  if (text.startsWith('openai ')) {
    const key = text.slice('openai '.length).trim();
    if (!key) return reply(msg.chat.id, 'استفاده: `/setai openai <کلید>`');
    ai.writeAi({ openaiKey: key, geminiKey: ai.getAiKey() });
    reply(msg.chat.id, '✅ کلید OpenAI ذخیره شد.');
    return;
  }

  ai.writeAi({ geminiKey: text, openaiKey: ai.getOpenAiKey() });
  reply(msg.chat.id, '✅ کلید هوش مصنوعی (Gemini) ذخیره شد. از این پس فایل‌ها خودکار طبقه‌بندی می‌شوند.');
}

// ---------- AI analysis of an image ----------
async function analyzePhoto(bot, msg) {
  const fileId = extractFileId(msg);
  if (!fileId) return;
  if (!ai.hasAi()) {
    return reply(msg.chat.id, '🤖 ابتدا کلید AI را تنظیم کن: `/setai <کلید Gemini>`');
  }
  reply(msg.chat.id, '🤖 در حال تحلیل تصویر با هوش مصنوعی...');
  try {
    const file = await bot.getFile(fileId);
    const mimeType = extractMime(msg);
    const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString('base64');
    const result = await ai.classify(b64, mimeType, extractName(msg));
    const catLine = result.category ? `\n🏷️ دسته: #${result.category}` : '';
    const descLine = result.description ? `\n📝 توضیح: _${result.description}_` : '';
    reply(msg.chat.id, `🔍 *نتیجه تحلیل:*${catLine}${descLine}`);
  } catch (e) {
    reply(msg.chat.id, '❌ خطا در تحلیل تصویر.');
  }
}

// ---------- media / archive ----------
async function handleMedia(msg) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const fileId = extractFileId(msg);
  if (!fileId) return;

  // If the caption is /analyze, analyze instead of archive.
  if (msg.caption && msg.caption.trim().startsWith('/analyze')) {
    return analyzePhoto(bot, msg);
  }

  const caption = msg.caption || msg.text || '';
  const filename = extractName(msg);

  // Download the image for AI classification.
  let imageBase64 = null;
  let mimeType = extractMime(msg);
  const isImage = /^image\//.test(mimeType);
  try {
    if (isImage) {
      const file = await bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      imageBase64 = buf.toString('base64');
    }
  } catch (e) { /* image download optional */ }

  let category = 'سایر';
  let aiDesc = '';
  try {
    const cl = await ai.classify(imageBase64, mimeType, filename);
    category = cl.category || 'سایر';
    aiDesc = cl.description || '';
  } catch (e) {}

  const tags = category ? [category] : [];

  try {
    const rec = await channel.archiveFile(bot, {
      fileId,
      mimeType,
      caption,
      category,
      tags,
      userId: msg.from.id,
      filename,
      chatPhoto: isImage,
    });
    const ref = rec.messageId;
    const aiLine = aiDesc && aiDesc !== category ? `\n🤖 ${aiDesc}` : (ai.hasAi() && category !== 'سایر' ? '\n🤖 تشخیص خودکار' : '');
    reply(
      msg.chat.id,
      `✅ ذخیره شد. (#${category})${aiLine}\nشناسه: \`${ref}\`\nبرای دریافت: دکمه زیر 👇`,
      'Markdown',
      savedKeyboard(ref)
    );
  } catch (e) {
    reply(msg.chat.id, '❌ خطا در ذخیره. مطمئن شو CHANNEL_ID درست است.');
  }
}

// ---------- get / search / agents ----------
async function handleGet(msg, args) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const id = Number((args || '').trim());
  if (!id) return reply(msg.chat.id, 'استفاده: `/get <شناسه>`');
  const rec = index.findByMessageId(id);
  if (!rec) return reply(msg.chat.id, '❌ فایلی با این شناسه پیدا نشد.');
  try {
    await channel.fetchFile(bot, msg.chat.id, rec.messageId);
  } catch (e) {
    reply(msg.chat.id, '❌ خطا در بازیابی فایل.');
  }
}

function handleSearch(msg, args) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const q = (args || '').trim();
  if (!q) return reply(msg.chat.id, 'استفاده: `/search <کلیدواژه>`');
  const results = index.search({ keyword: q });
  if (!results.length) return reply(msg.chat.id, '🔍 چیزی پیدا نشد.');
  const text = results.slice(0, 10).map((r) =>
    `• \`${r.messageId}\` #${r.category} — ${r.caption || ''} (${new Date(r.timestamp).toLocaleDateString('fa-IR')})`
  ).join('\n');
  reply(msg.chat.id, `🔍 *نتایج:*\n${text}\n\nبرای دریافت: \`/get <شناسه>\``);
}

function handleAgents(msg, args) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  registry.initDefaultAgents();
  const q = (args || '').trim();
  if (!q) {
    const list = registry.list().map((a) => `• ${a.name} — ${a.description}`).join('\n');
    reply(msg.chat.id, `🤖 *ایجنت‌های متصل:*\n\n${list}\n\nبرای جستجو با ایجنت: \`/agents <عبارت>\``);
    return;
  }
  const results = registry.dispatch(q);
  if (!results.length) {
    reply(msg.chat.id, `🤖 ایجنت برای «${q}» چیزی پیدا نکرد.`);
    return;
  }
  const text = results.slice(0, 8).map((r) =>
    `• \`${r.messageId}\` #${r.category} — ${r.caption || ''} (${new Date(r.timestamp).toLocaleDateString('fa-IR')})`
  ).join('\n');
  reply(msg.chat.id, `🤖 *ایجنت نتایج «${q}»:*\n\n${text}\n\nبرای دریافت: /get <شناسه>`);
}

function handleStats(msg) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const s = index.stats();
  const lines = Object.entries(s.byCat).map(([c, n]) => `•${c}: ${n}`).join('\n');
  reply(msg.chat.id, `📊 *آرشیو:* ${s.total} فایل\n\n${lines || '—'}`);
}

// ---------- start / help ----------
function handleHelp(msg, customText) {
  const hasAi = ai.hasAi();
  const aiLine = hasAi ? '✅ فعال' : '❌ غیرفعال (برای فعال‌سازی: /setai)';
  const help = [
    '🤖 *ربات آرشیو عکس و فایل*',
    '',
    '▪️ عکس/فایل بفرست → خودکار دسته‌بندی و در زیرگروه‌های کانال ذخیره می‌شود',
    '',
    `▪️ 🤖 *هوش مصنوعی:* ${aiLine}`,
    '',
    '*منوی اصلی:*',
    'از دکمه‌های زیر استفاده کن ⬇️',
  ];
  reply(msg.chat.id, customText || help.join('\n'), 'HTML', mainMenuKeyboard(msg));
}

// ---------- inline keyboard: main menu ----------
function mainMenuKeyboard(msg) {
  const rows = [
    [{ text: '🔍 جستجو', callback_data: 'menu_search' }, { text: '📊 آمار', callback_data: 'menu_stats' }],
    [{ text: '🤖 ایجنت‌ها', callback_data: 'menu_agents' }, { text: '📚 دسته‌بندی‌ها', callback_data: 'menu_categories' }],
  ];
  if (guardOwner(msg)) {
    rows.push([
      { text: '🤖 تنظیم AI', callback_data: 'menu_setai' },
      { text: '👥 کاربران', callback_data: 'menu_users' },
    ]);
  }
  return { inline_keyboard: rows };
}

// ---------- inline keyboard: categories ----------
const ALL_CATEGORIES = ['کارت_ملی', 'پاسپورت', 'شناسنامه', 'مدرک_تحصیلی', 'قرارداد', 'فاکتور', 'قبض', 'عکس_شخصی', 'سایر'];

function categoriesKeyboard() {
  const rows = [];
  for (let i = 0; i < ALL_CATEGORIES.length; i += 2) {
    rows.push(ALL_CATEGORIES.slice(i, i + 2).map((c) => ({ text: '#' + c, callback_data: 'cat_' + c })));
  }
  rows.push([{ text: '🏠 بازگشت', callback_data: 'menu_back' }]);
  return { inline_keyboard: rows };
}

// ---------- inline keyboard: saved confirmation ----------
function savedKeyboard(messageId) {
  return {
    inline_keyboard: [
      [{ text: '🔁 دریافت مجدد', callback_data: 'get_' + messageId }],
      [{ text: '🏠 منو', callback_data: 'menu_back' }],
    ],
  };
}

function usersKeyboard() {
  return { inline_keyboard: [[{ text: '🏠 بازگشت', callback_data: 'menu_back' }]] };
}

// ---------- router ----------
bot.on('message', async (msg) => {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  try {
    if (isCommand(text, 'start') || isCommand(text, 'help')) return handleHelp(msg);
    if (isCommand(text, 'adduser')) return handleAddUser(msg, text.slice('/adduser'.length));
    if (isCommand(text, 'removeuser')) return handleRemoveUser(msg, text.slice('/removeuser'.length));
    if (isCommand(text, 'listusers')) return handleListUsers(msg);
    if (isCommand(text, 'setai')) return handleSetAi(msg, text.slice('/setai'.length));
    if (isCommand(text, 'get')) return handleGet(msg, text.slice('/get'.length));
    if (isCommand(text, 'search')) return handleSearch(msg, text.slice('/search'.length));
    if (isCommand(text, 'agents')) return handleAgents(msg, text.slice('/agents'.length));
    if (isCommand(text, 'stats')) return handleStats(msg);
  } catch (e) {
    reply(chatId, '❌ خطای داخلی.');
  }

  // non-command: is it media?
  if (msg.document || msg.photo) {
    await handleMedia(msg);
    return;
  }
});

// ---------- inline button (callback query) handler ----------
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat?.id;
  const msg = query.message;
  const data = query.data || '';

  try {
    // Access control for callbacks
    if (!allowlist.isAllowed(query.from.id)) {
      await bot.answerCallbackQuery(query.id, { text: '⛔ مجاز نیستید' });
      return;
    }

    if (data === 'menu_back') {
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText('🤖 *منوی اصلی ربات آرشیو*\n\nاز دکمه‌های زیر استفاده کن:', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard(msg),
      });
      return;
    }

    if (data === 'menu_categories') {
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText('📚 *دسته‌بندی‌ها*\n\nروی یک دسته بزن تا فایل‌هایش را ببینی:', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: categoriesKeyboard(),
      });
      return;
    }

    if (data.startsWith('cat_')) {
      const cat = data.slice(4);
      await bot.answerCallbackQuery(query.id);
      const results = index.search({ category: cat });
      if (!results.length) {
        await bot.editMessageText(`🔍 در دسته #${cat} چیزی نیست.`, {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: categoriesKeyboard()
        });
      } else {
        const text = results.slice(0, 8).map((r) =>
          `• \`${r.messageId}\` — ${r.caption || ''} (${new Date(r.timestamp).toLocaleDateString('fa-IR')})`
        ).join('\n');
        await bot.editMessageText(`#${cat}\n${text}\n\nبرای دریافت: /get <شناسه>`, {
          chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: categoriesKeyboard()
        });
      }
      return;
    }

    if (data.startsWith('get_')) {
      const messageId = Number(data.slice(4));
      await bot.answerCallbackQuery(query.id, { text: 'در حال دریافت...' });
      const rec = index.findByMessageId(messageId);
      if (!rec) {
        await bot.sendMessage(chatId, '❌ فایل پیدا نشد.');
        return;
      }
      await channel.fetchFile(bot, chatId, rec.messageId);
      return;
    }

    if (data === 'menu_search') {
      await bot.answerCallbackQuery(query.id, { text: 'کلمه‌ی جستجو را تایپ کن: /search <کلمه>' });
      await bot.sendMessage(chatId, '🔍 کلمه‌ی جستجو را تایپ کن:\n`/search <کلمه>`', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard(msg) });
      return;
    }

    if (data === 'menu_agents') {
      await bot.answerCallbackQuery(query.id);
      registry.initDefaultAgents();
      const list = registry.list().map((a) => `• ${a.name} — ${a.description}`).join('\n');
      await bot.editMessageText(`🤖 *ایجنت‌های متصل:*\n\n${list}\n\nبرای جستجو با ایجنت: \`/agents <عبارت>\``, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: mainMenuKeyboard(msg)
      });
      return;
    }

    if (data === 'menu_stats') {
      await bot.answerCallbackQuery(query.id);
      const s = index.stats();
      const lines = Object.entries(s.byCat).map(([c, n]) => `• #${c}: ${n}`).join('\n');
      await bot.editMessageText(`📊 *آرشیو:* ${s.total} فایل\n\n${lines || '—'}`, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: mainMenuKeyboard(msg)
      });
      return;
    }

    if (data === 'menu_setai') {
      if (!allowlist.isOwner(query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: '⛔ فقط مالک' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const has = ai.hasAi();
      const txt = has
        ? '🤖 *کلید هوش مصنوعی تنظیم شده است.*\nبرای تغییر: `/setai <کلید>`\nحذف: `/setai off`'
        : '🤖 برای فعال‌سازی تشخیص خودکار، کلید AI اضافه کن:\n\n`/setai <کلید Gemini>`\n`/setai openai <کلید>`';
      await bot.editMessageText(txt, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: mainMenuKeyboard(msg)
      });
      return;
    }

    if (data === 'menu_users') {
      if (!allowlist.isOwner(query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: '⛔ فقط مالک' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const l = allowlist.list();
      const fmt = (ids) => ids.length ? ids.map((i) => `• \`${i}\``).join('\n') : '—';
      await bot.editMessageText(`👑 *Owners:*\n${fmt(l.owners)}\n\n👤 *Users:*\n${fmt(l.users)}\n\nبرای اضافه: /adduser @username`, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: usersKeyboard()
      });
      return;
    }

    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    try { await bot.answerCallbackQuery(query.id, { text: '❌ خطا' }); } catch (_E) {}
  }
});

// ---------- boot ----------
registry.initDefaultAgents();
if (!cfg.channelId || cfg.channelId === 'REPLACE_ME') {
  console.error('❌ CHANNEL_ID not set');
} else {
  console.log('🤖 Bot started. Access control enabled.');
  console.log('   Owners:', allowlist.list().owners.length);
  console.log('   AI key:', ai.hasAi() ? 'set' : 'not set');
}

module.exports = bot;
