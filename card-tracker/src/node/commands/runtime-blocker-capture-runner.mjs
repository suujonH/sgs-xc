import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const PRESETS = {
  battle: [
    "all-registration-names",
    "battle-entry-exit-tracker-ui",
    "skill-trigger-protocol",
    "card-ui-movement-selection"
  ],
  card: [
    "battle-entry-exit-tracker-ui",
    "skill-trigger-protocol",
    "card-ui-movement-selection"
  ],
  field: ["all-registration-names"],
  window: ["object-scene-window-switch", "buttons-clicks-ui"],
  hover: ["hover-popup"],
  rogue: ["rogue-overlays-shop-auto-skill"],
  qifu: ["effects-qifu-blocking"],
  qixing: ["shen-zhuge-qixing"],
  yanjiao: ["yanjiao-list-allocation"],
  resource: ["resource-drawing-replacement"]
};

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestDir(suffix, marker) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const fullPath = path.join(explorationRoot, entry.name);
    if (!marker || await exists(path.join(fullPath, marker))) dirs.push(fullPath);
  }
  dirs.sort();
  return dirs.at(-1) || null;
}

async function readJsonIfExists(filePath) {
  if (!filePath || !await exists(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_BLOCKER_CAPTURE_RUN_DIR ||
      path.join(explorationRoot, `${timestampName()}-blocker-capture-session-run`)
  );
}

function parseArgs(argv) {
  const options = {
    phase: "pre-arm",
    sessions: [],
    requirements: [],
    cases: [],
    presets: [],
    dryRun: false,
    list: false,
    listPresets: false,
    all: false,
    noDedupe: false,
    parallel: null,
    timeoutMs: null,
    planDir: "",
    keepActiveRecorder: false,
    detach: false,
    armFast: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || "";
    if (arg === "--phase") options.phase = next();
    else if (arg.startsWith("--phase=")) options.phase = arg.slice("--phase=".length);
    else if (arg === "--session") options.sessions.push(...splitList(next()));
    else if (arg.startsWith("--session=")) options.sessions.push(...splitList(arg.slice("--session=".length)));
    else if (arg === "--requirement") options.requirements.push(...splitList(next()));
    else if (arg.startsWith("--requirement=")) options.requirements.push(...splitList(arg.slice("--requirement=".length)));
    else if (arg === "--case") options.cases.push(...splitList(next()));
    else if (arg.startsWith("--case=")) options.cases.push(...splitList(arg.slice("--case=".length)));
    else if (arg === "--preset") options.presets.push(...splitList(next()));
    else if (arg.startsWith("--preset=")) options.presets.push(...splitList(arg.slice("--preset=".length)));
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next());
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else if (arg === "--plan-dir") options.planDir = next();
    else if (arg.startsWith("--plan-dir=")) options.planDir = arg.slice("--plan-dir=".length);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--list-presets") options.listPresets = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--no-dedupe") options.noDedupe = true;
    else if (arg === "--parallel") options.parallel = true;
    else if (arg === "--sequential") options.parallel = false;
    else if (arg === "--keep-active-recorder") options.keepActiveRecorder = true;
    else if (arg === "--detach") options.detach = true;
    else if (arg === "--arm-fast") options.armFast = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.phase = options.phase || "pre-arm";
  return options;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function usageText() {
  return [
    "Usage:",
    "  node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --list",
    "  node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset battle --phase pre-arm",
    "  node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --session capture-05 --phase during-action",
    "  node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --all --phase post-derive --sequential",
    "",
    "Options:",
    "  --phase <pre-arm|during-action|cleanup|post-derive|all>",
    "  --session <capture-03,capture-04>",
    "  --requirement <requirement-id>",
    "  --case <case-id>",
    "  --preset <battle|card|field|window|hover|rogue|qifu|qixing|yanjiao|resource>",
    "  --all",
    "  --dry-run",
    "  --parallel / --sequential",
    "  --timeout-ms <number>",
    "  --keep-active-recorder",
    "  --detach",
    "  --arm-fast"
  ].join("\n");
}

async function loadPlan(options) {
  const planDir = options.planDir
    ? path.resolve(options.planDir)
    : await latestDir("-blocker-capture-plan-report", "blocker-capture-plan.json");
  if (!planDir) throw new Error("No blocker capture plan found. Run runtime-blocker-capture-plan-report.mjs first.");
  const planPath = path.join(planDir, "blocker-capture-plan.json");
  const plan = await readJsonIfExists(planPath);
  if (!plan?.commandRows || !plan?.sessionRows) throw new Error(`Invalid blocker capture plan: ${planPath}`);
  return { planDir, planPath, plan };
}

function presetRequirements(options) {
  const requirements = [];
  for (const preset of options.presets) {
    if (!PRESETS[preset]) throw new Error(`Unknown preset: ${preset}`);
    requirements.push(...PRESETS[preset]);
  }
  return Array.from(new Set(requirements));
}

function selectedCommandRows(plan, options) {
  const presetReqs = presetRequirements(options);
  const wantedSessions = new Set(options.sessions);
  const wantedRequirements = new Set([...options.requirements, ...presetReqs]);
  const wantedCases = new Set(options.cases);
  const hasSelector = options.all || wantedSessions.size || wantedRequirements.size || wantedCases.size;
  if (!hasSelector && !options.list && !options.dryRun) {
    throw new Error("Refusing to execute without a selector. Pass --session, --requirement, --preset, or --all.");
  }
  let rows = plan.commandRows || [];
  if (options.phase !== "all") rows = rows.filter((row) => row.phase === options.phase);
  if (!options.all) {
    rows = rows.filter((row) => {
      if (wantedSessions.size && wantedSessions.has(row.sessionId)) return true;
      if (wantedRequirements.size && wantedRequirements.has(row.requirementId)) return true;
      if (wantedCases.size && wantedCases.has(row.caseId)) return true;
      return !hasSelector && options.dryRun;
    });
  }
  rows = rows.slice().sort((a, b) => {
    const phaseA = Number(a.phaseOrder || 0);
    const phaseB = Number(b.phaseOrder || 0);
    return phaseA - phaseB || Number(a.order || 0) - Number(b.order || 0) || String(a.command).localeCompare(String(b.command));
  });
  if (options.noDedupe) return rows.map((row) => ({ ...row, sessionIds: [row.sessionId], requirementIds: [row.requirementId], caseIds: [row.caseId] }));
  const byCommand = new Map();
  for (const row of rows) {
    const key = `${row.phase}\t${row.command}`;
    if (!byCommand.has(key)) {
      byCommand.set(key, {
        ...row,
        sessionIds: [],
        requirementIds: [],
        caseIds: []
      });
    }
    const target = byCommand.get(key);
    target.sessionIds.push(row.sessionId);
    target.requirementIds.push(row.requirementId);
    target.caseIds.push(row.caseId);
  }
  return Array.from(byCommand.values()).map((row) => ({
    ...row,
    sessionIds: Array.from(new Set(row.sessionIds)),
    requirementIds: Array.from(new Set(row.requirementIds)),
    caseIds: Array.from(new Set(row.caseIds.filter(Boolean)))
  }));
}

function shouldRunParallel(options) {
  if (options.detach) return true;
  if (options.parallel != null) return options.parallel;
  return options.phase === "pre-arm";
}

function defaultTimeoutMs(options) {
  if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) return options.timeoutMs;
  if (options.phase === "post-derive") return 300000;
  return 240000;
}

