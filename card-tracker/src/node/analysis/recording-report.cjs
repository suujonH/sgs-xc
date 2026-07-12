const { OLD_PROTOCOLS } = require("../../runtime/sources/protocol-normalizer-core.cjs");
const { moveRow, skillEventRow, planRow } = require("./protocol-flow-report.cjs");
const { buildOrderSourceRuleSet } = require("../../runtime/tracker/order-source-rule-core.cjs");

const CARD_RELEVANT_PROTOCOLS = new Set([
  "PubGsCMoveCard",
  "PubGsCUseCard",
  "PubGsCUseSpell",
  "GsCGamephaseNtf",
  "MsgGameTurnNtf",
  "MsgGameRoundNtf",
  "decodeMsgSetGamePhaseNtf",
  "GsCUpdateRoleDataNtf",
  "GsCUpdateRoleDataExNtf",
  "MsgGamePlayCardNtf",
  "ClientHappyGetFriendHandcardRep",
  "GsCModifyUserseatNtf",
  "SmsgGamePlayerDead",
  "GsCRoleOptTargetNtf",
  "GsCRoleOptNtf"
]);

const PROTOCOL_LISTED_EXACT_CATEGORIES = ["random.card.gain", "deck.search"];
const PROTOCOL_LISTED_JUDGEMENT_VIRTUAL_PINDIAN_CATEGORIES = ["judgement.replace", "judgement.gain", "virtual.transform", "pindian"];
const DECK_ENDPOINT_SOURCE_CATEGORIES = ["deck.top.reveal", "deck.bottom.reveal", "deck.top.put", "deck.bottom.put", "draw.bottom", "judgement.any"];
const KNOWN_HAND_MOVEMENT_CATEGORIES = ["hand.transfer", "hand.discard", "resolved.card.gain"];
const PUBLIC_ZONE_SOURCE_CHECKS = [
  { key: "publicEquip", category: "public.equip", zoneName: "equip", rule: "public-equip-runtime", warningId: "public-equip-without-public-zone-evidence" },
  { key: "publicJudge", category: "public.judge", zoneName: "judge", rule: "public-judge-runtime", warningId: "public-judge-without-public-zone-evidence" },
  { key: "publicGeneral", category: "public.general", zoneName: "general", rule: "public-general-runtime", warningId: "public-general-without-public-zone-evidence" }
];

