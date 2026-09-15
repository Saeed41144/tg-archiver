const cfg = require('../config');
const index = require('./index');

// Map category -> topic message_thread_id (created once, cached in-memory).
const topicCache = {};

async function ensureTopic(bot, category) {
  // If bot has no rights to create topics (e.g. a plain group), just return null.
  try {
    if (topicCache[category]) return topicCache[category];
    const res = await bot.createForumTopic(cfg.channelId, '#' + category);
    topicCache[category] = res.message_thread_id;
    return res.message_thread_id;
  } catch (e) {
    // Channel/group without forum topics -> no subgrouping.
    return null;
  }
}

async function archiveFile(bot, { fileId, mimeType, caption, category, tags, userId, filename, chatPhoto }) {
  const topicId = await ensureTopic(bot, category);

  const captionText = `#${(category || 'سایر').replace(/\s+/g, '_')}\n${caption || ''}`.trim();

  let msg;
  // If it's a photo (has chatPhoto or mimeType starts with image), forward it as a photo for viewing.
  if (chatPhoto || /^image\//.test(mimeType || '')) {
    msg = await bot.sendPhoto(cfg.channelId, fileId, {
      caption: captionText,
      message_thread_id: topicId || undefined,
    });
  } else {
    msg = await bot.sendDocument(cfg.channelId, fileId, {
      caption: captionText,
      message_thread_id: topicId || undefined,
    });
  }

  return index.add({
    messageId: msg.message_id,
    category: category || 'سایر',
    tags: tags || [],
    caption: caption || '',
    mimeType: mimeType || '',
    userId: userId || null,
    filename: filename || '',
    messageThreadId: topicId || null,
  });
}

// Fetch a previously archived file back to the user.
async function fetchFile(bot, chatId, messageId) {
  await bot.copyMessage(chatId, cfg.channelId, Number(messageId));
}

module.exports = { archiveFile, fetchFile, ensureTopic };
