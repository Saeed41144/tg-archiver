const fs = require('fs');
const cfg = require('../config');

function read() {
  if (!fs.existsSync(cfg.allowlistFile)) {
    const def = { owners: [], users: [] };
    if (cfg.ownerId) def.owners.push(cfg.ownerId);
    write(def);
    return def;
  }
  return JSON.parse(fs.readFileSync(cfg.allowlistFile, 'utf8'));
}

function write(data) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(cfg.allowlistFile, JSON.stringify(data, null, 2));
}

function isOwner(userId) {
  return read().owners.includes(Number(userId));
}

function isAllowed(userId) {
  const d = read();
  return d.owners.includes(Number(userId)) || d.users.includes(Number(userId));
}

function addUser(userId) {
  const d = read();
  userId = Number(userId);
  if (d.users.includes(userId)) return false;
  d.users.push(userId);
  write(d);
  return true;
}

function addOwner(userId) {
  const d = read();
  userId = Number(userId);
  if (d.owners.includes(userId)) return false;
  d.owners.push(userId);
  write(d);
  return true;
}

function removeUser(userId) {
  const d = read();
  const before = d.users.length;
  d.users = d.users.filter((u) => u !== Number(userId));
  const after = before - d.users.length;
  write(d);
  return after > 0;
}

function list() {
  return read();
}

function exists(userId) {
  const d = read();
  return d.owners.includes(Number(userId)) || d.users.includes(Number(userId));
}

module.exports = { isOwner, isAllowed, addUser, addOwner, removeUser, list, exists, read, write };
