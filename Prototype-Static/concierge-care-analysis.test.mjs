import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = new URL('./concierge-care-analysis.js', import.meta.url);
const context = vm.createContext({});
vm.runInContext(readFileSync(source, 'utf8'), context);

function dashboardContext() {
  const page = vm.createContext({});
  const html = readFileSync(new URL('./concierge_care_coworker_deck_v4.html', import.meta.url), 'utf8');
  vm.runInContext(html.split('\n').find(line => line.startsWith('const esc=')), page);
  vm.runInContext(readFileSync(source, 'utf8'), page);
  return page;
}

function v4CopyContext() {
  const elements = new Map();
  const page = vm.createContext({
    document: {
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', addEventListener() {} });
        return elements.get(id);
      },
      addEventListener() {},
    },
    setTimeout() {},
  });
  const html = readFileSync(new URL('./concierge_care_coworker_deck_v4.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.replace(/\brender\(\);\s*$/, ''), page);
  page.render = () => {};
  return { page, elements };
}

function assertProductCopy(html) {
  const text = html.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text, /\b(prototype|demo|simulation|simulated|mock|synthetic|sample)\b/i);
}

test('Home and architecture use product copy while retaining the health entry point', () => {
  const { page } = v4CopyContext();
  const home = page.home();
  assertProductCopy(home);
  assertProductCopy(page.architecture());
  assert.ok(home.includes('View Concierge Health →'));
  assert.ok(home.includes('data-nav="health"'));
  assert.ok(home.includes('Governed remediation.'));
  assert.ok(page.architecture().includes('External execution is not connected'));
});

test('all investigation stages and dialogs use neutral copy without claiming external execution', () => {
  const { page, elements } = v4CopyContext();
  const keys = vm.runInContext('Object.keys(cases)', page);
  for (const key of keys) {
    page.startCase(key);
    const finding = vm.runInContext('cases[state.current]', page);
    for (const name of ['traceView', 'attributeView', 'remediationView', 'certifyView', 'escalationView']) {
      assertProductCopy(page[name](finding));
    }
    vm.runInContext('state.approved = true; state.actionDone = true; state.certDone = true;', page);
    const approved = page.remediationView(finding);
    assertProductCopy(approved);
    assertProductCopy(page.certifyView(finding));
    if (['authoring', 'locale', 'quality'].includes(key)) {
      assert.ok(approved.includes('No external system has been modified.'));
    }
    for (const kind of ['trace', 'sources', 'approval', 'plan', 'escalation', 'details']) {
      page.openModal(kind);
      assertProductCopy(elements.get('modal-root').innerHTML);
    }
  }
});

test('activity and notifications keep local approvals and evaluation outcomes explicit', () => {
  const { page, elements } = v4CopyContext();
  assertProductCopy(page.history());
  page.startCase('locale');
  vm.runInContext('state.reviewed = true;', page);
  page.action('approve');
  assert.ok(elements.get('toast-root').innerHTML.includes('Approval recorded for this session'));
  page.action('execute');
  page.action('run-cert');
  assert.ok(elements.get('toast-root').innerHTML.includes('Passed evaluation recorded for this session'));
  assertProductCopy(page.history());
  page.action('simulate-fail');
  assertProductCopy(page.history());
  assert.ok(page.history().includes('Activity is stored in this browser session.'));
});

test('shows ten realistic sample runs with the requested concierge distribution', () => {
  const page = dashboardContext();
  assert.equal(typeof page.careFilteredRuns, 'function');
  const runs = page.careFilteredRuns();
  assert.equal(runs.length, 10);
  assert.equal(runs.filter(run => run.concierge === 'WKND').length, 4);
  assert.equal(runs.filter(run => run.concierge === 'WKND Trendsetters').length, 3);
  assert.equal(runs.filter(run => run.concierge === 'Frescopa').length, 3);
  assert.equal(new Set(runs.map(run => run.id)).size, 10);
  assert.ok(runs.every(run => Number.isSafeInteger(run.findings) && run.findings >= 12 && run.findings <= 48));
  assert.ok(runs.every((run, index) => !index || runs[index - 1].started >= run.started));
  assert.equal(new Set(runs.map(run => run.status)).size, 4);
});

test('entry dashboard keeps setup inline and renders every history row without pagination', () => {
  const page = dashboardContext();
  const html = page.careAnalysisView();
  assert.ok(html.includes('id="care-setup-form"'));
  assert.ok(html.includes('id="care-concierge"'));
  assert.ok(html.includes('id="care-date-window"'));
  assert.ok(html.includes('id="run-health-check"'));
  assert.ok(html.includes('id="care-run-history-results"'));
  assert.equal((html.match(/data-care-run-id=/g) ?? []).length, 10);
  assert.ok(!html.includes('care-run-chart'));
  assert.ok(html.includes('Recent health checks'));
  assert.doesNotMatch(html, /\b(prototype|demo|simulation|simulated|sample)\b/i);
  for (const status of ['In Attribution Phase', 'Certify Success', 'Certify Pending', 'Certify Failed']) {
    assert.ok(html.includes(status));
  }
});

