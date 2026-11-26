import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = new URL('./concierge-care-attribution.js', import.meta.url);
const context = vm.createContext({});
vm.runInContext(readFileSync(source, 'utf8'), context);

test('matches every action addressing the exact selected finding ID', () => {
  assert.equal(typeof context.careAttributionActions, 'function');
  const doc = { actions: [
    { id: 'A1', addresses: ['F1'] },
    { id: 'A2', addresses: ['F11'] },
    { id: 'A3', addresses: ['F2', 'F1'] },
  ] };
  assert.equal(context.careAttributionActions(doc, 'F1').map(action => action.id).join(','), 'A1,A3');
  assert.equal(context.careAttributionActions(doc, 'F3').length, 0);
});

test('shows only the three summary cards and defaults null risk to Medium', () => {
  assert.equal(typeof context.careAttributionFacts, 'function');
  const fields = context.careAttributionFacts({
    addresses: ['F3'],
    gap_cause: 'content_review',
    retrieval_subcause: 'retrieval_gap',
    review_risk: null,
    topic_frequency: 0,
    is_frequent: false,
  });
  assert.equal(fields.find(field => field.label === 'Attribution').value, 'Content Review');
  assert.equal(fields.find(field => field.label === 'Review risk').value, 'Medium');
  assert.equal(fields.map(field => field.label).join('|'), 'Addresses|Attribution|Review risk');
  assert.equal(fields.find(field => field.label === 'Addresses').value, 'F3');
});

test('omits null evidence while retaining structured responses and false published values', () => {
  assert.equal(typeof context.careAttributionEvidence, 'function');
  const fields = context.careAttributionEvidence({
    representative_question: 'Where can I go?',
    content_ai_response: [{ text: 'Australia adventure' }],
    content_ai_answer: null,
    published_value: false,
    unrelated: 'Do not render extra fields',
  });
  assert.equal(fields.find(field => field.label === 'Content AI response').value[0].text, 'Australia adventure');
  assert.equal(fields.find(field => field.label === 'Published value').value, false);
  assert.equal(fields.some(field => field.label === 'Content AI answer'), false);
  assert.equal(fields.length, 3);
});

test('hides unavailable status fields without discarding meaningful evidence', () => {
  const fields = context.careAttributionEvidence({
    aem_index_answer: 'no_results',
    aem_published_source: 'not_found',
    concierge_answer: 'The earlier lookup returned not_found, but the source is now available.',
    published_value: 0,
  });
  assert.equal(fields.some(field => field.label === 'AEM index answer'), false);
  assert.equal(fields.some(field => field.label === 'AEM Publish'), false);
  assert.equal(fields.find(field => field.label === 'Concierge reasoning').value,
    'The earlier lookup returned not_found, but the source is now available.');
  assert.equal(fields.find(field => field.label === 'Published value').value, 0);
  assert.equal(context.careAttributionFacts({ addresses: ['F1'], retrieval_subcause: 'no_results' })
    .some(field => field.label === 'Retrieval subcause'), false);
});

test('limits source evidence to the renamed AEM fields and excludes removed fields', () => {
  const fields = context.careAttributionEvidence({
    aem_author_source: 'found: /content/example (published)',
    aem_published_source: 'found',
    aem_index_answer: 'addresses',
    prompt_source: 'other',
    english_copy: 'n/a',
  });
  assert.equal(fields.map(field => field.label).join('|'), 'AEM Publish|AEM Author');
});

test('splits found AEM sources into path and explicit publication status', () => {
  assert.equal(typeof context.careAemSourceDetails, 'function');
  let details = context.careAemSourceDetails('found: /content/wknd/tokyo (Tokyo Tour), published=null');
  assert.equal(details.path, '/content/wknd/tokyo');
  assert.equal(details.publication, 'Unpublished');
  details = context.careAemSourceDetails('found: /content/wknd/australia (published)');
  assert.equal(details.publication, 'Published');
  details = context.careAemSourceDetails('found: 17 pages under /content/wknd/adventures (16 published, 1 unpublished)');
  assert.equal(details.path, '/content/wknd/adventures');
  assert.equal(details.publication, '16 Published, 1 Unpublished');
  details = context.careAemSourceDetails('found');
  assert.equal(details.path, null);
  assert.equal(details.publication, 'Not provided');
  assert.equal(context.careAemSourceDetails('An unresolved source description'), null);
});

