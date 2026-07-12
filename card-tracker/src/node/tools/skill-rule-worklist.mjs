import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildSkillRuleWorklist } = require("../analysis/skill-rule-worklist.cjs");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const defaultAuditPath = path.join(rootDir, "reports", "skill-audit", "skill-rule-audit-current.json");
const defaultOutPath = path.join(rootDir, "reports", "skill-audit", "skill-rule-worklist-current.json");
const auditPath = path.resolve(process.env.SGS_SKILL_AUDIT_FILE || process.argv[2] || defaultAuditPath);
const outPath = path.resolve(process.env.SGS_SKILL_WORKLIST_OUT || defaultOutPath);
const sampleLimit = Number(process.env.SGS_SKILL_WORKLIST_SAMPLE_LIMIT || process.argv[3] || 20);
const stdoutMode = process.env.SGS_SKILL_WORKLIST_STDOUT || "summary";

let audit = null;
let readError = null;
try {
  audit = JSON.parse(await readFile(auditPath, "utf8"));
} catch (error) {
  readError = error;
}

let report = readError
  ? {
      ok: false,
      auditPath,
      outPath,
      problems: [{ severity: "error", id: "skill-audit-read-failed", message: readError.message }]
    }
  : {
      auditPath,
      outPath,
      ...buildSkillRuleWorklist(audit, { sampleLimit })
    };

try {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
} catch (error) {
  report = {
    ...report,
    ok: false,
    problems: [
      ...(Array.isArray(report.problems) ? report.problems : []),
      { severity: "error", id: "skill-worklist-write-failed", message: error.message, path: outPath }
    ]
  };
}

console.log(JSON.stringify(stdoutMode === "full" ? report : summarizeForStdout(report), null, 2));
if (!report.ok) process.exitCode = 1;

function summarizeForStdout(report) {
  return {
    ok: report.ok === true,
    auditPath: report.auditPath || auditPath,
    outPath: report.outPath || outPath,
    source: report.source || "",
    generatedAt: report.generatedAt || "",
    counts: report.counts || {},
    boundary: report.boundary || {},
    strategyQueues: compactQueues(report.strategyQueues),
    categoryQueues: compactQueues(report.categoryQueues),
    exactIdentityQueues: compactQueues(report.exactIdentityQueues),
    ruleMatrix: compactRuleMatrix(report.ruleMatrix),
    nextActions: report.nextActions || [],
    problems: report.problems || [],
    stdout: {
      mode: "summary",
      fullReport: report.outPath || outPath,
      fullStdoutEnv: "SGS_SKILL_WORKLIST_STDOUT=full"
    }
  };
}

function compactQueues(queues) {
  return (Array.isArray(queues) ? queues : []).map((queue) => ({
    id: queue.id || "",
    ...(queue.strategy ? { strategy: queue.strategy } : {}),
    priority: Number(queue.priority || 0),
    count: Number(queue.count || 0),
    requiredSources: Array.isArray(queue.requiredSources) ? queue.requiredSources : []
  }));
}

function compactRuleMatrix(ruleMatrix) {
  if (!ruleMatrix || typeof ruleMatrix !== "object") return null;
  return {
    version: Number(ruleMatrix.version || 0),
    counts: ruleMatrix.counts || {},
    boundary: ruleMatrix.boundary || {}
  };
}