function buildRecordingReport(value = {}) {
  const recordingDir = value.recordingDir || "";
  const files = normalizeFiles(value.files);
  const summary = value.summary && typeof value.summary === "object" ? value.summary : null;
  const metaRows = array(value.metaRows);
  const protocolRows = array(value.protocolRows);
  const consoleProtocolRows = array(value.consoleProtocolRows);
  const snapshotRows = array(value.snapshotRows);
  const reportRows = array(value.reportRows);
  const parseErrors = array(value.parseErrors);
  const skillAudit = value.skillAudit && typeof value.skillAudit === "object" ? value.skillAudit : null;
  const skillAuditIndex = buildSkillAuditIndex(skillAudit);
  const records = protocolRows.map((row) => row?.record || row).filter((record) => record?.name);
  const consoleRecords = consoleProtocolRows.map((row) => row?.record || row).filter((record) => record?.name);
  const snapshots = snapshotRows.map(snapshotValue).filter(Boolean);
  const reportValues = reportRows.map((row) => row?.reports || row).filter(Boolean);
  const validations = reportRows.map((row) => row?.validation).filter(Boolean);
  const plans = collectPlans(snapshots, reportValues);
  const planByRecordIndex = new Map(plans.map((plan) => [Number(plan.recordIndex), plan]));
  const cardMoves = records
    .filter((record) => record?.parsed?.type === "card:move")
    .map((record) => moveRow(record, planByRecordIndex.get(Number(record.index))));
  const recordSkillEvents = records
    .filter((record) => record?.parsed?.skillRule || Number(record?.parsed?.skillId || 0) > 0)
    .map((record) => skillEventRow({
      time: record.time || null,
      protocol: record.name || record.parsed?.protocol || "",
      type: record.parsed?.type || "",
      skillId: record.parsed?.skillId || 0,
      skillRule: record.parsed?.skillRule || null
    }));
  const runtimeSkillEvents = snapshots.flatMap((snapshot) => array(snapshot.protocol?.recentSkillEvents).map(skillEventRow));
  const skillEvents = uniqueRows([...recordSkillEvents, ...runtimeSkillEvents], (row) => [
    row.time || "",
    row.protocol || "",
    row.type || "",
    row.skillId || 0
  ].join(":")).map((row) => enrichSkillRow(row, skillAuditIndex));
  const observedSkillIds = observedSkillIdList(records, skillEvents, plans);
  const skillCatalog = observedSkillIds.map((id) => skillCatalogRow(id, skillAuditIndex)).filter(Boolean);
  const observedProtocols = Array.from(new Set(records.map((record) => record.name))).sort();
  const observedConsoleProtocols = Array.from(new Set(consoleRecords.map((record) => record.name))).sort();
  const consoleOnlyProtocols = observedConsoleProtocols.filter((name) => !observedProtocols.includes(name));
  const normalizerProtocols = new Set(OLD_PROTOCOLS);
  const missingFromNormalizer = observedProtocols.filter((name) => !normalizerProtocols.has(name));
  const normalizerNotObserved = OLD_PROTOCOLS.filter((name) => !observedProtocols.includes(name));
  const protocolFlowProblems = collectProtocolFlowProblems(reportRows);
  const validationFailures = collectValidationFailures(reportRows);
  const legacyMismatches = collectLegacyMismatches(reportRows);
  const handSources = collectHandSources(reportRows);
  const publicZones = collectPublicZones(reportRows);
  const protocolZoneLedger = collectProtocolZoneLedger(snapshots, reportValues);
  const knownHandLedgerEvents = collectKnownHandLedgerEvents(snapshots);
  const sourceChecks = collectSourceChecks({ skillEvents, handSources, publicZones, protocolZoneLedger, cardMoves, plans });
  const manualOrderSourceReview = collectManualOrderSourceReview({ skillAudit, skillEvents, plans, sourceChecks });
  const problems = problemRows({
    files,
    parseErrors,
    records,
    consoleOnlyProtocols,
    missingFromNormalizer,
    protocolFlowProblems,
    validationFailures,
    legacyMismatches,
    handSources,
    publicZones,
    sourceChecks
  });

  return {
    ok: problems.every((problem) => problem.severity !== "error"),
    recordingDir,
    files,
    meta: metaSummary(summary, metaRows),
    counts: {
      protocolRecords: records.length,
      consoleProtocolRecords: consoleRecords.length,
      snapshots: snapshotRows.length,
      reports: reportRows.length,
      visibleSnapshots: snapshots.filter((snapshot) => snapshot.visible === true).length,
      uniqueProtocols: observedProtocols.length,
      uniqueConsoleProtocols: observedConsoleProtocols.length,
      consoleOnlyProtocols: consoleOnlyProtocols.length,
      missingNormalizerProtocols: missingFromNormalizer.length,
      cardRelevantProtocols: observedProtocols.filter((name) => CARD_RELEVANT_PROTOCOLS.has(name)).length,
      cardMoves: cardMoves.length,
      cardMovesWithKnownIds: cardMoves.filter((row) => row.knownCardIds.length > 0).length,
      cardMovesWithUnknownCount: cardMoves.filter((row) => row.unknownCount > 0).length,
      skillEvents: skillEvents.length,
      rulePlans: plans.length,
      orderSourceSensitivePlans: plans.filter((plan) => plan.orderSourceSensitive === true || plan.manualReview === true).length,
      manualReviewPlans: plans.filter((plan) => plan.manualReview === true).length,
      manualOrderSourceQueuedSkills: manualOrderSourceReview.queueCount,
      manualOrderSourceObservedSkills: manualOrderSourceReview.observedCount,
      manualOrderSourceReadyForReview: manualOrderSourceReview.readyForReviewCount,
      manualOrderSourceMissingEvidence: manualOrderSourceReview.missingEvidenceCount,
      observedSkills: observedSkillIds.length,
      skillAuditMatches: skillCatalog.filter((row) => row.auditMatched === true).length,
      skillAuditMissing: skillCatalog.filter((row) => row.auditMatched === false).length,
      handSourceReportRows: handSources.reportRows,
      maskRawMax: handSources.mask.rawMax,
      maskLedgerMax: handSources.mask.ledgerMax,
      protocolAuthorizedLedgerMax: handSources.protocolAuthorized.ledgerMax,
      handSourceProblemRows: handSources.problemRows,
      knownHandLedgerEvents: knownHandLedgerEvents.eventCount,
      knownHandLedgerRemoveKnownEvents: knownHandLedgerEvents.removeKnownEvents,
      knownHandLedgerInvalidateSeatEvents: knownHandLedgerEvents.invalidateSeatEvents,
      knownHandLedgerAddProtocolKnownEvents: knownHandLedgerEvents.addProtocolKnownEvents,
      handWatchSkillEvents: sourceChecks.handWatch.eventCount,
      handWatchSourceEvidenceRows: sourceChecks.handWatch.sourceEvidenceRows,
      handShowSkillEvents: sourceChecks.handShow.eventCount,
      handShowSourceEvidenceRows: sourceChecks.handShow.sourceEvidenceRows,
      knownHandMovementObservations: sourceChecks.knownHandMovement.observedCount,
      knownHandMovementSourceEvidenceRows: sourceChecks.knownHandMovement.sourceEvidenceRows,
      protocolListedRandomSearchObservations: sourceChecks.protocolListedRandomSearch.observedCount,
      protocolListedRandomSearchProtocolIdRows: sourceChecks.protocolListedRandomSearch.protocolCardIdRows,
      protocolListedJudgementVirtualPindianObservations: sourceChecks.protocolListedJudgementVirtualPindian.observedCount,
      protocolListedJudgementVirtualPindianProtocolIdRows: sourceChecks.protocolListedJudgementVirtualPindian.protocolCardIdRows,
      deckEndpointObservations: sourceChecks.deckEndpoint.observedCount,
      deckEndpointSourceEvidenceRows: sourceChecks.deckEndpoint.sourceEvidenceRows,
      publicZoneReportRows: publicZones.reportRows,
      publicZoneCardMax: publicZones.cardMax,
      publicEquipSkillEvents: sourceChecks.publicEquip.eventCount,
      publicEquipSourceEvidenceRows: sourceChecks.publicEquip.sourceEvidenceRows,
      publicJudgeSkillEvents: sourceChecks.publicJudge.eventCount,
      publicJudgeSourceEvidenceRows: sourceChecks.publicJudge.sourceEvidenceRows,
      publicGeneralSkillEvents: sourceChecks.publicGeneral.eventCount,
      publicGeneralSourceEvidenceRows: sourceChecks.publicGeneral.sourceEvidenceRows,
      protocolZoneLedgerRows: protocolZoneLedger.reportRows,
      protocolZoneMoveMax: protocolZoneLedger.moveMax,
      protocolZoneKnownLocationMax: protocolZoneLedger.knownLocationMax,
      protocolZoneDeckTopMax: protocolZoneLedger.deckTopMax,
      protocolZoneDeckBottomMax: protocolZoneLedger.deckBottomMax,
      protocolZoneDeckInvalidationMax: protocolZoneLedger.deckInvalidationMax,
      validationRows: validations.length,
      validationFailures: validationFailures.length,
      protocolFlowProblems: protocolFlowProblems.length,
      legacyMismatches: legacyMismatches.length,
      parseErrors: parseErrors.length
    },
    protocols: {
      observed: observedProtocols,
      byName: countBy(records, (record) => record.name || ""),
      byEventType: countBy(records, (record) => record.parsed?.type || "unparsed"),
      bySkillId: countBy(records, (record) => skillIdKey(record.parsed?.skillId)),
      byCategory: countCategories(records),
      cardRelevantObserved: observedProtocols.filter((name) => CARD_RELEVANT_PROTOCOLS.has(name)),
      missingFromNormalizer,
      normalizerNotObserved,
      console: {
        observed: observedConsoleProtocols,
        byName: countBy(consoleRecords, (record) => record.name || ""),
        byEventType: countBy(consoleRecords, (record) => record.parsed?.type || "unparsed"),
        bySkillId: countBy(consoleRecords, (record) => skillIdKey(record.parsed?.skillId)),
        byCategory: countCategories(consoleRecords),
        onlyInConsole: consoleOnlyProtocols,
        samples: consoleRecords.slice(-40).map(protocolCompact)
      }
    },
    cardMoves: {
      total: cardMoves.length,
      byFrom: countBy(cardMoves, (row) => zoneKey(row.from)),
      byTo: countBy(cardMoves, (row) => zoneKey(row.to)),
      bySkillId: countBy(cardMoves, (row) => skillIdKey(row.skillId)),
      samples: cardMoves.slice(-80)
    },
    skills: {
      events: skillEvents.slice(-80),
      bySkillId: countBy(skillEvents, (row) => skillIdKey(row.skillId)),
      byCategory: countBy(skillEvents.flatMap((row) => row.categories || []), (category) => category),
      planActions: countBy(plans.flatMap((plan) => plan.actions || []), (action) => action),
      catalog: skillCatalog,
      audit: skillAudit ? {
        source: skillAudit.source || "",
        generatedAt: skillAudit.generatedAt || "",
        totalSkills: Number(skillAudit.counts?.totalSkills || array(skillAudit.skills).length || 0)
      } : null,
      orderSourceSensitivePlans: plans.filter((plan) => plan.orderSourceSensitive === true || plan.manualReview === true).slice(-40).map(planRow),
      manualReviewPlans: plans.filter((plan) => plan.manualReview === true).slice(-40).map(planRow),
      plans: plans.slice(-80).map(planRow)
    },
    handSources,
    knownHandLedgerEvents,
    publicZones,
    sourceChecks,
    manualOrderSourceReview,
    protocolZoneLedger,
    validation: {
      statusCounts: countBy(validations, (validation) => validation.status || (validation.ok ? "ok" : "failed")),
      failures: validationFailures.slice(-80)
    },
    reports: {
      protocolFlowProblems: protocolFlowProblems.slice(-80),
      legacyMismatches: legacyMismatches.slice(-80),
      latestHandSourceCounts: lastReport(reportValues, "handSourceReport")?.counts || null,
      latestPublicZoneCounts: lastReport(reportValues, "publicZoneReport")?.counts || null,
      latestLegacyComparisonCounts: lastReport(reportValues, "legacyComparisonReport")?.counts || null,
      latestProtocolFlowCounts: lastReport(reportValues, "protocolFlowReport")?.counts || null
    },
    timeline: timelineSummary(summary, metaRows, protocolRows, snapshots),
    problems
  };
}

function buildSkillAuditIndex(skillAudit) {
  const index = new Map();
  for (const skill of array(skillAudit?.skills)) {
    const id = Number(skill?.id || 0);
    if (id > 0) index.set(id, skill);
  }
  return index;
}

function observedSkillIdList(records, skillEvents, plans) {
  const ids = [
    ...records.map((record) => record?.parsed?.skillId),
    ...skillEvents.map((event) => event.skillId),
    ...plans.map((plan) => plan.skillId),
    ...plans.map((plan) => plan.effectiveSkillId)
  ];
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b);
}

function enrichSkillRow(row, skillAuditIndex) {
  const audit = skillAuditIndex.get(Number(row.skillId || 0));
  if (!audit) return row;
  return {
    ...row,
    skillName: row.skillName || audit.name || "",
    auditStrategy: strategyId(audit.strategy),
    owners: ownerNames(audit.owners),
    reviewReasons: array(audit.reviewReasons),
    legacySpecialRule: audit.legacySpecialRule || ""
  };
}

function skillCatalogRow(id, skillAuditIndex) {
  const skill = skillAuditIndex.get(Number(id));
  if (!skill) {
    return {
      id: Number(id),
      auditMatched: false
    };
  }
  return {
    id: Number(skill.id),
    auditMatched: true,
    name: skill.name || "",
    sourceType: skill.sourceType || "",
    owners: ownerNames(skill.owners),
    ownerCount: Number(skill.ownerCount || array(skill.owners).length || 0),
    categories: array(skill.categories).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean),
    actions: array(skill.actions),
    strategy: strategyId(skill.strategy),
    confidence: skill.confidence || "",
    priority: skill.priority || "",
    reviewReasons: array(skill.reviewReasons),
    legacySpecialRule: skill.legacySpecialRule || ""
  };
}