test('validates plan actions and accepts nullable optional attribution fields', () => {
  assert.equal(typeof context.validateCareRemediationPlan, 'function');
  const doc = { actions: [{
    id: 'A1', addresses: ['F1'], gap_cause: 'content_gap',
    review_risk: null, topic_frequency: 0, is_frequent: false,
    gap_evidence: { content_ai_response: [{ text: 'Example' }] },
  }] };
  assert.equal(context.validateCareRemediationPlan(doc), doc);
  for (const invalid of [
    null, { actions: {} }, { actions: [null] },
    { actions: [{ id: 'A1', addresses: 'F1' }] },
    { actions: [{ id: 'A1', addresses: [''], gap_evidence: {} }] },
    { actions: [{ id: 'A1', addresses: ['F1'], gap_cause: {} }] },
    { actions: [{ id: 'A1', addresses: ['F1'], review_risk: 2 }] },
    { actions: [{ id: 'A1', addresses: ['F1'], topic_frequency: -1 }] },
    { actions: [{ id: 'A1', addresses: ['F1'], is_frequent: 'false' }] },
    { actions: [{ id: 'A1', addresses: ['F1'], gap_evidence: [] }] },
  ]) {
    assert.throws(() => context.validateCareRemediationPlan(invalid), /Invalid remediation plan/);
  }
});

function remediationContext(actions) {
  const html = readFileSync(new URL('./concierge_care_coworker_deck_v4.html', import.meta.url), 'utf8');
  const page = vm.createContext({});
  vm.runInContext(html.split('\n').find(line => line.startsWith('const esc=')), page);
  vm.runInContext(readFileSync(new URL('./concierge-care-analysis.js', import.meta.url), 'utf8'), page);
  vm.runInContext(readFileSync(source, 'utf8'), page);
  page.plan = { actions };
  vm.runInContext("careAttribution.status = 'done'; careAttribution.doc = plan;", page);
  return page;
}

test('defaults missing finding review risk to Medium without changing explicit risks or source values', () => {
  const page = remediationContext([]);
  for (const finding of [{ id: 'F1' }, { id: 'F1', review_risk: null }]) {
    const before = JSON.stringify(finding);
    const html = page.careInvestigationView(finding, 0);
    assert.ok(html.includes('<span class="tag amber">Review risk: Medium</span>'));
    assert.equal(JSON.stringify(finding), before);
  }
  for (const [risk, tone] of [['high', 'red'], ['medium', 'amber'], ['low', 'green']]) {
    const html = page.careInvestigationView({ id: 'F1', review_risk: risk }, 0);
    assert.ok(html.includes(`<span class="tag ${tone}">Review risk: ${risk}</span>`));
  }
});

test('renders only matching remediation actions with nested targets and escaped plan text', () => {
  const page = remediationContext([
    {
      id: 'A1', addresses: ['F1'], fixable_by: 'content', apply_tool: 'aem_publish',
      change: 'Publish the Tokyo page.', proposed_value: '/content/wknd/tokyo',
      rationale: '<script>unsafe</script>', handoff_reason: null, risk: 'medium', status: 'proposed',
      target: { field: 'aem_content', detail: 'Publish existing page',
        aem: { site_path: '/us/en/tokyo', author_path: '/content/wknd/tokyo',
          environment: 'STAGE', locales: ['en', 'de'] } },
    },
    { id: 'A2', addresses: ['F2'], change: 'Do not show this unrelated action.' },
    { id: 'A3', addresses: ['F1'], change: 'Refresh the listing.', handoff_reason: 'Ask the content team.' },
  ]);
  assert.equal(typeof page.careRemediationView, 'function');
  const html = page.careRemediationView({ id: 'F1' });
  for (const text of [
    'A1', 'A3', 'Publish the Tokyo page.', 'aem_publish', 'Medium', 'Proposed',
    'Publish existing page', '/us/en/tokyo', '/content/wknd/tokyo', 'STAGE', 'en, de',
    '&lt;script&gt;unsafe&lt;/script&gt;', 'Ask the content team.',
  ]) assert.ok(html.includes(text), `Missing remediation content: ${text}`);
  assert.ok(!html.includes('Do not show this unrelated action.'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('>Proposed Fix<'));
  assert.ok(html.indexOf('>Proposed Fix<') < html.indexOf('>Proposed value<'));
  assert.ok(html.indexOf('>Proposed value<') < html.indexOf('>Rationale<'));
  assert.ok(html.indexOf('>Rationale<') < html.indexOf('>Target<'));
  assert.ok(!html.includes('>Change<'));
});

test('omits null remediation fields and empty targets without losing false or zero proposed values', () => {
  const page = remediationContext([
    { id: 'A1', addresses: ['F1'], fixable_by: null, apply_tool: null, handoff_reason: null,
      change: null, rationale: null, risk: null, status: null, proposed_value: false,
      target: { field: null, detail: null,
        aem: { site_path: null, author_path: null, environment: null, locales: [] } } },
    { id: 'A2', addresses: ['F1'], target: null, proposed_value: 0 },
  ]);
  assert.equal(typeof page.careRemediationView, 'function');
  const html = page.careRemediationView({ id: 'F1' });
  for (const label of ['Fixable by', 'Apply tool', 'Handoff reason', 'Proposed Fix', 'Rationale', 'Risk', 'Status', 'Target']) {
    assert.ok(!html.includes(`>${label}<`), `Null field was rendered: ${label}`);
  }
  assert.ok(html.includes('<blockquote>false</blockquote>'));
  assert.ok(html.includes('<blockquote>0</blockquote>'));
});

test('validates remediation scalars and nested AEM target shapes', () => {
  const action = { id: 'A1', addresses: ['F1'], fixable_by: null, proposed_value: false,
    target: { field: null, detail: 'Publish page', aem: { locales: ['en'], environment: null } } };
  assert.equal(context.validateCareRemediationPlan({ actions: [action] }).actions[0], action);
  for (const fields of [
    { fixable_by: 1 }, { apply_tool: {} }, { handoff_reason: [] }, { change: false },
    { rationale: {} }, { risk: 1 }, { status: [] }, { target: [] },
    { target: { field: 1 } }, { target: { detail: [] } }, { target: { aem: 'invalid' } },
    { target: { aem: { site_path: {} } } }, { target: { aem: { author_path: [] } } },
    { target: { aem: { environment: 1 } } }, { target: { aem: { locales: 'en' } } },
    { target: { aem: { locales: [null] } } },
  ]) {
    assert.throws(() => context.validateCareRemediationPlan({ actions: [{ ...action, ...fields }] }),
      /Invalid remediation plan/);
  }
});

test('populates remediation from the sibling plan and reloads replaced content', async () => {
  const page = remediationContext([]);
  page.location = { protocol: 'http:' };
  page.AbortSignal = AbortSignal;
  let change = 'Current sibling plan';
  page.fetch = async (url, options) => {
    assert.equal(url, './remediation-plan.json');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ actions: [{ id: 'A1', addresses: ['F1'], change }] }) };
  };
  page.plan = await page.loadCareRemediationPlan();
  vm.runInContext('careAttribution.doc = plan;', page);
  assert.ok(page.careRemediationView({ id: 'F1' }).includes('Current sibling plan'));
  change = 'Replaced plan';
  page.plan = await page.loadCareRemediationPlan();
  vm.runInContext('careAttribution.doc = plan;', page);
  assert.ok(page.careRemediationView({ id: 'F1' }).includes('Replaced plan'));
});

