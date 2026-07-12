const { moveRow, skillEventRow, planRow } = require("./protocol-flow-report.cjs");

function buildRecordingTimeline(value = {}) {
  const rows = [];
  const problems = [];
  const recordingDir = value.recordingDir || value.recordingReport?.recordingDir || "";
  const summary = objectOrNull(value.summary);
  const metaRows = array(value.metaRows);
  const protocolRows = array(value.protocolRows);
  const consoleProtocolRows = array(value.consoleProtocolRows);
  const snapshotRows = array(value.snapshotRows);
  const reportRows = array(value.reportRows);
  const recordingReport = objectOrNull(value.recordingReport);
  const parseErrors = array(value.parseErrors);
  const planByRecordIndex = new Map(collectPlans(snapshotRows, reportRows).map((plan) => [Number(plan.recordIndex), plan]));
  const counters = {
    cardMoves: 0,
    skillEvents: 0,
    validationFailures: 0,
    maskEvents: 0,
    protocolAuthorizedEvents: 0,
    knownHandLedgerEvents: 0,
    protocolZoneEvents: 0,
    deckEndpointEvents: 0
  };
  let order = 0;

  function add(source, kind, ts, tick, detail, data = {}) {
    const row = {
      ts: ts || "",
      tick: tick ?? null,
      source,
      kind,
      text: formatLine(ts, source, kind, detail),
      data,
      order: order++
    };
    rows.push(row);
    return row;
  }

  for (const row of metaRows) {
    if (!row || typeof row !== "object") continue;
    const type = row.type || "meta";
    if (type === "start") {
      add("meta", "recording:start", row.ts, row.tick, [
        row.durationMs ? `durationMs=${Number(row.durationMs)}` : "",
        row.intervalMs ? `intervalMs=${Number(row.intervalMs)}` : "",
        row.snapshotEveryMs ? `snapshotEveryMs=${Number(row.snapshotEveryMs)}` : "",
        row.installTarget?.title ? `target=${row.installTarget.title}` : ""
      ].filter(Boolean).join(" "), row);
    } else if (type === "stop") {
      add("meta", "recording:stop", row.ts, row.tick, [
        row.elapsedMs ? `elapsedMs=${Number(row.elapsedMs)}` : "",
        row.protocolRecords != null ? `protocols=${Number(row.protocolRecords)}` : "",
        row.consoleProtocolRecords != null ? `console=${Number(row.consoleProtocolRecords)}` : "",
        row.snapshots != null ? `snapshots=${Number(row.snapshots)}` : "",
        row.reports != null ? `reports=${Number(row.reports)}` : ""
      ].filter(Boolean).join(" "), row);
    }
  }

  for (const row of protocolRows) {
    addProtocolRecord(add, row, "proxy", planByRecordIndex, counters);
  }
  for (const row of consoleProtocolRows) {
    addProtocolRecord(add, row, "console", planByRecordIndex, counters);
  }

  addSnapshotRows(add, snapshotRows, counters);
  addReportRows(add, reportRows, counters, problems);

  for (const error of parseErrors) {
    const problem = {
      severity: "error",
      id: "json-parse-error",
      message: error.message || "JSON parse error",
      path: error.path || "",
      line: error.line || null
    };
    problems.push(problem);
    add("report", "problem", "", null, problemText(problem), problem);
  }
  for (const problem of array(recordingReport?.problems)) {
    problems.push(problem);
    add("report", "problem", "", null, problemText(problem), problem);
  }

  rows.sort(compareRows);
  const publicRows = rows.map(({ order: _order, ...row }) => row);
  const reportCounts = objectOrNull(recordingReport?.counts);

  return {
    ok: recordingReport ? recordingReport.ok !== false && problems.every((problem) => problem?.severity !== "error") : problems.every((problem) => problem?.severity !== "error"),
    recordingDir,
    counts: {
      rows: publicRows.length,
      proxyProtocols: protocolRows.length,
      consoleProtocols: consoleProtocolRows.length,
      cardMoves: counters.cardMoves,
      skillEvents: counters.skillEvents,
      validationFailures: counters.validationFailures,
      maskEvents: counters.maskEvents,
      protocolAuthorizedEvents: counters.protocolAuthorizedEvents,
      knownHandLedgerEvents: counters.knownHandLedgerEvents,
      protocolZoneEvents: counters.protocolZoneEvents,
      deckEndpointEvents: counters.deckEndpointEvents,
      problems: problems.length,
      reports: reportRows.length,
      snapshots: snapshotRows.length,
      protocolRecords: reportCounts?.protocolRecords ?? protocolRows.length,
      consoleProtocolRecords: reportCounts?.consoleProtocolRecords ?? consoleProtocolRows.length
    },
    rows: publicRows,
    text: publicRows.map((row) => row.text),
    problems
  };
}

