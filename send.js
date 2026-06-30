#!/usr/bin/env node
// Standard HXA outbound. Installed at ~/zylos/.claude/skills/hxa/scripts/send.js
// so c4-send routes outbound HXA messages here (skills/<channel>/scripts/send.js
// convention). Lets the main agent send an HXA DM to a specific recipient
// (e.g. the supervisor "xiaofei"). No secrets — token from env.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { HxaConnectClient } from '@coco-xyz/hxa-connect-sdk';

const ZYLOS_DIR = process.env.ZYLOS_DIR || '/home/ubuntu/zylos';

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

function parseEndpoint(endpoint) {
  if (!endpoint) return null;
  if (endpoint.startsWith('bot:')) return endpoint.slice(4);
  const m = endpoint.match(/(?:^|\|)sender:([^|]+)/);
  return m ? decodeURIComponent(m[1]) : endpoint;
}

const [endpoint, message] = process.argv.slice(2);
if (!endpoint || !message) { console.error('Usage: node send.js <endpoint> <message>'); process.exit(1); }

loadEnvFile(path.join(ZYLOS_DIR, '.env'));
loadEnvFile(process.env.HXA_ENV_FILE || path.join(ZYLOS_DIR, '.hxa-native.env'));

const url = process.env.HXA_URL || 'https://conai.cosark.com.cn';
const token = process.env.HXA_TOKEN;
const orgId = process.env.HXA_ORG_ID;
const target = parseEndpoint(endpoint);

if (!token) { console.error('[hxa-send] Missing HXA_TOKEN'); process.exit(1); }
if (!target) { console.error(`[hxa-send] Invalid endpoint: ${endpoint}`); process.exit(1); }

const client = new HxaConnectClient({ url, token, orgId });
try { await client.send(target, message); console.log(`[hxa-send] sent to ${target}`); }
catch (err) { console.error(`[hxa-send] failed: ${err?.message || err}`); process.exit(1); }
