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
async function reply(chatId, text, parse = 'Markdown') {
  try { await bot.sendMessage(chatId, text, { parse_mode: parse }); } catch (e) { /* ignore */ }
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
      `✅ ذخیره شد. (#${category})\nشناسه: \`${ref}\`\nبرای بازیابی: \`/get ${ref}\``
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
function handleHelp(msg) {
  const help = [
    '🤖 *ربات آرشیو*',
    '',
    '▪️ عکس/فایل بفرست → خودکار دسته‌بندی و در کانال ذخیره می‌شود',
    '',
    '*دستورها:*',
    '`/get <شناسه>` — دریافت فایل',
    '`/search <کلمه>` — جستجو',
    '`/stats` — آمار',
    '',
    '*فقط مالک:*',
    '`/adduser @username` — افزودن کاربر',
    '`/removeuser @username` — حذف کاربر',
    '`/listusers` — لیست کاربران',
  ];
  reply(msg.chat.id, help.join('\n'));
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

// ---------- boot ----------
if (!cfg.channelId || cfg.channelId === 'REPLACE_ME') {
  console.error('❌ CHANNEL_ID not set');
} else {
  console.log('🤖 Bot started. Access control enabled.');
  console.log('   Owners:', allowlist.list().owners.length);
}

module.exports = bot;