function addProtocolRecord(add, row, source, planByRecordIndex, counters) {
  const record = row?.record || row;
  if (!record || typeof record !== "object") return;
  const parsed = record.parsed || {};
  const type = parsed.type || "protocol";
  const ts = row?.ts || timestampFromRecord(record);
  const tick = row?.tick ?? null;
  const protocol = record.name || parsed.protocol || "";

  if (type === "card:move") {
    const move = moveRow(record, planByRecordIndex.get(Number(record.index)));
    counters.cardMoves++;
    add(source, "card:move", ts, tick, cardMoveText(protocol, record, move), move);
    if (Number(move.skillId || 0) > 0) counters.skillEvents++;
    return;
  }

  if (isSkillRecord(record)) {
    const skill = skillEventRow({
      time: record.time || null,
      protocol,
      type,
      skillId: parsed.skillId || 0,
      skillRule: parsed.skillRule || null
    });
    counters.skillEvents++;
    add(source, type || "skill", ts, tick, skillText(protocol, record, skill), skill);
    return;
  }

  if (type === "card:use") {
    add(source, "card:use", ts, tick, cardUseText(protocol, record, parsed), protocolCompact(record));
    return;
  }

  add(source, type || "protocol", ts, tick, protocolText(protocol, record, parsed), protocolCompact(record));
}

function addSnapshotRows(add, snapshotRows, counters) {
  let seen = false;
  let lastVisible = null;
  for (const row of snapshotRows) {
    const snapshot = snapshotValue(row);
    if (!snapshot) continue;
    const visible = snapshot.visible === true;
    if (!seen || visible !== lastVisible) {
      add("snapshot", "visible", row?.ts || "", row?.tick ?? null, [
        `visible=${visible ? "true" : "false"}`,
        snapshot.reason ? `reason=${snapshot.reason}` : ""
      ].filter(Boolean).join(" "), { visible, reason: snapshot.reason || "" });
    }
    addProtocolZoneLedgerRows(add, "snapshot", row?.ts || "", row?.tick ?? null, snapshot.protocolZoneLedger, counters);
    addKnownHandLedgerRows(add, "snapshot", row?.ts || "", row?.tick ?? null, snapshot.knownHandLedger, counters);
    seen = true;
    lastVisible = visible;
  }
}

function addReportRows(add, reportRows, counters, problems) {
  for (const row of reportRows) {
    const ts = row?.ts || "";
    const tick = row?.tick ?? null;
    const reports = row?.reports || {};
    const validation = row?.validation || null;

    for (const check of array(validation?.checks)) {
      if (check?.status !== "fail" && check?.status !== "error") continue;
      counters.validationFailures++;
      add("report", "validation", ts, tick, `fail ${check.id || "unknown"}: ${check.message || ""}`.trim(), check);
    }

    const hand = reports.handSourceReport || {};
    const mask = hand.mask || {};
    if (Number(mask.rawCount || 0) > 0 || Number(mask.ledgerCount || 0) > 0) {
      const problemCount = array(mask.rawProblems).length + array(mask.ledgerProblems).length;
      counters.maskEvents++;
      add("report", "hand-source", ts, tick, [
        "mask",
        `raw=${Number(mask.rawCount || 0)}`,
        `ledger=${Number(mask.ledgerCount || 0)}`,
        `problems=${problemCount}`
      ].join(" "), {
        source: "mask",
        rawCount: Number(mask.rawCount || 0),
        ledgerCount: Number(mask.ledgerCount || 0),
        problemCount
      });
    }

    const protocolAuthorized = hand.protocolAuthorized || {};
    if (Number(protocolAuthorized.ledgerCount || 0) > 0) {
      const problemCount = array(protocolAuthorized.ledgerProblems).length;
      counters.protocolAuthorizedEvents++;
      add("report", "hand-source", ts, tick, [
        "protocol-authorized",
        `ledger=${Number(protocolAuthorized.ledgerCount || 0)}`,
        `problems=${problemCount}`
      ].join(" "), {
        source: "protocol-authorized",
        ledgerCount: Number(protocolAuthorized.ledgerCount || 0),
        problemCount
      });
    }

    addProtocolZoneLedgerRows(add, "report", ts, tick, reports.protocolFlowReport?.protocolZoneLedger, counters);

    for (const problem of array(reports.protocolFlowReport?.problems)) {
      problems.push(problem);
      add("report", "problem", ts, tick, problemText(problem), problem);
    }
    for (const mismatch of array(reports.legacyComparisonReport?.mismatches)) {
      const problem = {
        severity: "warn",
        id: "legacy-comparison-mismatch",
        message: mismatch.message || mismatch.type || "legacy comparison mismatch",
        actual: mismatch
      };
      problems.push(problem);
      add("report", "problem", ts, tick, problemText(problem), problem);
    }
  }
}