test('concierge and status filters narrow the recent runs table', () => {
  const page = dashboardContext();
  vm.runInContext("careRunFilters.concierge = 'WKND';", page);
  let runs = page.careFilteredRuns();
  assert.equal(runs.length, 4);
  vm.runInContext("careRunFilters.status = 'success';", page);
  runs = page.careFilteredRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].concierge, 'WKND');
  assert.equal(runs[0].status, 'success');
  const html = page.careRunHistoryResults();
  assert.equal((html.match(/data-care-run-id=/g) ?? []).length, 1);
  assert.ok(html.includes('WKND'));
  assert.ok(html.includes('Certify Success'));
  vm.runInContext("careRunFilters.concierge = ''; careRunFilters.status = 'pending';", page);
  assert.equal(page.careFilteredRuns().length, 3);
});

test('empty history filters show an explicit empty state without losing setup or filters', () => {
  const page = dashboardContext();
  vm.runInContext("careRunFilters.concierge = 'Frescopa'; careRunFilters.status = 'attribution';", page);
  assert.equal(page.careFilteredRuns().length, 0);
  const html = page.careAnalysisView();
  assert.ok(html.includes('No runs match these filters.'));
  assert.ok(!html.includes('data-care-run-id='));
  assert.ok(html.includes('id="care-setup-form"'));
  assert.ok(html.includes('id="care-run-status-filter"'));
});

test('counts distinct conversation IDs across all findings, not just the first page', () => {
  assert.equal(typeof context.careAnalysisSummary, 'function');
  const doc = {
    findings: [
      { conversation_ids: ['a', 'b'] },
      { conversation_ids: ['b', 'c'], conversation_id: 'b' },
      { conversation_id: 'd' },
      {},
      { conversation_ids: ['e'] },
      { conversation_ids: ['f', 'g'] },
    ],
  };
  const summary = context.careAnalysisSummary(doc);
  assert.equal(summary.findings, 6);
  assert.equal(summary.conversations, 7);
});

test('paginates at five findings and clamps pages for empty or shorter results', () => {
  assert.equal(typeof context.careAnalysisPage, 'function');
  const doc = { findings: Array.from({ length: 11 }, (_, i) => ({ id: `F${i + 1}` })) };
  let result = context.careAnalysisPage(doc, 2);
  assert.equal(result.pages, 3);
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].id, 'F6');
  result = context.careAnalysisPage(doc, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'F11');
  result = context.careAnalysisPage({ findings: doc.findings.slice(0, 5) }, 3);
  assert.equal(result.pages, 1);
  assert.equal(result.page, 1);
  result = context.careAnalysisPage({ findings: [] }, 2);
  assert.equal(result.items.length, 0);
  assert.equal(result.page, 1);
  assert.equal(result.pages, 1);
});

test('finding rows derive concise previews from existing evidence without changing the source', () => {
  const page = dashboardContext();
  const escapeHtml = vm.runInContext('esc', page);
  const doc = JSON.parse(readFileSync(new URL('./findings.json', import.meta.url), 'utf8'));
  const original = JSON.stringify(doc);
  for (const [index, finding] of doc.findings.entries()) {
    const html = page.careFindingView(finding, index);
    const preview = html.match(/<p class="care-finding-summary">([\s\S]*?)<\/p>/)[1];
    const summary = page.careFindingSummary(finding);
    assert.equal(preview, escapeHtml(summary));
    assert.ok(Array.from(summary).length <= 180);
    assert.ok(finding.evidence.startsWith(summary.replace(/\.\.\.$/, '')));
    assert.ok(!Object.hasOwn(finding, 'summary'));
    assert.ok(html.includes(`<blockquote>${escapeHtml(finding.evidence)}</blockquote>`));
    assert.ok(html.includes(escapeHtml(finding.subtype)));
    assert.ok(html.includes(`${finding.conversations} ${finding.conversations === 1 ? 'conversation' : 'conversations'}`));
    assert.ok(html.includes('<summary>Details</summary>'));
    assert.ok(html.includes('User Questions'));
    assert.ok(html.includes('Conversation IDs'));
    assert.ok(html.includes(`data-care-investigate="${index}"`));
  }
  assert.equal(JSON.stringify(doc), original);
});

