const { buildOrderSourceRuleSet } = require("../../runtime/tracker/order-source-rule-core.cjs");

function buildOrderSourceCoverage(value = {}) {
  const skillAudit = value.skillAudit && typeof value.skillAudit === "object" ? value.skillAudit : null;
  const reports = array(value.reports);
  const reportProblems = array(value.reportProblems);
  const parseErrors = array(value.parseErrors);
  const generatedAt = value.generatedAt || new Date().toISOString();
  const orderSourceRuleSet = buildOrderSourceRuleSet(array(skillAudit?.skills), { sampleLimit: 200 });
  const rows = orderSourceRuleSet.rules
    .map(coverageRow)
    .sort((a, b) => a.spellId - b.spellId || a.name.localeCompare(b.name));
  const byId = new Map(rows.map((row) => [row.spellId, row]));
  const unexpectedObserved = [];

  for (const report of reports) {
    const recording = compactRecording(report);
    const observedRows = uniqueRows(array(report?.manualOrderSourceReview?.observedSkills), (row) => Number(row?.id || row?.spellId || 0));
    for (const observed of observedRows) {
      const id = Number(observed?.id || observed?.spellId || 0);
      const target = byId.get(id);
      if (!target) {
        unexpectedObserved.push({
          recordingDir: report?.recordingDir || "",
          id,
          name: observed?.name || "",
          status: observed?.status || ""
        });
        continue;
      }
      applyObservation(target, observed, recording);
    }
  }

  for (const row of rows) {
    finalizeRow(row);
  }

  const coveredRows = rows.filter((row) => row.status === "ready-for-manual-review");
  const observedMissingEvidenceRows = rows.filter((row) => row.status === "observed-missing-evidence");
  const observedNeedsManualRows = rows.filter((row) => row.status === "observed-needs-manual-review");
  const notObservedRows = rows.filter((row) => row.status === "not-observed");
  const problems = [
    ...reportProblems,
    ...parseErrors.map((error) => ({
      severity: "error",
      id: "parse-error",
      message: error.message || "parse error",
      path: error.path || "",
      line: error.line ?? null
    }))
  ];
  if (!skillAudit) {
    problems.push({
      severity: "error",
      id: "skill-audit-missing",
      message: "skill audit is required to build the order/source coverage queue"
    });
  }
  if (!orderSourceRuleSet.count) {
    problems.push({
      severity: "error",
      id: "order-source-queue-empty",
      message: "order/source rule queue is empty"
    });
  }
  if (orderSourceRuleSet.mappingIncompleteCount) {
    problems.push({
      severity: "error",
      id: "order-source-rule-mapping-incomplete",
      message: "some order/source-sensitive skills have categories without operation mapping",
      count: orderSourceRuleSet.mappingIncompleteCount,
      unmappedCategoryCounts: orderSourceRuleSet.unmappedCategoryCounts || {}
    });
  }
  if (!reports.length) {
    problems.push({
      severity: "warn",
      id: "recordings-empty",
      message: "no recording reports were available"
    });
  }

  const ok = problems.every((problem) => problem.severity !== "error");
  const coverageComplete = rows.length > 0 && coveredRows.length === rows.length;

  return {
    ok,
    coverageComplete,
    gateOk: ok && coverageComplete,
    source: {
      skillAudit: value.skillAuditPath || "",
      recordingsRoot: value.recordingsRoot || "",
      recordingDirs: array(value.recordingDirs)
    },
    generatedAt,
    counts: {
      recordings: reports.length,
      queue: rows.length,
      rules: orderSourceRuleSet.count,
      readyForReview: coveredRows.length,
      observedMissingEvidence: observedMissingEvidenceRows.length,
      observedNeedsManualReview: observedNeedsManualRows.length,
      notObserved: notObservedRows.length,
      observed: rows.filter((row) => row.observed).length,
      unexpectedObserved: unexpectedObserved.length,
      reportProblems: reportProblems.length,
      parseErrors: parseErrors.length,
      mappingIncomplete: Number(orderSourceRuleSet.mappingIncompleteCount || 0)
    },
    byStatus: countBy(rows, (row) => row.status),
    operateCounts: orderSourceRuleSet.operateCounts,
    orderCounts: orderSourceRuleSet.orderCounts,
    evidenceCheckCounts: orderSourceRuleSet.evidenceCheckCounts,
    requiredSources: orderSourceRuleSet.requiredSources,
    recordings: reports.map(compactRecording),
    rows,
    readyForReview: coveredRows,
    observedMissingEvidence: observedMissingEvidenceRows,
    observedNeedsManualReview: observedNeedsManualRows,
    notObserved: notObservedRows,
    unexpectedObserved,
    nextActions: nextActions({ notObservedRows, observedMissingEvidenceRows, observedNeedsManualRows }),
    problems
  };
}

