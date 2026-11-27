const careAnalysis = { status: 'idle', doc: null, page: 1, error: '', selectedFinding: null, tab: 'analysis' };
const careWorkflowTabs = ['analysis', 'attribute', 'remediate', 'certify'];
// Prototype-only selections; backend filtering is not connected.
const careSetup = { concierge: 'WKND', window: '7', from: '', to: '' };
const careConcierges = ['WKND', 'WKND Trendsetters', 'Frescopa'];
const careRunFilters = { concierge: '', status: '' };
const careRunStatuses = [
  { value: 'attribution', label: 'In Attribution Phase', tone: 'blue' },
  { value: 'success', label: 'Certify Success', tone: 'green' },
  { value: 'pending', label: 'Certify Pending', tone: 'amber' },
  { value: 'failed', label: 'Certify Failed', tone: 'red' },
];
// Display-only history, independent of the JSON-driven health check and its approval state.
const carePastRuns = [
  { id: 'CARE-012', concierge: 'WKND', started: '2026-11-26T14:10', findings: 24, status: 'attribution' },
  { id: 'CARE-011', concierge: 'WKND Trendsetters', started: '2026-11-26T12:05', findings: 36, status: 'attribution' },
  { id: 'CARE-010', concierge: 'Frescopa', started: '2026-11-25T17:20', findings: 18, status: 'pending' },
  { id: 'CARE-009', concierge: 'WKND', started: '2026-11-25T14:30', findings: 42, status: 'pending' },
  { id: 'CARE-008', concierge: 'WKND Trendsetters', started: '2026-11-24T16:45', findings: 31, status: 'success' },
  { id: 'CARE-007', concierge: 'Frescopa', started: '2026-11-24T11:15', findings: 16, status: 'success' },
  { id: 'CARE-006', concierge: 'WKND', started: '2026-11-23T16:00', findings: 27, status: 'success' },
  { id: 'CARE-005', concierge: 'WKND Trendsetters', started: '2026-11-23T09:40', findings: 48, status: 'pending' },
  { id: 'CARE-004', concierge: 'Frescopa', started: '2026-11-22T17:10', findings: 22, status: 'failed' },
  { id: 'CARE-003', concierge: 'WKND', started: '2026-11-21T14:25', findings: 34, status: 'failed' },
];

function careFilteredRuns() {
  return carePastRuns.filter(run =>
    (!careRunFilters.concierge || run.concierge === careRunFilters.concierge) &&
    (!careRunFilters.status || run.status === careRunFilters.status));
}

