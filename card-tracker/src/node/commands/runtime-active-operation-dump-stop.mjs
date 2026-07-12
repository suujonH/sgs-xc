import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ACTIVE_OPERATION_DUMP_STOP_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-active-operation-dump-stop`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tsvEscape(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function rowsFromRecords(records = []) {
  return records.map((record) => ({
    seq: record.seq,
    time: record.time,
    kind: record.kind,
    label: record.label,
    targetType: record.targetType || "",
    sceneBefore: record.sceneBefore?.scene || "",
    sceneAfter: record.sceneAfter?.scene || "",
    promptBefore: (record.sceneBefore?.promptTexts || []).join("|"),
    promptAfter: (record.sceneAfter?.promptTexts || []).join("|"),
    thisLabel: record.thisLabel || "",
    thisPath: record.thisPath || "",
    selectedBefore: record.beforeSelection ? JSON.stringify(record.beforeSelection).slice(0, 900) : "",
    selectedAfter: record.afterSelection ? JSON.stringify(record.afterSelection).slice(0, 900) : "",
    args: record.args ? JSON.stringify(record.args).slice(0, 1200) : "",
    result: record.result ? JSON.stringify(record.result).slice(0, 700) : "",
    threw: record.threw === true,
    blocked: record.kind === "blocked-call"
  }));
}

function buildTsv(rows) {
  const headers = [
    "seq",
    "time",
    "kind",
    "label",
    "targetType",
    "sceneBefore",
    "sceneAfter",
    "promptBefore",
    "promptAfter",
    "thisLabel",
    "thisPath",
    "selectedBefore",
    "selectedAfter",
    "args",
    "result",
    "threw",
    "blocked"
  ];
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => tsvEscape(row[header])).join("\t")).join("\n")}\n`;
}

function countBy(rows, keySelector) {
  const counts = {};
  for (const row of rows) {
    const key = keySelector(row) || "";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topText(counts, limit = 16) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

function readmeText(payload, rows) {
  const status = payload.dump?.status || {};
  const activeRows = rows.filter((row) => row.kind === "call");
  const sendRows = activeRows.filter((row) => /proxy\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(row.label));
  return [
    "# Runtime Active Operation Dump Stop",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Final scene: ${status.scene?.scene || ""}`,
    `- Records: ${rows.length}`,
    `- Calls: ${activeRows.length}`,
    `- Send/confirm-like calls: ${sendRows.length}`,
    `- Samples before stop: ${status.sampleCount || 0}`,
    `- Wrappers before stop: ${status.wrapperCount || 0}`,
    `- Blocked purchase-like calls: ${status.blockedCalls || 0}`,
    `- Errors: ${status.errors?.length || 0}`,
    "",
    "This command only dumps and stops the already-installed passive recorder. It does not click, confirm, use, discard, play, buy, refresh, pay, or read hidden opponent hand fields.",
    "",
    "## Top Labels",
    "",
    `- ${topText(countBy(rows, (row) => row.label)) || "(none)"}`,
    "",
    "## Send / Confirm-Like Rows",
    "",
    ...sendRows.slice(0, 160).map((row) => `- #${row.seq} ${row.label} scene=${row.sceneBefore}->${row.sceneAfter} prompt=${row.promptBefore || row.promptAfter || ""}`),
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const dumpResult = await evaluateOnSgs(
    "(() => window.__codexActiveOperationRecorder ? window.__codexActiveOperationRecorder.dump() : { ok: false, error: 'active operation recorder is not installed' })()",
    { timeoutMs: 45000, cdpTimeoutMs: 70000 }
  );
  const stopResult = await evaluateOnSgs(
    "(() => window.__codexActiveOperationRecorder ? window.__codexActiveOperationRecorder.stop() : { ok: true, reason: 'not installed' })()",
    { timeoutMs: 45000, cdpTimeoutMs: 70000 }
  );
  const payload = { target: dumpResult.target, dump: dumpResult.value, stop: stopResult.value };
  const rows = rowsFromRecords(payload.dump?.records || []);
  await writeJson(path.join(dir, "active-operation-dump-stop.json"), payload);
  await writeFile(path.join(dir, "active-operation-records.tsv"), buildTsv(rows), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(payload, rows), "utf8");
  console.log(JSON.stringify({
    ok: payload.dump?.ok !== false,
    dir,
    scene: payload.dump?.status?.scene?.scene || "",
    records: rows.length,
    calls: rows.filter((row) => row.kind === "call").length,
    sendOrConfirmLikeCalls: rows.filter((row) => /proxy\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(row.label)).length,
    wrappersBeforeStop: payload.dump?.status?.wrapperCount || 0,
    stopped: payload.stop?.ok !== false
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
