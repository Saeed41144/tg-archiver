const cfg = require('../config');
const index = require('./index');

async function archiveFile(bot, { fileId, mimeType, caption, category, tags, userId, filename }) {
  // Send to archive channel with a tag header so the channel itself is searchable.
  const msg = await bot.sendDocument(cfg.channelId, fileId, {
    caption: `#${(category || 'سایر').replace(/\s+/g, '_')}\n${caption || ''}`.trim(),
  });
  return index.add({
    messageId: msg.message_id,
    category: category || 'سایر',
    tags: tags || [],
    caption: caption || '',
    mimeType: mimeType || '',
    userId: userId || null,
    filename: filename || '',
  });
}

// Fetch a previously archived file back to the user.
async function fetchFile(bot, chatId, messageId) {
  // Copy message from channel to user's chat (works for media).
  await bot.copyMessage(chatId, cfg.channelId, Number(messageId));
}

module.exports = { archiveFile, fetchFile };
