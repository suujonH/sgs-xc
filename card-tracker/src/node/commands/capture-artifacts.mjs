import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { buildHandSourceReport } = require("../analysis/hand-source-report.cjs");
const { buildProtocolFlowReport } = require("../analysis/protocol-flow-report.cjs");
const { buildPublicZoneReport } = require("../analysis/public-zone-report.cjs");

export async function writeJsonFile(outPath, value) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function validationPathForSnapshot(snapshotPath) {
  return snapshotPath.replace(/-snapshot\.json$/, "-validation.json");
}

export function reportPathsForSnapshot(snapshotPath) {
  return {
    handSourceReportPath: snapshotPath.replace(/-snapshot\.json$/, "-source-report.json"),
    publicZoneReportPath: snapshotPath.replace(/-snapshot\.json$/, "-public-zone-report.json"),
    protocolFlowReportPath: snapshotPath.replace(/-snapshot\.json$/, "-protocol-flow-report.json")
  };
}

export function latestArtifactPaths(capturesDir) {
  return {
    snapshotPath: path.join(capturesDir, "latest-snapshot.json"),
    validationPath: path.join(capturesDir, "latest-validation.json"),
    handSourceReportPath: path.join(capturesDir, "latest-source-report.json"),
    publicZoneReportPath: path.join(capturesDir, "latest-public-zone-report.json"),
    protocolFlowReportPath: path.join(capturesDir, "latest-protocol-flow-report.json")
  };
}

export function buildCaptureReports(value, validation) {
  return {
    handSourceReport: buildHandSourceReport(value, validation),
    publicZoneReport: buildPublicZoneReport(value, validation),
    protocolFlowReport: buildProtocolFlowReport(value, validation)
  };
}

export async function writeCaptureArtifactSet(snapshotPath, value, validation, options = {}) {
  const reports = options.reports || buildCaptureReports(value, validation);
  const validationPath = validationPathForSnapshot(snapshotPath);
  const reportPaths = reportPathsForSnapshot(snapshotPath);
  await writeJsonFile(snapshotPath, value);
  await writeJsonFile(validationPath, validation);
  await writeReports(reportPaths, reports);

  if (options.latestDir) {
    const latest = latestArtifactPaths(options.latestDir);
    await writeJsonFile(latest.snapshotPath, value);
    await writeJsonFile(latest.validationPath, validation);
    await writeReports(latest, reports);
  }

  return {
    validationPath,
    handSourceReportPath: reportPaths.handSourceReportPath,
    publicZoneReportPath: reportPaths.publicZoneReportPath,
    protocolFlowReportPath: reportPaths.protocolFlowReportPath,
    reports
  };
}

export async function writeReports(paths, reports) {
  await writeJsonFile(paths.handSourceReportPath, reports.handSourceReport);
  await writeJsonFile(paths.publicZoneReportPath, reports.publicZoneReport);
  await writeJsonFile(paths.protocolFlowReportPath, reports.protocolFlowReport);
}

export function compactReports(reports) {
  const hand = reports.handSourceReport || {};
  const publicZone = reports.publicZoneReport || {};
  const protocolFlow = reports.protocolFlowReport || {};
  return {
    handSource: {
      ok: hand.ok === true,
      ledgerKnownCards: hand.counts?.ledgerKnownCards || 0,
      rawVisibleCards: hand.counts?.rawVisibleCards || 0,
      maskLedgerProblems: hand.mask?.ledgerProblems?.length || 0,
      protocolAuthorizedProblems: hand.protocolAuthorized?.ledgerProblems?.length || 0
    },
    publicZone: {
      ok: publicZone.ok === true,
      cards: publicZone.counts?.cards || 0,
      problems: publicZone.provenance?.problems?.length || 0
    },
    protocolFlow: {
      ok: protocolFlow.ok === true,
      records: protocolFlow.counts?.records || 0,
      cardMoves: protocolFlow.counts?.cardMoves || 0,
      skillEvents: protocolFlow.counts?.skillEvents || 0,
      plans: protocolFlow.counts?.plans || 0,
      problems: protocolFlow.counts?.problems || 0
    }
  };
}