test('rejects missing or invalid sibling plans without using a sample fallback', async () => {
  const page = remediationContext([]);
  page.location = { protocol: 'http:' };
  page.AbortSignal = AbortSignal;
  page.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(page.loadCareRemediationPlan(), /remediation-plan\.json.*404/);
  page.fetch = async () => ({ ok: true, json: async () => ({ actions: {} }) });
  await assert.rejects(page.loadCareRemediationPlan(), /Invalid remediation plan/);
  page.location.protocol = 'file:';
  await assert.rejects(page.loadCareRemediationPlan(), /local HTTP preview/);
});

function reviewContext(actions) {
  const page = remediationContext(actions);
  const timers = [];
  const notifications = [];
  page.state = { page: 'health' };
  page.render = () => {};
  page.toast = message => notifications.push(message);
  page.document = { getElementById: () => ({ focus() {} }) };
  page.setTimeout = (callback, delay) => timers.push({ callback, delay });
  vm.runInContext(`
    careAttribution.findingIndex = 0;
    careAnalysis.selectedFinding = 0;
    careAnalysis.doc = { findings: [{ id: 'F1' }, { id: 'F2' }] };
    careAnalysis.tab = 'remediate';
  `, page);
  return { page, timers, notifications };
}

test('shows publishing feedback using the target page title until approval completes', async () => {
  const { page, timers } = reviewContext([{
    id: 'A1', addresses: ['F1'], fixable_by: 'content', apply_tool: 'aem_publish',
    target: { detail: "Publish existing author page 'Kyoto <Garden> Tour'" },
    change: 'Do not use this change as the page title.',
  }]);
  const approval = page.approveCareFix('A1');
  let html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('Publishing &quot;Kyoto &lt;Garden&gt; Tour&quot; page'));
  assert.ok(!html.includes('Processing approval'));
  assert.ok(!html.includes('<Garden>'));
  assert.ok(!html.includes('care-fix-success'));
  assert.ok(html.includes('<span class="care-processing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span></span>'));
  assert.equal(page.careCanCertify(), false);
  assert.equal(timers[0].delay, 7200);
  timers.shift().callback();
  await approval;
  html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('<span class="care-fix-success">Published</span>'));
  assert.ok(!html.includes('Publishing '));
  assert.ok(!html.includes('care-processing-dots'));
  assert.equal(page.careCanCertify(), true);
  page.rejectCareFix('A1');
  assert.ok(!page.careRemediationView({ id: 'F1' }).includes('care-fix-success'));
});

