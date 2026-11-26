const careAttribution = { status: 'idle', doc: null, error: '', request: 0, findingIndex: null };
const careFixReviews = new Map();
const careTraceInvestigations = new Map();
const careCertification = { status: 'idle', request: 0 };
const careTraceEvidenceFields = [
  ['route', 'Route'], ['diagnosis_summary', 'Diagnosis summary'],
  ['review_attributes', 'Review attributes'], ['suggested_fix', 'Suggested fix'],
  ['support_ticket', 'Support ticket'],
];

function validateCareRemediationPlan(doc) {
  const invalid = () => { throw new Error('Invalid remediation plan'); };
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.actions)) invalid();
  if (doc.concierge_id != null && typeof doc.concierge_id !== 'string') invalid();
  const actionIds = new Set();
  for (const action of doc.actions) {
    if (!action || typeof action !== 'object' || Array.isArray(action) ||
        typeof action.id !== 'string' || !action.id.trim() ||
        !Array.isArray(action.addresses) ||
        action.addresses.some(id => typeof id !== 'string' || !id.trim())) invalid();
    if (actionIds.has(action.id)) invalid();
    actionIds.add(action.id);
    for (const key of ['gap_cause', 'retrieval_subcause', 'review_risk',
      'fixable_by', 'apply_tool', 'handoff_reason', 'change', 'rationale', 'risk', 'status']) {
      if (action[key] != null && (typeof action[key] !== 'string' || !action[key].trim())) invalid();
    }
    if (action.topic_frequency != null && (!Number.isSafeInteger(action.topic_frequency) || action.topic_frequency < 0)) invalid();
    if (action.is_frequent != null && typeof action.is_frequent !== 'boolean') invalid();
    if (action.gap_evidence != null && (typeof action.gap_evidence !== 'object' || Array.isArray(action.gap_evidence))) invalid();
    if (action.target != null) {
      const target = action.target;
      if (typeof target !== 'object' || Array.isArray(target)) invalid();
      for (const key of ['field', 'detail']) {
        if (target[key] != null && (typeof target[key] !== 'string' || !target[key].trim())) invalid();
      }
      if (target.aem != null) {
        const aem = target.aem;
        if (typeof aem !== 'object' || Array.isArray(aem)) invalid();
        for (const key of ['site_path', 'author_path', 'environment']) {
          if (aem[key] != null && (typeof aem[key] !== 'string' || !aem[key].trim())) invalid();
        }
        if (aem.locales != null && (!Array.isArray(aem.locales) ||
          aem.locales.some(locale => typeof locale !== 'string' || !locale.trim()))) invalid();
      }
    }
  }
  return doc;
}

function careAttributionActions(doc, findingId) {
  return doc.actions.filter(action => action.addresses.includes(findingId));
}

function validateCareApplyLog(doc) {
  const invalid = () => { throw new Error('Invalid apply log'); };
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.results)) invalid();
  if (doc.concierge_id != null && typeof doc.concierge_id !== 'string') invalid();
  const ids = new Set();
  for (const result of doc.results) {
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        typeof result.action_id !== 'string' || !result.action_id.trim() || ids.has(result.action_id)) invalid();
    ids.add(result.action_id);
    if (result.addresses != null && (!Array.isArray(result.addresses) ||
        result.addresses.some(id => typeof id !== 'string' || !id.trim()))) invalid();
    if (result.apply_tool != null && typeof result.apply_tool !== 'string') invalid();
    if (result.trace_investigate != null) {
      const trace = result.trace_investigate;
      if (typeof trace !== 'object' || Array.isArray(trace)) invalid();
      for (const [key] of careTraceEvidenceFields) {
        if (trace[key] != null && (typeof trace[key] !== 'string' || !trace[key].trim())) invalid();
      }
    }
  }
  return doc;
}

function careHasAttributionValue(value) {
  return value != null && (typeof value !== 'string' ||
    !['no_results', 'not_found'].includes(value.trim().toLowerCase()));
}

