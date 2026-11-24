#!/usr/bin/env node
// Concierge Care — live proxy for CX Enterprise Coworker (headless).
//
// Browser UI  ->  this local server  ->  Coworker MCP endpoint (Streamable HTTP, JSON-RPC)
//
// Why a server: a browser page cannot hold the Adobe bearer token safely and the MCP
// endpoint does not allow cross-origin browser calls. The token lives only in this
// process (env var or pasted at runtime) and is never sent to the browser or logged.
//
// Data: CJA JSON exports in ./sample-cja-data (or uploaded in the UI) are joined here and sent to
// the "Concierge Care Analysis Tabular" skill (Phase 1). Its findings.json is validated, saved to
// ./output/findings.json and drives the UI. A CSV export can be used as extra evidence.
//
// Zero npm dependencies. Node >= 18.

import http from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LIMITS, parseCsv, detectColumns, validateMapping, buildDigest, wrapForPrompt, safeName, ROLES } from './evidence.mjs';
import { createLogger } from './logger.mjs';
import { CJA_LIMITS, loadDataset, buildPhase1Message, cjaDigest, extractFencedJson, sanitizeFindings, verifyFindings } from './cja.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');
const SAMPLE_DIR = path.join(__dirname, 'sample-cja-data'); // drop CJA JSON exports here
const OUT_DIR = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : path.join(__dirname, 'output'); // findings.json is written here

// ---------- config (.env is optional; real env vars win) ----------
const ENV_KEYS = new Set([
  'PORT', 'COWORKER_MCP_URL', 'ADOBE_IMS_TOKEN', 'ADOBE_ORG_ID', 'ADOBE_SANDBOX',
  'CONCIERGE_NAME', 'ALLOW_LOCAL_MCP', 'OUTPUT_DIR', 'LOG_PAYLOADS', 'LOG_DIR', 'COWORKER_TIMEOUT_MS',
]);
(function loadDotEnv() {
  const f = path.join(__dirname, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !ENV_KEYS.has(m[1]) || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

const HOST = '127.0.0.1'; // loopback only — never expose this proxy on the network
const PORT = Number(process.env.PORT || 8787);
const ALLOW_LOCAL_MCP = process.env.ALLOW_LOCAL_MCP === '1'; // dev only: lets the mock server run
const SANDBOX = process.env.ADOBE_SANDBOX || '';
const ORG_ID = process.env.ADOBE_ORG_ID || '';
const CONCIERGE = process.env.CONCIERGE_NAME || '';

const ID_RE = /^[A-Za-z0-9@._-]{1,128}$/;
const EPISODE_RE = /^\d{1,30}$/;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{20,8192}$/;
const MAX_MESSAGE = 8000;

let MCP_URL;
try {
  MCP_URL = new URL(process.env.COWORKER_MCP_URL || 'https://mcp.coworker.experience.adobe.io/');
} catch {
  fail('COWORKER_MCP_URL is not a valid URL');
}
{
  const h = MCP_URL.hostname;
  const adobeHttps = MCP_URL.protocol === 'https:' && (h.endsWith('.adobe.io') || h.endsWith('.adobe.com'));
  const localDev = ALLOW_LOCAL_MCP && MCP_URL.protocol === 'http:' && (h === '127.0.0.1' || h === 'localhost');
  if (!adobeHttps && !localDev) fail('COWORKER_MCP_URL must be https on *.adobe.io / *.adobe.com');
}
function fail(msg) { console.error('Config error: ' + msg); process.exit(1); }

// Token is held in memory only.
let bearer = cleanToken(process.env.ADOBE_IMS_TOKEN || '');
delete process.env.ADOBE_IMS_TOKEN;
function cleanToken(t) { return String(t || '').trim().replace(/^Bearer\s+/i, ''); }

const CSRF = crypto.randomBytes(32).toString('hex'); // per-process; embedded in the served page

// How long one Coworker turn may take. Real Phase 1 turns run 1–3 minutes (the agent calls several tools).
const TIMEOUT_MS = Math.min(900_000, Math.max(30_000, Number(process.env.COWORKER_TIMEOUT_MS) || 300_000));

// Logger: what we send to Coworker and what comes back (see logger.mjs). LOG_PAYLOADS=0 -> sizes only.
const logger = createLogger({
  dir: process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(__dirname, 'logs'),
  payloads: process.env.LOG_PAYLOADS !== '0',
  getSecret: () => bearer,
});

// ---------- minimal MCP Streamable-HTTP client ----------
class HttpError extends Error { constructor(status) { super('http_' + status); this.status = status; } }

function parseSseBlock(block) {
  const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; } // ignore non-JSON events
}

// Incrementally read an SSE reply; resolve on the matching JSON-RPC result, log everything else.
async function readSse(res, { expectId, callId, t0 }) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 8_000_000) throw new Error('response_too_large');
      buf += dec.decode(value, { stream: true });
      let sep;
      while ((sep = buf.match(/\r?\n\r?\n/))) {
        const block = buf.slice(0, sep.index);
        buf = buf.slice(sep.index + sep[0].length);
        const msg = parseSseBlock(block);
        if (!msg) continue;
        const ms = Date.now() - t0;
        if (msg.id === expectId && ('result' in msg || 'error' in msg)) {
          logger.log({ callId, dir: 'upstream', kind: 'event', method: 'result', bytes: block.length, ms });
          return msg;
        }
        if (msg.method === 'notifications/progress') {
          const p = msg.params || {};
          logger.log({ callId, dir: 'upstream', kind: 'progress', text: p.message, params: { progress: p.progress, total: p.total }, ms });
        } else if (msg.method === 'notifications/message') {
          const d = msg.params?.data;
          logger.log({ callId, dir: 'upstream', kind: 'progress', text: typeof d === 'string' ? d : JSON.stringify(d), ms });
        } else logger.log({ callId, dir: 'upstream', kind: 'event', method: msg.method || 'unknown', bytes: block.length, ms });
      }
    }
  } finally { reader.cancel().catch(() => {}); } // closes the connection even if the server keeps the stream open
  throw new Error('stream_ended_without_result');
}

