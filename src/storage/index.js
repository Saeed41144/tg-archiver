const fs = require('fs');
const cfg = require('../config');

function read() {
  if (!fs.existsSync(cfg.indexFile)) return [];
  return JSON.parse(fs.readFileSync(cfg.indexFile, 'utf8'));
}

function write(records) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(cfg.indexFile, JSON.stringify(records, null, 2));
}

// record: { messageId, category, tags, caption, timestamp, userId, mimeType }
function add(record) {
  const records = read();
  record.timestamp = record.timestamp || Date.now();
  records.push(record);
  write(records);
  return record;
}

function findByMessageId(messageId) {
  return read().find((r) => r.messageId === Number(messageId));
}

function search({ category, keyword }) {
  let records = read();
  if (category) {
    records = records.filter((r) => r.category === category);
  }
  if (keyword) {
    const k = String(keyword).toLowerCase();
    records = records.filter(
      (r) =>
        (r.category && r.category.toLowerCase().includes(k)) ||
        (r.tags && r.tags.some((t) => String(t).toLowerCase().includes(k))) ||
        (r.caption && r.caption.toLowerCase().includes(k))
    );
  }
  return records.reverse();
}

function stats() {
  const records = read();
  const byCat = {};
  records.forEach((r) => {
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  });
  return { total: records.length, byCat };
}

module.exports = { read, write, add, findByMessageId, search, stats };