function careHumanize(value) {
  return !careHasAttributionValue(value) ? null : value.replace(/_/g, ' ').split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function careAttributionFacts(action) {
  return [
    { label: 'Addresses', value: action.addresses.join(', ') },
    { label: 'Attribution', value: careHumanize(action.gap_cause) },
    { label: 'Review risk', value: careHumanize(action.review_risk ?? 'medium') },
  ].filter(field => careHasAttributionValue(field.value));
}

function careAttributionEvidence(evidence) {
  const fields = [
    ['representative_question', 'Representative question'],
    ['conversation_id', 'Conversation ID'],
    ['content_ai_response', 'Content AI response'],
    ['concierge_answer', 'Concierge reasoning'],
    ['content_ai_answer', 'Content AI answer'],
    ['aem_published_source', 'AEM Publish'],
    ['aem_author_source', 'AEM Author'],
    ['published_value', 'Published value'],
  ];
  return fields.filter(([key]) => careHasAttributionValue(evidence[key]))
    .map(([key, label]) => ({ key, label, value: evidence[key] }));
}

function careAemSourceDetails(value) {
  if (typeof value !== 'string' || !/^\s*found\b/i.test(value)) return null;
  const path = value.match(/(?:https?:\/\/|\/)[^\s,()]+/)?.[0] ?? null;
  const mixed = value.match(/(\d+)\s+published\s*,\s*(\d+)\s+unpublished/i);
  let publication = 'Not provided';
  if (mixed) publication = `${mixed[1]} Published, ${mixed[2]} Unpublished`;
  else if (/\bpublished\s*=\s*(?:null|false)\b|\bunpublished\b/i.test(value)) publication = 'Unpublished';
  else if (/\bpublished\b/i.test(value)) publication = 'Published';
  return { path, publication };
}

function careAemSourceView(value) {
  const details = careAemSourceDetails(value);
  if (!details) return careAttributionEvidenceView(value);
  return `<blockquote class="care-aem-source"><div>Found</div>${details.path ? `<div>Path: <code>${esc(details.path)}</code></div>` : ''}<div>${details.publication === 'Not provided' ? 'Publication: Not provided' : esc(details.publication)}</div></blockquote>`;
}

function careAttributionEvidenceView(value) {
  const values = Array.isArray(value) ? value.filter(item => item != null) : [value];
  return values.map(item => {
    const text = item && typeof item === 'object'
      ? typeof item.text === 'string' ? item.text : JSON.stringify(item, null, 2)
      : String(item);
    return `<blockquote>${esc(text)}</blockquote>`;
  }).join('');
}

function carePlanFactsView(fields) {
  return fields.map(field => {
    const riskTone = field.value === 'High' ? 'red' : field.value === 'Low' ? 'green' : field.value === 'Medium' ? 'amber' : '';
    const risk = field.label === 'Review risk' || field.label === 'Risk';
    return `<div><dt>${esc(field.label)}</dt><dd>${risk ? `<span class="tag ${riskTone}">${esc(field.value)}</span>` : esc(field.value)}</dd></div>`;
  }).join('');
}

function careAttributionView(finding) {
  if (careAttribution.status === 'loading') {
    return '<div class="care-attribution-loading" role="status" aria-live="polite"><div class="assessment-spinner" aria-hidden="true"></div><p>Processing attribution...</p></div>';
  }
  if (careAttribution.status === 'error') {
    return `<p class="care-attribution-error" role="alert">${esc(careAttribution.error)}</p>`;
  }
  const actions = careAttribution.doc ? careAttributionActions(careAttribution.doc, finding.id) : [];
  if (!actions.length) {
    return `<p class="care-attribution-error" role="alert">No attribution action addresses ${esc(finding.id ?? 'this finding')} in the remediation plan. Select Attribute to reload the plan.</p>`;
  }
  return actions.map(action => `<article class="care-attribution-action" aria-label="Action ${esc(action.id)}">
    <h3>${esc(action.id)}</h3>
    <dl class="care-attribution-facts">${carePlanFactsView(careAttributionFacts(action))}</dl>
    <div class="care-attribution-evidence">${careAttributionEvidence(action.gap_evidence ?? {}).map(field =>
      `<section class="care-reasoning"><h4>${esc(field.label)}</h4>${field.key === 'aem_author_source' || field.key === 'aem_published_source' ? careAemSourceView(field.value) : careAttributionEvidenceView(field.value)}</section>`).join('')}</div>
  </article>`).join('');
}

function careRemediationView(finding) {
  if (careAttribution.status === 'loading') {
    return '<div class="care-attribution-loading" role="status" aria-live="polite"><div class="assessment-spinner" aria-hidden="true"></div><p>Preparing remediation...</p></div>';
  }
  if (careAttribution.status === 'error') {
    return `<p class="care-attribution-error" role="alert">${esc(careAttribution.error)}</p>`;
  }
  const actions = careAttribution.doc ? careAttributionActions(careAttribution.doc, finding.id) : [];
  if (!actions.length) {
    return `<p class="care-attribution-error" role="alert">No remediation action addresses ${esc(finding.id ?? 'this finding')} in the plan. Select Remediate to reload the plan.</p>`;
  }
  return actions.map(action => {
    const traceAction = action.apply_tool === 'trace_investigate';
    const trace = careTraceInvestigations.get(action.id);
    const tracing = trace?.status === 'loading';
    const facts = [
      ['fixable_by', 'Fixable by'], ['apply_tool', 'Apply tool'], ['risk', 'Risk'], ['status', 'Status'],
    ].filter(([key]) => action[key] != null)
      .map(([key, label]) => ({ label, value: key === 'apply_tool' ? action[key] : careHumanize(action[key]) }));
    const target = action.target;
    const aem = target?.aem;
    const targetFields = traceAction ? (trace?.status === 'done' ? trace.fields : []) : [
      ['Field', target?.field], ['Detail', target?.detail],
      ['Site path', aem?.site_path], ['Author path', aem?.author_path],
      ['Environment', aem?.environment], ['Locales', aem?.locales?.length ? aem.locales.join(', ') : null],
    ].filter(([, value]) => value != null);
    const details = [
      ['proposed_value', 'Proposed value'], ['handoff_reason', 'Handoff reason'], ['rationale', 'Rationale'],
    ].filter(([key]) => action[key] != null)
      .map(([key, label]) => `<section class="care-reasoning"><h4>${esc(label)}</h4>${careAttributionEvidenceView(action[key])}</section>`).join('');
    const targetView = targetFields.length ? `<div class="care-attribution-evidence care-remediation-details care-remediation-target-section"><section class="care-reasoning"><h4>Target</h4><blockquote><dl class="care-remediation-target">${targetFields.map(([label, value]) =>
      `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></blockquote></section></div>` : '';
    const review = careFixReviews.get(action.id)?.status;
    const approving = review === 'processing';
    const approved = review === 'approved';
    const approvalBlocked = traceAction && trace?.status !== 'done';
    return `<article class="care-attribution-action care-remediation-action" aria-label="Action ${esc(action.id)}">
      <h3>${esc(action.id)}</h3>
      ${facts.length ? `<dl class="care-attribution-facts care-remediation-facts">${carePlanFactsView(facts)}</dl>` : ''}
      ${action.change != null ? `<section class="care-reasoning care-remediation-change"><h4>Proposed Fix</h4>${careAttributionEvidenceView(action.change)}</section>` : ''}
      ${details ? `<div class="care-attribution-evidence care-remediation-details">${details}</div>` : ''}
      ${traceAction ? `<div class="actions care-fix-trace" aria-busy="${tracing}"><button class="btn ${trace ? 'primary' : ''}" data-care-trace-fix="${esc(action.id)}" ${tracing ? 'disabled' : ''}>Trace &amp; Investigate</button></div>` : ''}
      ${tracing ? '<p class="care-fix-feedback" role="status">Tracing logs and identifying the specific route...</p>' : ''}
      ${trace?.status === 'done' ? '<p class="care-fix-feedback" role="status">Tracing complete. Target details are available.</p>' : ''}
      ${trace?.status === 'error' ? `<p class="care-attribution-error" role="alert">${esc(trace.error)}</p>` : ''}
      ${targetView}
      <div class="actions care-fix-decisions" aria-busy="${approving}">
        <button class="btn" data-care-reject-fix="${esc(action.id)}">Reject</button>
        <button class="btn ${approving || approved ? 'good' : ''}" data-care-approve-fix="${esc(action.id)}" ${approvalBlocked || approving || approved ? 'disabled' : ''}>Approve Fix</button>
      </div>
      ${approving || review === 'rejected' ? `<p class="care-fix-feedback" role="status">${approving ? 'Processing approval...' : 'Fix rejected.'}</p>` : ''}
    </article>`;
  }).join('') + (careFindingApproved(finding)
    ? '<p class="care-fix-feedback" role="status">You can now proceed with Certifying this fix.</p>' : '');
}

function careFindingApproved(finding) {
  if (!finding || !careAttribution.doc) return false;
  const actions = careAttributionActions(careAttribution.doc, finding.id);
  return actions.length > 0 && actions.every(action =>
    careFixReviews.get(action.id)?.status === 'approved' &&
    (action.apply_tool !== 'trace_investigate' || careTraceInvestigations.get(action.id)?.status === 'done'));
}

function careCanCertify() {
  return !['loading', 'error'].includes(careAttribution.status) &&
    (careAnalysis.doc?.findings ?? []).some(careFindingApproved);
}

function careCertifyView() {
  return `<ul class="care-certify-findings" aria-label="Finding approvals">
    ${(careAnalysis.doc?.findings ?? []).map(finding => `<li><label>
      <input type="checkbox" disabled ${careFindingApproved(finding) ? 'checked' : ''}>
      <span><strong>${esc(finding.id)}</strong><span>${esc(finding.theme ?? 'Theme not provided')}</span></span>
    </label></li>`).join('')}
    </ul>
    <section class="care-certify-caution" aria-labelledby="care-certify-caution-title">
      <h3 id="care-certify-caution-title">Caution:</h3>
      <p>For Content fixes, make sure Content AI sources are reindexed with published data.</p>
      <p>For Concierge Config fixes, make sure Support tickets are resolved and Composer fixes are in place.</p>
    </section>
    ${careCertification.status === 'processing' ? '<div class="care-attribution-loading" role="status" aria-live="polite"><div class="assessment-spinner" aria-hidden="true"></div><p>Preparing evaluation set...</p></div>' : ''}
    ${careCertification.status === 'done' && careCanCertify() ? `<div class="care-certify-export">
      <a href="#" data-care-certify-download>Download evaluation set (.csv)</a>
      <p class="care-certify-instructions"><strong>Download this evaluation set, add it alongside your Silver or Golden Set, and Run Evaluation.</strong></p>
    </div>` : ''}`;
}

function resetCareCertification() {
  careCertification.request++;
  careCertification.status = 'idle';
}

async function runCareCertification() {
  if (!careCanCertify()) {
    toast('Approve at least one finding and wait for processing to finish before Certifying.');
    return;
  }
  if (careCertification.status === 'processing' || careCertification.status === 'done') return;
  const request = ++careCertification.request;
  careCertification.status = 'processing';
  render();
  await new Promise(resolve => setTimeout(resolve, 3600));
  if (request !== careCertification.request || !careCanCertify()) return;
  careCertification.status = 'done';
  if (state.page === 'health' && careAnalysis.tab === 'certify') render();
}

function careReviewableAction(actionId) {
  const finding = careAnalysis.doc?.findings[careAnalysis.selectedFinding];
  const action = finding && careAttribution.status === 'done' &&
    careAttribution.findingIndex === careAnalysis.selectedFinding
    ? careAttributionActions(careAttribution.doc, finding.id).find(item => item.id === actionId) : null;
  if (!action) toast('This fix is not available. Reload Attribute and try again.');
  return action;
}

async function approveCareFix(actionId) {
  const action = careReviewableAction(actionId);
  if (!action) return;
  if (action.apply_tool === 'trace_investigate' && careTraceInvestigations.get(actionId)?.status !== 'done') {
    toast('Run Trace & Investigate and wait for Target details before approving this fix.');
    return;
  }
  const status = careFixReviews.get(actionId)?.status;
  if (status === 'processing' || status === 'approved') {
    toast('This fix is already processing or approved.');
    return;
  }
  const index = careAnalysis.selectedFinding;
  const review = { status: 'processing' };
  resetCareCertification();
  careFixReviews.set(actionId, review);
  render();
  await new Promise(resolve => setTimeout(resolve, 3600));
  if (careFixReviews.get(actionId) !== review) return;
  review.status = 'approved';
  if (state.page === 'health' && careAnalysis.selectedFinding === index) render();
}

function rejectCareFix(actionId) {
  if (!careReviewableAction(actionId)) return;
  resetCareCertification();
  if (careTraceInvestigations.get(actionId)?.status === 'loading') careTraceInvestigations.delete(actionId);
  careFixReviews.set(actionId, { status: 'rejected' });
  render();
}

async function loadCareApplyLog() {
  return validateCareApplyLog(await loadCareJson('apply-log.json'));
}

async function runCareTrace(actionId) {
  const action = careReviewableAction(actionId);
  if (!action) return;
  if (action.apply_tool !== 'trace_investigate') {
    toast('Trace & Investigate is only available for trace_investigate actions.');
    return;
  }
  if (careTraceInvestigations.get(actionId)?.status === 'loading') {
    toast('Tracing is already in progress for this action.');
    return;
  }
  const index = careAnalysis.selectedFinding;
  const finding = careAnalysis.doc.findings[index];
  const trace = { status: 'loading', fields: [], error: '' };
  resetCareCertification();
  careTraceInvestigations.set(actionId, trace);
  careFixReviews.delete(actionId);
  render();
  try {
    const [doc] = await Promise.all([
      loadCareApplyLog(), new Promise(resolve => setTimeout(resolve, 3600)),
    ]);
    if (careTraceInvestigations.get(actionId) !== trace) return;
    const conciergeId = careAttribution.doc.concierge_id ?? careAnalysis.doc.concierge_id;
    if (doc.concierge_id && conciergeId && doc.concierge_id !== conciergeId) {
      throw new Error('Apply log belongs to a different concierge');
    }
    const result = doc.results.find(item => item.action_id === actionId);
    if (result?.addresses && !result.addresses.includes(finding.id)) {
      throw new Error('Trace result does not address the selected finding');
    }
    if (result?.apply_tool && result.apply_tool !== action.apply_tool) {
      throw new Error('Trace result belongs to a different apply tool');
    }
    const evidence = result?.trace_investigate ?? {};
    trace.fields = careTraceEvidenceFields.filter(([key]) => evidence[key] != null)
      .flatMap(([key, label]) => {
        if (key === 'support_ticket') {
          const metadata = evidence[key].match(/\bRoot\s+cause:\s*([^,\r\n]+),\s*confidence(?:\s*:\s*|\s+)([a-z][a-z_-]*)\.?\s*$/i);
          if (metadata && metadata[1].trim()) {
            const body = evidence[key].slice(0, metadata.index).trim();
            return [
              ...(body ? [[label, body]] : []),
              ['Root Cause', metadata[1].trim()], ['Confidence', metadata[2]],
            ];
          }
        }
        return [[label, key === 'route' ? careHumanize(evidence[key]) : evidence[key]]];
      });
    if (trace.fields.length) {
      trace.status = 'done';
    } else {
      console.warn('No trace investigation details found for the selected action.');
      trace.status = 'error';
      trace.error = `No trace details found for ${actionId} in apply-log.json. Update the file and retry Trace & Investigate.`;
    }
  } catch (error) {
    if (careTraceInvestigations.get(actionId) !== trace) return;
    console.error('Concierge trace investigation could not be loaded.', error.name);
    trace.status = 'error';
    trace.error = `Tracing could not be completed for ${actionId}. Check that apply-log.json is next to the v4 HTML and contains valid trace details for this concierge, then retry Trace & Investigate.`;
  }
  if (state.page === 'health' && careAnalysis.selectedFinding === index && careAnalysis.tab === 'remediate') render();
}

function resetCareAttribution(preserveApprovals = false) {
  resetCareCertification();
  if (preserveApprovals) {
    for (const [id, trace] of careTraceInvestigations) {
      if (trace.status === 'loading') careTraceInvestigations.delete(id);
    }
    for (const [id, review] of careFixReviews) {
      if (review.status === 'processing') careFixReviews.delete(id);
    }
  } else {
    careTraceInvestigations.clear();
    careFixReviews.clear();
    careAttribution.doc = null;
  }
  careAttribution.request++;
  careAttribution.status = 'idle';
  careAttribution.error = '';
  careAttribution.findingIndex = null;
}

async function loadCareRemediationPlan() {
  return validateCareRemediationPlan(await loadCareJson('remediation-plan.json'));
}

async function runCareAttribution() {
  const index = careAnalysis.selectedFinding;
  if (careAttribution.status === 'loading' && careAttribution.findingIndex === index) return;
  const previousDoc = careAttribution.doc;
  resetCareAttribution(true);
  const request = careAttribution.request;
  careAttribution.status = 'loading';
  careAttribution.error = '';
  careAttribution.findingIndex = index;
  render();
  try {
    const [doc] = await Promise.all([
      loadCareRemediationPlan(),
      new Promise(resolve => setTimeout(resolve, 3600)),
    ]);
    if (request !== careAttribution.request) return;
    if (doc.concierge_id && careAnalysis.doc.concierge_id && doc.concierge_id !== careAnalysis.doc.concierge_id) {
      throw new Error('Remediation plan belongs to a different concierge');
    }
    if (previousDoc && previousDoc.concierge_id === doc.concierge_id) {
      for (const action of previousDoc.actions) {
        const next = doc.actions.find(item => item.id === action.id);
        if (JSON.stringify(action) !== JSON.stringify(next)) {
          careFixReviews.delete(action.id);
          careTraceInvestigations.delete(action.id);
        }
      }
    } else {
      careFixReviews.clear();
      careTraceInvestigations.clear();
    }
    careAttribution.doc = doc;
    careAttribution.status = 'done';
  } catch (error) {
    if (request !== careAttribution.request) return;
    console.error('Concierge remediation plan could not be loaded.', error.name);
    careAttribution.doc = null;
    careFixReviews.clear();
    careTraceInvestigations.clear();
    careAttribution.status = 'error';
    careAttribution.error = location.protocol === 'file:'
      ? 'Open v4 using a local HTTP preview, such as VS Code Live Server. The browser cannot read remediation-plan.json when the HTML is opened as a local file.'
      : 'The remediation plan could not be loaded. Check that remediation-plan.json is next to the v4 HTML and contains valid data for this concierge, then select Attribute or Remediate to retry.';
  }
  if (state.page === 'health' && careAnalysis.selectedFinding === index &&
      ['attribute', 'remediate'].includes(careAnalysis.tab)) {
    render();
    document.getElementById('care-investigation-title').focus();
  }
}