function strategyId(strategy) {
  return typeof strategy === "string" ? strategy : strategy?.id || "";
}

function ownerNames(owners) {
  return array(owners).map((owner) => owner?.name || owner?.className || "").filter(Boolean);
}

function problemRows({ files, parseErrors, records, consoleOnlyProtocols, missingFromNormalizer, protocolFlowProblems, validationFailures, legacyMismatches, handSources, publicZones, sourceChecks }) {
  const rows = [];
  for (const name of ["meta", "protocolRecords", "snapshots", "reports", "summary"]) {
    if (files[name] && files[name].exists === false) {
      rows.push({ severity: name === "summary" ? "warn" : "error", id: `missing-${name}`, message: `${name} file is missing`, path: files[name].path || "" });
    }
  }
  for (const error of parseErrors) {
    rows.push({ severity: "error", id: "json-parse-error", message: error.message || "JSON parse error", path: error.path || "", line: error.line || null });
  }
  if (records.length === 0) {
    rows.push({ severity: "info", id: "no-protocol-records", message: "recording has no deduplicated protocol records" });
  }
  if (missingFromNormalizer.length > 0) {
    rows.push({
      severity: "warn",
      id: "observed-protocol-missing-normalizer",
      message: "observed protocols are not in the migrated normalizer list",
      protocols: missingFromNormalizer
    });
  }
  if (consoleOnlyProtocols.length > 0) {
    rows.push({
      severity: "info",
      id: "console-protocols-not-in-proxy-records",
      message: "console audit saw protocols that were not retained in proxy protocol records",
      protocols: consoleOnlyProtocols
    });
  }
  if (validationFailures.length > 0) {
    rows.push({ severity: "warn", id: "validation-failures", message: "recording report rows contain failed validation checks", count: validationFailures.length });
  }
  if (protocolFlowProblems.length > 0) {
    rows.push({ severity: "warn", id: "protocol-flow-problems", message: "protocol flow sidecar reported problems", count: protocolFlowProblems.length });
  }
  if (legacyMismatches.length > 0) {
    rows.push({ severity: "info", id: "legacy-comparison-mismatches", message: "legacy comparison sidecar reported mismatches", count: legacyMismatches.length });
  }
  if (handSources?.mask?.problemCount > 0) {
    rows.push({ severity: "warn", id: "hand-source-mask-problems", message: "mask hand-source provenance problems were recorded", count: handSources.mask.problemCount });
  }
  if (handSources?.protocolAuthorized?.problemCount > 0) {
    rows.push({ severity: "warn", id: "hand-source-protocol-authorized-problems", message: "protocol-authorized hand-source provenance problems were recorded", count: handSources.protocolAuthorized.problemCount });
  }
  if (publicZones?.problemCount > 0) {
    rows.push({ severity: "warn", id: "public-zone-source-problems", message: "public-zone provenance problems were recorded", count: publicZones.problemCount });
  }
  if (sourceChecks?.handWatch?.eventCount > 0 && sourceChecks.handWatch.hasAllowedEvidence !== true) {
    rows.push({
      severity: "warn",
      id: "hand-watch-without-source-evidence",
      message: "hand.watch skill events were observed but no mask or protocol-authorized hand source evidence was recorded",
      count: sourceChecks.handWatch.eventCount,
      skillIds: Object.keys(sourceChecks.handWatch.bySkillId || {})
    });
  }
  if (sourceChecks?.handShow?.eventCount > 0 && sourceChecks.handShow.hasAllowedEvidence !== true) {
    rows.push({
      severity: "warn",
      id: "hand-show-without-source-evidence",
      message: "hand.show skill events were observed but no visible card UI or public reveal protocol evidence was recorded",
      count: sourceChecks.handShow.eventCount,
      skillIds: Object.keys(sourceChecks.handShow.bySkillId || {})
    });
  }
  if (sourceChecks?.knownHandMovement?.observedCount > 0 && sourceChecks.knownHandMovement.hasKnownHandMovementEvidence !== true) {
    rows.push({
      severity: "warn",
      id: "known-hand-movement-without-source-evidence",
      message: "hand movement or resolved-card gain categories were observed but no known hand source or protocol-listed card id evidence was recorded",
      count: sourceChecks.knownHandMovement.observedCount,
      categories: Object.keys(sourceChecks.knownHandMovement.byCategory || {})
    });
  }
  if (sourceChecks?.protocolListedRandomSearch?.observedCount > 0 && sourceChecks.protocolListedRandomSearch.hasProtocolCardIds !== true) {
    rows.push({
      severity: "warn",
      id: "protocol-listed-random-search-without-card-id",
      message: "random.card.gain or deck.search was observed but no matching protocol-listed card id evidence was recorded",
      count: sourceChecks.protocolListedRandomSearch.observedCount,
      categories: Object.keys(sourceChecks.protocolListedRandomSearch.byCategory || {})
    });
  }
  if (sourceChecks?.protocolListedJudgementVirtualPindian?.observedCount > 0 && sourceChecks.protocolListedJudgementVirtualPindian.hasProtocolCardIds !== true) {
    rows.push({
      severity: "warn",
      id: "protocol-listed-judgement-virtual-pindian-without-card-id",
      message: "judgement, virtual transform, or pindian exact-identity categories were observed but no matching protocol-listed card id evidence was recorded",
      count: sourceChecks.protocolListedJudgementVirtualPindian.observedCount,
      categories: Object.keys(sourceChecks.protocolListedJudgementVirtualPindian.byCategory || {})
    });
  }
  if (sourceChecks?.deckEndpoint?.observedCount > 0 && sourceChecks.deckEndpoint.hasDeckEndpointEvidence !== true) {
    rows.push({
      severity: "warn",
      id: "deck-endpoint-without-source-evidence",
      message: "deck endpoint categories were observed but no matching protocol-listed deck endpoint evidence was recorded",
      count: sourceChecks.deckEndpoint.observedCount,
      categories: Object.keys(sourceChecks.deckEndpoint.byCategory || {})
    });
  }
  for (const item of PUBLIC_ZONE_SOURCE_CHECKS) {
    const check = sourceChecks?.[item.key];
    if (check?.eventCount > 0 && check.hasPublicZoneEvidence !== true) {
      rows.push({
        severity: "warn",
        id: item.warningId,
        message: `${item.category} skill events were observed but no ${item.rule} evidence was recorded`,
        count: check.eventCount,
        skillIds: Object.keys(check.bySkillId || {})
      });
    }
  }
  return rows;
}

function metaSummary(summary, metaRows) {
  const start = metaRows.find((row) => row?.type === "start") || {};
  const stop = metaRows.findLast?.((row) => row?.type === "stop") || metaRows.slice().reverse().find((row) => row?.type === "stop") || {};
  return {
    startedAt: summary?.startedAt || start.ts || "",
    finishedAt: summary?.finishedAt || stop.ts || "",
    elapsedMs: Number(summary?.elapsedMs || stop.elapsedMs || 0),
    durationMs: Number(summary?.durationMs || start.durationMs || 0),
    intervalMs: Number(summary?.intervalMs || start.intervalMs || 0),
    snapshotEveryMs: Number(summary?.snapshotEveryMs || start.snapshotEveryMs || 0),
    installFirst: summary?.installFirst ?? start.installFirst ?? null,
    installTarget: summary?.installTarget || start.installTarget || null,
    ticks: Number(summary?.ticks || 0),
    firstVisibleAt: summary?.firstVisibleAt || "",
    lastVisible: summary?.lastVisible === true
  };
}

function timelineSummary(summary, metaRows, protocolRows, snapshots) {
  const firstProtocol = protocolRows.find((row) => row?.record) || null;
  const lastProtocol = protocolRows.slice().reverse().find((row) => row?.record) || null;
  const firstVisible = snapshots.find((snapshot) => snapshot.visible === true) || null;
  return {
    startedAt: summary?.startedAt || metaRows.find((row) => row?.type === "start")?.ts || "",
    finishedAt: summary?.finishedAt || metaRows.slice().reverse().find((row) => row?.type === "stop")?.ts || "",
    firstVisibleAt: summary?.firstVisibleAt || firstVisible?.readAt || "",
    lastVisible: summary?.lastVisible === true,
    firstProtocolAt: firstProtocol?.ts || "",
    lastProtocolAt: lastProtocol?.ts || "",
    firstProtocol: firstProtocol?.record ? protocolCompact(firstProtocol.record) : null,
    lastProtocol: lastProtocol?.record ? protocolCompact(lastProtocol.record) : null
  };
}