class McpClient {
  constructor() { this.sessionId = null; this.ready = null; this.nextId = 1; }

  reset() { this.sessionId = null; this.ready = null; }

  headers() {
    const h = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + bearer,
    };
    if (this.sessionId) { h['Mcp-Session-Id'] = this.sessionId; h['MCP-Protocol-Version'] = '2025-06-18'; }
    if (ORG_ID) h['x-gw-ims-org-id'] = ORG_ID;
    if (SANDBOX) h['x-sandbox-name'] = SANDBOX;
    return h;
  }

  // POST one JSON-RPC message. For a request (expectId set) the reply is READ AS A STREAM and we return as soon
  // as the matching result arrives; we never wait for the server to close an SSE stream (a server that keeps the
  // stream open after answering used to make Phase 1 look endless). Progress events are logged as they arrive.
  async send(body, { timeoutMs = TIMEOUT_MS, signal, callId, expectId } = {}) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
    const onAbort = () => ac.abort(signal.reason);
    if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      // redirect:'error' -> the bearer token can never be forwarded to another host.
      const res = await fetch(MCP_URL, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: ac.signal, redirect: 'error' });
      const ct = res.headers.get('content-type') || '';
      logger.log({ callId, dir: 'upstream', kind: 'http', rpc: body.method, status: res.status, ms_to_headers: Date.now() - t0, content_type: ct.split(';')[0] });
      if (res.status === 401 || res.status === 403) throw new HttpError(res.status);
      if (res.status === 404 && this.sessionId) throw new HttpError(404); // session expired
      if (!res.ok && res.status !== 202) throw new HttpError(res.status);
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (expectId === undefined) { await res.arrayBuffer().catch(() => {}); return null; } // notification: nothing to read
      if (!/event-stream/i.test(ct)) {
        const m = safeJson((await res.text()).slice(0, 4_000_000));
        if (!m || m.id !== expectId) throw new Error('no_response');
        return m;
      }
      return await readSse(res, { expectId, callId, t0 });
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  async rpc(method, params, opts = {}) {
    const id = this.nextId++;
    const m = await this.send({ jsonrpc: '2.0', id, method, params }, { ...opts, expectId: id });
    if (m.error) { const e = new Error('rpc_error'); e.rpc = m.error; throw e; }
    return m.result;
  }

  async init(opts) {
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'concierge-care-live', version: '1.3.0' },
    }, { ...opts, timeoutMs: 30_000 });
    await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, { ...opts, timeoutMs: 15_000 });
  }

  ensure(opts) {
    if (!this.ready) this.ready = this.init(opts).catch((e) => { this.reset(); throw e; });
    return this.ready;
  }

  async callTool(name, args, opts = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensure(opts);
        // _meta.progressToken invites the server to stream progress notifications, which we log.
        return await this.rpc('tools/call', { name, arguments: args, _meta: { progressToken: 'care-' + (opts.callId || 'x') } }, opts);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404 && attempt === 0) { this.reset(); continue; }
        throw e;
      }
    }
    throw new Error('unreachable');
  }
}
function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }
const mcp = new McpClient();