function armFastWatchMs() {
  const value = Number(process.env.SGS_BLOCKER_CAPTURE_ARM_FAST_WATCH_MS || 300000);
  return Number.isFinite(value) && value > 0 ? String(value) : "300000";
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function spawnSpec(command) {
  const tokens = tokenizeCommand(command);
  if (!tokens.length) throw new Error("Empty command");
  if (tokens[0].toLowerCase() === "node") {
    return { file: process.execPath, args: tokens.slice(1) };
  }
  return { file: tokens[0], args: tokens.slice(1) };
}

function commandLogBase(row, index) {
  const scriptName = path.basename(row.scriptPath || "command").replace(/\.mjs$/i, "");
  const safePhase = String(row.phase || "phase").replace(/[^a-z0-9-]/gi, "_");
  return `${String(index + 1).padStart(3, "0")}-${safePhase}-${scriptName}`;
}

async function runCommand(row, index, outDir, options) {
  const logsDir = path.join(outDir, "logs");
  await mkdir(logsDir, { recursive: true });
  const base = commandLogBase(row, index);
  const stdoutPath = path.join(logsDir, `${base}.stdout.log`);
  const stderrPath = path.join(logsDir, `${base}.stderr.log`);
  if (row.scriptExists && row.scriptExists !== "true") {
    return {
      ...resultBase(row, index, stdoutPath, stderrPath),
      status: "skipped-missing-script",
      exitCode: "",
      signal: "",
      durationMs: 0,
      timedOut: "false"
    };
  }
  const spec = spawnSpec(row.command);
  const env = {
    ...process.env,
    SGS_BLOCKER_CAPTURE_RUNNER: "1",
    SGS_BLOCKER_CAPTURE_RUNNER_SESSION_IDS: (row.sessionIds || []).join(","),
    SGS_BLOCKER_CAPTURE_RUNNER_REQUIREMENT_IDS: (row.requirementIds || []).join(",")
  };
  const activeRecorderCommand = /runtime-active-operation-recorder\.mjs/.test(row.command);
  if ((options.keepActiveRecorder || options.armFast) && activeRecorderCommand) {
    env.SGS_ACTIVE_OPERATION_KEEP_INSTALLED = "1";
  }
  if (options.armFast && activeRecorderCommand && row.phase === "pre-arm") {
    env.SGS_ACTIVE_OPERATION_RECORDER_MS = process.env.SGS_ACTIVE_OPERATION_RECORDER_MS || "0";
  }
  if (options.armFast && row.phase === "pre-arm") {
    const watchMs = armFastWatchMs();
    if (/runtime-live-gap-watch\.mjs/.test(row.command)) {
      env.SGS_LIVE_GAP_WATCH_MS = process.env.SGS_LIVE_GAP_WATCH_MS || watchMs;
      env.SGS_LIVE_GAP_WATCH_KEEP_INSTALLED = "1";
    }
    if (/runtime-event-field-transition-watch\.mjs/.test(row.command)) {
      env.SGS_EVENT_FIELD_TRANSITION_WATCH_MS = process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_MS || watchMs;
      env.SGS_EVENT_FIELD_TRANSITION_WATCH_KEEP_INSTALLED = "1";
    }
    if (/runtime-prompt-automation-monitor\.mjs/.test(row.command)) {
      env.SGS_PROMPT_MONITOR_WAIT_MS = process.env.SGS_PROMPT_MONITOR_WAIT_MS || watchMs;
      env.SGS_PROMPT_MONITOR_KEEP_INSTALLED = "1";
    }
  }
  if (options.detach) {
    const started = Date.now();
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let child;
    try {
      child = spawn(spec.file, spec.args, {
        cwd: projectRoot,
        env,
        windowsHide: true,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd]
      });
      child.unref();
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    return {
      ...resultBase(row, index, stdoutPath, stderrPath),
      status: "started-detached",
      exitCode: "",
      signal: "",
      error: "",
      pid: child?.pid || "",
      durationMs: Date.now() - started,
      timedOut: "false"
    };
  }
  const stdout = createWriteStream(stdoutPath, { flags: "w" });
  const stderr = createWriteStream(stderrPath, { flags: "w" });
  const started = Date.now();
  const child = spawn(spec.file, spec.args, {
    cwd: projectRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const timeoutMs = defaultTimeoutMs(options);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGTERM"); } catch {}
  }, timeoutMs);
  const exit = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ error }));
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(timer);
  await new Promise((resolve) => stdout.end(resolve));
  await new Promise((resolve) => stderr.end(resolve));
  const durationMs = Date.now() - started;
  return {
    ...resultBase(row, index, stdoutPath, stderrPath),
    status: exit.error ? "spawn-error" : timedOut ? "timed-out" : exit.exitCode === 0 ? "ok" : "failed",
    exitCode: exit.error ? "" : exit.exitCode,
    signal: exit.error ? "" : exit.signal || "",
    error: exit.error ? exit.error.message : "",
    pid: child.pid || "",
    durationMs,
    timedOut: timedOut ? "true" : "false"
  };
}

