#!/usr/bin/env node
// Dev-only mock of the Coworker MCP endpoint (Streamable HTTP). Lets you exercise the
// whole UI/proxy without Adobe credentials. Responses are canned and clearly labelled.
//
//   node dev/mock-mcp.mjs                     # listens on 127.0.0.1:8799
//   ALLOW_LOCAL_MCP=1 COWORKER_MCP_URL=http://127.0.0.1:8799/mcp ADOBE_IMS_TOKEN=mock-token-0000000000000000 node server.mjs
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8799);
const sessions = new Set();
const phase1Waiting = new Set();
let ep = 7000000000000000000n;

const fence = (o) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';
const tool = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const done = (episode_id, response) => tool({ status: 'completed', response, episode_id });
const asks = (episode_id, kind, response, extra = {}) =>
  tool({ status: 'input_required', response, episode_id, suspend: { kind, episode_id, ...extra } });

// Mirrors the shape the real skill returned, including its two quirks (prompt_source "other", all-time window),
// plus one made-up finding so the UI's "check against your data" logic can be exercised.
const FINDINGS = {
  concierge_id: '6af98add4843b8ffbde511d1', concierge_name: 'Wknd - demo-DONOTDELETE', sandbox: 'acs-onshore-demo',
  window: { start: null, end: null, scope: 'all-time' }, generated_at: '2026-11-24T17:28:49Z',
  findings: [
    { id: 'F1', bucket: 'dont_know', subtype: 'content_gap', review_risk: null, theme: 'Japan / Tokyo adventures', example_questions: ['Do you have any adventure in Japan', 'I am looking for an adventure in Tokyo', 'I am looking for adventure to Tokyo Skyscaper'], frequency: 3, conversations: 3, conversation_ids: ['8160db51-7436-4054-b707-56575311e01a', '3cd46f67-dbd0-4231-b357-41b0511baa98', 'e9bc061d-fdcb-4c41-bc37-73538b7fe360'], prompt_source: 'other', evidence: "\"I wasn't able to find a specific Wknd adventure trip in Japan.\"" },
    { id: 'F2', bucket: 'frequently_asked', subtype: 'content_review', review_risk: 'high', theme: 'List all adventures — inconsistent trip lists', example_questions: ['list out all the adventures'], frequency: 2, conversations: 2, conversation_ids: ['45e6bb8f-f116-4fa4-865e-6e5e22cec6e2', 'd2d2b172-818e-4c78-8518-3be03a4ad0fc'], prompt_source: 'other', evidence: 'One answer listed 8 adventures, the other only 3.' },
    { id: 'F9', bucket: 'dont_know', subtype: 'content_gap', review_risk: null, theme: 'MOCK: a finding that is not in your data', example_questions: ['Do you ship to Mars'], frequency: 1, conversations: 1, conversation_ids: ['ffffffff-0000-4000-8000-000000000000'], prompt_source: 'other', evidence: 'invented by the mock' },
  ],
};