function protocolCompact(record) {
  return {
    index: record.index ?? null,
    name: record.name || "",
    type: record.parsed?.type || "",
    skillId: Number(record.parsed?.skillId || 0),
    categories: categoryIds(record.parsed?.skillRule)
  };
}

function collectPlans(snapshots, reportValues) {
  const rows = [
    ...snapshots.flatMap((snapshot) => array(snapshot.rulePlanner?.recentPlans)),
    ...reportValues.flatMap((reports) => array(reports.protocolFlowReport?.planner?.recentPlans))
  ];
  return uniqueRows(rows.map(planRow), (row) => [
    row.recordIndex ?? "",
    row.time || "",
    row.protocol || "",
    row.eventType || "",
    row.skillId || "",
    array(row.actions).join(",")
  ].join(":"));
}

function collectProtocolFlowProblems(reportRows) {
  const rows = [];
  for (const row of reportRows) {
    const problems = array(row?.reports?.protocolFlowReport?.problems || row?.protocolFlowReport?.problems);
    for (const problem of problems) {
      rows.push({
        tick: row?.tick ?? null,
        ts: row?.ts || "",
        severity: problem?.severity || "",
        id: problem?.id || "",
        message: problem?.message || "",
        actual: problem?.actual || null
      });
    }
  }
  return rows;
}

function collectValidationFailures(reportRows) {
  const rows = [];
  for (const row of reportRows) {
    for (const check of array(row?.validation?.checks)) {
      if (check?.status !== "fail" && check?.status !== "error") continue;
      rows.push({
        tick: row?.tick ?? null,
        ts: row?.ts || "",
        id: check.id || "",
        status: check.status || "",
        message: check.message || "",
        actual: check.actual || null
      });
    }
  }
  return rows;
}

function collectLegacyMismatches(reportRows) {
  const rows = [];
  for (const row of reportRows) {
    const report = row?.reports?.legacyComparisonReport || row?.legacyComparisonReport || null;
    const counts = report?.counts || {};
    const hand = Number(counts.handMismatches || 0);
    const zone = Number(counts.zoneMismatches || 0);
    if (hand || zone) {
      rows.push({ tick: row?.tick ?? null, ts: row?.ts || "", handMismatches: hand, zoneMismatches: zone });
    }
  }
  return rows;
}

function collectHandSources(reportRows) {
  const rows = [];
  const sourceOccurrences = {
    ledgerRules: {},
    ledgerUnderlyingRules: {},
    rawRules: {},
    legacySources: {}
  };
  const sourceMax = {
    ledgerRules: {},
    ledgerUnderlyingRules: {},
    rawRules: {},
    legacySources: {}
  };
  const maskExamples = [];
  const protocolExamples = [];
  const maskProblems = [];
  const protocolProblems = [];
  let maskRawMax = 0;
  let maskLedgerMax = 0;
  let protocolLedgerMax = 0;
  let problemRowsCount = 0;

  for (const row of reportRows) {
    const report = row?.reports?.handSourceReport || row?.handSourceReport || null;
    if (!report) continue;
    const mask = report.mask || {};
    const protocolAuthorized = report.protocolAuthorized || {};
    const timelineRow = {
      tick: row?.tick ?? null,
      ts: row?.ts || "",
      visible: report.visible === true,
      ledgerKnownCards: Number(report.counts?.ledgerKnownCards || 0),
      rawVisibleCards: Number(report.counts?.rawVisibleCards || 0),
      maskRaw: Number(mask.rawCount || 0),
      maskLedger: Number(mask.ledgerCount || 0),
      protocolAuthorizedLedger: Number(protocolAuthorized.ledgerCount || 0),
      legacySources: report.sources?.legacySources || {},
      ledgerUnderlyingRules: report.sources?.ledgerUnderlyingRules || {},
      rawRules: report.sources?.rawRules || {}
    };
    rows.push(timelineRow);
    maskRawMax = Math.max(maskRawMax, timelineRow.maskRaw);
    maskLedgerMax = Math.max(maskLedgerMax, timelineRow.maskLedger);
    protocolLedgerMax = Math.max(protocolLedgerMax, timelineRow.protocolAuthorizedLedger);
    mergeCountSet(sourceOccurrences.ledgerRules, report.sources?.ledgerRules);
    mergeCountSet(sourceOccurrences.ledgerUnderlyingRules, report.sources?.ledgerUnderlyingRules);
    mergeCountSet(sourceOccurrences.rawRules, report.sources?.rawRules);
    mergeCountSet(sourceOccurrences.legacySources, report.sources?.legacySources);
    maxCountSet(sourceMax.ledgerRules, report.sources?.ledgerRules);
    maxCountSet(sourceMax.ledgerUnderlyingRules, report.sources?.ledgerUnderlyingRules);
    maxCountSet(sourceMax.rawRules, report.sources?.rawRules);
    maxCountSet(sourceMax.legacySources, report.sources?.legacySources);
    pushLimited(maskExamples, array(mask.examples), 12);
    pushLimited(protocolExamples, array(protocolAuthorized.examples), 12);
    pushProblemRows(maskProblems, array(mask.rawProblems), row, "mask.raw");
    pushProblemRows(maskProblems, array(mask.ledgerProblems), row, "mask.ledger");
    pushProblemRows(protocolProblems, array(protocolAuthorized.ledgerProblems), row, "protocolAuthorized.ledger");
    if (array(mask.rawProblems).length || array(mask.ledgerProblems).length || array(protocolAuthorized.ledgerProblems).length) {
      problemRowsCount++;
    }
  }

  return {
    reportRows: rows.length,
    problemRows: problemRowsCount,
    sourceOccurrences: {
      ledgerRules: sortObject(sourceOccurrences.ledgerRules),
      ledgerUnderlyingRules: sortObject(sourceOccurrences.ledgerUnderlyingRules),
      rawRules: sortObject(sourceOccurrences.rawRules),
      legacySources: sortObject(sourceOccurrences.legacySources)
    },
    sourceMax: {
      ledgerRules: sortObject(sourceMax.ledgerRules),
      ledgerUnderlyingRules: sortObject(sourceMax.ledgerUnderlyingRules),
      rawRules: sortObject(sourceMax.rawRules),
      legacySources: sortObject(sourceMax.legacySources)
    },
    mask: {
      rawMax: maskRawMax,
      ledgerMax: maskLedgerMax,
      rawOccurrences: rows.reduce((total, row) => total + row.maskRaw, 0),
      ledgerOccurrences: rows.reduce((total, row) => total + row.maskLedger, 0),
      problemCount: maskProblems.length,
      problems: maskProblems.slice(-40),
      examples: maskExamples
    },
    protocolAuthorized: {
      ledgerMax: protocolLedgerMax,
      ledgerOccurrences: rows.reduce((total, row) => total + row.protocolAuthorizedLedger, 0),
      problemCount: protocolProblems.length,
      problems: protocolProblems.slice(-40),
      examples: protocolExamples
    },
    timeline: rows.slice(-120)
  };
}

function collectPublicZones(reportRows) {
  const rows = [];
  const byZoneMax = {};
  const byRuleMax = {};
  const examples = [];
  const problems = [];
  let cardMax = 0;
  let knownMax = 0;
  let problemRowsCount = 0;

  for (const row of reportRows) {
    const report = row?.reports?.publicZoneReport || row?.publicZoneReport || null;
    if (!report) continue;
    const counts = report.counts || {};
    const timelineRow = {
      tick: row?.tick ?? null,
      ts: row?.ts || "",
      visible: report.visible === true,
      cards: Number(counts.cards || 0),
      known: Number(counts.known || 0),
      byZone: counts.byZone || {},
      byRule: counts.byRule || {}
    };
    rows.push(timelineRow);
    cardMax = Math.max(cardMax, timelineRow.cards);
    knownMax = Math.max(knownMax, timelineRow.known);
    maxCountSet(byZoneMax, counts.byZone);
    maxCountSet(byRuleMax, counts.byRule);
    pushLimited(examples, array(report.provenance?.examples), 12);
    pushPublicZoneProblemRows(problems, array(report.provenance?.problems), row);
    if (array(report.provenance?.problems).length) problemRowsCount++;
  }

  return {
    reportRows: rows.length,
    problemRows: problemRowsCount,
    problemCount: problems.length,
    cardMax,
    knownMax,
    byZoneMax: sortObject(byZoneMax),
    byRuleMax: sortObject(byRuleMax),
    problems: problems.slice(-40),
    examples,
    timeline: rows.slice(-120)
  };
}

