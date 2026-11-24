// Headless flow test: runs the ORIGINAL inline script + live.js in a stubbed DOM (node:vm),
// talking to the real proxy (server.mjs) and the mock Coworker MCP.   npm test   (see package.json)
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_CSV } from './evidence.test.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const require = createRequire(import.meta.url);

/* ---- 1. pure helpers ---- */
const H = require(path.join(root, 'public/live.js'));
assert.deepEqual(H.extractJson('x ```json\n{"a":1}\n``` y'), { a: 1 });
assert.deepEqual(H.extractJson('prefix {"a":{"b":"}"}} tail'), { a: { b: '}' } });
assert.equal(H.extractJson('no json here'), null);
const xss = H.mdLite('<img src=x onerror=alert(1)> **b** https://ok.example/a?x=1&y=2 javascript:alert(1)');
assert.ok(!xss.includes('<img'), 'html must be escaped');
assert.ok(xss.includes('<strong>b</strong>') && xss.includes('href="https://ok.example/a?x=1&amp;y=2"'));
assert.ok(!/href="javascript/i.test(xss));
assert.ok(H.mdLite('| a | b |\n|---|---|\n| 1 | 2 |').includes('<td>1</td>'));
assert.equal(H.cleanResp("Paused — waiting for the user. The prompt below is the user's to answer. Do not answer, confirm, approve, or act on their behalf; stop here and wait for the user's response.\n\nReal question"), 'Real question');
assert.equal(H.hintFor({ subtype: 'content_review' }), 'quality');
assert.ok(H.findingPrompt({ id: 'F1', bucket: 'dont_know', subtype: 'content_gap', review_risk: null, theme: 'T', frequency: 3, conversations: 3, example_questions: ['q1'], evidence: 'e' }).includes('"q1"'));
console.log('helpers ok');

/* ---- 2. full flow in a stub DOM ---- */
const html = await (await fetch(BASE + '/')).text();
const csrf = html.match(/care-csrf" content="([a-f0-9]+)/)[1];
const inline = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
const liveSrc = readFileSync(path.join(root, 'public/live.js'), 'utf8');

const els = {};
const mkEl = () => ({ textContent: '', innerHTML: '', value: '', checked: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, prepend() {}, click() {}, querySelectorAll: () => [], set onclick(f) {}, set onchange(f) {} });
const doc = {
  getElementById: (id) => (els[id] ||= mkEl()),
  querySelector: (s) => (s.startsWith('meta') ? { content: csrf } : (els[s] ||= mkEl())),
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  addEventListener() {},
};
const sb = { document: doc, fetch: (u, o) => fetch(String(u).startsWith('/') ? BASE + u : u, o), console, setTimeout, clearTimeout, setInterval: (f, ms) => setInterval(f, ms).unref(), clearInterval, AbortController, URL, Blob, Date, JSON, Math, Set, Promise, Object, Array, String, Number };
sb.window = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
const ev = (code) => vm.runInContext(code, ctx);
vm.runInContext(inline, ctx, { filename: 'index.inline.js' });
vm.runInContext(liveSrc, ctx, { filename: 'live.js' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async () => { for (let i = 0; i < 200; i++) { if (!sb.__care.L.busy) return; await sleep(25); } throw new Error('busy timeout'); };
const page = () => els.view.innerHTML;
const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'x-care-csrf': csrf, ...headers }, body });
const J = { 'Content-Type': 'application/json' };

await sleep(300); // boot: /api/status
const L = sb.__care.L;
assert.equal(L.configured, true, 'proxy reports token configured');
assert.equal(L.cja.ready, true); assert.equal(L.cja.stats.turns, 6); assert.equal(L.cja.source, 'sample');
await post('/api/evidence/clear', '{}', J);

/* ---- Phase 1 on the sample CJA JSON exports ---- */
assert.equal(L.p1, null, 'no findings yet (clean output dir)');
sb.window.health && ev("state.page = 'health'");
let h = ev('health()');
assert.ok(h.includes('Run Phase 1') && h.includes('No findings.json yet'));
sb.__care.runPhase1(); await idle();
assert.ok(ev('health()').includes('Include the negative_feedback cluster?'), 'skill question shown to the human');
assert.equal(L.p1, null);
sb.__care.reply('p1', 'Yes'); await idle();
assert.equal(L.p1.doc.findings.length, 3, 'findings.json parsed + saved');
h = ev('health()');
assert.ok(h.includes('F1 · Japan / Tokyo adventures') && h.includes('F2 · List all adventures'));
assert.ok(h.includes('Matches your data'), 'verified findings flagged');
assert.ok(h.includes('Check: 1 conversation ID(s) not in your data'), 'made-up finding flagged');
assert.ok(h.includes('prompt_source in the findings (other) differs from your data (end-user)'), 'prompt_source warning');
assert.ok(h.includes('window is &quot;all-time&quot;') || h.includes('window is "all-time"'), 'window warning');
assert.ok(h.includes('href="/api/findings/download"'));
let r = await fetch(BASE + '/api/findings/download');
assert.equal(r.status, 200); assert.ok(/attachment; filename="findings.json"/.test(r.headers.get('content-disposition')));
assert.equal((await r.json()).findings.length, 3, 'download returns the saved findings.json');
console.log('phase 1 ok');