function ask(args) {
  const m = String(args.message || '');
  const id = args.episode_id || String(++ep);
  const fromCsv = m.includes('<<<CJA_EXPORT_DIGEST');

  if (m.startsWith('/concierge-care-analysis-tabular')) { // Phase 1 skill: asks one question, then returns findings.json
    phase1Waiting.add(id);
    return asks(id, 'user_question', 'Before I start: should I include the negative_feedback cluster?', {
      title: 'Question', questions: [{ id: '1', question: 'Include the negative_feedback cluster?', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }],
    });
  }
  if (phase1Waiting.has(id) && args.episode_id) {
    phase1Waiting.delete(id);
    return done(id, '**[MOCK]** Phase 1 complete (read-only). `findings.json` written to `/workspace/mock/findings.json`.\n\nComplete findings.json:\n\n' + fence(FINDINGS));
  }
  if (/^\/concierge-care-health-check/.test(m) && !fromCsv) {
    return asks(id, 'user_question', 'Before I start, one question on scope.', {
      title: 'Question', questions: [{ id: '1', question: 'What time window should the analysis cover?', options: [{ label: 'Last 7 days', description: '' }, { label: 'Last 30 days', description: '' }, { label: 'All time', description: '' }] }],
    });
  }
  if (/^\/concierge-care-health-check/.test(m) && fromCsv) return done(id, '**[MOCK]** Health check on the supplied digest.\n\n| Finding | Source |\n|---|---|\n| Fallbacks on returns | digest |');
  if (/^(Last|All)/.test(m)) {
    return done(id, '**[MOCK]** Health check complete.\n\n| Finding | Count | Severity |\n|---|---|---|\n| Missing return policy | 9 | High |\n| German fallback | 12 | Medium |\n\nSee https://example.com/report for details.');
  }
  if (m.includes('· TRACE')) {
    return done(id, '**[MOCK]** Found sessions about this topic.\n' + fence({
      fault_class: 'authoring', title: 'Returns policy — missing source content', severity: 'High', confidence: 0.94,
      signal: fromCsv ? 'from uploaded export (CSV digest)' : '9 unanswered conversations · last 7 days', summary: 'No approved return-policy source exists in the AEM source set.',
      question: 'Can I return an opened product after 45 days?', observed: 'Returns are accepted within 30 days.', impact: 'Possible incorrect policy answer',
      evidence: [{ title: 'CJA conversation sample', detail: fromCsv ? 'Digest shows related fallbacks.' : '9 sessions mention return windows.', source: 'CJA skills' }, { title: 'AEM source search', detail: 'No approved policy page found.', source: 'AEM MCP' }],
      table: [['Return window', '6', 'No approved source'], ['Opened product exception', '3', 'No approved source']], blockers: [],
    }));
  }
  if (m.includes('· ATTRIBUTE')) {
    return done(id, '**[MOCK]** Source is absent, so this is an authoring gap.\n' + fence({ fault_class: 'authoring', agrees_with_trace: true, confidence: 0.93, rationale: 'The answer cannot be grounded: no approved source exists.', evidence: [{ title: 'Retrieval trace', detail: 'No policy citation returned.', source: 'Composer' }], blockers: [] }));
  }
  if (m.includes('· REMEDIATE · PLAN')) {
    return done(id, '**[MOCK]** Plan only — nothing written.\n' + fence({
      action: 'Create and publish approved returns page', connector: 'AEM MCP', approval_required: true, tier: 'Tier 2',
      target: '/content/wknd/us/en/support/returns', before: 'No page exists.', proposed_text: 'Returns are accepted within 45 days of receipt, subject to the approved eligibility rules.',
      remedy: 'Draft the page, get content-owner approval, publish, re-index.', validation: ['Page exists in AEM', 'Re-index completes', 'Golden set passes'], blockers: [],
    }));
  }
  if (m.includes('· REMEDIATE · EXECUTE')) {
    return asks(id, 'entity_mutation', 'Coworker wants to create `/content/wknd/us/en/support/returns` in AEM. Approve this write?', { title: 'Approve change' });
  }
  if (m.includes('· CERTIFY')) {
    return done(id, '**[MOCK]** Evaluation complete.\n' + fence({ passed: true, summary: 'Golden set and replay pass.', checks: [{ name: 'Golden set', passed: true, detail: '24/24' }, { name: 'Replayed live questions', passed: true, detail: '9/9' }], blockers: [] }));
  }
  if (/^Approve/i.test(m)) {
    return done(id, '**[MOCK]** Change applied.\n' + fence({ executed: true, result: 'Page created', audit_id: 'AUD-MOCK-1', blockers: [] }));
  }
  return done(id, '**[MOCK]** I received: ' + m.slice(0, 200));
}

const stats = { aborted: 0 };
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/__stats') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(stats)); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  if (req.headers.authorization !== 'Bearer mock-token-0000000000000000') { res.writeHead(401).end(); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const reply = (obj, headers = {}, sse = false) => {
    if (sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers }); res.end(`event: message\ndata: ${JSON.stringify(obj)}\n\n`); }
    else { res.writeHead(200, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); }
  };
  if (msg.method === 'initialize') {
    const sid = 'sess-' + Math.random().toString(16).slice(2); sessions.add(sid);
    return reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-coworker', version: '0' } } }, { 'Mcp-Session-Id': sid });
  }
  if (!sessions.has(req.headers['mcp-session-id'])) { res.writeHead(404).end(); return; }
  if (msg.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
  if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params;
    let result;
    if (name === 'ask_aep_agent') result = ask(a);
    else if (name === 'core_list_orgs') result = tool({ orgs: [{ orgName: 'Mock Org', orgId: 'X@AdobeOrg' }] });
    else if (name === 'core_list_sandboxes') result = tool({ sandboxes: [{ name: 'acs-onshore-demo', type: 'development', preferred: true }] });
    else return reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown tool' } });
    const text = String(a.message || '');
    if (name === 'ask_aep_agent' && /SLOWTEST|STALLTEST/.test(text)) { // streaming: progress first; SLOW sends the result but keeps the stream open, STALL never answers
      res.on('close', () => { if (!res.writableFinished) stats.aborted++; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: msg.params._meta?.progressToken, progress: 1, message: 'querying datasets' } })}\n\n`);
      if (/SLOWTEST/.test(text)) setTimeout(() => res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`), 300); // never res.end()
      return;
    }
    return reply({ jsonrpc: '2.0', id: msg.id, result }, {}, true); // exercise the SSE path
  }
  reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
}).listen(PORT, '127.0.0.1', () => console.log(`mock Coworker MCP on http://127.0.0.1:${PORT}/mcp`));
