// Faroese pronunciation trainer — tiny backend proxy (zero npm dependencies, Node 18+).
// Serves the static app, proxies VoisIT TTS/ASR, keeps the API key server-side,
// and caches TTS audio on disk so the same text/voice/speed is never paid twice.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Optional .env loader (no dependency)
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) {}

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = (process.env.VOISIT_API_KEY || '').trim();
const BASE = process.env.VOISIT_BASE_URL || 'https://app.voisit.fo';
const ASR_MODEL = process.env.VOISIT_ASR_MODEL || 'voisit-asr-2026';
const ALLOW_ANY_TEXT = process.env.ALLOW_ANY_TEXT === '1';
const VOISIT_STORE = process.env.VOISIT_STORE !== '0'; // true = VoisIT keeps audio (repeat requests free there too)
const VOICES = ['simun', 'elin', 'drongur', 'genta'];
const PUBLIC_DIR = path.join(__dirname, 'public');
const LESSON_DIR = path.join(__dirname, 'lessons');
const CACHE_DIR = process.env.TTS_CACHE_DIR || path.join(__dirname, 'cache', 'tts');
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---- whitelist of Faroese text that may be synthesised (prevents others burning your quota)
let allowedTexts = new Set();
function collectFo(node, out) {
  if (Array.isArray(node)) node.forEach((n) => collectFo(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'fo' && typeof v === 'string') out.add(v.normalize('NFC').trim());
      else collectFo(v, out);
    }
  }
}
function loadWhitelist() {
  const out = new Set();
  for (const f of fs.readdirSync(LESSON_DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    try { collectFo(JSON.parse(fs.readFileSync(path.join(LESSON_DIR, f), 'utf8')), out); }
    catch (e) { console.error('Bad lesson file', f, e.message); }
  }
  allowedTexts = out;
}
loadWhitelist();
fs.watch(LESSON_DIR, () => { try { loadWhitelist(); } catch (_) {} });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function err(res, status, code, message) { sendJson(res, status, { error: { code, message } }); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, root, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return err(res, 403, 'FORBIDDEN', 'Forbidden');
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (_) { err(res, 404, 'NOT_FOUND', 'Not found'); }
}

// forward VoisIT error shape where possible
async function relayError(res, upstream) {
  let body; try { body = await upstream.json(); } catch (_) { body = null; }
  const code = body?.error?.code || 'UPSTREAM_ERROR';
  const message = body?.error?.message || `VoisIT returned HTTP ${upstream.status}`;
  const retryAfter = upstream.headers.get('retry-after');
  res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) });
  res.end(JSON.stringify({ error: { code, message, request_id: body?.error?.request_id } }));
}

