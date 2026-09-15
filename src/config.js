require('dotenv').config();

module.exports = {
  token: process.env.BOT_TOKEN,
  channelId: process.env.CHANNEL_ID,
  ownerId: process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null,
  dataDir: __dirname + '/../data',
  allowlistFile: __dirname + '/../data/allowlist.json',
  indexFile: __dirname + '/../data/index.json',
};
