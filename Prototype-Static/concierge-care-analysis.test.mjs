import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = new URL('./concierge-care-analysis.js', import.meta.url);
const context = vm.createContext({});
vm.runInContext(readFileSync(source, 'utf8'), context);

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
