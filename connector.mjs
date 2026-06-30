// HXA / A2A standard connector (reference implementation)
// Bridges inbound HXA messages into the local agent via c4-receive, with
// SDK auto-reconnect. NO dead-regex auto-reply: every inbound message is
// handed to the main agent so it can answer with real business logic.
//
// All credentials come from the environment (see .env.example) — this file
// contains no secrets.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HxaConnectClient } from '@coco-xyz/hxa-connect-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZYLOS_DIR = process.env.ZYLOS_DIR || '/home/ubuntu/zylos';
const C4_RECEIVE = path.join(ZYLOS_DIR, '.claude/skills/comm-bridge/scripts/c4-receive.js');

function loadEnvFile(pathname) {
  if (!pathname || !fs.existsSync(pathname)) return;
  for (const line of fs.readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx);
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(idx + 1);
  }
}

// Load the connector's own dir .env first (drop-in: one .env per org dir),
// then any explicit env file, then the legacy native env.
loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(process.env.HXA_ENV_FILE);
loadEnvFile(path.join(ZYLOS_DIR, '.hxa-native.env'));

const url = process.env.HXA_URL || 'https://conai.cosark.com.cn';
const token = process.env.HXA_TOKEN;
const orgId = process.env.HXA_ORG_ID;
const name = process.env.HXA_NAME || process.env.HXA_BOT_NAME || 'bot';

if (!token) {
  console.error('[hxa] Missing HXA_TOKEN');
  process.exit(1);
}

const client = new HxaConnectClient({
  url,
  token,
  orgId,
  reconnect: { enabled: true, initialDelay: 1000, maxDelay: 30000, backoffFactor: 2 },
});

const seen = new Set();
function compactSeen(id) {
  seen.add(id);
  if (seen.size <= 1000) return;
  const first = seen.values().next().value;
  if (first) seen.delete(first);
}

function extract(event) {
  const msg = event?.message && typeof event.message === 'object' ? event.message : event;
  const content = msg?.content || event?.content || '';
  const sender = msg?.sender_name || event?.sender_name || event?.sender || msg?.sender_id || 'unknown';
  const channelId = msg?.channel_id || event?.channel_id || event?.channel?.id || '';
  const messageId = msg?.id || event?.id || `${channelId}:${sender}:${msg?.created_at || ''}:${content}`;
  return { content, sender, channelId, messageId };
}

function buildEndpoint(channelId, sender) {
  const s = encodeURIComponent(sender || 'unknown');
  return channelId ? `channel:${channelId}|sender:${s}` : `bot:${s}`;
}

// Inbound -> c4-receive -> main agent. This is the contract: the connector
// NEVER answers on its own; it only delivers the message to the agent.
function queueToC4(event) {
  const { content, sender, channelId, messageId } = extract(event);
  if (!content || typeof content !== 'string') return;
  if (sender === name) return;
  if (seen.has(messageId)) return;
  compactSeen(messageId);

  const endpoint = buildEndpoint(channelId, sender);
  const args = [C4_RECEIVE, '--channel', 'hxa', '--endpoint', endpoint, '--priority', '2',
    '--content', `[HXA] ${sender} said: ${content}`];
  const child = spawn('node', args, { cwd: ZYLOS_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => process.stdout.write(`[hxa:c4] ${c}`));
  child.stderr.on('data', (c) => process.stderr.write(`[hxa:c4] ${c}`));
  child.on('close', (code) => {
    if (code !== 0) console.error(`[hxa] queue failed from ${sender}; exit=${code}`);
    else console.log(`[hxa] queued to C4 from ${sender} endpoint=${endpoint}`);
  });
}

client.on('*', (event) => {
  const type = event?.type || 'event';
  if (type === 'message') {
    const { sender, content } = extract(event);
    console.log(`[hxa] message from ${sender}: ${content}`);
    queueToC4(event);
    return;
  }
  console.log(`[hxa] ${type}`, JSON.stringify(event).slice(0, 1000));
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[hxa] ${sig} shutting down`); client.disconnect(); process.exit(0); });
}

console.log(`[hxa] connecting ${name} to ${url} org=${orgId || 'default'}`);
await client.connect();
await client.getProfile().then((p) => p && console.log('[hxa] profile', JSON.stringify(p)))
  .catch((e) => console.warn('[hxa] getProfile failed:', e.message));

setInterval(() => {
  try {
    const p = client.ping();
    if (p && typeof p.catch === 'function') p.catch((e) => console.warn('[hxa] ping failed:', e.message));
  } catch (e) { console.warn('[hxa] ping failed:', e.message); }
}, 30000);