function addKnownHandLedgerRows(add, source, ts, tick, ledger, counters) {
  if (!ledger || typeof ledger !== "object") return;
  for (const event of array(ledger.recentEvents)) {
    counters.knownHandLedgerEvents++;
    add(source, "known-hand-ledger", ts, tick, knownHandLedgerText(event), event);
  }
}

function addProtocolZoneLedgerRows(add, source, ts, tick, ledger, counters) {
  if (!ledger || typeof ledger !== "object") return;
  const moveCount = Number(ledger.moveCount || 0);
  const knownLocationCount = Number(ledger.knownLocationCount || 0);
  const zoneCount = Number(ledger.zoneCount || 0);
  const endpoint = ledger.deckEndpoint || {};
  const top = normalizeIds(endpoint.top || []);
  const bottom = normalizeIds(endpoint.bottom || []);
  const invalidationCount = Number(endpoint.invalidationCount || 0);
  if (moveCount || knownLocationCount || top.length || bottom.length || invalidationCount) {
    counters.protocolZoneEvents++;
    add(source, "protocol-zone", ts, tick, [
      `moves=${moveCount}`,
      `knownLocations=${knownLocationCount}`,
      `zones=${zoneCount}`,
      `deckTop=${idsText(top)}`,
      `deckBottom=${idsText(bottom)}`,
      `invalidations=${invalidationCount}`
    ].join(" "), {
      moveCount,
      knownLocationCount,
      zoneCount,
      byZone: ledger.byZone || {},
      sources: ledger.sources || {},
      deckEndpoint: compactDeckEndpoint(endpoint)
    });
  }

  for (const event of array(endpoint.recentEvents)) {
    counters.deckEndpointEvents++;
    add(source, "deck-endpoint", ts, tick, deckEndpointText(event), event);
  }
}

function knownHandLedgerText(event) {
  const type = event?.type || "event";
  const fields = [];
  if (event?.seatIndex != null) fields.push(`seat=${event.seatIndex}`);
  if (array(event?.ids).length) fields.push(`ids=${idsText(event.ids)}`);
  if (event?.removed != null) fields.push(`removed=${Number(event.removed || 0)}`);
  if (event?.added != null) fields.push(`added=${Number(event.added || 0)}`);
  if (event?.known != null) fields.push(`known=${Number(event.known || 0)}`);
  if (event?.count != null) fields.push(`count=${Number(event.count || 0)}`);
  if (event?.reason) fields.push(`reason=${event.reason}`);
  if (event?.protocol) fields.push(`protocol=${event.protocol}`);
  if (event?.recordIndex != null) fields.push(`record=#${event.recordIndex}`);
  const skill = skillSuffix(event?.skillId, event?.skillName);
  if (skill) fields.push(skill);
  if (array(event?.categories).length) fields.push(`[${array(event.categories).join(",")}]`);
  if (event?.sourceRule) fields.push(`rule=${event.sourceRule}`);
  if (event?.clearKnown != null) fields.push(`clearKnown=${event.clearKnown === true ? "true" : "false"}`);
  return [type, ...fields].join(" ");
}

function cardMoveText(protocol, record, move) {
  const ids = move.knownCardIds.length ? move.knownCardIds.join(",") : "-";
  const categories = move.skillCategories.length ? ` [${move.skillCategories.join(",")}]` : "";
  const actions = move.plannedActions.length ? ` actions=${move.plannedActions.join(",")}` : "";
  return [
    protocol || "protocol",
    record.index != null ? `#${record.index}` : "",
    `${zoneText(move.from)} -> ${zoneText(move.to)}`,
    `count=${move.count}`,
    `known=${ids}`,
    `unknown=${move.unknownCount}`,
    skillSuffix(move.skillId, move.skillName),
    categories,
    actions
  ].filter(Boolean).join(" ");
}

function deckEndpointText(event) {
  return [
    event?.type || "event",
    `endpoint=${event?.endpoint || "?"}`,
    event?.reason ? `reason=${event.reason}` : "",
    `ids=${idsText(event?.ids || [])}`,
    event?.unknownCount != null ? `unknown=${Number(event.unknownCount || 0)}` : "",
    event?.recordIndex != null ? `record=#${event.recordIndex}` : "",
    skillSuffix(event?.skillId, "")
  ].filter(Boolean).join(" ");
}

function compactDeckEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") return null;
  return {
    top: normalizeIds(endpoint.top || []),
    bottom: normalizeIds(endpoint.bottom || []),
    knownTopCount: Number(endpoint.knownTopCount || endpoint.top?.length || 0),
    knownBottomCount: Number(endpoint.knownBottomCount || endpoint.bottom?.length || 0),
    invalidationCount: Number(endpoint.invalidationCount || 0),
    lastInvalidationReason: endpoint.lastInvalidationReason || "",
    lastReason: endpoint.lastReason || ""
  };
}