function collectKnownHandLedgerEvents(snapshots) {
  const rawRows = [];
  for (const snapshot of snapshots) {
    const ledger = snapshot?.knownHandLedger;
    if (!ledger || typeof ledger !== "object") continue;
    for (const event of array(ledger.recentEvents)) {
      rawRows.push(knownHandLedgerEventRow(event));
    }
  }

  const rows = uniqueRows(rawRows, knownHandLedgerEventKey);
  return {
    eventCount: rows.length,
    removeKnownEvents: rows.filter((row) => row.type === "remove-known").length,
    invalidateSeatEvents: rows.filter((row) => row.type === "invalidate-seat").length,
    addProtocolKnownEvents: rows.filter((row) => row.type === "add-protocol-known").length,
    addUnknownHandCountEvents: rows.filter((row) => row.type === "add-unknown-hand-count").length,
    replaceProtocolHandSnapshotEvents: rows.filter((row) => row.type === "replace-protocol-hand-snapshot").length,
    byType: countBy(rows, (row) => row.type || "event"),
    bySeat: countBy(rows, (row) => row.seatIndex != null ? String(row.seatIndex) : ""),
    bySkillId: countBy(rows, (row) => skillIdKey(row.skillId)),
    byCategory: countBy(rows.flatMap((row) => row.categories), (category) => category),
    byProtocol: countBy(rows, (row) => row.protocol || ""),
    byReason: countBy(rows, (row) => row.reason || ""),
    timeline: rows.slice(-120),
    samples: rows.slice(-40)
  };
}

function knownHandLedgerEventRow(event) {
  return {
    type: event?.type || "event",
    time: event?.time ?? null,
    seatIndex: event?.seatIndex ?? null,
    ids: normalizeIds(event?.ids || []),
    removed: Number(event?.removed || 0),
    added: Number(event?.added || 0),
    known: Number(event?.known || 0),
    count: Number(event?.count || 0),
    reason: event?.reason || "",
    clearKnown: event?.clearKnown === true,
    protocol: event?.protocol || "",
    recordIndex: event?.recordIndex ?? null,
    msgId: event?.msgId ?? null,
    skillId: Number(event?.skillId || 0),
    skillName: event?.skillName || "",
    categories: array(event?.categories).filter(Boolean),
    sourceRule: event?.sourceRule || ""
  };
}

function knownHandLedgerEventKey(row) {
  return [
    row.time ?? "",
    row.type || "",
    row.seatIndex ?? "",
    row.ids.join(","),
    row.reason || "",
    row.protocol || "",
    row.recordIndex ?? "",
    row.msgId ?? "",
    row.skillId || 0,
    row.categories.join(","),
    row.sourceRule || "",
    row.clearKnown === true ? "1" : "0"
  ].join(":");
}

function collectSourceChecks({ skillEvents, handSources, publicZones, protocolZoneLedger, cardMoves, plans }) {
  const handWatchEvents = array(skillEvents).filter((row) => array(row.categories).includes("hand.watch"));
  const handShowEvents = array(skillEvents).filter((row) => array(row.categories).includes("hand.show"));
  const publicZoneChecks = Object.fromEntries(PUBLIC_ZONE_SOURCE_CHECKS.map((item) => {
    const events = array(skillEvents).filter((row) => array(row.categories).includes(item.category));
    return [item.key, publicZoneSourceCheck(item, events, publicZones)];
  }));
  return {
    handWatch: handWatchSourceCheck(handWatchEvents, handSources),
    handShow: handShowSourceCheck(handShowEvents, handSources, cardMoves, plans),
    knownHandMovement: knownHandMovementSourceCheck(skillEvents, handSources, cardMoves, plans),
    protocolListedRandomSearch: protocolListedRandomSearchCheck(skillEvents, plans, cardMoves),
    protocolListedJudgementVirtualPindian: protocolListedJudgementVirtualPindianCheck(skillEvents, plans, cardMoves),
    deckEndpoint: deckEndpointSourceCheck(skillEvents, plans, cardMoves, protocolZoneLedger),
    ...publicZoneChecks
  };
}

function collectManualOrderSourceReview({ skillAudit, skillEvents, plans, sourceChecks }) {
  const orderSourceRuleSet = buildOrderSourceRuleSet(array(skillAudit?.skills), { sampleLimit: 40 });
  const queue = orderSourceRuleSet.rules
    .map(manualSkillQueueRow)
    .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  const eventRows = array(skillEvents).map((row) => ({ ...eventSample(row), source: "skill-event" }));
  const planRows = array(plans).map((row) => ({ ...planSample(row), source: "rule-plan" }));
  const observedRows = [];

  for (const skill of queue) {
    const observations = uniqueRows([
      ...eventRows.filter((row) => Number(row.skillId || 0) === skill.id),
      ...planRows.filter((row) => Number(row.skillId || 0) === skill.id || Number(row.effectiveSkillId || 0) === skill.id)
    ], sourceCheckRowKey);
    const checks = manualEvidenceChecks(skill.categories, sourceChecks);
    const availableChecks = checks.filter((check) => check.hasEvidence === true);
    const recognizedCategories = new Set(checks.flatMap((check) => check.categories));
    const unmappedCategories = skill.categories.filter((category) => !recognizedCategories.has(category));
    const status = manualReviewStatus({ observations, checks, availableChecks });
    observedRows.push({
      ...skill,
      status,
      observed: observations.length > 0,
      observationCount: observations.length,
      evidenceAvailable: availableChecks.length > 0,
      evidenceRows: checks.reduce((total, check) => total + Number(check.evidenceRows || 0), 0),
      evidenceChecks: checks,
      unmappedCategories,
      observations: observations.slice(-12)
    });
  }

  const observed = observedRows.filter((row) => row.observed);
  const ready = observedRows.filter((row) => row.status === "ready-for-manual-review");
  const missingEvidence = observedRows.filter((row) => row.status === "observed-missing-evidence");
  const notObserved = observedRows.filter((row) => row.status === "not-observed");
  return {
    queueCount: queue.length,
    ruleCount: orderSourceRuleSet.count,
    operateCounts: orderSourceRuleSet.operateCounts,
    orderCounts: orderSourceRuleSet.orderCounts,
    evidenceCheckCounts: orderSourceRuleSet.evidenceCheckCounts,
    requiredSources: orderSourceRuleSet.requiredSources,
    mappingIncompleteCount: Number(orderSourceRuleSet.mappingIncompleteCount || 0),
    unmappedCategoryCounts: orderSourceRuleSet.unmappedCategoryCounts || {},
    observedCount: observed.length,
    readyForReviewCount: ready.length,
    missingEvidenceCount: missingEvidence.length,
    notObservedCount: notObserved.length,
    byStatus: countBy(observedRows, (row) => row.status),
    queueSamples: queue.slice(0, 20),
    observedSkills: observed.slice(-40),
    readyForReview: ready.slice(-40),
    missingEvidence: missingEvidence.slice(-40),
    notObservedSamples: notObserved.slice(0, 40),
    rules: orderSourceRuleSet.rules.slice(0, 40)
  };
}

function manualSkillQueueRow(skill) {
  return {
    id: Number(skill?.id || 0),
    spellId: Number(skill?.spellId || skill?.id || 0),
    name: skill?.name || "",
    sourceType: skill?.sourceType || "",
    owners: ownerNames(skill?.owners),
    categories: array(skill?.categories).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean),
    actions: array(skill?.actions),
    strategy: strategyId(skill?.strategy),
    confidence: skill?.confidence || "",
    operate: skill?.operate || "",
    order: skill?.order || "",
    primaryOperate: skill?.primaryOperate || "",
    primaryOrder: skill?.primaryOrder || "",
    requiredSources: array(skill?.requiredSources),
    evidenceChecks: array(skill?.evidenceChecks),
    mappingComplete: skill?.mappingComplete === true,
    unmappedCategories: array(skill?.unmappedCategories),
    orderSourceRule: {
      spellId: Number(skill?.spellId || skill?.id || 0),
      operate: skill?.operate || "",
      order: skill?.order || "",
      primaryOperate: skill?.primaryOperate || "",
      primaryOrder: skill?.primaryOrder || "",
      operations: array(skill?.operations),
      requiredSources: array(skill?.requiredSources),
      evidenceChecks: array(skill?.evidenceChecks),
      runtimeState: array(skill?.runtimeState),
      mappingComplete: skill?.mappingComplete === true,
      unmappedCategories: array(skill?.unmappedCategories)
    },
    reviewReasons: array(skill?.reviewReasons),
    desc: skill?.desc || ""
  };
}

