import childProcess from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCdpBase, listTargets } from "./cdp/client.mjs";
import {
  buildCaptureReports,
  compactReports,
  reportPathsForSnapshot,
  validationPathForSnapshot,
  writeCaptureArtifactSet,
  writeJsonFile
} from "./commands/capture-artifacts.mjs";
import { recordRuntimeSession } from "./commands/recording-session.mjs";
import { buildRecordingReportForDir, latestRecordingDir } from "./commands/recording-report.mjs";
import { buildRecordingTimelineForDir } from "./commands/recording-timeline.mjs";
import { buildOrderSourceCoverageForRecordings } from "./commands/order-source-coverage.mjs";
import { buildSnapshotReport } from "./commands/report-commands.mjs";
import { configureRuntimeRecording, installRuntime, readRuntimeSnapshot, stopRuntime } from "./commands/runtime-session.mjs";
import { ensureUserCredentials } from "./commands/user-credentials.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { validateSnapshotValue } = require("./validation/snapshot-validator.cjs");
const { buildHandSourceReport } = require("./analysis/hand-source-report.cjs");
const { buildProtocolFlowReport } = require("./analysis/protocol-flow-report.cjs");
const { buildPublicZoneReport } = require("./analysis/public-zone-report.cjs");
const capturesDir = path.join(rootDir, "captures");
const recordingsDir = path.join(rootDir, "recordings");
const defaultChromeProfile = path.resolve(rootDir, "..", "devBrowserTools", "work", "chrome-profile");
const defaultGameUrl = "https://web.sanguosha.com/220/h5_2/index_210000.php";

const command = process.argv[2] || "status";

async function install() {
  const { target, value } = await installRuntime();
  console.log(JSON.stringify({ ok: true, target: { id: target.id, title: target.title, url: target.url }, value }, null, 2));
}

async function status() {
  const targets = await listTargets(defaultCdpBase).catch((error) => ({ error: error.message }));
  console.log(JSON.stringify({ cdpBase: defaultCdpBase, targets }, null, 2));
}

function findChromePath() {
  const candidates = [
    process.env.SGS_CHROME,
    process.env.DEV_BROWSER_TOOLS_CHROME,
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    "chrome"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "chrome" || fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Chrome executable was not found. Set SGS_CHROME or CHROME_PATH.");
}

async function waitForCdp(timeoutMs = 15000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      await listTargets(defaultCdpBase);
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`CDP was not ready at ${defaultCdpBase}: ${lastError?.message || "unknown error"}`);
}