function cardUseText(protocol, record, parsed) {
  const card = parsed.card || array(parsed.cards)[0] || {};
  const cardName = card.name || (card.id ? `card#${card.id}` : "unknown-card");
  const targets = array(parsed.targetSeats || parsed.targets).map((item) => typeof item === "object" ? item.seat ?? item.id ?? "" : item).filter((item) => item !== "").join(",");
  return [
    protocol || "protocol",
    record.index != null ? `#${record.index}` : "",
    `seat=${parsed.seat ?? parsed.srcSeat ?? "?"}`,
    `card=${cardName}`,
    targets ? `targets=${targets}` : ""
  ].filter(Boolean).join(" ");
}

function skillText(protocol, record, skill) {
  const categories = array(skill.categories).length ? ` [${array(skill.categories).join(",")}]` : "";
  return [
    protocol || "protocol",
    record.index != null ? `#${record.index}` : "",
    skillSuffix(skill.skillId, skill.skillName),
    categories,
    skill.confidence ? `confidence=${skill.confidence}` : ""
  ].filter(Boolean).join(" ");
}

function protocolText(protocol, record, parsed) {
  const fields = [];
  for (const name of ["seat", "round", "turn", "phase", "stage", "stateId", "dataId", "optType", "timeout"]) {
    if (parsed[name] != null) fields.push(`${name}=${JSON.stringify(parsed[name])}`);
  }
  return [
    protocol || "protocol",
    record.index != null ? `#${record.index}` : "",
    parsed.type ? `type=${parsed.type}` : "",
    fields.join(" ")
  ].filter(Boolean).join(" ");
}

function problemText(problem) {
  return [
    problem?.severity || "warn",
    problem?.id || "problem",
    problem?.message || ""
  ].filter(Boolean).join(" ");
}

function protocolCompact(record) {
  return {
    index: record?.index ?? null,
    time: record?.time || null,
    protocol: record?.name || record?.parsed?.protocol || "",
    type: record?.parsed?.type || "",
    skillId: Number(record?.parsed?.skillId || 0)
  };
}

function collectPlans(snapshotRows, reportRows) {
  const rows = [];
  for (const row of snapshotRows) {
    const snapshot = snapshotValue(row);
    for (const plan of array(snapshot?.rulePlanner?.recentPlans)) rows.push(planRow(plan));
  }
  for (const row of reportRows) {
    for (const plan of array(row?.reports?.protocolFlowReport?.planner?.recentPlans)) rows.push(planRow(plan));
  }
  const seen = new Set();
  return rows.filter((plan) => {
    const key = [plan.recordIndex, plan.time || "", plan.protocol || "", plan.skillId || ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function snapshotValue(row) {
  const value = row?.value || row;
  return value?.snapshot || (value?.config || value?.protocol ? value : null);
}

function isSkillRecord(record) {
  const parsed = record?.parsed || {};
  return Boolean(parsed.skillRule) || Number(parsed.skillId || 0) > 0 || String(parsed.type || "").startsWith("skill:");
}

function zoneText(endpoint) {
  if (!endpoint) return "?:?";
  const code = endpoint.code ?? "?";
  const zone = endpoint.zone || "?";
  const seat = endpoint.seat == null ? "?" : endpoint.seat;
  return `${code}:${zone}:seat${seat}`;
}

function idsText(ids) {
  const normalized = normalizeIds(ids);
  return normalized.length ? normalized.join(",") : "-";
}

function normalizeIds(ids) {
  return Array.from(new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function skillSuffix(skillId, skillName) {
  const id = Number(skillId || 0);
  if (!id && !skillName) return "";
  return `skill=${skillName || `skill#${id}`}${id ? `(${id})` : ""}`;
}

function formatLine(ts, source, kind, detail) {
  return [formatTs(ts), source, kind, detail || ""].filter(Boolean).join(" ").trim();
}

function formatTs(ts) {
  if (!ts) return "no-ts";
  const date = new Date(ts);
  if (Number.isFinite(date.getTime())) return date.toISOString().replace("T", " ").replace("Z", "");
  return String(ts);
}

function timestampFromRecord(record) {
  if (!record?.time) return "";
  const date = new Date(record.time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function compareRows(a, b) {
  return timeValue(a.ts) - timeValue(b.ts) ||
    Number(a.tick ?? 0) - Number(b.tick ?? 0) ||
    Number(a.order ?? 0) - Number(b.order ?? 0);
}

function timeValue(ts) {
  if (!ts) return Number.MAX_SAFE_INTEGER;
  const date = new Date(ts);
  return Number.isFinite(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function objectOrNull(value) {
  return value && typeof value === "object" ? value : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildRecordingTimeline
};