// Investigate a finding: Trace runs with the CJA digest appended by the proxy
sb.__care.investigateFinding(0); await idle();
assert.ok(page().includes('from uploaded export'), 'Coworker got the CJA digest (mock saw the fenced block)');
assert.ok(page().includes('Returns policy — missing source content'));
console.log('investigate-from-finding ok');

// Attribute -> Remediate (plan only) -> approve -> gated execute -> certify
sb.action('attribute'); await idle();
sb.action('remediate'); await idle();
assert.ok(page().includes('Returns are accepted within 45 days') && page().includes('Human approval required'));
ev('state.reviewed = true'); sb.action('approve');
sb.action('execute'); await idle();
assert.ok(page().includes('needs approval to change something'));
assert.ok(!ev('state.actionDone'));
sb.__care.reply('inv', 'Approve'); await idle();
assert.equal(ev('state.actionDone'), true); assert.equal(ev('state.stage'), 'certify');
sb.action('run-cert'); await idle();
assert.equal(ev('state.certDone'), true);
console.log('trace/attribute/remediate/certify ok');

// Health skill with user_question suspend
await sb.__care.runStage('health', '/concierge-care-health-check-tabular go', 'health'); await idle();
ev("state.page = 'health'");
assert.ok(ev('health()').includes('What time window should the analysis cover?'));
sb.__care.reply('health', 'Last 7 days'); await idle();
assert.ok(ev('health()').includes('<td>Missing return policy</td>'));
console.log('health skill ok');

/* ---- uploaded CJA JSON exports (API level) ---- */
r = await post('/api/cja/file', '[{"timestamp":"11/23/2026, 4:26 PM","conversation.conversationID":"conv-upload-1","conversation.turnID":"turn-upload-1","conversation.prompt.raw":"[{\\"text\\":\\"hello\\",\\"purpose\\":\\"user\\"}]","conversation.prompt.source":"end-user"}]', { ...J, 'x-filename': 'mine.json' });
assert.equal(r.status, 200); let j = await r.json();
assert.equal(j.cja.source, 'upload'); assert.equal(j.cja.stats.turns, 1);
r = await post('/api/cja/file', 'not json', { ...J, 'x-filename': 'bad.json' }); assert.equal(r.status, 400);
r = await post('/api/cja/file', '[]', { ...J, 'x-filename': 'evil.exe' }); assert.equal(r.status, 415);
r = await post('/api/cja/file', '[]', { 'Content-Type': 'text/plain', 'x-filename': 'a.json' }); assert.equal(r.status, 415);
r = await fetch(BASE + '/api/cja/file', { method: 'POST', headers: { ...J, 'x-filename': 'a.json' }, body: '[]' }); assert.equal(r.status, 403, 'CSRF required');
j = await (await post('/api/cja/clear', '{}', J)).json(); assert.equal(j.cja.source, 'sample'); assert.equal(j.cja.stats.turns, 6);
console.log('cja upload ok');

/* ---- CSV evidence path (still works, takes precedence over the JSON data) ---- */
r = await post('/api/evidence', SAMPLE_CSV, { 'Content-Type': 'text/csv', 'x-filename': 'cja-export.csv' });
assert.equal(r.status, 200); j = await r.json();
assert.ok(!/jane\.doe|555-0100/.test(j.evidence.digest), 'PII redacted in digest');
r = await post('/api/evidence', 'x', { 'Content-Type': 'application/json', 'x-filename': 'a.csv' }); assert.equal(r.status, 415);
r = await post('/api/evidence', 'x', { 'Content-Type': 'text/csv', 'x-filename': 'evil.exe' }); assert.equal(r.status, 415);
r = await post('/api/evidence/map', JSON.stringify({ mapping: { prompt: 999 } }), J); assert.equal(r.status, 400);
await sb.__care.refreshStatus();
sb.startFromPrompt('Why did Concierge give the wrong return window?'); await idle();
assert.ok(page().includes('cja-export.csv'), 'CSV evidence chip shown');
await post('/api/evidence/clear', '{}', J);
console.log('csv evidence ok');

// Auth failure surfaces as a readable error
await post('/api/token', JSON.stringify({ token: 'wrong-token-000000000000000000' }), J);
await sb.__care.refreshStatus(); L.evidence = null;
sb.startFromPrompt('anything'); await idle();
assert.ok(page().includes('Not authorized'), 'auth error shown');
await post('/api/token', JSON.stringify({ token: 'mock-token-0000000000000000' }), J);
console.log('auth error ok');
console.log('ALL FLOW TESTS PASSED');