function normalizeAsk(result) {
  const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const obj = result?.structuredContent || safeJson(text);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const out = {
      status: typeof obj.status === 'string' ? obj.status.slice(0, 40) : 'completed',
      response: typeof obj.response === 'string' ? obj.response.slice(0, 200_000) : '',
    };
    if (obj.episode_id != null) out.episode_id = String(obj.episode_id).slice(0, 40);
    if (obj.turn_id != null) out.turn_id = String(obj.turn_id).slice(0, 40);
    if (obj.suspend && typeof obj.suspend === 'object') out.suspend = clip(obj.suspend);
    return out;
  }
  return { status: result?.isError ? 'error' : 'completed', response: text.slice(0, 200_000) };
}
function clip(o) { const s = JSON.stringify(o); return s.length > 50_000 ? { kind: o.kind } : JSON.parse(s); }

// ---------- uploaded CSV evidence (memory only, one file) ----------
let evidence = null; // { name, headers, rows, mapping, digest, stats, ready }
function applyEvidence(mapping) {
  const d = buildDigest(evidence, mapping, evidence.name);
  Object.assign(evidence, { mapping, digest: d.digest, stats: d.stats, ready: d.ready });
}
function evidenceSummary() {
  if (!evidence) return null;
  return { name: evidence.name, headers: evidence.headers, mapping: evidence.mapping, stats: evidence.stats, ready: evidence.ready, digest: evidence.digest, roles: ROLES };
}

// ---------- CJA JSON datasets (sample folder, or files uploaded in the UI) ----------
const uploads = new Map(); // name -> text (memory only)
let sampleFiles = [];      // [{name,text}] from ./sample-cja-data
let dsCache = null;
async function loadSampleFolder() {
  sampleFiles = [];
  if (existsSync(SAMPLE_DIR)) {
    for (const name of (await readdir(SAMPLE_DIR)).filter((n) => /\.json$/i.test(n)).sort().slice(0, CJA_LIMITS.maxFiles)) {
      const p = path.join(SAMPLE_DIR, name);
      if ((await stat(p)).size <= CJA_LIMITS.maxFileBytes) sampleFiles.push({ name, text: await readFile(p, 'utf8') });
    }
  }
  dsCache = null;
}
function getDataset() {
  if (!dsCache) {
    const files = uploads.size ? [...uploads].map(([name, text]) => ({ name, text })) : sampleFiles;
    dsCache = { ds: loadDataset(files), source: uploads.size ? 'upload' : 'sample' };
  }
  return dsCache;
}
function cjaSummary() {
  const { ds, source } = getDataset();
  return { source, ready: ds.ready, stats: ds.stats, files: ds.files, warnings: ds.warnings, folder: 'sample-cja-data' };
}