test('uses supplied content target detail without inventing a missing page title', async () => {
  const { page, timers } = reviewContext([{
    id: 'A1', addresses: ['F1'], fixable_by: 'content',
    target: { detail: 'Publish /content/wknd/<new-page>' },
  }]);
  const approval = page.approveCareFix('A1');
  assert.ok(page.careRemediationView({ id: 'F1' })
    .includes('Publishing: Publish /content/wknd/&lt;new-page&gt;'));
  timers.shift().callback();
  await approval;
});

test('selects configuration approval feedback from the traced route and escapes its diagnosis', async () => {
  for (const [route, processing, completed] of [
    ['COMPOSER_FIX', 'Reviewing Guardrails: Review &lt;Australia&gt; restrictions.',
      '<span class="care-fix-success">Updated</span> Guardrails'],
    ['SUPPORT_TICKET', 'Raising Support Ticket',
      '<span class="care-fix-success">Raised</span> Support Ticket'],
    ['OTHER_ROUTE', 'Processing approval...', null],
  ]) {
    const { page, timers } = traceContext({ results: [{
      action_id: 'A2', trace_investigate: {
        route, diagnosis_summary: 'Review <Australia> restrictions.',
        suggested_fix: 'Mentioning SUPPORT_TICKET here must not choose the route.',
      },
    }] });
    vm.runInContext("careAttribution.doc.actions[0].fixable_by = 'concierge_config';", page);
    const tracing = page.runCareTrace('A2');
    timers.shift().callback();
    await tracing;
    const approval = page.approveCareFix('A2');
    let html = page.careRemediationView({ id: 'F1' });
    assert.ok(html.includes(`role="status">${processing}<span class="care-processing-dots"`), route);
    assert.equal(timers[0].delay, 7200);
    assert.ok(!html.includes('<Australia>'));
    assert.ok(!html.includes('care-fix-success'));
    assert.equal(page.careCanCertify(), false);
    timers.shift().callback();
    await approval;
    html = page.careRemediationView({ id: 'F1' });
    if (completed) assert.ok(html.includes(completed), route);
    else assert.ok(!html.includes('care-fix-success'));
    assert.ok(!html.includes('care-processing-dots'));
    assert.equal(page.careCanCertify(), true);
  }
});

test('keeps a partially approved multi-action finding unchecked until its fixes finish processing', async () => {
  const { page, timers, notifications } = reviewContext([
    { id: 'A1', addresses: ['F1'], change: 'Publish page' },
    { id: 'A2', addresses: ['F1'], change: 'Refresh listing' },
    { id: 'A3', addresses: ['F2'], change: 'Unrelated fix' },
  ]);
  assert.equal(typeof page.approveCareFix, 'function');
  const finding = { id: 'F1' };
  assert.equal(page.careCanCertify(finding), false);
  let html = page.careInvestigationView(finding, 0);
  assert.match(html, /<button[^>]*id="care-tab-certify"[^>]*disabled/);
  assert.match(html, /<button[^>]*data-care-tab="certify"[^>]*disabled/);
  page.activateCareTab('certify');
  assert.ok(notifications[0].includes('Approve'));
  assert.equal(vm.runInContext('careAnalysis.tab', page), 'remediate');
  const first = page.approveCareFix('A1');
  assert.equal(page.careCanCertify(finding), false);
  assert.ok(page.careRemediationView(finding).includes('Processing approval'));
  assert.equal(timers[0].delay, 7200);
  timers.shift().callback();
  await first;
  assert.equal(page.careCanCertify(finding), false);
  assert.ok(!page.careRemediationView(finding).includes('You can now proceed'));
  const second = page.approveCareFix('A2');
  assert.equal(page.careCanCertify(finding), false);
  timers.shift().callback();
  await second;
  assert.equal(page.careCanCertify(finding), true);
  assert.ok(page.careRemediationView(finding).includes('You can now proceed with Certifying this fix.'));
  html = page.careInvestigationView(finding, 0);
  assert.doesNotMatch(html, /<button[^>]*id="care-tab-certify"[^>]*disabled/);
  assert.doesNotMatch(html, /<button[^>]*data-care-tab="certify"[^>]*disabled/);
  page.activateCareTab('certify');
  assert.equal(vm.runInContext('careAnalysis.tab', page), 'certify');
});

