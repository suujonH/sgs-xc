import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { recordingPaths } from "./recording-session.mjs";

const require = createRequire(import.meta.url);
const { buildRecordingReport } = require("../analysis/recording-report.cjs");

export async function latestRecordingDir(recordingsDir) {
  let entries = [];
  try {
    entries = await readdir(recordingsDir, { withFileTypes: true });
  } catch {
    return "";
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("recording-")) continue;
    const fullPath = path.join(recordingsDir, entry.name);
    let info = null;
    try {
      info = await stat(fullPath);
    } catch {
      continue;
    }
    candidates.push({ path: fullPath, name: entry.name, mtimeMs: Number(info.mtimeMs || 0) });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  return candidates[0]?.path || "";
}

export async function buildRecordingReportForDir(recordingDir, options = {}) {
  const resolvedDir = recordingDir ? path.resolve(recordingDir) : "";
  if (!resolvedDir) {
    return {
      ok: false,
      recordingDir: "",
      error: "recording directory is missing",
      problems: [{ severity: "error", id: "recording-directory-missing", message: "recording directory is missing" }]
    };
  }

  try {
    const info = await stat(resolvedDir);
    if (!info.isDirectory()) {
      return {
        ok: false,
        recordingDir: resolvedDir,
        error: "recording path is not a directory",
        problems: [{ severity: "error", id: "recording-path-not-directory", message: "recording path is not a directory" }]
      };
    }
  } catch (error) {
    return {
      ok: false,
      recordingDir: resolvedDir,
      error: error.message,
      problems: [{ severity: "error", id: "recording-directory-read-failed", message: error.message }]
    };
  }

  const paths = recordingPaths(resolvedDir);
  const summary = await readJsonFile(paths.summaryPath);
  const meta = await readJsonlFile(paths.metaPath);
  const protocol = await readJsonlFile(paths.protocolRecordsPath);
  const protocolConsole = await readJsonlFile(paths.protocolConsoleRecordsPath);
  const snapshots = await readJsonlFile(paths.snapshotsPath);
  const reports = await readJsonlFile(paths.reportsPath);
  const skillAudit = options.skillAuditPath ? await readJsonFile(options.skillAuditPath) : { file: null, value: null, parseErrors: [] };
  const parseErrors = [
    ...summary.parseErrors,
    ...meta.parseErrors,
    ...protocol.parseErrors,
    ...protocolConsole.parseErrors,
    ...snapshots.parseErrors,
    ...reports.parseErrors,
    ...skillAudit.parseErrors
  ];

  return buildRecordingReport({
    recordingDir: resolvedDir,
    summary: summary.value,
    metaRows: meta.rows,
    protocolRows: protocol.rows,
    consoleProtocolRows: protocolConsole.rows,
    snapshotRows: snapshots.rows,
    reportRows: reports.rows,
    files: {
      summary: summary.file,
      meta: meta.file,
      protocolRecords: protocol.file,
      protocolConsoleRecords: protocolConsole.file,
      snapshots: snapshots.file,
      reports: reports.file,
      ...(skillAudit.file ? { skillAudit: skillAudit.file } : {})
    },
    skillAudit: skillAudit.value,
    parseErrors
  });
}

export async function readJsonFile(filePath) {
  const file = { path: filePath, exists: false, lines: 0 };
  try {
    const text = await readFile(filePath, "utf8");
    file.exists = true;
    file.lines = text ? text.split(/\r?\n/).length : 0;
    return { file, value: JSON.parse(text), parseErrors: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { file, value: null, parseErrors: [] };
    return {
      file: { ...file, exists: true },
      value: null,
      parseErrors: [{ path: filePath, line: null, message: error.message }]
    };
  }
}

export async function readJsonlFile(filePath) {
  const file = { path: filePath, exists: false, lines: 0 };
  try {
    const text = await readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    file.exists = true;
    file.lines = lines.filter(Boolean).length;
    const rows = [];
    const parseErrors = [];
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        parseErrors.push({ path: filePath, line: index + 1, message: error.message });
      }
    });
    return { file, rows, parseErrors };
  } catch (error) {
    if (error?.code === "ENOENT") return { file, rows: [], parseErrors: [] };
    return {
      file: { ...file, exists: true },
      rows: [],
      parseErrors: [{ path: filePath, line: null, message: error.message }]
    };
  }
}