// ---------- findings.json (Phase 1 output) ----------
let findingsState = null; // { doc, checks, warnings, problems, savedAt, source }
function buildFindingsState(doc, problems, savedAt, source) {
  const v = getDataset().ds.ready ? verifyFindings(doc, getDataset().ds) : { checks: [], warnings: ['no CJA data loaded, so the findings could not be checked'] };
  return { doc, checks: v.checks, warnings: v.warnings, problems, savedAt, source };
}
async function saveFindings(doc, reply, problems) {
  await mkdir(OUT_DIR, { recursive: true, mode: 0o700 });
  const tmp = path.join(OUT_DIR, `.findings.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path.join(OUT_DIR, 'findings.json'));
  await writeFile(path.join(OUT_DIR, 'phase1-response.md'), String(reply).slice(0, 200_000), { mode: 0o600 });
  findingsState = buildFindingsState(doc, problems, new Date().toISOString(), 'coworker');
}
async function loadFindingsFromDisk() {
  const p = path.join(OUT_DIR, 'findings.json');
  if (!existsSync(p)) return;
  const san = sanitizeFindings(safeJson(await readFile(p, 'utf8')));
  if (san.ok) findingsState = buildFindingsState(san.doc, san.problems, (await stat(p)).mtime.toISOString(), 'file');
}

// ---------- body readers ----------
async function readRaw(req, max, typeRe, nameRe, filename) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!typeRe.test(ct) || !nameRe.test(filename)) throw Object.assign(new Error('unsupported_file_type'), { code: 415 });
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('too_large'), { code: 413 });
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (buf.includes(0)) throw Object.assign(new Error('unsupported_file_type'), { code: 415 }); // binary
  return buf.toString('utf8');
}
async function readJson(req, max = 65_536) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('bad_content_type'), { code: 415 });
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('too_large'), { code: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('bad_json'), { code: 400 }); }
}
const headerName = (req) => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return ''; } };

// ---------- HTTP plumbing ----------
const hits = new Map(); // naive in-memory rate limit: 60 API calls / minute
function rateLimited() {
  const now = Date.now();
  const arr = (hits.get('api') || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set('api', arr);
  return arr.length > 60;
}
function secHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra,
  };
}
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, secHeaders({ 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers }));
  res.end(isObj ? JSON.stringify(body) : body);
}
function csrfOk(req) {
  const got = String(req.headers['x-care-csrf'] || '');
  const a = Buffer.from(got), b = Buffer.from(CSRF);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function hostOk(req) {
  const h = String(req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`; // blocks DNS-rebinding
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // same-origin requests may omit it; the CSRF header is still required
  return o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`;
}
function log(rec) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...rec })); }

// Static files: fixed allowlist, no path joining from user input.
const STATIC = {
  '/live.js': ['live.js', 'text/javascript; charset=utf-8'],
  '/live.css': ['live.css', 'text/css; charset=utf-8'],
};
let indexTemplate = null;
async function renderIndex(nonce) {
  if (!indexTemplate) indexTemplate = await readFile(path.join(PUB, 'index.html'), 'utf8');
  return indexTemplate
    .replace('</head>', `<meta name="care-csrf" content="${CSRF}"><link rel="stylesheet" href="/live.css"></head>`)
    .replace(/<style>/g, `<style nonce="${nonce}">`)
    .replace(/<script>/g, `<script nonce="${nonce}">`)
    .replace('</body>', `<script nonce="${nonce}" src="/live.js"></script></body>`);
}

// One Coworker turn, fully logged: the request we send, upstream timings/progress (logged by the client),
// and the response. If the browser disconnects or presses Cancel, the upstream call is aborted.
async function askCoworker(route, args, res) {
  const callId = crypto.randomBytes(3).toString('hex');
  const ac = new AbortController();
  const onClose = () => { if (!res.writableFinished) ac.abort(new DOMException('client disconnected', 'AbortError')); };
  res.on('close', onClose);
  const t0 = Date.now();
  logger.log({ callId, dir: 'out', kind: 'request', route, tool: 'ask_aep_agent', episode_id: args.episode_id || null, sandbox_name: args.sandbox_name || null, message: args.message });
  try {
    const out = normalizeAsk(await mcp.callTool('ask_aep_agent', args, { signal: ac.signal, callId }));
    logger.log({ callId, dir: 'in', kind: 'response', status: out.status, episode_id: out.episode_id || null, suspend_kind: out.suspend?.kind || null, response: out.response, suspend: out.suspend, ms: Date.now() - t0 });
    return out;
  } catch (e) {
    const ms = Date.now() - t0;
    if (e?.name === 'AbortError') logger.log({ callId, kind: 'cancelled', reason: 'browser cancelled or disconnected', ms });
    else logger.log({ callId, kind: 'error', error: e?.name === 'TimeoutError' ? `no result within ${Math.round(TIMEOUT_MS / 1000)}s (COWORKER_TIMEOUT_MS)` : `${e?.name || 'Error'}: ${e?.message}`, rpc: e?.rpc?.message, ms });
    throw e;
  } finally { res.off('close', onClose); }
}

const findingsPublic = () => (findingsState ? { findings: findingsState } : { findings: null });

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const rid = crypto.randomBytes(4).toString('hex');
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  let status = 0;
  try {
    if (!hostOk(req)) { status = 400; return send(res, 400, 'bad host'); }

    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = crypto.randomBytes(16).toString('base64');
      const csp = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "style-src-attr 'unsafe-inline'", // legacy prototype uses inline style="" attributes
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
      ].join('; ');
      status = 200;
      return send(res, 200, await renderIndex(nonce), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      status = 200;
      return send(res, 200, await readFile(path.join(PUB, file)), { 'Content-Type': type });
    }

    if (url.pathname.startsWith('/api/')) {
      if (rateLimited()) { status = 429; return send(res, 429, { error: 'rate_limited' }); }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        status = 200;
        return send(res, 200, { configured: !!bearer, mcpHost: MCP_URL.host, concierge: CONCIERGE, sandbox: SANDBOX, evidence: evidenceSummary(), cja: cjaSummary(), hasFindings: !!findingsState, timeoutMs: TIMEOUT_MS, logPayloads: logger.payloads });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') { // what we sent to Coworker and what came back (contains conversation text)
        if (!csrfOk(req)) { status = 403; return send(res, 403, { error: 'forbidden' }); }
        const entries = logger.since(Number(url.searchParams.get('since')) || 0, Math.min(500, Number(url.searchParams.get('limit')) || 100));
        status = 200;
        return send(res, 200, { entries, last: logger.last()?.seq || 0, payloads: logger.payloads });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs/download') { // anchor click can't set headers, so the page's CSRF token rides in ?k=
        const k = String(url.searchParams.get('k') || '');
        if (k.length !== CSRF.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(CSRF))) { status = 403; return send(res, 403, { error: 'forbidden' }); }
        const p = logger.file();
        if (!existsSync(p)) { status = 404; return send(res, 404, { error: 'no_log_yet' }); }
        status = 200;
        return send(res, 200, await readFile(p), { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(p)}"` });
      }
      if (req.method === 'GET' && url.pathname === '/api/findings') { status = 200; return send(res, 200, findingsPublic()); }
      if (req.method === 'GET' && url.pathname === '/api/findings/download') {
        const p = path.join(OUT_DIR, 'findings.json');
        if (!existsSync(p)) { status = 404; return send(res, 404, { error: 'no_findings' }); }
        status = 200;
        return send(res, 200, await readFile(p), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="findings.json"' });
      }

      if (req.method === 'POST') {
        if (!originOk(req) || !csrfOk(req)) { status = 403; return send(res, 403, { error: 'forbidden' }); }

        if (url.pathname === '/api/evidence') { // raw CSV body; filename in the x-filename header
          const fname = headerName(req);
          const text = await readRaw(req, LIMITS.maxBytes, /^(text\/(csv|plain|tab-separated-values)|application\/(csv|vnd\.ms-excel))/, /\.(csv|tsv|txt)$/i, fname);
          const parsed = parseCsv(text);
          if (!parsed.headers.length || !parsed.rows.length) { status = 400; return send(res, 400, { error: 'empty_or_unreadable_csv' }); }
          evidence = { name: safeName(fname), headers: parsed.headers, rows: parsed.rows };
          applyEvidence(detectColumns(parsed.headers));
          log({ rid, evidenceRows: parsed.rows.length, truncated: parsed.truncated }); // counts only, never content
          status = 200;
          return send(res, 200, { evidence: evidenceSummary(), truncated: parsed.truncated });
        }

        if (url.pathname === '/api/cja/file') { // one CJA JSON export per request; filename in x-filename
          const fname = safeName(headerName(req));
          const text = await readRaw(req, CJA_LIMITS.maxFileBytes, /^application\/json/, /\.json$/i, fname);
          if (safeJson(text) === null) { status = 400; return send(res, 400, { error: 'invalid_json' }); }
          if (!uploads.has(fname) && uploads.size >= CJA_LIMITS.maxFiles) { status = 400; return send(res, 400, { error: 'too_many_files' }); }
          uploads.set(fname, text); dsCache = null;
          log({ rid, cjaUpload: fname.length, bytes: text.length });
          status = 200;
          return send(res, 200, { cja: cjaSummary() });
        }

        const body = await readJson(req);

        if (url.pathname === '/api/cja/clear') { uploads.clear(); dsCache = null; status = 200; return send(res, 200, { cja: cjaSummary() }); }
        if (url.pathname === '/api/cja/reload') { await loadSampleFolder(); status = 200; return send(res, 200, { cja: cjaSummary() }); }

        if (url.pathname === '/api/evidence/map') {
          if (!evidence) { status = 404; return send(res, 404, { error: 'no_evidence' }); }
          const m = validateMapping(body.mapping, evidence.headers);
          if (!m) { status = 400; return send(res, 400, { error: 'invalid_mapping' }); }
          applyEvidence(m);
          status = 200;
          return send(res, 200, { evidence: evidenceSummary() });
        }
        if (url.pathname === '/api/evidence/clear') { evidence = null; status = 200; return send(res, 200, { evidence: null }); }

        if (url.pathname === '/api/token') {
          const t = cleanToken(body.token);
          if (!TOKEN_RE.test(t)) { status = 400; return send(res, 400, { error: 'invalid_token_format' }); }
          bearer = t; mcp.reset();
          status = 200;
          return send(res, 200, { configured: true });
        }

        if (!bearer) { status = 401; return send(res, 401, { error: 'auth_required' }); }

        if (url.pathname === '/api/test') {
          const [orgs, sbx] = await Promise.all([
            mcp.callTool('core_list_orgs', {}, { timeoutMs: 30_000, callId: 'test' }),
            mcp.callTool('core_list_sandboxes', {}, { timeoutMs: 30_000, callId: 'test' }),
          ]);
          const o = safeJson((orgs.content || []).map((c) => c.text).join('')) || {};
          const s = safeJson((sbx.content || []).map((c) => c.text).join('')) || {};
          status = 200;
          return send(res, 200, {
            ok: true,
            orgCount: Array.isArray(o.orgs) ? o.orgs.length : null,
            sandboxes: Array.isArray(s.sandboxes) ? s.sandboxes.slice(0, 20).map((x) => String(x.name).slice(0, 80)) : [],
          });
        }

        // Phase 1: run the "Concierge Care Analysis Tabular" skill on the loaded CJA data.
        // First call builds the prompt server-side; a call with {episode_id, reply} answers a Coworker question.
        if (url.pathname === '/api/phase1/run') {
          const { ds } = getDataset();
          if (!ds.ready) { status = 400; return send(res, 400, { error: 'no_data' }); }
          const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
          const args = {};
          if (reply) {
            if (reply.length > 4000 || body.episode_id == null) { status = 400; return send(res, 400, { error: 'invalid_reply' }); }
            args.message = reply;
          } else args.message = buildPhase1Message(ds, { concierge: CONCIERGE, sandbox: SANDBOX });
          if (body.episode_id != null) {
            if (!EPISODE_RE.test(String(body.episode_id))) { status = 400; return send(res, 400, { error: 'invalid_episode' }); }
            args.episode_id = String(body.episode_id);
          }
          if (SANDBOX) args.sandbox_name = SANDBOX;
          const out = await askCoworker('/api/phase1/run', args, res);
          if (out.status === 'completed') {
            const san = sanitizeFindings(extractFencedJson(out.response));
            if (san.ok) { await saveFindings(san.doc, out.response, san.problems); out.findings = findingsState; }
            else out.findingsError = san.problems.join('; ');
          }
          status = 200;
          return send(res, 200, out);
        }

        if (url.pathname === '/api/ask') {
          const message = typeof body.message === 'string' ? body.message.trim() : '';
          if (!message || message.length > MAX_MESSAGE) { status = 400; return send(res, 400, { error: 'invalid_message' }); }
          const args = { message };
          if (body.with_evidence === true) { // backend appends a redacted, fenced, data-only digest
            const { ds } = getDataset();
            if (evidence && evidence.ready) args.message = message + wrapForPrompt(evidence.digest);
            else if (ds.ready) args.message = message + wrapForPrompt(cjaDigest(ds));
            else { status = 400; return send(res, 400, { error: 'evidence_not_ready' }); }
          }
          if (body.episode_id != null) {
            if (!EPISODE_RE.test(String(body.episode_id))) { status = 400; return send(res, 400, { error: 'invalid_episode' }); }
            args.episode_id = String(body.episode_id);
          }
          for (const k of ['org_id', 'sandbox_name']) {
            if (body[k] != null) {
              if (!ID_RE.test(String(body[k]))) { status = 400; return send(res, 400, { error: 'invalid_' + k }); }
              args[k] = String(body[k]);
            }
          }
          const out = await askCoworker('/api/ask', args, res); // only ask_aep_agent / core_list_* are ever called
          status = 200;
          return send(res, 200, out);
        }
      }
    }
    status = 404;
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    // Generic message to the client; details (never tokens/bodies) only in the server log.
    if (e && e.code && [400, 413, 415].includes(e.code)) { status = e.code; return send(res, e.code, { error: e.message }); }
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      mcp.reset(); status = 401; // keep the token in memory; the user can paste a fresh one
      return send(res, 401, { error: 'auth_required' });
    }
    if (e && e.name === 'AbortError') { status = 499; return; } // the browser went away or pressed Cancel; the upstream call was aborted
    status = e && e.name === 'TimeoutError' ? 504 : 502;
    log({ rid, route: url.pathname, err: String(e && (e.message || e.name)).slice(0, 200), rpc: e && e.rpc ? String(e.rpc.message || '').slice(0, 200) : undefined });
    send(res, status, { error: status === 504 ? 'timeout' : 'upstream_error', id: rid });
  } finally {
    log({ rid, m: req.method, route: url.pathname, status, ms: Date.now() - started });
  }
});

await loadSampleFolder();
await loadFindingsFromDisk();
server.listen(PORT, HOST, () => {
  const d = getDataset().ds;
  console.log(`Concierge Care live proxy: http://localhost:${PORT}`);
  console.log(`Coworker MCP: ${MCP_URL.origin}${MCP_URL.pathname}  ·  token: ${bearer ? 'set' : 'NOT SET (paste it in the UI: Connection)'}  ·  turn timeout ${Math.round(TIMEOUT_MS / 1000)}s`);
  console.log(`Logging Coworker traffic to ${logger.file().replace(/coworker-.*$/, '')}  (payloads ${logger.payloads ? 'ON — files contain conversation text' : 'OFF — sizes only'}; view in the UI: Debug log)`);
  console.log(`CJA data: ${d.ready ? `${d.stats.turns} turn(s) from ./sample-cja-data` : 'none found in ./sample-cja-data'}  ·  findings: ${findingsState ? findingsState.doc.findings.length + ' loaded from ./output/findings.json' : 'none yet'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
