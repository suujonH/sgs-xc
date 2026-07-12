import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { buildRecordingReportForDir, readJsonFile } from "./recording-report.mjs";

const require = createRequire(import.meta.url);
const { buildOrderSourceCoverage } = require("../analysis/order-source-coverage.cjs");

export async function buildOrderSourceCoverageForRecordings(targetPath, options = {}) {
  const resolvedTarget = targetPath ? path.resolve(targetPath) : "";
  const skillAuditPath = options.skillAuditPath ? path.resolve(options.skillAuditPath) : "";
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : "";
  const recordingDirsResult = await recordingDirs(resolvedTarget);
  const skillAudit = skillAuditPath
    ? await readJsonFile(skillAuditPath)
    : { file: null, value: null, parseErrors: [] };
  const reports = [];
  const reportProblems = [];

  for (const dir of recordingDirsResult.dirs) {
    const report = await buildRecordingReportForDir(dir, { skillAuditPath });
    reports.push(report);
    if (!report.ok) {
      reportProblems.push({
        severity: "error",
        id: "recording-report-not-ok",
        message: "recording report was not ok",
        recordingDir: dir,
        problems: report.problems || []
      });
    }
  }

  const coverage = buildOrderSourceCoverage({
    skillAudit: skillAudit.value,
    skillAuditPath,
    recordingsRoot: recordingDirsResult.root,
    recordingDirs: recordingDirsResult.dirs,
    reports,
    reportProblems: [
      ...recordingDirsResult.problems,
      ...reportProblems
    ],
    parseErrors: skillAudit.parseErrors
  });

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
    coverage.outputPath = outputPath;
  }

  return coverage;
}

export async function recordingDirs(targetPath) {
  if (!targetPath) {
    return {
      root: "",
      dirs: [],
      problems: [{
        severity: "error",
        id: "recording-root-missing",
        message: "recording root path is missing"
      }]
    };
  }

  let info;
  try {
    info = await stat(targetPath);
  } catch (error) {
    return {
      root: targetPath,
      dirs: [],
      problems: [{
        severity: "error",
        id: "recording-root-read-failed",
        message: error.message,
        path: targetPath
      }]
    };
  }
  if (!info.isDirectory()) {
    return {
      root: targetPath,
      dirs: [],
      problems: [{
        severity: "error",
        id: "recording-root-not-directory",
        message: "recording root path is not a directory",
        path: targetPath
      }]
    };
  }

  if (path.basename(targetPath).startsWith("recording-")) {
    return { root: path.dirname(targetPath), dirs: [targetPath], problems: [] };
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("recording-")) continue;
    dirs.push(path.join(targetPath, entry.name));
  }
  dirs.sort();
  return { root: targetPath, dirs, problems: [] };
}