function manualReviewStatus({ observations, checks, availableChecks }) {
  if (!observations.length) return "not-observed";
  if (!checks.length) return "observed-needs-manual-review";
  if (availableChecks.length > 0) return "ready-for-manual-review";
  return "observed-missing-evidence";
}

function manualEvidenceChecks(categories, sourceChecks) {
  const checks = [];
  const push = (key, sourceCheck, categoryList, hasEvidence, evidenceRows) => {
    if (!sourceCheck) return;
    checks.push({
      key,
      categories: categoryList,
      requiredSources: array(sourceCheck.requiredSources),
      hasEvidence,
      evidenceRows: Number(evidenceRows || 0)
    });
  };
  if (hasAnyCategory(categories, ["hand.watch"])) {
    const check = sourceChecks?.handWatch;
    push("handWatch", check, ["hand.watch"], check?.hasAllowedEvidence === true, check?.sourceEvidenceRows);
  }
  if (hasAnyCategory(categories, ["hand.show"])) {
    const check = sourceChecks?.handShow;
    push("handShow", check, ["hand.show"], check?.hasAllowedEvidence === true, check?.sourceEvidenceRows);
  }
  if (hasAnyCategory(categories, KNOWN_HAND_MOVEMENT_CATEGORIES)) {
    const check = sourceChecks?.knownHandMovement;
    push("knownHandMovement", check, KNOWN_HAND_MOVEMENT_CATEGORIES, check?.hasKnownHandMovementEvidence === true, check?.sourceEvidenceRows);
  }
  if (hasAnyCategory(categories, PROTOCOL_LISTED_EXACT_CATEGORIES)) {
    const check = sourceChecks?.protocolListedRandomSearch;
    push("protocolListedRandomSearch", check, PROTOCOL_LISTED_EXACT_CATEGORIES, check?.hasProtocolCardIds === true, check?.protocolCardIdRows);
  }
  if (hasAnyCategory(categories, PROTOCOL_LISTED_JUDGEMENT_VIRTUAL_PINDIAN_CATEGORIES)) {
    const check = sourceChecks?.protocolListedJudgementVirtualPindian;
    push("protocolListedJudgementVirtualPindian", check, PROTOCOL_LISTED_JUDGEMENT_VIRTUAL_PINDIAN_CATEGORIES, check?.hasProtocolCardIds === true, check?.protocolCardIdRows);
  }
  if (hasAnyCategory(categories, [...DECK_ENDPOINT_SOURCE_CATEGORIES, "draw.count"])) {
    const check = sourceChecks?.deckEndpoint;
    push("deckEndpoint", check, [...DECK_ENDPOINT_SOURCE_CATEGORIES, "draw.count"], check?.hasDeckEndpointEvidence === true, check?.sourceEvidenceRows);
  }
  if (hasAnyCategory(categories, ["deck.shuffle", "deck.random.put"])) {
    const check = sourceChecks?.deckEndpoint;
    const invalidationRows = Number(check?.evidence?.deckInvalidationMax || 0);
    push("deckOrderInvalidation", check, ["deck.shuffle", "deck.random.put"], invalidationRows > 0, invalidationRows);
  }
  for (const item of PUBLIC_ZONE_SOURCE_CHECKS) {
    if (!hasAnyCategory(categories, [item.category])) continue;
    const check = sourceChecks?.[item.key];
    push(item.key, check, [item.category], check?.hasPublicZoneEvidence === true || check?.hasPublicGeneralEvidence === true, check?.sourceEvidenceRows);
  }
  return uniqueRows(checks, (row) => row.key);
}

function handWatchSourceCheck(events, handSources) {
  const sourceTimeline = array(handSources?.timeline);
  const evidenceRows = sourceTimeline.filter((row) =>
    Number(row.maskRaw || 0) > 0 ||
    Number(row.maskLedger || 0) > 0 ||
    Number(row.protocolAuthorizedLedger || 0) > 0
  );
  const evidence = {
    maskRawMax: Number(handSources?.mask?.rawMax || 0),
    maskLedgerMax: Number(handSources?.mask?.ledgerMax || 0),
    maskRawOccurrences: Number(handSources?.mask?.rawOccurrences || 0),
    maskLedgerOccurrences: Number(handSources?.mask?.ledgerOccurrences || 0),
    protocolAuthorizedLedgerMax: Number(handSources?.protocolAuthorized?.ledgerMax || 0),
    protocolAuthorizedLedgerOccurrences: Number(handSources?.protocolAuthorized?.ledgerOccurrences || 0)
  };
  const hasAllowedEvidence =
    evidence.maskRawOccurrences > 0 ||
    evidence.maskLedgerOccurrences > 0 ||
    evidence.protocolAuthorizedLedgerOccurrences > 0;
  return {
    category: "hand.watch",
    requiredSources: ["mask-visible-card-ui", "protocol-authorized-friend-hand"],
    eventCount: events.length,
    bySkillId: countBy(events, (row) => skillIdKey(row.skillId)),
    hasAllowedEvidence,
    sourceEvidenceRows: evidenceRows.length,
    evidence,
    eventSamples: events.slice(-12).map((row) => ({
      time: row.time || null,
      protocol: row.protocol || "",
      type: row.type || "",
      skillId: Number(row.skillId || 0),
      skillName: row.skillName || "",
      categories: array(row.categories)
    })),
    sourceSamples: evidenceRows.slice(-12)
  };
}

function handShowSourceCheck(events, handSources, cardMoves, plans) {
  const sourceTimeline = array(handSources?.timeline);
  const visibleEvidenceRows = sourceTimeline.filter((row) =>
    Number(row.maskRaw || 0) > 0 ||
    Number(row.maskLedger || 0) > 0
  );
  const protocolEvidenceRows = protocolListedRowsForCategory("hand.show", cardMoves, plans);
  const evidence = {
    visibleMaskRawOccurrences: Number(handSources?.mask?.rawOccurrences || 0),
    visibleMaskLedgerOccurrences: Number(handSources?.mask?.ledgerOccurrences || 0),
    protocolCardIdRows: protocolEvidenceRows.length
  };
  const hasAllowedEvidence =
    evidence.visibleMaskRawOccurrences > 0 ||
    evidence.visibleMaskLedgerOccurrences > 0 ||
    evidence.protocolCardIdRows > 0;
  return {
    category: "hand.show",
    requiredSources: ["visible card ui", "public reveal protocol"],
    eventCount: events.length,
    bySkillId: countBy(events, (row) => skillIdKey(row.skillId)),
    hasAllowedEvidence,
    sourceEvidenceRows: visibleEvidenceRows.length + protocolEvidenceRows.length,
    evidence,
    eventSamples: events.slice(-12).map(eventSample),
    sourceSamples: [
      ...visibleEvidenceRows.slice(-6),
      ...protocolEvidenceRows.slice(-6)
    ].slice(-12)
  };
}