async function handleTts(req, res) {
  if (!API_KEY) return err(res, 503, 'NO_API_KEY', 'VOISIT_API_KEY is not set on the server (demo mode).');
  let payload;
  try { payload = JSON.parse((await readBody(req, 20000)).toString('utf8')); }
  catch (_) { return err(res, 400, 'INVALID_INPUT', 'Bad JSON'); }
  const text = String(payload.text || '').normalize('NFC').trim();
  const voice = VOICES.includes(payload.voice) ? payload.voice : 'simun';
  const speed = Number(payload.speed ?? 1.0);
  if (!text || text.length > 500) return err(res, 400, 'INVALID_INPUT', 'Text missing or too long');
  if (!(speed >= 0.6 && speed <= 1.6)) return err(res, 400, 'INVALID_INPUT', 'Speed must be 0.6–1.6');
  if (!ALLOW_ANY_TEXT && !allowedTexts.has(text)) return err(res, 403, 'TEXT_NOT_IN_LESSONS', 'Only lesson text can be synthesised');

  const key = crypto.createHash('sha256').update(JSON.stringify([text, voice, speed.toFixed(2), 'mp3'])).digest('hex');
  for (const ext of ['mp3', 'wav']) {
    const f = path.join(CACHE_DIR, `${key}.${ext}`);
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'Content-Type': ext === 'mp3' ? 'audio/mpeg' : 'audio/wav', 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  let upstream;
  try {
    upstream = await fetch(`${BASE}/api/v1/tts/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ inputs: text, parameters: { voice, speed, audio_format: 'mp3', store: VOISIT_STORE } }),
    });
  } catch (e) { return err(res, 502, 'UPSTREAM_UNREACHABLE', e.message); }
  if (!upstream.ok) return relayError(res, upstream);
  const data = await upstream.json();
  if (!data.audio_base64) return err(res, 502, 'UPSTREAM_BAD_RESPONSE', 'No audio_base64 in VoisIT reply');
  const fmt = data.audio_format === 'wav' ? 'wav' : 'mp3'; // replay may return wav master (see docs)
  const buf = Buffer.from(data.audio_base64, 'base64');
  const tmp = path.join(CACHE_DIR, `${key}.${fmt}.tmp`);
  await fsp.writeFile(tmp, buf); await fsp.rename(tmp, path.join(CACHE_DIR, `${key}.${fmt}`));
  const remaining = upstream.headers.get('x-voisit-quota-remaining');
  res.writeHead(200, { 'Content-Type': fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav', 'X-Cache': 'MISS', ...(remaining ? { 'X-Quota-Remaining': remaining } : {}) });
  res.end(buf);
}

function extractTranscript(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.text === 'string') return data.text;
  if (typeof data.transcript === 'string') return data.transcript;
  if (typeof data.transcription === 'string') return data.transcription;
  if (Array.isArray(data.segments)) return data.segments.map((s) => s.text || '').join(' ');
  if (Array.isArray(data.results)) return data.results.map((s) => s.text || s.transcript || '').join(' ');
  return '';
}

async function handleAsr(req, res) {
  if (!API_KEY) return err(res, 503, 'NO_API_KEY', 'VOISIT_API_KEY is not set on the server (demo mode).');
  let audio;
  try { audio = await readBody(req, MAX_AUDIO_BYTES); }
  catch (e) { return err(res, e.status || 400, 'INVALID_AUDIO', 'Recording too large'); }
  if (audio.length < 100) return err(res, 400, 'EMPTY_AUDIO', 'Empty recording');
  const ctype = (req.headers['content-type'] || 'audio/wav').split(';')[0];
  const ext = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/flac': 'flac' }[ctype] || 'wav';
  const durationMs = Math.min(Math.max(parseInt(req.headers['x-duration-ms'] || '10000', 10) || 10000, 500), 60000);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: ctype }), `recording.${ext}`);
  form.append('language', 'fo');
  form.append('model', ASR_MODEL);
  form.append('duration_ms', String(durationMs));
  let upstream;
  try {
    upstream = await fetch(`${BASE}/api/v1/asr/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${API_KEY}`, 'Idempotency-Key': crypto.randomUUID() }, body: form,
    });
  } catch (e) { return err(res, 502, 'UPSTREAM_UNREACHABLE', e.message); }
  if (!upstream.ok) return relayError(res, upstream);
  const data = await upstream.json().catch(() => ({}));
  sendJson(res, 200, { text: extractTranscript(data), model: upstream.headers.get('x-voisit-model') || ASR_MODEL, raw: data });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config' && req.method === 'GET')
      return sendJson(res, 200, { hasKey: Boolean(API_KEY), voices: VOICES, asrModel: ASR_MODEL });
    if (url.pathname === '/api/tts' && req.method === 'POST') return await handleTts(req, res);
    if (url.pathname === '/api/asr' && req.method === 'POST') return await handleAsr(req, res);
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') return err(res, 405, 'METHOD', 'Method not allowed');
    if (url.pathname.startsWith('/lessons/')) return serveStatic(req, res, LESSON_DIR, url.pathname.slice('/lessons'.length));
    return serveStatic(req, res, PUBLIC_DIR, url.pathname);
  } catch (e) {
    console.error(e); if (!res.headersSent) err(res, 500, 'SERVER_ERROR', 'Internal error');
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Faroese pronunciation app on http://0.0.0.0:${PORT}  (${API_KEY ? 'VoisIT key loaded' : 'DEMO MODE – no VOISIT_API_KEY'})`);
});