test('lists every finding and enables global Certify after one finding is explicitly approved', async () => {
  const { page, timers } = reviewContext([
    { id: 'A1', addresses: ['F1'] }, { id: 'A2', addresses: ['F2'] }, { id: 'A3', addresses: ['F3'] },
  ]);
  vm.runInContext(`careAnalysis.doc.findings = [
    { id: 'F1', theme: 'Japan adventures' }, { id: 'F2', theme: 'Australia adventures' },
    { id: 'F3', theme: '<script>List adventures</script>' }
  ];`, page);
  assert.equal(typeof page.careCertifyView, 'function');
  let html = page.careCertifyView();
  let checkboxes = html.match(/<input\b[^>]*>/g);
  assert.equal(checkboxes.length, 3);
  assert.ok(checkboxes.every(input => input.includes('disabled') && !/\bchecked\b/.test(input)));
  let rendered = '';
  page.render = () => { rendered = page.careInvestigationView({ id: 'F1' }, 0); };
  const approval = page.approveCareFix('A1');
  page.activateCareTab('analysis');
  assert.equal(page.careCanCertify(), false);
  timers.shift().callback();
  await approval;
  assert.doesNotMatch(rendered, /<button[^>]*id="care-tab-certify"[^>]*disabled/);
  page.resetCareAttribution(true);
  vm.runInContext("careAnalysis.selectedFinding = 1; careAnalysis.tab = 'analysis';", page);
  assert.equal(page.careCanCertify(), true);
  html = page.careCertifyView();
  checkboxes = html.match(/<input\b[^>]*>/g);
  assert.ok(checkboxes.every(input => input.includes('disabled')));
  assert.ok(/\bchecked\b/.test(checkboxes[0]));
  assert.ok(checkboxes.slice(1).every(input => !/\bchecked\b/.test(input)));
  assert.ok(html.includes('Japan adventures'));
  assert.ok(html.includes('Australia adventures'));
  assert.ok(html.includes('&lt;script&gt;List adventures&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.doesNotMatch(page.careInvestigationView({ id: 'F2' }, 1), /<button[^>]*id="care-tab-certify"[^>]*disabled/);
});

test('shows cautions immediately and reveals the download link and instructions after the Certify delay', async () => {
  const { page, timers } = reviewContext([{ id: 'A1', addresses: ['F1'] }]);
  const approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  page.activateCareTab('certify');
  let html = page.careInvestigationView({ id: 'F1' }, 0);
  assert.ok(html.includes('For Content fixes, make sure Content AI sources are reindexed with published data'));
  assert.ok(html.includes('For Concierge Config fixes, make sure Support tickets are resolved and Composer fixes are in place.'));
  assert.ok(html.includes('Preparing evaluation set'));
  assert.ok(!html.includes('data-care-certify-download'));
  assert.ok(!html.includes('care-certify-instructions'));
  assert.equal(timers[0].delay, 3600);
  timers.shift().callback();
  await Promise.resolve();
  html = page.careInvestigationView({ id: 'F1' }, 0);
  assert.ok(html.includes('data-care-certify-download'));
  assert.ok(html.includes('care-certify-instructions'));
  assert.ok(!html.includes('Preparing evaluation set'));
});

test('rejecting a fix or leaving the finding cancels a pending Certify reveal', async () => {
  const { page, timers } = reviewContext([{ id: 'A1', addresses: ['F1'] }]);
  let approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  assert.equal(typeof page.runCareCertification, 'function');
  const stale = page.runCareCertification();
  page.rejectCareFix('A1');
  timers.shift().callback();
  await stale;
  assert.equal(page.careCanCertify(), false);
  assert.ok(!page.careCertifyView().includes('data-care-certify-download'));
  approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  const leaving = page.runCareCertification();
  page.resetCareAttribution(true);
  timers.shift().callback();
  await leaving;
  assert.equal(page.careCanCertify(), true);
  assert.ok(!page.careCertifyView().includes('data-care-certify-download'));
  page.resetCareAttribution();
  assert.equal(page.careCanCertify(), false);
});

test('preserves approvals on unchanged plan reloads but invalidates changed or removed fixes', async () => {
  const doc = { actions: [
    { id: 'A1', addresses: ['F1'], change: 'Publish Japan page' },
    { id: 'A2', addresses: ['F2'], change: 'Publish Australia page' },
  ] };
  const { page, timers } = reviewContext(structuredClone(doc.actions));
  page.location = { protocol: 'http:' };
  page.AbortSignal = AbortSignal;
  page.fetch = async () => ({ ok: true, json: async () => structuredClone(doc) });
  let approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  page.resetCareAttribution(true);
  vm.runInContext("careAnalysis.selectedFinding = 1;", page);
  let loading = page.runCareAttribution();
  timers.shift().callback();
  await loading;
  assert.equal(page.careCanCertify(), true);
  assert.equal(page.careFindingApproved({ id: 'F1' }), true);
  approval = page.approveCareFix('A2');
  timers.shift().callback();
  await approval;
  doc.actions[0].change = 'A different proposed fix';
  loading = page.runCareAttribution();
  timers.shift().callback();
  await loading;
  assert.equal(page.careFindingApproved({ id: 'F1' }), false);
  assert.equal(page.careFindingApproved({ id: 'F2' }), true);
  doc.actions.pop();
  loading = page.runCareAttribution();
  timers.shift().callback();
  await loading;
  assert.equal(page.careCanCertify(), false);
});

test('actual finding navigation preserves approvals while Restart clears the approval register', async () => {
  const { page, timers } = reviewContext([
    { id: 'A1', addresses: ['F1'] }, { id: 'A2', addresses: ['F2'] },
  ]);
  const handlers = new Map();
  page.document.getElementById = id => id === 'care-investigation-title' ? { focus() {} } : null;
  page.view = {
    querySelectorAll: selector => {
      if (!['[data-care-back]', '[data-care-investigate]'].includes(selector)) return [];
      return [{ dataset: { careInvestigate: '1' }, addEventListener: (_, handler) => handlers.set(selector, handler) }];
    },
    querySelector: () => ({ focus() {}, addEventListener() {} }),
  };
  page.bindCareAnalysis();
  const approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  handlers.get('[data-care-back]')();
  assert.equal(page.careCanCertify(), true);
  handlers.get('[data-care-investigate]')();
  assert.equal(page.careCanCertify(), true);
  assert.equal(page.careFindingApproved({ id: 'F1' }), true);
  assert.equal(page.careFindingApproved({ id: 'F2' }), false);
  const doc = vm.runInContext('careAnalysis.doc', page);
  page.location = { protocol: 'http:' };
  page.AbortSignal = AbortSignal;
  page.fetch = async () => ({ ok: true, json: async () => structuredClone(doc) });
  page.document.getElementById = () => ({ focus() {} });
  const restarting = page.runHealthCheck();
  assert.equal(page.careCanCertify(), false);
  assert.equal(timers[0].delay, 3600);
  timers.shift().callback();
  await restarting;
  assert.equal(page.careCanCertify(), false);
  assert.equal(page.careFindingApproved({ id: 'F1' }), false);
});

test('Remediate shows a full processing delay even with a loaded plan and preserves unchanged approvals', async () => {
  const { page, timers } = reviewContext([{ id: 'A1', addresses: ['F1'], change: 'Publish page' }]);
  page.location = { protocol: 'http:' };
  page.AbortSignal = AbortSignal;
  page.fetch = async () => ({ ok: true, json: async () => ({
    actions: [{ id: 'A1', addresses: ['F1'], change: 'Publish page' }],
  }) });
  const approval = page.approveCareFix('A1');
  timers.shift().callback();
  await approval;
  page.activateCareTab('remediate');
  assert.equal(vm.runInContext('careAnalysis.tab', page), 'remediate');
  assert.ok(page.careRemediationView({ id: 'F1' }).includes('Preparing remediation'));
  assert.ok(!page.careRemediationView({ id: 'F1' }).includes('Proposed Fix'));
  assert.ok(page.careInvestigationView({ id: 'F1' }, 0).includes('aria-busy="true"'));
  assert.equal(timers[0].delay, 3600);
  timers.shift().callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(page.careRemediationView({ id: 'F1' }).includes('Proposed Fix'));
  assert.equal(page.careFindingApproved({ id: 'F1' }), true);
  page.activateCareTab('attribute');
  assert.ok(page.careAttributionView({ id: 'F1' }).includes('Processing attribution'));
  assert.equal(timers[0].delay, 3600);
  timers.shift().callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.careFindingApproved({ id: 'F1' }), true);
});

test('Reject cancels pending approval and an old timer cannot complete reapproval', async () => {
  const { page, timers } = reviewContext([{ id: 'A1', addresses: ['F1'] }]);
  assert.equal(typeof page.approveCareFix, 'function');
  const first = page.approveCareFix('A1');
  page.rejectCareFix('A1');
  assert.ok(page.careRemediationView({ id: 'F1' }).includes('Fix rejected'));
  const second = page.approveCareFix('A1');
  timers.shift().callback();
  await first;
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  timers.shift().callback();
  await second;
  assert.equal(page.careCanCertify({ id: 'F1' }), true);
  page.rejectCareFix('A1');
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  assert.ok(!page.careRemediationView({ id: 'F1' }).includes('You can now proceed'));
});

test('discarding a plan cancels stale approval and changing findings cannot inherit it', async () => {
  const { page, timers, notifications } = reviewContext([{ id: 'A1', addresses: ['F1'] }]);
  assert.equal(typeof page.approveCareFix, 'function');
  await page.approveCareFix('unknown');
  assert.equal(timers.length, 0);
  assert.ok(notifications[0].includes('not available'));
  const pending = page.approveCareFix('A1');
  page.resetCareAttribution();
  timers.shift().callback();
  await pending;
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  vm.runInContext(`
    careAttribution.status = 'done';
    careAttribution.doc = { actions: [{ id: 'A1', addresses: ['F2'] }] };
    careAttribution.findingIndex = 1;
    careAnalysis.selectedFinding = 1;
  `, page);
  assert.equal(page.careCanCertify({ id: 'F2' }), false);
});

test('rejects duplicate action IDs so unrelated fixes cannot share approval', () => {
  assert.throws(() => context.validateCareRemediationPlan({ actions: [
    { id: 'A1', addresses: ['F1'] }, { id: 'A1', addresses: ['F1'] },
  ] }), /Invalid remediation plan/);
});

function traceContext(doc) {
  const review = reviewContext([
    { id: 'A2', addresses: ['F1'], apply_tool: 'trace_investigate',
      rationale: 'Trace rationale',
      target: { field: 'Original target must stay hidden' } },
  ]);
  review.page.location = { protocol: 'http:' };
  review.page.AbortSignal = AbortSignal;
  review.page.fetch = async (url, options) => {
    assert.equal(url, './apply-log.json');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => doc };
  };
  return review;
}

