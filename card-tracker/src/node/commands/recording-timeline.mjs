import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { recordingPaths } from "./recording-session.mjs";
import { buildRecordingReportForDir, latestRecordingDir, readJsonFile, readJsonlFile } from "./recording-report.mjs";

const require = createRequire(import.meta.url);
const { buildRecordingTimeline } = require("../analysis/recording-timeline.cjs");

export { latestRecordingDir };

export async function buildRecordingTimelineForDir(recordingDir, options = {}) {
  const resolvedDir = recordingDir ? path.resolve(recordingDir) : "";
  if (!resolvedDir) {
    return buildRecordingTimeline({
      recordingDir: "",
      recordingReport: {
        ok: false,
        recordingDir: "",
        problems: [{ severity: "error", id: "recording-directory-missing", message: "recording directory is missing" }]
      }
    });
  }

  try {
    const info = await stat(resolvedDir);
    if (!info.isDirectory()) {
      return buildRecordingTimeline({
        recordingDir: resolvedDir,
        recordingReport: {
          ok: false,
          recordingDir: resolvedDir,
          problems: [{ severity: "error", id: "recording-path-not-directory", message: "recording path is not a directory" }]
        }
      });
    }
  } catch (error) {
    return buildRecordingTimeline({
      recordingDir: resolvedDir,
      recordingReport: {
        ok: false,
        recordingDir: resolvedDir,
        problems: [{ severity: "error", id: "recording-directory-read-failed", message: error.message }]
      }
    });
  }

  const paths = recordingPaths(resolvedDir);
  const report = await buildRecordingReportForDir(resolvedDir, options);
  const summary = await readJsonFile(paths.summaryPath);
  const meta = await readJsonlFile(paths.metaPath);
  const protocol = await readJsonlFile(paths.protocolRecordsPath);
  const protocolConsole = await readJsonlFile(paths.protocolConsoleRecordsPath);
  const snapshots = await readJsonlFile(paths.snapshotsPath);
  const reports = await readJsonlFile(paths.reportsPath);
  const parseErrors = [
    ...summary.parseErrors,
    ...meta.parseErrors,
    ...protocol.parseErrors,
    ...protocolConsole.parseErrors,
    ...snapshots.parseErrors,
    ...reports.parseErrors
  ];

  return buildRecordingTimeline({
    recordingDir: resolvedDir,
    summary: summary.value,
    metaRows: meta.rows,
    protocolRows: protocol.rows,
    consoleProtocolRows: protocolConsole.rows,
    snapshotRows: snapshots.rows,
    reportRows: reports.rows,
    recordingReport: report,
    parseErrors
  });
}