function knownHandMovementSourceCheck(skillEvents, handSources, cardMoves, plans) {
  const observed = uniqueRows([
    ...array(skillEvents)
      .filter((row) => hasAnyCategory(row.categories, KNOWN_HAND_MOVEMENT_CATEGORIES))
      .map((row) => ({ ...eventSample(row), source: "skill-event" })),
    ...array(plans)
      .filter((row) => hasAnyCategory(row.categories, KNOWN_HAND_MOVEMENT_CATEGORIES))
      .map((row) => ({ ...planSample(row), source: "rule-plan" }))
  ], sourceCheckRowKey);
  const sourceTimeline = array(handSources?.timeline);
  const handSourceRows = sourceTimeline.filter((row) =>
    Number(row.maskRaw || 0) > 0 ||
    Number(row.maskLedger || 0) > 0 ||
    Number(row.protocolAuthorizedLedger || 0) > 0
  );
  const protocolRows = protocolListedRowsForCategories(KNOWN_HAND_MOVEMENT_CATEGORIES, cardMoves, plans);
  const hasKnownHandMovementEvidence = handSourceRows.length > 0 || protocolRows.length > 0;
  return {
    categories: KNOWN_HAND_MOVEMENT_CATEGORIES.slice(),
    requiredSources: ["protocol card id", "mask-visible-card-ui", "protocol-authorized-friend-hand"],
    observedCount: observed.length,
    byCategory: countBy(observed.flatMap((row) => array(row.categories).filter((category) => KNOWN_HAND_MOVEMENT_CATEGORIES.includes(category))), (category) => category),
    hasKnownHandMovementEvidence,
    sourceEvidenceRows: handSourceRows.length + protocolRows.length,
    handSourceEvidenceRows: handSourceRows.length,
    protocolCardIdRows: protocolRows.length,
    evidence: {
      maskRawOccurrences: Number(handSources?.mask?.rawOccurrences || 0),
      maskLedgerOccurrences: Number(handSources?.mask?.ledgerOccurrences || 0),
      protocolAuthorizedLedgerOccurrences: Number(handSources?.protocolAuthorized?.ledgerOccurrences || 0),
      protocolCardIdRows: protocolRows.length
    },
    observedSamples: observed.slice(-12),
    sourceSamples: [
      ...handSourceRows.slice(-6),
      ...protocolRows.slice(-6)
    ].slice(-12)
  };
}

function protocolListedRandomSearchCheck(skillEvents, plans, cardMoves) {
  return protocolListedCategorySourceCheck(PROTOCOL_LISTED_EXACT_CATEGORIES, skillEvents, plans, cardMoves);
}

function protocolListedJudgementVirtualPindianCheck(skillEvents, plans, cardMoves) {
  return protocolListedCategorySourceCheck(PROTOCOL_LISTED_JUDGEMENT_VIRTUAL_PINDIAN_CATEGORIES, skillEvents, plans, cardMoves);
}

function deckEndpointSourceCheck(skillEvents, plans, cardMoves, protocolZoneLedger) {
  const observed = uniqueRows([
    ...array(skillEvents)
      .filter((row) => hasAnyCategory(row.categories, DECK_ENDPOINT_SOURCE_CATEGORIES))
      .map((row) => ({ ...eventSample(row), source: "skill-event" })),
    ...array(plans)
      .filter((row) => hasAnyCategory(row.categories, DECK_ENDPOINT_SOURCE_CATEGORIES))
      .map((row) => ({ ...planSample(row), source: "rule-plan" }))
  ], sourceCheckRowKey);
  const endpointEvidenceRows = array(protocolZoneLedger?.timeline).filter((row) =>
    Number(row.deckTop || 0) > 0 ||
    Number(row.deckBottom || 0) > 0 ||
    Number(row.endpointKnownEvents || 0) > 0
  );
  const protocolRows = protocolListedRowsForCategories(DECK_ENDPOINT_SOURCE_CATEGORIES, cardMoves, plans);
  const hasDeckEndpointEvidence = endpointEvidenceRows.length > 0 || protocolRows.length > 0;
  return {
    categories: DECK_ENDPOINT_SOURCE_CATEGORIES.slice(),
    requiredSources: ["protocol-listed-deck-endpoint", "protocol card id"],
    observedCount: observed.length,
    byCategory: countBy(observed.flatMap((row) => array(row.categories).filter((category) => DECK_ENDPOINT_SOURCE_CATEGORIES.includes(category))), (category) => category),
    hasDeckEndpointEvidence,
    sourceEvidenceRows: endpointEvidenceRows.length + protocolRows.length,
    endpointEvidenceRows: endpointEvidenceRows.length,
    protocolCardIdRows: protocolRows.length,
    evidence: {
      deckTopMax: Number(protocolZoneLedger?.deckTopMax || 0),
      deckBottomMax: Number(protocolZoneLedger?.deckBottomMax || 0),
      endpointKnownEventMax: Number(protocolZoneLedger?.endpointKnownEventMax || 0),
      endpointEventMax: Number(protocolZoneLedger?.endpointEventMax || 0),
      deckInvalidationMax: Number(protocolZoneLedger?.deckInvalidationMax || 0),
      reasonMax: protocolZoneLedger?.reasonMax || {}
    },
    observedSamples: observed.slice(-12),
    sourceSamples: [
      ...endpointEvidenceRows.slice(-6),
      ...protocolRows.slice(-6)
    ].slice(-12)
  };
}

function protocolListedCategorySourceCheck(categories, skillEvents, plans, cardMoves) {
  const observed = uniqueRows([
    ...array(skillEvents)
      .filter((row) => hasAnyCategory(row.categories, categories))
      .map((row) => ({ ...eventSample(row), source: "skill-event" })),
    ...array(plans)
      .filter((row) => hasAnyCategory(row.categories, categories))
      .map((row) => ({ ...planSample(row), source: "rule-plan" }))
  ], sourceCheckRowKey);
  const protocolRows = protocolListedRowsForCategories(categories, cardMoves, plans);
  return {
    categories: categories.slice(),
    requiredSources: ["protocol card id"],
    observedCount: observed.length,
    byCategory: countBy(observed.flatMap((row) => array(row.categories).filter((category) => categories.includes(category))), (category) => category),
    hasProtocolCardIds: protocolRows.length > 0,
    protocolCardIdRows: protocolRows.length,
    observedSamples: observed.slice(-12),
    protocolCardIdSamples: protocolRows.slice(-12)
  };
}

function publicZoneSourceCheck(item, events, publicZones) {
  const evidenceRows = array(publicZones?.timeline).filter((row) =>
    Number(row.byZone?.[item.zoneName] || 0) > 0 ||
    Number(row.byRule?.[item.rule] || 0) > 0
  );
  const zoneMax = Number(publicZones?.byZoneMax?.[item.zoneName] || 0);
  const ruleMax = Number(publicZones?.byRuleMax?.[item.rule] || 0);
  const evidence = {
    zoneMax,
    ruleMax,
    [`${item.zoneName}ZoneMax`]: zoneMax,
    [publicRuleMaxKey(item.rule)]: ruleMax,
    cardMax: Number(publicZones?.cardMax || 0),
    problemCount: Number(publicZones?.problemCount || 0)
  };
  const result = {
    category: item.category,
    zoneName: item.zoneName,
    requiredSources: [item.rule],
    eventCount: events.length,
    bySkillId: countBy(events, (row) => skillIdKey(row.skillId)),
    hasPublicZoneEvidence: zoneMax > 0 || ruleMax > 0,
    sourceEvidenceRows: evidenceRows.length,
    evidence,
    eventSamples: events.slice(-12).map(eventSample),
    sourceSamples: evidenceRows.slice(-12)
  };
  if (item.key === "publicGeneral") result.hasPublicGeneralEvidence = result.hasPublicZoneEvidence;
  return result;
}

function publicRuleMaxKey(rule) {
  return rule.replace(/-([a-z])/g, (_, char) => char.toUpperCase()).replace(/Runtime$/, "RuntimeMax");
}

function protocolListedRowsForCategory(category, cardMoves, plans) {
  return protocolListedRowsForCategories([category], cardMoves, plans);
}

function protocolListedRowsForCategories(categories, cardMoves, plans) {
  return uniqueRows([
    ...array(cardMoves)
      .filter((row) => hasAnyCategory(row.skillCategories, categories) && array(row.knownCardIds).length > 0)
      .map((row) => ({
        source: "card-move",
        recordIndex: row.recordIndex ?? null,
        time: row.time || null,
        protocol: row.protocol || "",
        type: row.type || "",
        skillId: Number(row.skillId || 0),
        skillName: row.skillName || "",
        categories: array(row.skillCategories),
        knownCardIds: normalizeIds(row.knownCardIds)
      })),
    ...array(plans)
      .filter((row) => hasAnyCategory(row.categories, categories) && array(row.knownCardIds).length > 0)
      .map((row) => ({
        ...planSample(row),
        source: "rule-plan",
        knownCardIds: normalizeIds(row.knownCardIds)
      }))
  ], sourceCheckRowKey);
}