function resultBase(row, index, stdoutPath, stderrPath) {
  return {
    index: index + 1,
    sessionIds: (row.sessionIds || [row.sessionId]).join("|"),
    requirementIds: (row.requirementIds || [row.requirementId]).join("|"),
    caseIds: (row.caseIds || [row.caseId]).join("|"),
    phase: row.phase,
    phaseOrder: row.phaseOrder,
    command: row.command,
    scriptPath: row.scriptPath,
    scriptExists: row.scriptExists,
    purchaseSensitive: row.purchaseSensitive,
    stdoutPath,
    stderrPath
  };
}

function tsvCell(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function writeTsv(rows, header) {
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Blocker Capture Session Run");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- phase: ${report.options.phase}`);
  lines.push(`- dryRun: ${report.options.dryRun ? "true" : "false"}`);
  lines.push(`- detach: ${report.options.detach ? "true" : "false"}`);
  lines.push(`- armFast: ${report.options.armFast ? "true" : "false"}`);
  lines.push(`- commands: ${report.summary.commands}`);
  lines.push(`- executed: ${report.summary.executed}`);
  lines.push(`- ok: ${report.summary.ok}`);
  lines.push(`- failed: ${report.summary.failed}`);
  lines.push(`- timedOut: ${report.summary.timedOut}`);
  lines.push(`- detached: ${report.summary.detached}`);
  lines.push(`- missingScripts: ${report.summary.missingScripts}`);
  lines.push(`- purchaseSensitive: ${report.summary.purchaseSensitive}`);
  lines.push(`- parallel: ${report.summary.parallel ? "true" : "false"}`);
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  for (const row of report.commandRows) {
    lines.push(`- ${row.phase} ${row.command} sessions=${row.sessionIds.join("|") || row.sessionId} purchaseSensitive=${row.purchaseSensitive}`);
  }
  if (report.resultRows.some((row) => row.pid)) {
    lines.push("");
    lines.push("## Detached Processes");
    lines.push("");
    for (const row of report.resultRows.filter((item) => item.pid)) {
      lines.push(`- pid=${row.pid} ${row.command}`);
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- This runner only executes commands that already exist in blocker-capture-commands.tsv.");
  lines.push("- It does not click, confirm, buy, refresh, pay, recharge, or read hidden opponent handCards by itself.");
  lines.push("- Purchase-sensitive rows are preserved as warnings because their underlying probes contain purchase blockers or boundary checks.");
  return `${lines.join("\n")}\n`;
}

function listPayload(plan, planDir) {
  const phaseCounts = {};
  for (const row of plan.commandRows || []) {
    const key = `${row.sessionId}:${row.phase}`;
    phaseCounts[key] = (phaseCounts[key] || 0) + 1;
  }
  return {
    planDir,
    presets: PRESETS,
    sessions: (plan.sessionRows || []).map((session) => ({
      sessionId: session.sessionId,
      requirementId: session.requirementId,
      caseId: session.caseId,
      title: session.title,
      commandCount: session.commandCount,
      preArmCommands: phaseCounts[`${session.sessionId}:pre-arm`] || 0,
      duringActionCommands: phaseCounts[`${session.sessionId}:during-action`] || 0,
      cleanupCommands: phaseCounts[`${session.sessionId}:cleanup`] || 0,
      postDeriveCommands: phaseCounts[`${session.sessionId}:post-derive`] || 0
    }))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usageText());
    return;
  }
  if (options.listPresets) {
    console.log(JSON.stringify(PRESETS, null, 2));
    return;
  }

  const { planDir, planPath, plan } = await loadPlan(options);
  if (options.list) {
    console.log(JSON.stringify(listPayload(plan, planDir), null, 2));
    return;
  }

  const commandRows = selectedCommandRows(plan, options);
  const parallel = shouldRunParallel(options);
  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const outputs = {
    json: path.join(outDir, "blocker-capture-session-run.json"),
    commandsTsv: path.join(outDir, "blocker-capture-session-run-commands.tsv"),
    readme: path.join(outDir, "README.md")
  };

  let resultRows = [];
  if (options.dryRun) {
    resultRows = commandRows.map((row, index) => ({
      ...resultBase(row, index, "", ""),
      status: "dry-run",
      exitCode: "",
      signal: "",
      pid: "",
      durationMs: 0,
      timedOut: "false"
    }));
  } else if (parallel) {
    resultRows = await Promise.all(commandRows.map((row, index) => runCommand(row, index, outDir, options)));
  } else {
    for (let index = 0; index < commandRows.length; index += 1) {
      resultRows.push(await runCommand(commandRows[index], index, outDir, options));
      const last = resultRows.at(-1);
      if (last.status === "failed" || last.status === "timed-out" || last.status === "spawn-error") break;
    }
  }

  const statusCounts = countBy(resultRows, (row) => row.status);
  const summary = {
    commands: commandRows.length,
    executed: options.dryRun ? 0 : resultRows.filter((row) => !/^skipped/.test(row.status)).length,
    ok: statusCounts.ok || 0,
    failed: (statusCounts.failed || 0) + (statusCounts["spawn-error"] || 0),
    timedOut: statusCounts["timed-out"] || 0,
    detached: statusCounts["started-detached"] || 0,
    missingScripts: resultRows.filter((row) => row.status === "skipped-missing-script").length,
    purchaseSensitive: commandRows.filter((row) => row.purchaseSensitive === "true").length,
    parallel,
    statusCounts
  };
  const report = {
    generatedAt: new Date().toISOString(),
    planDir,
    planPath,
    options: {
      phase: options.phase,
      sessions: options.sessions,
      requirements: options.requirements,
      cases: options.cases,
      presets: options.presets,
      all: options.all,
      dryRun: options.dryRun,
      noDedupe: options.noDedupe,
      parallel,
      detach: options.detach,
      armFast: options.armFast,
      timeoutMs: defaultTimeoutMs(options),
      keepActiveRecorder: options.keepActiveRecorder
    },
    outputs,
    summary,
    commandRows,
    resultRows
  };

  const header = [
    "index",
    "sessionIds",
    "requirementIds",
    "caseIds",
    "phase",
    "phaseOrder",
    "command",
    "scriptPath",
    "scriptExists",
    "purchaseSensitive",
    "status",
    "exitCode",
    "signal",
    "error",
    "pid",
    "durationMs",
    "timedOut",
    "stdoutPath",
    "stderrPath"
  ];
  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.commandsTsv, writeTsv(resultRows, header), "utf8");
  await writeFile(outputs.readme, buildMarkdown(report), "utf8");

  console.log(JSON.stringify({
    outDir,
    summary,
    outputs
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