function coverageRow(rule) {
  return {
    id: Number(rule.id || rule.spellId || 0),
    spellId: Number(rule.spellId || rule.id || 0),
    name: rule.name || "",
    owners: array(rule.owners),
    categories: array(rule.categories),
    operate: rule.operate || "",
    order: rule.order || "",
    primaryOperate: rule.primaryOperate || "",
    primaryOrder: rule.primaryOrder || "",
    requiredSources: array(rule.requiredSources),
    evidenceChecks: array(rule.evidenceChecks),
    operations: array(rule.operations),
    mappingComplete: rule.mappingComplete === true,
    unmappedCategories: array(rule.unmappedCategories),
    status: "not-observed",
    observed: false,
    recordingCount: 0,
    observationCount: 0,
    evidenceRows: 0,
    observedRecordings: [],
    readyForReviewRecordings: [],
    missingEvidenceRecordings: [],
    needsManualReviewRecordings: [],
    evidenceCheckSummary: {},
    sampleObservations: []
  };
}

function applyObservation(target, observed, recording) {
  target.observed = true;
  target.recordingCount += 1;
  target.observationCount += Number(observed.observationCount || 0);
  target.evidenceRows += Number(observed.evidenceRows || 0);
  target.observedRecordings.push(recording);
  if (observed.status === "ready-for-manual-review") target.readyForReviewRecordings.push(recording);
  else if (observed.status === "observed-missing-evidence") target.missingEvidenceRecordings.push(recording);
  else if (observed.status === "observed-needs-manual-review") target.needsManualReviewRecordings.push(recording);
  for (const check of array(observed.evidenceChecks)) {
    const key = check.key || "unknown";
    const current = target.evidenceCheckSummary[key] || {
      key,
      categories: array(check.categories),
      requiredSources: array(check.requiredSources),
      hasEvidence: false,
      evidenceRows: 0,
      recordings: []
    };
    current.hasEvidence = current.hasEvidence || check.hasEvidence === true;
    current.evidenceRows += Number(check.evidenceRows || 0);
    if (check.hasEvidence === true) current.recordings.push(recording);
    target.evidenceCheckSummary[key] = current;
  }
  target.sampleObservations.push(...array(observed.observations).slice(-4).map((item) => ({
    ...item,
    recordingDir: recording.recordingDir
  })));
}

function finalizeRow(row) {
  row.recordingCount = row.observedRecordings.length;
  row.observedRecordings = uniqueRecordings(row.observedRecordings);
  row.readyForReviewRecordings = uniqueRecordings(row.readyForReviewRecordings);
  row.missingEvidenceRecordings = uniqueRecordings(row.missingEvidenceRecordings);
  row.needsManualReviewRecordings = uniqueRecordings(row.needsManualReviewRecordings);
  row.evidenceCheckSummary = Object.values(row.evidenceCheckSummary).map((item) => ({
    ...item,
    recordings: uniqueRecordings(item.recordings)
  }));
  row.sampleObservations = row.sampleObservations.slice(-12);
  if (row.readyForReviewRecordings.length) row.status = "ready-for-manual-review";
  else if (row.missingEvidenceRecordings.length) row.status = "observed-missing-evidence";
  else if (row.needsManualReviewRecordings.length) row.status = "observed-needs-manual-review";
  else row.status = "not-observed";
}

function compactRecording(report) {
  const review = report?.manualOrderSourceReview || {};
  return {
    recordingDir: report?.recordingDir || "",
    ok: report?.ok === true,
    observedCount: Number(review.observedCount || 0),
    readyForReviewCount: Number(review.readyForReviewCount || 0),
    missingEvidenceCount: Number(review.missingEvidenceCount || 0),
    notObservedCount: Number(review.notObservedCount || 0),
    problemCount: array(report?.problems).length
  };
}

function nextActions({ notObservedRows, observedMissingEvidenceRows, observedNeedsManualRows }) {
  const actions = [];
  if (notObservedRows.length) {
    actions.push({
      id: "record-not-observed-order-source-skills",
      count: notObservedRows.length,
      skillIds: notObservedRows.slice(0, 40).map((row) => row.spellId),
      reason: "these order/source-sensitive skills have not appeared in the analyzed recordings"
    });
  }
  if (observedMissingEvidenceRows.length) {
    actions.push({
      id: "record-required-source-evidence",
      count: observedMissingEvidenceRows.length,
      skillIds: observedMissingEvidenceRows.slice(0, 40).map((row) => row.spellId),
      reason: "these skills appeared but the accepted source/order evidence was absent"
    });
  }
  if (observedNeedsManualRows.length) {
    actions.push({
      id: "map-unhandled-order-source-category",
      count: observedNeedsManualRows.length,
      skillIds: observedNeedsManualRows.slice(0, 40).map((row) => row.spellId),
      reason: "these skills appeared with categories that need an explicit evidence check"
    });
  }
  return actions;
}

function uniqueRecordings(recordings) {
  return uniqueRows(recordings, (row) => row.recordingDir || "").slice(-20);
}

function uniqueRows(rows, keyOf) {
  const result = [];
  const seen = new Set();
  for (const row of array(rows)) {
    const key = keyOf(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function countBy(rows, keyOf) {
  const result = {};
  for (const row of array(rows)) {
    const key = keyOf(row);
    if (!key) continue;
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildOrderSourceCoverage
};