test('places tracing before Target and enables approval only after matching trace details are ready', async () => {
  const { page, timers, notifications } = traceContext({ results: [
    { action_id: 'A3', trace_investigate: { route: 'WRONG_ACTION' } },
    { action_id: 'A2', addresses: ['F1'], trace_investigate: {
      route: 'SUPPORT_TICKET', diagnosis_summary: '<script>Diagnosis</script>',
      review_attributes: 'tools.config.max_text_chars', suggested_fix: 'Review the character budget.',
      support_ticket: 'Investigate truncated lists.', unrelated: 'Do not render this field',
    } },
  ] });
  assert.equal(typeof page.runCareTrace, 'function');
  let html = page.careRemediationView({ id: 'F1' });
  assert.ok(!html.includes('>Target<'));
  assert.ok(html.includes('Trace &amp; Investigate'));
  assert.ok(html.indexOf('>Rationale<') < html.indexOf('data-care-trace-fix="A2"'));
  assert.ok(html.indexOf('data-care-trace-fix="A2"') < html.indexOf('data-care-reject-fix="A2"'));
  assert.match(html, /<button[^>]*data-care-approve-fix="A2"[^>]*disabled/);
  assert.ok(page.careInvestigationView({ id: 'F1' }, 0).includes('>Remediation Plan<'));
  await page.approveCareFix('A2');
  assert.equal(timers.length, 0);
  assert.ok(notifications[0].includes('Trace'));
  const pending = page.runCareTrace('A2');
  assert.equal(timers[0].delay, 3600);
  html = page.careRemediationView({ id: 'F1' });
  assert.ok(!html.includes('>Target<'));
  assert.ok(html.includes('Tracing logs'));
  assert.match(html, /<button[^>]*class="btn primary"[^>]*data-care-trace-fix="A2"/);
  timers.shift().callback();
  await pending;
  html = page.careRemediationView({ id: 'F1' });
  for (const text of ['>Target<', 'Support Ticket', '&lt;script&gt;Diagnosis&lt;/script&gt;',
    'tools.config.max_text_chars', 'Review the character budget.', 'Investigate truncated lists.']) {
    assert.ok(html.includes(text), `Missing trace content: ${text}`);
  }
  assert.ok(!html.includes('WRONG_ACTION'));
  assert.ok(!html.includes('Original target must stay hidden'));
  assert.ok(!html.includes('Do not render this field'));
  assert.ok(!html.includes('<script>'));
  assert.doesNotMatch(html, /<button[^>]*data-care-approve-fix="A2"[^>]*disabled/);
  assert.ok(html.indexOf('data-care-trace-fix="A2"') < html.indexOf('>Target<'));
  assert.ok(html.indexOf('>Target<') < html.indexOf('data-care-reject-fix="A2"'));
  assert.ok(html.indexOf('data-care-reject-fix="A2"') < html.indexOf('data-care-approve-fix="A2"'));
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  const approval = page.approveCareFix('A2');
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  timers.shift().callback();
  await approval;
  assert.equal(page.careCanCertify({ id: 'F1' }), true);
});