function careRunHistoryResults() {
  const runs = careFilteredRuns();
  if (!runs.length) return '<p class="care-history-empty">No runs match these filters. Choose a different concierge or status.</p>';
  return `<section class="care-recent-runs" aria-labelledby="care-recent-runs-title">
    <h3 id="care-recent-runs-title">Recent runs</h3>
    <div class="care-run-table-scroll" role="region" aria-label="Recent runs table" tabindex="0">
      <table class="care-run-table"><caption class="care-sr-only">Past health checks, newest first</caption>
        <thead><tr><th scope="col">Run</th><th scope="col">Concierge</th><th scope="col">Started</th><th scope="col">Findings</th><th scope="col">Status</th></tr></thead>
        <tbody>${runs.map(run => {
          const status = careRunStatuses.find(item => item.value === run.status);
          const started = new Date(run.started).toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          return `<tr data-care-run-id="${esc(run.id)}"><th scope="row">${esc(run.id)}</th><td>${esc(run.concierge)}</td>
            <td><time datetime="${esc(run.started)}">${esc(started)}</time></td><td class="care-run-findings">${run.findings}</td>
            <td><span class="tag ${status.tone}">${status.label}</span></td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

function careDashboardView() {
  return `<div class="page care-dashboard">
    <header class="care-dashboard-heading"><p>Hi Krati!</p><h1>Concierge Care</h1></header>
    <section class="card care-dashboard-setup" aria-labelledby="care-dashboard-setup-title">
      <div class="card-body"><h2 id="care-dashboard-setup-title">New health check</h2>
        ${careAnalysis.error ? `<p class="care-error" role="alert">${esc(careAnalysis.error)}</p>` : ''}
        ${careSetupForm()}
      </div>
    </section>
    <section class="card care-run-history" aria-labelledby="care-run-history-title">
      <div class="care-history-head"><div><h2 id="care-run-history-title">Run history</h2><p>Recent health checks</p></div>
        <div class="care-history-filters">
          <div><label for="care-run-concierge-filter">Concierge</label><select id="care-run-concierge-filter" data-care-run-filter="concierge">
            <option value="">All concierges</option>${careConcierges.map(name =>
              `<option ${careRunFilters.concierge === name ? 'selected' : ''}>${name}</option>`).join('')}
          </select></div>
          <div><label for="care-run-status-filter">Status</label><select id="care-run-status-filter" data-care-run-filter="status">
            <option value="">All statuses</option>${careRunStatuses.map(status =>
              `<option value="${status.value}" ${careRunFilters.status === status.value ? 'selected' : ''}>${status.label}</option>`).join('')}
          </select></div>
        </div>
      </div>
      <div id="care-run-history-results" aria-live="polite">${careRunHistoryResults()}</div>
    </section>
  </div>`;
}

function careSetupForm() {
  return `<form class="care-setup-form" id="care-setup-form" novalidate>
    <div class="care-setup-fields">
      <div class="care-setup-field"><label for="care-concierge">Choose your Concierges</label>
        <select id="care-concierge">${careConcierges.map(name =>
          `<option ${careSetup.concierge === name ? 'selected' : ''}>${name}</option>`).join('')}</select>
      </div>
      <div class="care-setup-field"><label for="care-date-window">Choose Date Window</label>
        <select id="care-date-window">${[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Custom']].map(([value, name]) =>
          `<option value="${value}" ${careSetup.window === value ? 'selected' : ''}>${name}</option>`).join('')}<option value="custom-edit" hidden>Edit custom range</option></select>
      </div>
    </div>
    <div class="care-date-popover" id="care-date-popover" popover aria-label="Custom date range">
      <div class="care-date-inputs">
        <div class="care-setup-field"><label for="care-date-from">From</label><input id="care-date-from" type="date" value="${esc(careSetup.from)}"></div>
        <div class="care-setup-field"><label for="care-date-to">To</label><input id="care-date-to" type="date" value="${esc(careSetup.to)}"></div>
      </div>
      <button class="btn primary" type="button" id="care-date-done">Done</button>
    </div>
    <button class="btn primary" id="run-health-check" type="submit">Start</button>
  </form>`;
}

function bindCareSetup() {
  const form = document.getElementById('care-setup-form');
  if (!form) return;
  const concierge = document.getElementById('care-concierge');
  const dateWindow = document.getElementById('care-date-window');
  const popover = document.getElementById('care-date-popover');
  const from = document.getElementById('care-date-from');
  const to = document.getElementById('care-date-to');
  const updateDates = () => {
    careSetup.from = from.value;
    careSetup.to = to.value;
    const custom = dateWindow.value === 'custom';
    from.required = custom;
    to.required = custom;
    to.min = from.value;
    to.setCustomValidity(custom && from.value && to.value && to.value < from.value
      ? 'Choose an end date on or after the start date.' : '');
    const validRange = from.value && to.value && from.checkValidity() && to.checkValidity();
    dateWindow.querySelector('[value="custom"]').textContent = validRange
      ? `${from.value} to ${to.value}` : 'Custom';
    dateWindow.querySelector('[value="custom-edit"]').hidden = !validRange;
  };
  const openDates = () => {
    const bounds = dateWindow.getBoundingClientRect();
    popover.style.width = `${Math.min(360, innerWidth - 32)}px`;
    popover.showPopover();
    const rect = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(16, Math.min(bounds.left, innerWidth - rect.width - 16))}px`;
    popover.style.top = `${Math.max(16, Math.min(bounds.bottom + 10, innerHeight - rect.height - 16))}px`;
    from.focus();
  };
  concierge.addEventListener('change', () => { careSetup.concierge = concierge.value; });
  dateWindow.addEventListener('change', () => {
    if (dateWindow.value === 'custom-edit') dateWindow.value = 'custom';
    careSetup.window = dateWindow.value;
    updateDates();
    if (dateWindow.value === 'custom') openDates();
    else if (popover.matches(':popover-open')) popover.hidePopover();
  });
  from.addEventListener('input', updateDates);
  to.addEventListener('input', updateDates);
  document.getElementById('care-date-done').addEventListener('click', () => {
    updateDates();
    if (from.reportValidity() && to.reportValidity()) {
      popover.hidePopover();
      dateWindow.focus();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    updateDates();
    if (dateWindow.value === 'custom' && (!from.checkValidity() || !to.checkValidity())) {
      openDates();
      form.reportValidity();
      return;
    }
    if (popover.matches(':popover-open')) popover.hidePopover();
    runHealthCheck();
  });
  updateDates();
}

function validateCareAnalysis(doc) {
  const invalid = () => { throw new Error('Invalid analysis document'); };
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.findings)) invalid();
  for (const finding of doc.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) invalid();
    for (const key of ['id', 'bucket', 'bucket_label', 'subtype', 'theme', 'evidence', 'conversation_id', 'review_risk']) {
      if (finding[key] != null && (typeof finding[key] !== 'string' || !finding[key].trim())) invalid();
    }
    for (const key of ['example_questions', 'conversation_ids']) {
      if (finding[key] != null && (!Array.isArray(finding[key]) ||
          finding[key].some(value => typeof value !== 'string' || !value.trim()))) invalid();
    }
    for (const key of ['frequency', 'conversations']) {
      if (finding[key] != null && (!Number.isSafeInteger(finding[key]) || finding[key] < 0)) invalid();
    }
  }
  if (doc.window != null) {
    if (typeof doc.window !== 'object' || Array.isArray(doc.window)) invalid();
    for (const key of ['start', 'end']) {
      const value = doc.window[key];
      if (value != null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid();
    }
    if (doc.window.start && doc.window.end && doc.window.start > doc.window.end) invalid();
  }
  return doc;
}

function careConversationIds(finding) {
  return finding.conversation_ids ?? (finding.conversation_id ? [finding.conversation_id] : []);
}

function careAnalysisSummary(doc) {
  return {
    findings: doc.findings.length,
    conversations: new Set(doc.findings.flatMap(careConversationIds)).size,
  };
}

function careAnalysisPage(doc, requestedPage) {
  const pages = Math.max(1, Math.ceil(doc.findings.length / 5));
  const page = Math.max(1, Math.min(pages, requestedPage));
  const offset = (page - 1) * 5;
  return { page, pages, offset, items: doc.findings.slice(offset, offset + 5) };
}

function careText(value) {
  return esc(value).replace(/\bcontent(?:\s+|-)enrichment\b/gi, text => `<strong>${text}</strong>`);
}

function careBucketLabel(finding) {
  const tone = finding.bucket === 'dont_know' ? 'blue' : finding.bucket === 'frequently_asked' ? 'amber' : '';
  return `<span class="tag care-bucket-label ${tone}">${careText(finding.bucket_label ?? 'Bucket not provided')}</span>`;
}

function careFindingSummary(finding) {
  const evidence = finding.evidence?.replace(/\s+/g, ' ').trim();
  if (!evidence) return 'No supporting evidence provided.';
  const characters = Array.from(evidence);
  if (characters.length <= 180) return evidence;
  const preview = characters.slice(0, 177).join('');
  const boundary = preview.lastIndexOf(' ');
  return `${boundary > 0 ? preview.slice(0, boundary) : preview}...`;
}

function careFindingView(finding, index) {
  const id = finding.id ?? `F${index + 1}`;
  const questions = finding.example_questions ?? [];
  const ids = careConversationIds(finding);
  return `<article class="care-finding" aria-labelledby="care-finding-${index}">
    <div class="care-finding-head">
      <div class="care-finding-main">
        ${careBucketLabel(finding)}
        <div><h3 id="care-finding-${index}">${esc(id)} · ${careText(finding.theme ?? 'Theme not provided')}</h3>
          <p class="care-subtype">${careText(finding.subtype ?? 'Subtype not provided')}${finding.conversations != null ? ` &middot; ${finding.conversations} ${finding.conversations === 1 ? 'conversation' : 'conversations'}` : ''}</p>
          <p class="care-finding-summary">${careText(careFindingSummary(finding))}</p></div>
      </div>
      <button class="btn primary" data-care-investigate="${index}" aria-label="Investigate ${esc(id)}">Investigate</button>
    </div>
    <details class="care-details">
      <summary>Details</summary>
      <div class="care-details-body">
        <section><h4>User Questions</h4>${questions.length ? `<ul>${questions.map(question => `<li>${careText(question)}</li>`).join('')}</ul>` : '<p>Not provided</p>'}</section>
        <section><h4>Evidence</h4><blockquote>${careText(finding.evidence ?? 'Not provided')}</blockquote></section>
        <section><h4>Conversation IDs</h4>${ids.length ? `<ul class="care-conversation-ids">${ids.map(id => `<li><code>${esc(id)}</code></li>`).join('')}</ul>` : '<p>Not provided</p>'}</section>
      </div>
    </details>
  </article>`;
}

function careFindingsView(doc) {
  const pagination = careAnalysisPage(doc, careAnalysis.page);
  return `<section class="card care-findings" aria-labelledby="care-findings-title">
    <div class="card-head"><h2 id="care-findings-title">Findings</h2></div>
    ${pagination.items.length ? pagination.items.map((finding, index) => careFindingView(finding, pagination.offset + index)).join('') : '<p class="care-no-findings">No findings in this analysis.</p>'}
    ${pagination.pages > 1 ? `<nav class="care-pagination" aria-label="Findings pagination">
      <span role="status">Page ${pagination.page} of ${pagination.pages}</span>
      <div class="actions"><button class="btn" data-care-page="${pagination.page - 1}" ${pagination.page === 1 ? 'disabled' : ''}>Previous</button><button class="btn" data-care-page="${pagination.page + 1}" ${pagination.page === pagination.pages ? 'disabled' : ''}>Next</button></div>
    </nav>` : ''}
  </section>`;
}

function careInvestigationView(finding, index) {
  const tab = careAnalysis.tab;
  const id = finding.id ?? `F${index + 1}`;
  const questions = finding.example_questions ?? [];
  const reviewRisk = finding.review_risk ?? 'Medium';
  const riskTone = reviewRisk === 'high' ? 'red' : reviewRisk.toLowerCase() === 'medium' ? 'amber' : reviewRisk === 'low' ? 'green' : '';
  const label = tab === 'remediate' ? 'Remediation Plan' : tab[0].toUpperCase() + tab.slice(1);
  const planReady = careAttribution.status === 'done' && careAttribution.findingIndex === index &&
    careAttributionActions(careAttribution.doc, finding.id).length > 0;
  return `<div class="progress care-workflow-tabs" role="tablist" aria-label="Finding workflow">
    ${careWorkflowTabs.map((name, i) => `<button class="step ${name === tab ? 'active' : ''}" role="tab" id="care-tab-${name}" data-care-tab="${name}" aria-selected="${name === tab}" aria-controls="care-investigation-panel" tabindex="${name === tab ? '0' : '-1'}" ${name === 'certify' && !careCanCertify() ? 'disabled' : ''}><span class="n" aria-hidden="true">${i + 1}</span>${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}
  </div>
  <section class="card care-investigation" role="tabpanel" id="care-investigation-panel" aria-labelledby="care-tab-${tab}" aria-busy="${(['attribute', 'remediate'].includes(tab) && careAttribution.status === 'loading') || (tab === 'certify' && careCertification.status === 'processing')}" tabindex="0">
    <div class="card-body">
      <h2 id="care-investigation-title" tabindex="-1">${tab === 'analysis' ? `${esc(id)} · ${careText(finding.theme ?? 'Theme not provided')}` : label}</h2>
      ${tab === 'analysis' ? `<div class="care-investigation-meta">${careBucketLabel(finding)}<span class="tag ${riskTone}">Review risk: ${esc(reviewRisk)}</span></div>
        <section class="care-reasoning care-user-queries"><h3>User Queries:</h3>${questions.length ? questions.map(question => `<blockquote>&ldquo;${careText(question)}&rdquo;</blockquote>`).join('') : '<p class="care-placeholder">No example queries provided.</p>'}</section>
        <section class="care-reasoning"><h3>Concierge reasoning</h3><blockquote>${careText(finding.evidence ?? 'Not provided')}</blockquote></section>
        <dl class="care-finding-stats"><div><dt>Frequency</dt><dd>${esc(finding.frequency ?? 'Not provided')}</dd></div><div><dt>Conversations</dt><dd>${esc(finding.conversations ?? 'Not provided')}</dd></div></dl>` : tab === 'attribute' ? careAttributionView(finding) : tab === 'remediate' ? careRemediationView(finding) : careCertifyView()}
      <div class="actions care-investigation-actions">${tab === 'attribute'
        ? `<button class="btn" data-care-tab="analysis">Go Back</button><button class="btn primary" data-care-tab="remediate" ${planReady ? '' : 'disabled'}>Remediate</button>`
        : tab === 'remediate' ? `<button class="btn" data-care-tab="attribute">Go Back</button><button class="btn primary" data-care-tab="certify" ${careCanCertify() ? '' : 'disabled'}>Certify</button>`
        : tab === 'certify' ? '<button class="btn" data-care-tab="remediate">Go Back</button>'
        : `<button class="btn" data-care-back>Go Back</button>${tab === 'analysis' ? '<button class="btn primary" data-care-tab="attribute">Attribute</button>' : ''}`}</div>
    </div>
  </section>`;
}

function careAnalysisView() {
  if (careAnalysis.status !== 'done') {
    if (careAnalysis.status !== 'checking') return careDashboardView();
    return `<div class="page assessment-page"><section class="assessment-empty" aria-label="Concierge health assessment">
      <div role="status" aria-live="polite" aria-atomic="true"><div class="assessment-spinner" aria-hidden="true"></div><h2>Concierge Care</h2><p>Analysing conversations...</p></div>
      <button class="btn primary" id="run-health-check" disabled>Running...</button>
    </section></div>`;
  }
  const doc = careAnalysis.doc;
  const summary = careAnalysisSummary(doc);
  const range = doc.window?.start && doc.window?.end ? `${doc.window.start} → ${doc.window.end}` : 'Not provided';
  return `<div class="page assessment-page">
    <section class="card care-overview" aria-labelledby="care-analysis-title">
      <div class="card-head"><h1 id="care-analysis-title" tabindex="-1">Concierge Care</h1>
        <div class="actions"><button class="btn primary" id="run-health-check">Restart</button><button class="btn" id="care-export">Export analysis</button></div>
      </div>
      <dl class="care-metrics">
        <div><dt>Findings</dt><dd class="care-metric-count">${summary.findings}</dd></div>
        <div><dt>Total conversations</dt><dd class="care-metric-count">${summary.conversations}</dd></div>
        <div><dt>Source</dt><dd>WKND concierge</dd></div>
        <div><dt>Date range</dt><dd>${esc(range)}</dd></div>
      </dl>
    </section>
    ${careAnalysis.selectedFinding === null ? careFindingsView(doc) : careInvestigationView(doc.findings[careAnalysis.selectedFinding], careAnalysis.selectedFinding)}
  </div>`;
}

async function loadCareJson(filename) {
  if (location.protocol === 'file:') {
    throw new Error(`Use a local HTTP preview to read ${filename}`);
  }
  const response = await fetch(`./${filename}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${filename} request failed (${response.status})`);
  return response.json();
}

async function loadCareAnalysis() {
  return validateCareAnalysis(await loadCareJson('findings.json'));
}

async function runHealthCheck() {
  if (careAnalysis.status === 'checking') return;
  careAnalysis.status = 'checking';
  careAnalysis.doc = null;
  careAnalysis.error = '';
  careAnalysis.page = 1;
  careAnalysis.selectedFinding = null;
  careAnalysis.tab = 'analysis';
  resetCareAttribution();
  render();
  try {
    const [doc] = await Promise.all([
      loadCareAnalysis(),
      new Promise(resolve => setTimeout(resolve, 3600)),
    ]);
    careAnalysis.doc = doc;
    careAnalysis.status = 'done';
  } catch (error) {
    console.error('Concierge Care Analysis could not be loaded.', error.name);
    careAnalysis.status = 'error';
    careAnalysis.error = location.protocol === 'file:'
      ? 'Open v4 using a local HTTP preview, such as VS Code Live Server. The browser cannot read findings.json when the HTML is opened as a local file.'
      : 'Analysis could not be loaded. Check that findings.json is next to the v4 HTML and contains valid data, then try Start again.';
  }
  if (state.page === 'health') {
    render();
    document.getElementById(careAnalysis.status === 'done' ? 'care-analysis-title' : 'run-health-check').focus();
  }
}

function exportCareAnalysis() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(careAnalysis.doc, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'findings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function bindCareAnalysis() {
  if (document.getElementById('care-setup-form')) bindCareSetup();
  else document.getElementById('run-health-check')?.addEventListener('click', runHealthCheck);
  view.querySelectorAll('[data-care-run-filter]').forEach(select => select.addEventListener('change', () => {
    const field = select.dataset.careRunFilter;
    const options = field === 'concierge' ? careConcierges
      : field === 'status' ? careRunStatuses.map(status => status.value) : null;
    if (!options || (select.value && !options.includes(select.value))) {
      toast('This history filter is not available. Choose a listed concierge or status.');
      return;
    }
    careRunFilters[field] = select.value;
    document.getElementById('care-run-history-results').innerHTML = careRunHistoryResults();
  }));
  document.getElementById('care-export')?.addEventListener('click', exportCareAnalysis);
  view.querySelectorAll('[data-care-page]').forEach(button => button.addEventListener('click', () => {
    careAnalysis.page = Number(button.dataset.carePage);
    render();
    const title = document.getElementById('care-findings-title');
    title.tabIndex = -1;
    title.focus();
  }));
  view.querySelectorAll('[data-care-investigate]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.careInvestigate);
    if (!Number.isInteger(index) || !careAnalysis.doc.findings[index]) {
      toast('This finding is not available. Restart the analysis and try again.');
      return;
    }
    careAnalysis.selectedFinding = index;
    careAnalysis.tab = 'analysis';
    resetCareAttribution(true);
    render();
    document.getElementById('care-investigation-title').focus();
  }));
  view.querySelectorAll('[data-care-back]').forEach(button => button.addEventListener('click', () => {
    const index = careAnalysis.selectedFinding;
    careAnalysis.selectedFinding = null;
    careAnalysis.tab = 'analysis';
    resetCareAttribution(true);
    render();
    view.querySelector(`[data-care-investigate="${index}"]`).focus();
  }));
  view.querySelectorAll('[data-care-tab]').forEach(button => button.addEventListener('click', () => {
    activateCareTab(button.dataset.careTab);
  }));
  view.querySelectorAll('[data-care-approve-fix]').forEach(button => button.addEventListener('click', () => {
    approveCareFix(button.dataset.careApproveFix);
  }));
  view.querySelectorAll('[data-care-author-form]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    authorCareContent(form.dataset.careAuthorForm, form.querySelector('input').value);
  }));
  view.querySelectorAll('[data-care-publish-fix]').forEach(button => button.addEventListener('click', () => {
    publishCareContent(button.dataset.carePublishFix);
  }));
  view.querySelectorAll('[data-care-reject-fix]').forEach(button => button.addEventListener('click', () => {
    rejectCareFix(button.dataset.careRejectFix);
  }));
  view.querySelectorAll('[data-care-trace-fix]').forEach(button => button.addEventListener('click', () => {
    runCareTrace(button.dataset.careTraceFix);
  }));
  view.querySelector('[data-care-certify-download]')?.addEventListener('click', event => {
    event.preventDefault();
    toast('The evaluation set cannot be downloaded yet. CSV generation is not connected.');
  });
  view.querySelectorAll('.care-workflow-tabs [role="tab"]').forEach(button => button.addEventListener('keydown', event => {
    const tabs = Array.from(view.querySelectorAll('.care-workflow-tabs [role="tab"]:not(:disabled)'), tab => tab.dataset.careTab);
    const current = tabs.indexOf(button.dataset.careTab);
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    activateCareTab(tabs[next]);
  }));
}

function activateCareTab(tab) {
  if (!careWorkflowTabs.includes(tab)) {
    toast('This workflow tab is not available.');
    return;
  }
  if (tab === 'certify' && !careCanCertify()) {
    toast('Approve at least one finding and wait for processing to finish before Certifying.');
    return;
  }
  careAnalysis.tab = tab;
  if (tab === 'certify') runCareCertification();
  else {
    resetCareCertification();
    if (tab === 'attribute' || tab === 'remediate') runCareAttribution();
    else render();
  }
  document.getElementById(`care-tab-${tab}`).focus();
}
