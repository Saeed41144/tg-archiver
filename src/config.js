require('dotenv').config();

module.exports = {
  token: process.env.BOT_TOKEN,
  channelId: process.env.CHANNEL_ID,
  ownerId: process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null,
  dataDir: __dirname + '/../data',
  allowlistFile: __dirname + '/../data/allowlist.json',
  indexFile: __dirname + '/../data/index.json',
  aiFile: __dirname + '/../data/ai.json',
  // providers: 'gemini' | 'openai' | 'local'
  aiProvider: process.env.AI_PROVIDER || 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
};
