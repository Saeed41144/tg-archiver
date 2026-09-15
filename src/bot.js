const TelegramBot = require('node-telegram-bot-api');
const cfg = require('./config');
const allowlist = require('./storage/allowlist');
const channel = require('./storage/channel');
const index = require('./storage/index');
const { classify } = require('./classifier/ai');
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
  const d = msg.document || msg.photo && msg.photo[msg.photo.length - 1];
  if (!d) return null;
  return d.file_id;
}
function extractMime(msg) {
  return (msg.document && msg.document.mime_type) || 'image';
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

// ---------- media / archive ----------
async function handleMedia(msg) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const fileId = extractFileId(msg);
  if (!fileId) return;

  const caption = msg.caption || msg.text || '';
  let category = 'سایر';
  try {
    category = await classify(null, extractName(msg));
  } catch (e) {}

  try {
    const rec = await channel.archiveFile(bot, {
      fileId,
      mimeType: extractMime(msg),
      caption,
      category,
      tags: [category],
      userId: msg.from.id,
      filename: extractName(msg),
    });
    const ref = rec.messageId;
    reply(
      msg.chat.id,
      `✅ ذخیره شد. (#${category})\nشناسه: \`${ref}\`\nبرای دریافت: دکمه زیر 👇`,
      'Markdown',
      savedKeyboard(ref)
    );
  } catch (e) {
    reply(msg.chat.id, '❌ خطا در ذخیره. مطمئن شو CHANNEL_ID درست است.');
  }
}

// ---------- get / search ----------
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

function handleStats(msg) {
  if (!guardAllowed(msg)) return reply(msg.chat.id, '⛔ شما مجاز نیستید.');
  const s = index.stats();
  const lines = Object.entries(s.byCat).map(([c, n]) => `• #${c}: ${n}`).join('\n');
  reply(msg.chat.id, `📊 *آرشیو:* ${s.total} فایل\n\n${lines || '—'}`);
}

// ---------- start / help ----------
function handleHelp(msg, customText) {
  const help = [
    '🤖 *ربات آرشیو*',
    '',
    '▪️ عکس/فایل بفرست → خودکار دسته‌بندی و در کانال ذخیره می‌شود',
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
    [{ text: '📚 دسته‌بندی‌ها', callback_data: 'menu_categories' }],
  ];
  if (guardOwner(msg)) {
    rows.push([
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
  const l = allowlist.list();
  return {
    inline_keyboard: [
      [{ text: '🏠 بازگشت', callback_data: 'menu_back' }],
    ],
  };
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
    if (isCommand(text, 'get')) return handleGet(msg, text.slice('/get'.length));
    if (isCommand(text, 'search')) return handleSearch(msg, text.slice('/search'.length));
    if (isCommand(text, 'stats')) return handleStats(msg);
  } catch (e) {
    reply(chatId, '❌ خطای داخلی.');
  }

  // non-command: is it media?
  if (msg.document || msg.photo) {
    await handleMedia(msg);
    return;
  }

  // ignored text
  if (text && !isCommand(text, 'start') && !isCommand(text, 'help') && !isAllowedAny(msg)) {
    // nothing, just silence
  }
});

function isAllowedAny(msg) {
  return allowlist.isAllowed(msg.from?.id);
}

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

    if (data === 'menu_stats') {
      await bot.answerCallbackQuery(query.id);
      const s = index.stats();
      const lines = Object.entries(s.byCat).map(([c, n]) => `• #${c}: ${n}`).join('\n');
      await bot.editMessageText(`📊 *آرشیو:* ${s.total} فایل\n\n${lines || '—'}`, {
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
if (!cfg.channelId || cfg.channelId === 'REPLACE_ME') {
  console.error('❌ CHANNEL_ID not set');
} else {
  console.log('🤖 Bot started. Access control enabled.');
  console.log('   Owners:', allowlist.list().owners.length);
}

module.exports = bot;
