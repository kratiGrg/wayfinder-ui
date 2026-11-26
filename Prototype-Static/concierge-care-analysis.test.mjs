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

test('shows ten realistic sample runs with the requested concierge distribution', () => {
  const page = dashboardContext();
  assert.equal(typeof page.careFilteredRuns, 'function');
  const runs = page.careFilteredRuns();
  assert.equal(runs.length, 10);
  assert.equal(runs.filter(run => run.concierge === 'WKND Demo').length, 4);
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
  assert.ok(html.includes('Sample history'));
  for (const status of ['In Attribution Phase', 'Certify Success', 'Certify Pending', 'Certify Failed']) {
    assert.ok(html.includes(status));
  }
});

test('concierge and status filters narrow the recent runs table', () => {
  const page = dashboardContext();
  vm.runInContext("careRunFilters.concierge = 'WKND Demo';", page);
  let runs = page.careFilteredRuns();
  assert.equal(runs.length, 4);
  vm.runInContext("careRunFilters.status = 'success';", page);
  runs = page.careFilteredRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].concierge, 'WKND Demo');
  assert.equal(runs[0].status, 'success');
  const html = page.careRunHistoryResults();
  assert.equal((html.match(/data-care-run-id=/g) ?? []).length, 1);
  assert.ok(html.includes('WKND Demo'));
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