function eventSample(row) {
  return {
    time: row.time || null,
    protocol: row.protocol || "",
    type: row.type || "",
    skillId: Number(row.skillId || 0),
    skillName: row.skillName || "",
    categories: array(row.categories)
  };
}

function planSample(row) {
  return {
    recordIndex: row.recordIndex ?? null,
    time: row.time || null,
    protocol: row.protocol || "",
    type: row.eventType || "",
    skillId: Number(row.skillId || 0),
    effectiveSkillId: Number(row.effectiveSkillId || 0),
    skillName: row.skillName || "",
    categories: array(row.categories)
  };
}

function hasAnyCategory(values, categories) {
  const wanted = new Set(categories || []);
  return array(values).some((category) => wanted.has(category));
}

function sourceCheckRowKey(row) {
  return [
    row.source || "",
    row.recordIndex ?? "",
    row.time || "",
    row.protocol || "",
    row.type || "",
    row.skillId || 0,
    array(row.categories).join(","),
    array(row.knownCardIds).join(",")
  ].join(":");
}

function pushLimited(target, rows, limit) {
  for (const row of rows) {
    if (target.length >= limit) return;
    target.push(row);
  }
}

function pushProblemRows(target, problems, reportRow, kind) {
  for (const problem of problems) {
    target.push({
      tick: reportRow?.tick ?? null,
      ts: reportRow?.ts || "",
      kind,
      seatIndex: problem?.seatIndex ?? null,
      id: problem?.id ?? null,
      text: problem?.text || "",
      rule: problem?.rule || "",
      legacySource: problem?.legacySource || "",
      missing: array(problem?.missing)
    });
  }
}

function pushPublicZoneProblemRows(target, problems, reportRow) {
  for (const problem of problems) {
    target.push({
      tick: reportRow?.tick ?? null,
      ts: reportRow?.ts || "",
      seatIndex: problem?.seatIndex ?? null,
      zoneName: problem?.zoneName || "",
      id: problem?.id ?? null,
      text: problem?.text || "",
      rule: problem?.rule || "",
      missing: array(problem?.missing)
    });
  }
}

function collectProtocolZoneLedger(snapshots, reportValues) {
  const rows = [
    ...snapshots.map((snapshot) => snapshot?.protocolZoneLedger).filter(Boolean),
    ...reportValues.map((reports) => reports?.protocolFlowReport?.protocolZoneLedger).filter(Boolean)
  ];
  const timeline = [];
  const byZoneMax = {};
  const sourceMax = {};
  const reasonMax = {};
  let moveMax = 0;
  let knownLocationMax = 0;
  let cardMax = 0;
  let zoneMax = 0;
  let deckTopMax = 0;
  let deckBottomMax = 0;
  let deckInvalidationMax = 0;
  let endpointEventMax = 0;
  let endpointKnownEventMax = 0;

  for (const row of rows) {
    const endpoint = row.deckEndpoint || {};
    const endpointEvents = array(endpoint.recentEvents);
    const endpointKnownEvents = endpointEvents.filter((event) => normalizeIds(event.ids || []).length > 0).length;
    const deckTop = Number(endpoint.knownTopCount || endpoint.top?.length || 0);
    const deckBottom = Number(endpoint.knownBottomCount || endpoint.bottom?.length || 0);
    moveMax = Math.max(moveMax, Number(row.moveCount || 0));
    knownLocationMax = Math.max(knownLocationMax, Number(row.knownLocationCount || 0));
    cardMax = Math.max(cardMax, Number(row.cardCount || 0));
    zoneMax = Math.max(zoneMax, Number(row.zoneCount || 0));
    deckTopMax = Math.max(deckTopMax, deckTop);
    deckBottomMax = Math.max(deckBottomMax, deckBottom);
    deckInvalidationMax = Math.max(deckInvalidationMax, Number(endpoint.invalidationCount || 0));
    endpointEventMax = Math.max(endpointEventMax, endpointEvents.length);
    endpointKnownEventMax = Math.max(endpointKnownEventMax, endpointKnownEvents);
    maxCountSet(byZoneMax, row.byZone);
    maxCountSet(sourceMax, row.sources);
    maxCountSet(reasonMax, countBy(endpointEvents, (event) => event.reason || ""));
    timeline.push({
      deckTop,
      deckBottom,
      deckInvalidations: Number(endpoint.invalidationCount || 0),
      lastReason: endpoint.lastReason || "",
      topSourceReason: endpoint.topSource?.reason || "",
      bottomSourceReason: endpoint.bottomSource?.reason || "",
      endpointEvents: endpointEvents.length,
      endpointKnownEvents,
      eventReasons: countBy(endpointEvents, (event) => event.reason || ""),
      eventTypes: countBy(endpointEvents, (event) => event.type || "")
    });
  }

  return {
    reportRows: rows.length,
    moveMax,
    knownLocationMax,
    cardMax,
    zoneMax,
    deckTopMax,
    deckBottomMax,
    deckInvalidationMax,
    endpointEventMax,
    endpointKnownEventMax,
    byZoneMax: sortObject(byZoneMax),
    sourceMax: sortObject(sourceMax),
    reasonMax: sortObject(reasonMax),
    timeline: timeline.slice(-120),
    latest: compactProtocolZoneLedger(rows.at(-1))
  };
}

function compactProtocolZoneLedger(row) {
  if (!row) return null;
  return {
    version: row.version || null,
    moveCount: Number(row.moveCount || 0),
    knownMoveCount: Number(row.knownMoveCount || 0),
    unknownMoveCount: Number(row.unknownMoveCount || 0),
    cardCount: Number(row.cardCount || 0),
    knownLocationCount: Number(row.knownLocationCount || 0),
    zoneCount: Number(row.zoneCount || 0),
    byZone: row.byZone || {},
    sources: row.sources || {},
    deckEndpoint: compactDeckEndpoint(row.deckEndpoint),
    recentEvents: array(row.recentEvents).slice(-20)
  };
}

function compactDeckEndpoint(endpoint) {
  if (!endpoint) return null;
  return {
    version: endpoint.version || null,
    top: normalizeIds(endpoint.top || []),
    bottom: normalizeIds(endpoint.bottom || []),
    knownTopCount: Number(endpoint.knownTopCount || endpoint.top?.length || 0),
    knownBottomCount: Number(endpoint.knownBottomCount || endpoint.bottom?.length || 0),
    invalidationCount: Number(endpoint.invalidationCount || 0),
    lastInvalidationReason: endpoint.lastInvalidationReason || "",
    lastReason: endpoint.lastReason || "",
    recentEvents: array(endpoint.recentEvents).slice(-20)
  };
}

function mergeCountSet(target, counts) {
  for (const [key, value] of Object.entries(counts || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

function maxCountSet(target, counts) {
  for (const [key, value] of Object.entries(counts || {})) {
    target[key] = Math.max(Number(target[key] || 0), Number(value || 0));
  }
}

function countCategories(records) {
  const counts = {};
  for (const record of records) {
    for (const category of categoryIds(record?.parsed?.skillRule)) {
      counts[category] = (counts[category] || 0) + 1;
    }
  }
  return sortObject(counts);
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortObject(counts);
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function uniqueRows(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function lastReport(reportValues, key) {
  for (let i = reportValues.length - 1; i >= 0; i--) {
    if (reportValues[i]?.[key]) return reportValues[i][key];
  }
  return null;
}

function snapshotValue(row) {
  return row?.value?.snapshot || row?.snapshot || (row?.value?.protocol ? row.value : null);
}

function zoneKey(endpoint) {
  if (!endpoint) return "";
  return `${endpoint.code ?? ""}:${endpoint.zone || ""}:seat${endpoint.seat ?? ""}`;
}

function skillIdKey(value) {
  const id = Number(value || 0);
  return Number.isFinite(id) && id > 0 ? String(id) : "";
}

function normalizeIds(ids) {
  return Array.from(new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function categoryIds(rule) {
  return Array.from(rule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function normalizeFiles(files) {
  const out = {};
  for (const [key, value] of Object.entries(files || {})) {
    out[key] = {
      path: value?.path || "",
      exists: value?.exists === true,
      lines: Number(value?.lines || 0)
    };
  }
  return out;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  CARD_RELEVANT_PROTOCOLS,
  buildRecordingReport,
  countBy
};
