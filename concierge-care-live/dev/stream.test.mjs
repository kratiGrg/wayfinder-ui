// Streaming + logging + cancel tests. Needs the mock (8799) and the proxy against it (8787).  node dev/stream.test.mjs
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8799';
const html = await (await fetch(BASE + '/')).text();
const csrf = /name="care-csrf" content="([^"]+)"|csrf["':\s=]+["']([0-9a-f]{16,})["']/i.exec(html);
const token = csrf && (csrf[1] || csrf[2]); assert.ok(token, 'csrf token found in page');
const H = { 'Content-Type': 'application/json', 'x-care-csrf': token, Origin: BASE };
const post = (p, b, signal) => fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(b), signal });
const logs = async () => (await (await fetch(BASE + '/api/logs?limit=500', { headers: H })).json());

// 1. result arrives while the upstream stream stays open: must return fast
let t = Date.now();
const r = await post('/api/ask', { message: 'SLOWTEST hello world' });
const j = await r.json();
assert.equal(r.status, 200); assert.equal(j.status, 'completed');
assert.ok(Date.now() - t < 5000, 'returned without waiting for the stream to close (' + (Date.now() - t) + 'ms)');

// 2. log has request, http, progress, response with full text, and never the token
const L = await logs();
const kinds = L.entries.map((e) => e.kind);
for (const k of ['request', 'http', 'progress', 'response']) assert.ok(kinds.includes(k), 'log has ' + k);
assert.ok(L.entries.some((e) => e.kind === 'request' && /SLOWTEST hello world/.test(e.message)), 'request text logged');
assert.ok(L.entries.some((e) => e.kind === 'response' && e.response), 'response text logged');
assert.ok(!JSON.stringify(L).includes('mock-token-0000000000000000'), 'token never in log');
assert.equal((await fetch(BASE + '/api/logs')).status, 403, 'log needs csrf');
assert.equal((await fetch(BASE + '/api/logs/download?k=nope')).status, 403);
const dl = await fetch(BASE + '/api/logs/download?k=' + token); assert.equal(dl.status, 200);
assert.ok(!(await dl.text()).includes('mock-token-0000000000000000'), 'token not in file');

// 3. cancel: client aborts, upstream sees the connection drop, log shows cancelled
const before = (await (await fetch(MOCK + '/__stats')).json()).aborted;
const ac = new AbortController();
const p = post('/api/ask', { message: 'STALLTEST' }, ac.signal).catch((e) => e);
await new Promise((r2) => setTimeout(r2, 600)); ac.abort();
assert.equal((await p).name, 'AbortError');
await new Promise((r2) => setTimeout(r2, 600));
assert.ok((await (await fetch(MOCK + '/__stats')).json()).aborted > before, 'upstream request aborted');
assert.ok((await logs()).entries.some((e) => e.kind === 'cancelled'), 'cancel logged');
console.log('stream tests passed');
