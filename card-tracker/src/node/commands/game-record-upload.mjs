import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const GAME_RECORD_SCHEMA_VERSION = 1;

export async function readJsonLines(filePath) {
  const text = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function buildGameRecordPackage(options) {
  const runDir = options.runDir;
  const paths = options.paths;
  const summary = options.summary || {};
  if (!runDir) throw new Error("runDir is required");
  if (!paths) throw new Error("paths is required");

  const meta = await readJsonLines(paths.metaPath);
  const protocolRecords = await readJsonLines(paths.protocolRecordsPath);
  const protocolConsoleRecords = await readJsonLines(paths.protocolConsoleRecordsPath);
  const snapshots = await readJsonLines(paths.snapshotsPath);
  const reports = await readJsonLines(paths.reportsPath);
  const snapshotValues = snapshots
    .map((row) => row?.value?.snapshot || row?.snapshot || null)
    .filter(Boolean);
  const visibleSnapshots = snapshotValues.filter((snapshot) => snapshot?.visible === true);
  const firstVisible = visibleSnapshots[0] || null;
  const lastVisible = visibleSnapshots.at(-1) || null;
  const lastSnapshot = snapshotValues.at(-1) || null;
  const allProtocolRows = protocolRecords.concat(protocolConsoleRecords);
  const gameOver = allProtocolRows.find((row) => isGameOverRecord(row?.record || row)) || null;

  return {
    schemaVersion: GAME_RECORD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    userId: options.userId || "",
    clientSessionId: path.basename(runDir),
    source: {
      tool: "sgs-scripts",
      command: "record",
      runDir,
      files: fileSummary(paths)
    },
    session: sessionSummary(summary, meta),
    battle: battleSummary(summary, {
      firstVisible,
      lastVisible,
      lastSnapshot,
      gameOver
    }),
    streams: {
      meta,
      protocolRecords,
      protocolConsoleRecords,
      snapshots,
      reports
    }
  };
}

export async function writeGameRecordPackage(outPath, record) {
  await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function uploadGameRecordPackage(record, options = {}) {
  const url = options.url || "";
  if (!url) return { ok: false, skipped: true, reason: "upload url is empty" };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
  const body = {
    userId: options.userId || record.userId || "",
    password: options.password || "",
    clientSessionId: record.clientSessionId || "",
    startedAt: record.battle?.startedAt || record.session?.startedAt || null,
    finishedAt: record.battle?.finishedAt || record.session?.finishedAt || null,
    gameMode: record.battle?.gameMode || null,
    uploadAllowed: record.session?.uploadAllowed !== false && record.battle?.uploadAllowed !== false,
    reconnected: record.session?.reconnected === true || record.battle?.reconnected === true,
    record
  };
  const headers = {
    "content-type": "application/json"
  };
  if (options.apiKey) headers["x-sgs-api-key"] = options.apiKey;
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = parseResponseText(text);
  return {
    ok: response.ok,
    status: response.status,
    response: parsed
  };
}

export function isGameOverRecord(record) {
  return record?.name === "MsgGameOver" || record?.parsed?.type === "game:over";
}

function sessionSummary(summary, metaRows) {
  const start = metaRows.find((row) => row?.type === "start") || {};
  const stop = [...metaRows].reverse().find((row) => row?.type === "stop") || {};
  return {
    startedAt: summary.startedAt || start.ts || "",
    finishedAt: summary.finishedAt || stop.ts || "",
    elapsedMs: Number(summary.elapsedMs || stop.elapsedMs || 0),
    durationMs: Number(summary.durationMs || 0),
    intervalMs: Number(summary.intervalMs || 0),
    snapshotEveryMs: Number(summary.snapshotEveryMs || 0),
    stopReason: summary.stopReason || "",
    firstVisibleAt: summary.firstVisibleAt || "",
    gameOverAt: summary.gameOverAt || "",
    counts: {
      ticks: Number(summary.ticks || 0),
      protocolRecords: Number(summary.protocolRecords || 0),
      consoleProtocolRecords: Number(summary.consoleProtocolRecords || 0),
      snapshots: Number(summary.snapshots || 0),
      reports: Number(summary.reports || 0)
    },
    installTarget: summary.installTarget || null,
    uploadAllowed: summary.uploadAllowed !== false,
    uploadBlockedReason: summary.uploadBlockedReason || "",
    reconnected: summary.reconnected === true
  };
}

function battleSummary(summary, values) {
  const snapshot = values.lastVisible || values.lastSnapshot || {};
  const table = snapshot.table || {};
  const seats = Array.isArray(table.seats) ? table.seats : [];
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const visibleRows = Array.isArray(snapshot.visibleRows) ? snapshot.visibleRows : [];
  return {
    startedAt: summary.firstVisibleAt || summary.startedAt || "",
    finishedAt: summary.finishedAt || "",
    gameOverAt: summary.gameOverAt || values.gameOver?.ts || "",
    gameMode: table.mode || { known: false, candidates: {} },
    selfSeatIndex: table.selfSeatIndex ?? snapshot.selfSeatIndex ?? -1,
    seatCount: table.seatCount || seats.length || snapshot.visibility?.length || 0,
    allGenerals: table.allGenerals || [],
    selfGenerals: table.selfGenerals || [],
    teammateGenerals: table.teammateGenerals || [],
    seats,
    knownHands: rows.map(handRowSummary),
    visibleHands: visibleRows.map(handRowSummary),
    uploadAllowed: summary.uploadAllowed !== false,
    uploadBlockedReason: summary.uploadBlockedReason || "",
    reconnected: summary.reconnected === true,
    protocolBoundaries: {
      gameOver: values.gameOver?.record || values.gameOver || null
    }
  };
}

function handRowSummary(row) {
  return {
    seatIndex: row.seatIndex,
    names: row.names || [],
    handCardCount: Number(row.handCardCount || 0),
    knownCount: Number(row.knownCount || 0),
    candidateCount: Number(row.candidateCount || 0),
    unknownCount: Number(row.unknownCount || 0),
    complete: row.complete === true,
    dirty: row.dirty === true,
    cards: row.cards || [],
    candidates: row.candidates || [],
    sources: row.sources || []
  };
}

function fileSummary(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value]));
}

function parseResponseText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