test('separates ticket metadata from the Support ticket body after tracing', async () => {
  const { page, timers } = traceContext({ results: [
    { action_id: 'A2', trace_investigate: {
      support_ticket: 'Investigate truncated lists. Root cause: CONTENT_AI_RESPONSE_TRUNCATION, confidence MEDIUM.',
    } },
  ] });
  const pending = page.runCareTrace('A2');
  timers.shift().callback();
  await pending;
  const html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('<dt>Support ticket</dt><dd>Investigate truncated lists.</dd>'));
  assert.ok(html.includes('<dt>Root Cause</dt><dd>CONTENT_AI_RESPONSE_TRUNCATION</dd>'));
  assert.ok(html.includes('<dt>Confidence</dt><dd>MEDIUM</dd>'));
  assert.ok(!html.includes('Root cause:'));
});

test('escapes extracted Root Cause text just like other trace evidence', async () => {
  const { page, timers } = traceContext({ results: [
    { action_id: 'A2', trace_investigate: {
      support_ticket: 'Review <b>retrieval</b>. Root cause: <script>alert(1)</script>, confidence: MEDIUM.',
    } },
  ] });
  const pending = page.runCareTrace('A2');
  timers.shift().callback();
  await pending;
  const html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('<dt>Root Cause</dt><dd>&lt;script&gt;alert(1)&lt;/script&gt;</dd>'));
  assert.ok(html.includes('Review &lt;b&gt;retrieval&lt;/b&gt;.'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>'));
});

test('keeps tickets without a complete metadata ending unchanged and omits absent metadata', async () => {
  for (const ticket of ['Root cause: UNKNOWN.', 'Confidence MEDIUM.', 'Root cause: , confidence MEDIUM.', null]) {
    const { page, timers } = traceContext({ results: [
      { action_id: 'A2', trace_investigate: { route: 'SUPPORT_TICKET', support_ticket: ticket } },
    ] });
    const pending = page.runCareTrace('A2');
    timers.shift().callback();
    await pending;
    const html = page.careRemediationView({ id: 'F1' });
    if (ticket !== null) assert.ok(html.includes(`<dt>Support ticket</dt><dd>${ticket}</dd>`));
    else assert.ok(!html.includes('<dt>Support ticket</dt>'));
    assert.ok(!html.includes('<dt>Root Cause</dt>'));
    assert.ok(!html.includes('<dt>Confidence</dt>'));
  }
});

test('shows missing trace details explicitly and allows retry from an updated apply log', async () => {
  const doc = { results: [
    { action_id: 'A2', outcome: 'skipped', trace_investigate: null },
    { action_id: 'A3', trace_investigate: { route: 'OTHER_ACTION' } },
  ] };
  const { page, timers } = traceContext(doc);
  assert.equal(typeof page.runCareTrace, 'function');
  let pending = page.runCareTrace('A2');
  timers.shift().callback();
  await pending;
  let html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('No trace details'));
  assert.ok(html.includes('apply-log.json'));
  assert.ok(!html.includes('>Target<'));
  assert.match(html, /<button[^>]*data-care-approve-fix="A2"[^>]*disabled/);
  doc.results[0].trace_investigate = { route: 'SUPPORT_TICKET', suggested_fix: null };
  pending = page.runCareTrace('A2');
  timers.shift().callback();
  await pending;
  html = page.careRemediationView({ id: 'F1' });
  assert.ok(html.includes('>Target<'));
  assert.ok(!html.includes('>Suggested fix<'));
});

