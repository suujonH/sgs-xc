import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGameRecordPackage,
  isGameOverRecord,
  uploadGameRecordPackage,
  writeGameRecordPackage
} from "./game-record-upload.mjs";

export function recordingPaths(runDir) {
  return {
    metaPath: path.join(runDir, "meta.session.jsonl"),
    protocolRecordsPath: path.join(runDir, "protocol.records.jsonl"),
    protocolConsoleRecordsPath: path.join(runDir, "protocol.console.records.jsonl"),
    snapshotsPath: path.join(runDir, "snapshots.jsonl"),
    reportsPath: path.join(runDir, "reports.jsonl"),
    gameRecordPath: path.join(runDir, "game-record.json"),
    summaryPath: path.join(runDir, "summary.json")
  };
}

export async function appendJsonLine(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function recordRuntimeSession(options) {
  const runDir = options.runDir;
  if (!runDir) throw new Error("runDir is required");
  const paths = recordingPaths(runDir);
  const startedAt = Date.now();
  const durationMs = positiveNumber(options.durationMs, 300000);
  const intervalMs = positiveNumber(options.intervalMs, 1000);
  const snapshotEveryMs = positiveNumber(options.snapshotEveryMs, 3000);
  const installFirst = options.installFirst !== false;
  const stopOnGameOver = options.stopOnGameOver === true;
  const writeGameRecord = options.writeGameRecord !== false;
  const readRuntimeSnapshotImpl = options.readRuntimeSnapshotImpl;
  const installRuntimeImpl = options.installRuntimeImpl;
  const validateSnapshotValue = options.validateSnapshotValue;
  const validationOptions = options.validationOptions || (() => ({}));
  const buildCaptureReports = options.buildCaptureReports;
  const buildGameRecordPackageImpl = options.buildGameRecordPackageImpl || buildGameRecordPackage;
  const uploadGameRecordPackageImpl = options.uploadGameRecordPackageImpl || uploadGameRecordPackage;
  const configureRuntimeRecordingImpl = options.configureRuntimeRecordingImpl;
  if (typeof readRuntimeSnapshotImpl !== "function") throw new Error("readRuntimeSnapshotImpl is required");
  if (typeof validateSnapshotValue !== "function") throw new Error("validateSnapshotValue is required");
  if (typeof buildCaptureReports !== "function") throw new Error("buildCaptureReports is required");

  await mkdir(runDir, { recursive: true });
  await writeFile(paths.metaPath, "", "utf8");
  await writeFile(paths.protocolRecordsPath, "", "utf8");
  await writeFile(paths.protocolConsoleRecordsPath, "", "utf8");
  await writeFile(paths.snapshotsPath, "", "utf8");
  await writeFile(paths.reportsPath, "", "utf8");
  let installTarget = null;
  let installValue = null;
  if (installFirst && typeof installRuntimeImpl === "function") {
    const installed = await installRuntimeImpl();
    installValue = installed?.value || null;
    installTarget = installed?.target ? {
      id: installed.target.id,
      title: installed.target.title,
      url: installed.target.url
    } : null;
  }

  const summary = {
    ok: true,
    runDir,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    intervalMs,
    snapshotEveryMs,
    installFirst,
    stopOnGameOver,
    installTarget,
    ticks: 0,
    protocolRecords: 0,
    consoleProtocolRecords: 0,
    snapshots: 0,
    reports: 0,
    firstVisibleAt: "",
    lastVisible: false,
    lastProtocolCounts: {},
    lastProtocolIndex: -1,
    lastConsoleProtocolCounts: {},
    lastConsoleProtocolIndex: -1,
    gameOverAt: "",
    stopReason: "",
    userId: options.userId || "",
    uploadAllowed: true,
    uploadBlockedReason: "",
    reconnected: false,
    gameRecordPath: writeGameRecord ? paths.gameRecordPath : "",
    upload: null,
    files: paths
  };
  if (isVisibleValue(installValue)) markUploadBlocked(summary, "visible-at-install");
  if (typeof configureRuntimeRecordingImpl === "function") {
    try {
      summary.runtimeRecording = await configureRuntimeRecordingImpl({
        userId: summary.userId,
        clientSessionId: path.basename(runDir),
        uploadAllowed: summary.uploadAllowed,
        uploadBlockedReason: summary.uploadBlockedReason,
        reconnected: summary.reconnected
      });
    } catch (error) {
      summary.runtimeRecordingError = String(error?.stack || error);
    }
  }

  await appendJsonLine(paths.metaPath, {
    type: "start",
    time: startedAt,
    ts: summary.startedAt,
    durationMs,
    intervalMs,
    snapshotEveryMs,
    installFirst,
    stopOnGameOver,
    installTarget,
    userId: summary.userId,
    uploadAllowed: summary.uploadAllowed,
    uploadBlockedReason: summary.uploadBlockedReason,
    reconnected: summary.reconnected
  });

  const seenRecords = new Set();
  const seenConsoleRecords = new Set();
  let lastSnapshotAt = 0;
  while (Date.now() - startedAt <= durationMs) {
    summary.ticks++;
    const readAt = Date.now();
    const value = await readRuntimeSnapshotImpl();
    const snapshot = value?.snapshot || (value?.config || value?.protocol ? value : null);
    const visible = snapshot?.visible === true;
    if (summary.ticks === 1 && visible && summary.uploadAllowed !== false) {
      markUploadBlocked(summary, "visible-at-first-read");
      if (typeof configureRuntimeRecordingImpl === "function") {
        try {
          summary.runtimeRecording = await configureRuntimeRecordingImpl({
            userId: summary.userId,
            clientSessionId: path.basename(runDir),
            uploadAllowed: summary.uploadAllowed,
            uploadBlockedReason: summary.uploadBlockedReason,
            reconnected: summary.reconnected
          });
        } catch (error) {
          summary.runtimeRecordingError = String(error?.stack || error);
        }
      }
    }
    if (visible && !summary.firstVisibleAt) summary.firstVisibleAt = new Date(readAt).toISOString();
    summary.lastVisible = visible;
    const records = newProtocolRecords(snapshot, seenRecords);
    const consoleRecords = newProtocolConsoleRecords(snapshot, seenConsoleRecords);
    const gameOverRecord = records.concat(consoleRecords).find(isGameOverRecord);
    if (gameOverRecord && !summary.gameOverAt) {
      summary.gameOverAt = new Date(readAt).toISOString();
    }
    for (const record of records) {
      await appendJsonLine(paths.protocolRecordsPath, {
        type: "protocol.record",
        tick: summary.ticks,
        readAt,
        ts: new Date(readAt).toISOString(),
        record
      });
      summary.protocolRecords++;
      summary.lastProtocolIndex = Math.max(summary.lastProtocolIndex, Number(record.index ?? -1));
    }
    for (const record of consoleRecords) {
      await appendJsonLine(paths.protocolConsoleRecordsPath, {
        type: "protocol.console.record",
        tick: summary.ticks,
        readAt,
        ts: new Date(readAt).toISOString(),
        record
      });
      summary.consoleProtocolRecords++;
      summary.lastConsoleProtocolIndex = Math.max(summary.lastConsoleProtocolIndex, Number(record.index ?? -1));
    }

    const shouldSnapshot =
      summary.ticks === 1 ||
      visible ||
      records.length > 0 ||
      consoleRecords.length > 0 ||
      readAt - lastSnapshotAt >= snapshotEveryMs;
    if (shouldSnapshot) {
      const validation = validateSnapshotValue(value, validationOptions());
      const reports = buildCaptureReports(value, validation);
      await appendJsonLine(paths.snapshotsPath, {
        type: "snapshot",
        tick: summary.ticks,
        readAt,
        ts: new Date(readAt).toISOString(),
        value
      });
      await appendJsonLine(paths.reportsPath, {
        type: "reports",
        tick: summary.ticks,
        readAt,
        ts: new Date(readAt).toISOString(),
        validation,
        reports
      });
      summary.snapshots++;
      summary.reports++;
      lastSnapshotAt = readAt;
    }

    summary.lastProtocolCounts = snapshot?.protocol?.counts || {};
    summary.lastConsoleProtocolCounts = snapshot?.protocol?.consoleCounts || {};
    if (stopOnGameOver && summary.gameOverAt) {
      summary.stopReason = "game-over";
      break;
    }
    await wait(intervalMs);
  }

  const finishedAt = Date.now();
  summary.finishedAt = new Date(finishedAt).toISOString();
  summary.elapsedMs = finishedAt - startedAt;
  if (!summary.stopReason) summary.stopReason = "duration";
  await appendJsonLine(paths.metaPath, {
    type: "stop",
    time: finishedAt,
    ts: summary.finishedAt,
    elapsedMs: summary.elapsedMs,
    stopReason: summary.stopReason,
    protocolRecords: summary.protocolRecords,
    consoleProtocolRecords: summary.consoleProtocolRecords,
    snapshots: summary.snapshots,
    reports: summary.reports
  });

  let gameRecord = null;
  if (writeGameRecord) {
    gameRecord = await buildGameRecordPackageImpl({
      runDir,
      paths,
      summary,
      userId: options.userId || ""
    });
    await writeGameRecordPackage(paths.gameRecordPath, gameRecord);
  }
  if (options.uploadUrl && gameRecord) {
    if (summary.uploadAllowed === false) {
      summary.upload = {
        ok: false,
        skipped: true,
        reason: summary.uploadBlockedReason || "upload-not-allowed"
      };
    } else {
      try {
        summary.upload = await uploadGameRecordPackageImpl(gameRecord, {
          url: options.uploadUrl,
          userId: options.userId || "",
          password: options.password || "",
          apiKey: options.apiKey || ""
        });
      } catch (error) {
        summary.upload = {
          ok: false,
          error: String(error?.stack || error)
        };
      }
    }
  }
  await writeFile(paths.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

export function newProtocolRecords(snapshot, seen) {
  const records = Array.isArray(snapshot?.protocol?.records) ? snapshot.protocol.records : [];
  const out = [];
  for (const record of records) {
    const key = protocolRecordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

export function newProtocolConsoleRecords(snapshot, seen) {
  const records = Array.isArray(snapshot?.protocol?.consoleRecords) ? snapshot.protocol.consoleRecords : [];
  const out = [];
  for (const record of records) {
    const key = protocolRecordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

export function protocolRecordKey(record) {
  if (record?.index !== undefined && record?.index !== null) return `index:${record.index}`;
  return [
    "fallback",
    record?.time || 0,
    record?.name || "",
    record?.parsed?.type || "",
    record?.parsed?.msgId ?? ""
  ].join(":");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isVisibleValue(value) {
  const snapshot = value?.snapshot || value;
  return snapshot?.visible === true;
}

function markUploadBlocked(summary, reason) {
  if (summary.uploadAllowed === false) return;
  summary.uploadAllowed = false;
  summary.uploadBlockedReason = reason;
  summary.reconnected = true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
