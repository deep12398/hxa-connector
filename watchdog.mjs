// HXA connector watchdog: polls the connector's PM2 status and restarts it if
// it is not "online". On repeated failure it raises a C4 alert. (Note: a
// watchdog is itself just a process — for full closure the connector + this
// watchdog should also be registered under the runtime guardian / pm2 save so
// they survive reboots and fleet restarts.)
//
// No secrets here. Alert endpoint is supplied via env.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ZYLOS_DIR = process.env.ZYLOS_DIR || '/home/ubuntu/zylos';
const APP_NAME = process.env.HXA_WATCHDOG_APP || 'hxa-connector';
const INTERVAL_MS = Number(process.env.HXA_WATCHDOG_INTERVAL_MS || 60000);
const STATE_FILE = process.env.HXA_WATCHDOG_STATE || path.join(ZYLOS_DIR, 'hxa-connect/watchdog-state.json');
const ALERT_CHANNEL = process.env.HXA_WATCHDOG_ALERT_CHANNEL || 'feishu';
const ALERT_ENDPOINT = process.env.HXA_WATCHDOG_ALERT_ENDPOINT || ''; // set to enable alerts
const ALERT_AFTER = Number(process.env.HXA_WATCHDOG_ALERT_AFTER_FAILURES || 2);
const C4_SEND = path.join(ZYLOS_DIR, '.claude/skills/comm-bridge/scripts/c4-send.js');

const nowIso = () => new Date().toISOString();
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { failures: 0, lastStatus: 'unknown', incidents: [] }; } };
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

async function run(cmd, args) {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: ZYLOS_DIR, maxBuffer: 1024 * 1024 });
  return `${stdout || ''}${stderr || ''}`.trim();
}
async function getApp() { return JSON.parse(await run('pm2', ['jlist'])).find((a) => a?.name === APP_NAME); }

async function sendAlert(message) {
  if (!ALERT_ENDPOINT) { console.warn('[hxa-watchdog] no ALERT_ENDPOINT set, skip alert'); return; }
  await new Promise((resolve, reject) => {
    const c = spawn('node', [C4_SEND, ALERT_CHANNEL, ALERT_ENDPOINT], { cwd: ZYLOS_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => out += d); c.stderr.on('data', (d) => out += d);
    c.on('error', reject); c.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(out || `c4-send exit ${code}`)));
    c.stdin.end(message);
  });
}
function remember(s, inc) { s.incidents = Array.isArray(s.incidents) ? s.incidents : []; s.incidents.push(inc); if (s.incidents.length > 20) s.incidents.shift(); }

async function checkOnce() {
  const s = readState();
  let app;
  try { app = await getApp(); }
  catch (e) { s.failures = (s.failures || 0) + 1; s.lastStatus = 'pm2-check-failed'; s.lastError = e.message; remember(s, { at: nowIso(), status: s.lastStatus, error: e.message }); writeState(s); return; }

  const status = app?.pm2_env?.status || 'missing';
  if (status === 'online') { s.failures = 0; s.lastStatus = status; s.lastOkAt = nowIso(); writeState(s); return; }

  const stoppedAt = nowIso();
  let restartError = '';
  try { await run('pm2', ['restart', APP_NAME]); s.lastRestartAt = nowIso(); }
  catch (e) { restartError = e.message; }
  s.failures = (s.failures || 0) + 1; s.lastStatus = status; s.lastError = restartError;
  remember(s, { at: stoppedAt, status, restartAt: s.lastRestartAt || '', restartError });
  writeState(s);

  if (s.failures >= ALERT_AFTER) {
    const detail = restartError ? `auto-restart failed: ${restartError}` : 'auto-restart attempted; please verify.';
    await sendAlert(`HXA connector watchdog alert: ${APP_NAME} status=${status}.\n${detail}\nat=${stoppedAt}\nconsecutive failures=${s.failures}`).catch((e) => console.error('[hxa-watchdog] alert failed:', e.message));
  }
}

console.log(`[hxa-watchdog] watching ${APP_NAME}, interval=${INTERVAL_MS}ms`);
await checkOnce().catch((e) => console.error('[hxa-watchdog] check failed:', e));
setInterval(() => checkOnce().catch((e) => console.error('[hxa-watchdog] check failed:', e)), INTERVAL_MS);