test('finding summaries use existing evidence and escape it while retaining full evidence in Details', () => {
  const page = dashboardContext();
  const finding = { summary: 'Do not use a new source field', evidence: '<script>Evidence</script>', conversations: 0 };
  assert.equal(page.validateCareAnalysis({ findings: [finding] }).findings[0], finding);
  const html = page.careFindingView(finding, 0);
  assert.ok(html.includes('<p class="care-finding-summary">&lt;script&gt;Evidence&lt;/script&gt;</p>'));
  assert.ok(html.includes('<blockquote>&lt;script&gt;Evidence&lt;/script&gt;</blockquote>'));
  assert.ok(!html.includes('Do not use a new source field'));
  assert.ok(html.includes('0 conversations'));
  assert.ok(!html.includes('<script>'));
});

test('missing summary fields and counts remain explicit instead of inventing finding context', () => {
  const page = dashboardContext();
  let html = page.careFindingView({}, 0);
  assert.ok(html.includes('No supporting evidence provided.'));
  assert.ok(!html.includes('0 conversations'));
  html = page.careFindingView({ evidence: 'An observed answer.', conversations: 1 }, 0);
  assert.ok(html.includes('<p class="care-finding-summary">An observed answer.</p>'));
  assert.ok(html.includes('1 conversation'));
  assert.ok(!html.includes('1 conversations'));
});

test('evidence previews normalize whitespace, stop at word boundaries and preserve complete Details', () => {
  const page = dashboardContext();
  assert.equal(page.careFindingSummary({ evidence: '  An observed\n answer.\t ' }), 'An observed answer.');
  assert.equal(page.careFindingSummary({ evidence: 'x'.repeat(180) }).length, 180);
  assert.equal(page.careFindingSummary({ evidence: 'x'.repeat(181) }), `${'x'.repeat(177)}...`);
  const evidence = `${'Observed response. '.repeat(20)}Full explanation at the end.`;
  const summary = page.careFindingSummary({ evidence });
  assert.ok(summary.endsWith('...'));
  assert.ok(summary.length <= 180);
  assert.ok(evidence.startsWith(summary.slice(0, -3) + ' '));
  assert.ok(page.careFindingView({ evidence }, 0).includes(`<blockquote>${evidence}</blockquote>`));
  const emojiSummary = page.careFindingSummary({ evidence: '\u{1f600}'.repeat(181) });
  assert.equal(Array.from(emojiSummary).length, 180);
});

test('accepts missing optional fields but rejects malformed findings and dates', () => {
  assert.equal(typeof context.validateCareAnalysis, 'function');
  const doc = { findings: [{ theme: 'Japan', conversation_ids: ['a'] }] };
  assert.equal(context.validateCareAnalysis(doc), doc);
  assert.equal(context.validateCareAnalysis({ findings: [] }).findings.length, 0);
  for (const invalid of [
    null,
    { findings: {} },
    { findings: [null] },
    { findings: [{ theme: {} }] },
    { findings: [{ evidence: [] }] },
    { findings: [{ example_questions: [123] }] },
    { findings: [{ conversation_ids: [''] }] },
    { findings: [{ review_risk: 123 }] },
    { findings: [{ frequency: -1 }] },
    { findings: [{ conversations: 1.5 }] },
    { findings: [], window: { start: '2026-02-30', end: '2026-03-01' } },
    { findings: [], window: { start: '2026-11-26', end: '2026-11-22' } },
  ]) {
    assert.throws(() => context.validateCareAnalysis(invalid), /Invalid analysis/);
  }
});

test('loads fresh findings only from the sibling JSON file', async () => {
  let theme = 'Latest sibling findings';
  const page = vm.createContext({
    location: { protocol: 'http:' }, AbortSignal,
    fetch: async (url, options) => {
      assert.equal(url, './findings.json');
      assert.equal(options.cache, 'no-store');
      return { ok: true, json: async () => ({ findings: [{ theme }] }) };
    },
  });
  vm.runInContext(readFileSync(source, 'utf8'), page);
  assert.equal((await page.loadCareAnalysis()).findings[0].theme, 'Latest sibling findings');
  theme = 'Replaced file';
  assert.equal((await page.loadCareAnalysis()).findings[0].theme, 'Replaced file');
});

test('rejects missing or invalid findings and explains the local HTTP requirement', async () => {
  const page = vm.createContext({
    location: { protocol: 'http:' }, AbortSignal,
    fetch: async () => ({ ok: false, status: 404 }),
  });
  vm.runInContext(readFileSync(source, 'utf8'), page);
  await assert.rejects(page.loadCareAnalysis(), /findings\.json.*404/);
  page.fetch = async () => ({ ok: true, json: async () => ({ findings: {} }) });
  await assert.rejects(page.loadCareAnalysis(), /Invalid analysis/);
  page.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } });
  await assert.rejects(page.loadCareAnalysis(), /Invalid JSON/);
  page.location.protocol = 'file:';
  await assert.rejects(page.loadCareAnalysis(), /local HTTP preview/);
});
