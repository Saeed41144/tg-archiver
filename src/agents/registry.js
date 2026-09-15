const index = require('../storage/index');

// Agents register categories they own.
const agents = [];

function registerAgent({ name, categories }) {
  agents.push({ name, categories });
}

function findAgent(category) {
  return agents.find((a) => a.categories.includes(category)) || null;
}

function list() {
  return agents;
}

module.exports = { registerAgent, findAgent, list };
