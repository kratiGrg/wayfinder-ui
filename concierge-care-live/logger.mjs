// Small structured logger for the Care proxy.
//
// What it records (per Coworker call): the request the proxy sent, upstream HTTP timings,
// every streamed progress event, and the response that came back, plus errors / cancels.
//   - console: one short line per entry
//   - logs/coworker-YYYY-MM-DD.jsonl: full entries, one JSON object per line (mode 0600)
//   - in-memory ring buffer: served to the UI's "Debug log" panel via /api/logs
//
// The bearer token is never logged: it is not passed in, and any accidental occurrence in a
// string is masked. Message/response bodies ARE logged by default because that is the point of
// this log; set LOG_PAYLOADS=0 to log sizes only. Log files may contain customer conversation
// text, so keep ./logs private.
import { mkdirSync, appendFile } from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 200_000;

export function createLogger({ dir, payloads = true, getSecret = () => '', ringSize = 400, echo = true }) {
  let seq = 0;
  const ring = [];
  let dirReady = false;

  const mask = (v) => {
    const secret = getSecret();
    const walk = (x, depth = 0) => {
      if (typeof x === 'string') {
        let s = x.length > MAX_TEXT ? x.slice(0, MAX_TEXT) + `… [+${x.length - MAX_TEXT} chars]` : x;
        if (secret && secret.length > 12) s = s.split(secret).join('[token]');
        return s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'Bearer [token]');
      }
      if (Array.isArray(x)) return depth > 6 ? '[…]' : x.slice(0, 200).map((i) => walk(i, depth + 1));
      if (x && typeof x === 'object') {
        if (depth > 6) return '[…]';
        const o = {};
        for (const [k, val] of Object.entries(x)) o[k] = /^(authorization|token|secret|password)$/i.test(k) ? '[redacted]' : walk(val, depth + 1);
        return o;
      }
      return x;
    };
    return walk(v);
  };

  function summarize(e) {
    switch (e.kind) {
      case 'request': return `→ ${e.tool || 'call'} ${e.route || ''} (${e.chars} chars${e.episode_id ? ', episode ' + e.episode_id : ', new episode'})`;
      case 'http': return `⇄ HTTP ${e.status} after ${e.ms_to_headers}ms (${e.content_type || '?'})`;
      case 'progress': return `⋯ progress ${e.text ? '“' + String(e.text).slice(0, 120) + '”' : JSON.stringify(e.params || {}).slice(0, 120)}`;
      case 'event': return `⋯ ${e.method || 'event'} (${e.bytes} bytes) +${e.ms}ms`;
      case 'response': return `← ${e.status} (${e.chars} chars${e.suspend_kind ? ', waiting for ' + e.suspend_kind : ''}) in ${e.ms}ms`;
      case 'cancelled': return `✖ cancelled after ${e.ms}ms (${e.reason})`;
      case 'error': return `✖ ${e.error} after ${e.ms}ms`;
      default: return `${e.kind}`;
    }
  }

  function log(entry) {
    const e = { seq: ++seq, ts: new Date().toISOString(), ...entry };
    if (!payloads) { // sizes only
      for (const k of ['message', 'response']) if (typeof e[k] === 'string') { e.chars = e[k].length; delete e[k]; }
    } else {
      if (typeof e.message === 'string') e.chars = e.message.length;
      if (typeof e.response === 'string') e.chars = e.response.length;
    }
    const clean = mask(e);
    clean.summary = summarize(clean);
    ring.push(clean); if (ring.length > ringSize) ring.shift();
    if (echo) console.log(`[${clean.ts.slice(11, 23)}] #${clean.callId || '-'} ${clean.summary}`);
    try {
      if (!dirReady) { mkdirSync(dir, { recursive: true, mode: 0o700 }); dirReady = true; }
      appendFile(path.join(dir, `coworker-${clean.ts.slice(0, 10)}.jsonl`), JSON.stringify(clean) + '\n', { mode: 0o600 }, () => {});
    } catch { /* logging must never break a request */ }
    return clean;
  }

  return {
    log,
    since: (after = 0, limit = 100) => ring.filter((e) => e.seq > after).slice(-limit),
    last: () => ring[ring.length - 1] || null,
    get payloads() { return payloads; },
    file: () => path.join(dir, `coworker-${new Date().toISOString().slice(0, 10)}.jsonl`),
  };
}