async function chrome() {
  try {
    await listTargets(defaultCdpBase);
    console.log(JSON.stringify({ ok: true, reused: true, cdpBase: defaultCdpBase }, null, 2));
    return;
  } catch {
    // Start Chrome below.
  }

  const profile = process.env.SGS_CHROME_PROFILE || defaultChromeProfile;
  const url = process.env.SGS_URL || defaultGameUrl;
  await mkdir(profile, { recursive: true });
  const args = [
    "--remote-debugging-port=9222",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--new-window",
    url
  ];
  const child = childProcess.spawn(findChromePath(), args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  await waitForCdp();
  console.log(JSON.stringify({ ok: true, reused: false, cdpBase: defaultCdpBase, profile, url }, null, 2));
}

async function snapshot() {
  const value = await readRuntimeSnapshot();
  console.log(JSON.stringify(value, null, 2));
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function capture() {
  await mkdir(capturesDir, { recursive: true });
  const value = await readRuntimeSnapshot();
  const validation = validateSnapshotValue(value, validationOptions());
  const outPath = path.join(capturesDir, `${timestampName()}-snapshot.json`);
  const artifact = await writeCaptureArtifactSet(outPath, value, validation, { latestDir: capturesDir });
  console.log(JSON.stringify({
    ok: true,
    outPath,
    validationPath: artifact.validationPath,
    handSourceReportPath: artifact.handSourceReportPath,
    publicZoneReportPath: artifact.publicZoneReportPath,
    protocolFlowReportPath: artifact.protocolFlowReportPath,
    snapshotOk: value?.ok,
    visible: value?.snapshot?.visible,
    validation: compactValidation(validation),
    reports: compactReports(artifact.reports)
  }, null, 2));
}

async function monitor() {
  const startedAt = Date.now();
  const durationMs = Number(process.env.SGS_MONITOR_MS || 300000);
  const intervalMs = Number(process.env.SGS_MONITOR_INTERVAL_MS || 1000);
  const captureEveryMs = Number(process.env.SGS_MONITOR_CAPTURE_EVERY_MS || 15000);
  const installFirst = process.env.SGS_MONITOR_INSTALL !== "0";
  const onceVisible = process.env.SGS_MONITOR_ONCE_VISIBLE !== "0";
  const runDir = path.join(capturesDir, `monitor-${timestampName()}`);
  await mkdir(runDir, { recursive: true });

  let installResult = null;
  if (installFirst) installResult = await installRuntime();

  const state = {
    runDir,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    intervalMs,
    captureEveryMs,
    installFirst,
    onceVisible,
    ticks: 0,
    snapshots: [],
    firstVisiblePath: "",
    firstVisibleValidationPath: "",
    firstVisibleHandSourceReportPath: "",
    firstVisiblePublicZoneReportPath: "",
    firstVisibleProtocolFlowReportPath: "",
    latestValidationPath: "",
    latestHandSourceReportPath: "",
    latestPublicZoneReportPath: "",
    latestProtocolFlowReportPath: "",
    lastVisible: false,
    lastCaptureAt: 0,
    lastProtocolCounts: "",
    lastSkillEventCount: 0,
    installTarget: installResult?.target ? {
      id: installResult.target.id,
      title: installResult.target.title,
      url: installResult.target.url
    } : null
  };

  while (Date.now() - startedAt <= durationMs) {
    state.ticks++;
    const value = await readRuntimeSnapshot();
    const snapshot = value?.snapshot;
    const validation = validateSnapshotValue(value, validationOptions());
    const reports = buildCaptureReports(value, validation);
    const visible = snapshot?.visible === true;
    const protocolCounts = JSON.stringify(snapshot?.protocol?.counts || {});
    const skillEventCount = Number(snapshot?.protocol?.recentSkillEvents?.length || 0);
    const shouldCapture =
      state.ticks === 1 ||
      visible !== state.lastVisible ||
      (visible && !state.firstVisiblePath) ||
      protocolCounts !== state.lastProtocolCounts ||
      skillEventCount !== state.lastSkillEventCount ||
      Date.now() - state.lastCaptureAt >= captureEveryMs;

    if (shouldCapture) {
      const name = `${String(state.ticks).padStart(4, "0")}-${visible ? "visible" : "waiting"}-snapshot.json`;
      const outPath = path.join(runDir, name);
      const artifact = await writeCaptureArtifactSet(outPath, value, validation, { reports, latestDir: capturesDir });
      state.latestValidationPath = artifact.validationPath;
      state.latestHandSourceReportPath = artifact.handSourceReportPath;
      state.latestPublicZoneReportPath = artifact.publicZoneReportPath;
      state.latestProtocolFlowReportPath = artifact.protocolFlowReportPath;
      state.snapshots.push({
        tick: state.ticks,
        outPath,
        validationPath: artifact.validationPath,
        handSourceReportPath: artifact.handSourceReportPath,
        publicZoneReportPath: artifact.publicZoneReportPath,
        protocolFlowReportPath: artifact.protocolFlowReportPath,
        visible,
        ok: value?.ok === true,
        validation: compactValidation(validation),
        reports: compactReports(reports),
        protocolCounts: snapshot?.protocol?.counts || {},
        skillEventCount
      });
      state.lastCaptureAt = Date.now();
      if (visible && !state.firstVisiblePath) {
        state.firstVisiblePath = path.join(runDir, "first-visible-snapshot.json");
        state.firstVisibleValidationPath = validationPathForSnapshot(state.firstVisiblePath);
        const firstVisibleReportPaths = reportPathsForSnapshot(state.firstVisiblePath);
        state.firstVisibleHandSourceReportPath = firstVisibleReportPaths.handSourceReportPath;
        state.firstVisiblePublicZoneReportPath = firstVisibleReportPaths.publicZoneReportPath;
        state.firstVisibleProtocolFlowReportPath = firstVisibleReportPaths.protocolFlowReportPath;
        await writeCaptureArtifactSet(state.firstVisiblePath, value, validation, { reports });
      }
      console.log(JSON.stringify({
        tick: state.ticks,
        visible,
        ok: value?.ok === true,
        outPath,
        validationPath: artifact.validationPath,
        handSourceReportPath: artifact.handSourceReportPath,
        publicZoneReportPath: artifact.publicZoneReportPath,
        protocolFlowReportPath: artifact.protocolFlowReportPath,
        firstVisiblePath: state.firstVisiblePath || null,
        firstVisibleValidationPath: state.firstVisibleValidationPath || null,
        firstVisibleHandSourceReportPath: state.firstVisibleHandSourceReportPath || null,
        firstVisiblePublicZoneReportPath: state.firstVisiblePublicZoneReportPath || null,
        firstVisibleProtocolFlowReportPath: state.firstVisibleProtocolFlowReportPath || null,
        validation: compactValidation(validation),
        reports: compactReports(reports),
        protocolCounts: snapshot?.protocol?.counts || {},
        skillEventCount
      }));
    }

    state.lastVisible = visible;
    state.lastProtocolCounts = protocolCounts;
    state.lastSkillEventCount = skillEventCount;
    if (visible && onceVisible) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const summaryPath = path.join(runDir, "summary.json");
  await writeJsonFile(summaryPath, {
    ok: true,
    ...state,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt
  });
  console.log(JSON.stringify({ ok: true, summaryPath, runDir, firstVisiblePath: state.firstVisiblePath || null }, null, 2));
}

async function record() {
  const runDir = process.env.SGS_RECORD_DIR || path.join(recordingsDir, `recording-${timestampName()}`);
  const uploadUrl = process.env.SGS_GAME_RECORD_API_URL || process.env.SGS_RECORD_API_URL || "";
  const credentials = await ensureUserCredentials({
    rootDir,
    uploadUrl,
    userId: process.env.SGS_RECORD_USER_ID || "",
    password: process.env.SGS_RECORD_PASSWORD || process.env.SGS_RECORD_USER_PASSWORD || ""
  });
  const summary = await recordRuntimeSession({
    runDir,
    durationMs: Number(process.env.SGS_RECORD_MS || 300000),
    intervalMs: Number(process.env.SGS_RECORD_INTERVAL_MS || 1000),
    snapshotEveryMs: Number(process.env.SGS_RECORD_SNAPSHOT_EVERY_MS || 3000),
    installFirst: process.env.SGS_RECORD_INSTALL !== "0",
    stopOnGameOver: process.env.SGS_RECORD_STOP_ON_GAME_OVER !== "0",
    writeGameRecord: process.env.SGS_RECORD_WRITE_GAME_RECORD !== "0",
    uploadUrl,
    userId: credentials.userId || process.env.USERNAME || process.env.USER || "local",
    password: credentials.password || "",
    apiKey: process.env.SGS_RECORD_API_KEY || "",
    installRuntimeImpl: installRuntime,
    configureRuntimeRecordingImpl: configureRuntimeRecording,
    readRuntimeSnapshotImpl: readRuntimeSnapshot,
    validateSnapshotValue,
    validationOptions,
    buildCaptureReports
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.upload && summary.upload.ok === false && process.env.SGS_RECORD_REQUIRE_UPLOAD === "1") {
    process.exitCode = 1;
  }
}

async function recordingReport() {
  const target = process.env.SGS_RECORDING_REPORT_DIR || process.argv[3] || await latestRecordingDir(recordingsDir);
  const skillAuditPath = process.env.SGS_SKILL_AUDIT_FILE || path.join(rootDir, "reports", "skill-audit", "skill-rule-audit-current.json");
  const report = await buildRecordingReportForDir(target, { skillAuditPath });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

async function recordingTimeline() {
  const target = process.env.SGS_RECORDING_TIMELINE_DIR || process.env.SGS_RECORDING_REPORT_DIR || process.argv[3] || await latestRecordingDir(recordingsDir);
  const skillAuditPath = process.env.SGS_SKILL_AUDIT_FILE || path.join(rootDir, "reports", "skill-audit", "skill-rule-audit-current.json");
  const timeline = await buildRecordingTimelineForDir(target, { skillAuditPath });
  if (process.env.SGS_RECORDING_TIMELINE_TEXT === "1") {
    console.log(timeline.text.join("\n"));
  } else {
    console.log(JSON.stringify(timeline, null, 2));
  }
  if (!timeline.ok) process.exitCode = 1;
}

async function orderSourceCoverage() {
  const target = process.env.SGS_ORDER_SOURCE_COVERAGE_DIR || process.argv[3] || recordingsDir;
  if (!process.env.SGS_ORDER_SOURCE_COVERAGE_DIR && !process.argv[3]) await mkdir(recordingsDir, { recursive: true });
  const skillAuditPath = process.env.SGS_SKILL_AUDIT_FILE || path.join(rootDir, "reports", "skill-audit", "skill-rule-audit-current.json");
  const outputPath = process.env.SGS_ORDER_SOURCE_COVERAGE_OUT || path.join(rootDir, "reports", "skill-audit", "order-source-coverage-current.json");
  const report = await buildOrderSourceCoverageForRecordings(target, { skillAuditPath, outputPath });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || (process.env.SGS_ORDER_SOURCE_COVERAGE_STRICT === "1" && !report.coverageComplete)) process.exitCode = 1;
}

async function validate() {
  const filePath = process.env.SGS_VALIDATE_FILE || process.argv[3] || "";
  const value = filePath
    ? JSON.parse(await readFile(path.resolve(filePath), "utf8"))
    : await readRuntimeSnapshot();
  const validation = validateSnapshotValue(value, validationOptions());
  console.log(JSON.stringify({ ok: validation.ok, filePath: filePath || null, validation }, null, 2));
  if (!validation.ok) process.exitCode = 1;
}

async function sourceReport() {
  await printSnapshotReport("SGS_SOURCE_REPORT_FILE", buildHandSourceReport);
}

async function publicZoneReport() {
  await printSnapshotReport("SGS_PUBLIC_ZONE_REPORT_FILE", buildPublicZoneReport);
}

async function protocolFlowReport() {
  await printSnapshotReport("SGS_PROTOCOL_FLOW_REPORT_FILE", buildProtocolFlowReport);
}

async function printSnapshotReport(envName, buildReport) {
  const result = await buildSnapshotReport({
    envName,
    buildReport,
    validateSnapshotValue,
    validationOptions
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function validationOptions() {
  return {
    requireVisible: process.env.SGS_VALIDATE_REQUIRE_VISIBLE === "1" || process.argv.includes("--require-visible")
  };
}

function compactValidation(validation) {
  return {
    ok: validation.ok,
    status: validation.status,
    counts: validation.counts,
    visible: validation.visible
  };
}

async function stop() {
  const value = await stopRuntime();
  console.log(JSON.stringify(value, null, 2));
}

if (command === "chrome") await chrome();
else if (command === "install") await install();
else if (command === "status") await status();
else if (command === "snapshot") await snapshot();
else if (command === "capture") await capture();
else if (command === "monitor") await monitor();
else if (command === "record") await record();
else if (command === "recording-report") await recordingReport();
else if (command === "recording-timeline") await recordingTimeline();
else if (command === "order-source-coverage") await orderSourceCoverage();
else if (command === "validate") await validate();
else if (command === "source-report") await sourceReport();
else if (command === "public-zone-report") await publicZoneReport();
else if (command === "protocol-flow-report") await protocolFlowReport();
else if (command === "stop") await stop();
else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}