test('retracing cancels pending approval and requires reapproval of the regenerated Target', async () => {
  const { page, timers } = traceContext({ results: [
    { action_id: 'A2', trace_investigate: { route: 'SUPPORT_TICKET' } },
  ] });
  let pending = page.runCareTrace('A2');
  timers.shift().callback();
  await pending;
  const staleApproval = page.approveCareFix('A2');
  assert.equal(timers.length, 1);
  pending = page.runCareTrace('A2');
  timers.shift().callback();
  await staleApproval;
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  assert.match(page.careRemediationView({ id: 'F1' }), /<button[^>]*data-care-approve-fix="A2"[^>]*disabled/);
  timers.shift().callback();
  await pending;
  assert.equal(page.careCanCertify({ id: 'F1' }), false);
  const approval = page.approveCareFix('A2');
  timers.shift().callback();
  await approval;
  assert.equal(page.careCanCertify({ id: 'F1' }), true);
});

test('rejecting or reloading a plan cancels pending traces without exposing stale results', async () => {
  const { page, timers } = traceContext({ results: [
    { action_id: 'A2', trace_investigate: { route: 'SUPPORT_TICKET' } },
  ] });
  assert.equal(typeof page.runCareTrace, 'function');
  let pending = page.runCareTrace('A2');
  page.rejectCareFix('A2');
  timers.shift().callback();
  await pending;
  assert.ok(!page.careRemediationView({ id: 'F1' }).includes('>Target<'));
  pending = page.runCareTrace('A2');
  page.resetCareAttribution();
  timers.shift().callback();
  await pending;
  vm.runInContext("careAttribution.doc = plan; careAttribution.status = 'done'; careAttribution.findingIndex = 0;", page);
  assert.ok(!page.careRemediationView({ id: 'F1' }).includes('>Target<'));
});

test('validates apply-log result IDs, optional addresses, and nullable trace fields', () => {
  assert.equal(typeof context.validateCareApplyLog, 'function');
  const doc = { results: [{ action_id: 'A2', trace_investigate: { route: 'SUPPORT_TICKET', support_ticket: null } }] };
  assert.equal(context.validateCareApplyLog(doc), doc);
  for (const invalid of [
    null, { results: {} }, { results: [null] }, { results: [{ action_id: '' }] },
    { results: [{ action_id: 'A2', addresses: 'F1' }] },
    { results: [{ action_id: 'A2', trace_investigate: [] }] },
    { results: [{ action_id: 'A2', trace_investigate: { route: 5 } }] },
    { results: [{ action_id: 'A2', trace_investigate: { suggested_fix: {} } }] },
    { results: [{ action_id: 'A2' }, { action_id: 'A2' }] },
  ]) assert.throws(() => context.validateCareApplyLog(invalid), /Invalid apply log/);
});
