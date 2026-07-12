import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_BLOCKER_CAPTURE_ARM_VERIFY_DIR ||
      path.join(explorationRoot, `${timestampName()}-blocker-capture-arm-verify-report`)
  );
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    phase: "pre-arm",
    presets: ["battle"],
    sessions: [],
    requirements: [],
    cases: [],
    all: false,
    dryRun: false,
    detach: true,
    armFast: true,
    planDir: "",
    readinessWaitMs: Number(process.env.SGS_BLOCKER_CAPTURE_ARM_VERIFY_READINESS_WAIT_MS || 3000),
    readinessIntervalMs: Number(process.env.SGS_BLOCKER_CAPTURE_ARM_VERIFY_READINESS_INTERVAL_MS || 500),
    stepTimeoutMs: Number(process.env.SGS_BLOCKER_CAPTURE_ARM_VERIFY_STEP_TIMEOUT_MS || 120000),
    skipReadiness: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || "";
    if (arg === "--phase") options.phase = next();
    else if (arg.startsWith("--phase=")) options.phase = arg.slice("--phase=".length);
    else if (arg === "--preset") options.presets = splitList(next());
    else if (arg.startsWith("--preset=")) options.presets = splitList(arg.slice("--preset=".length));
    else if (arg === "--session") options.sessions.push(...splitList(next()));
    else if (arg.startsWith("--session=")) options.sessions.push(...splitList(arg.slice("--session=".length)));
    else if (arg === "--requirement") options.requirements.push(...splitList(next()));
    else if (arg.startsWith("--requirement=")) options.requirements.push(...splitList(arg.slice("--requirement=".length)));
    else if (arg === "--case") options.cases.push(...splitList(next()));
    else if (arg.startsWith("--case=")) options.cases.push(...splitList(arg.slice("--case=".length)));
    else if (arg === "--plan-dir") options.planDir = next();
    else if (arg.startsWith("--plan-dir=")) options.planDir = arg.slice("--plan-dir=".length);
    else if (arg === "--readiness-wait-ms") options.readinessWaitMs = Number(next());
    else if (arg.startsWith("--readiness-wait-ms=")) options.readinessWaitMs = Number(arg.slice("--readiness-wait-ms=".length));
    else if (arg === "--readiness-interval-ms") options.readinessIntervalMs = Number(next());
    else if (arg.startsWith("--readiness-interval-ms=")) options.readinessIntervalMs = Number(arg.slice("--readiness-interval-ms=".length));
    else if (arg === "--step-timeout-ms") options.stepTimeoutMs = Number(next());
    else if (arg.startsWith("--step-timeout-ms=")) options.stepTimeoutMs = Number(arg.slice("--step-timeout-ms=".length));
    else if (arg === "--all") options.all = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-detach") options.detach = false;
    else if (arg === "--no-arm-fast") options.armFast = false;
    else if (arg === "--skip-readiness") options.skipReadiness = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.presets.length && !options.sessions.length && !options.requirements.length && !options.cases.length && !options.all) {
    options.presets = ["battle"];
  }
  if (!Number.isFinite(options.readinessWaitMs) || options.readinessWaitMs < 0) options.readinessWaitMs = 3000;
  if (!Number.isFinite(options.readinessIntervalMs) || options.readinessIntervalMs <= 0) options.readinessIntervalMs = 500;
  if (!Number.isFinite(options.stepTimeoutMs) || options.stepTimeoutMs <= 0) options.stepTimeoutMs = 120000;
  return options;
}

function usageText() {
  return [
    "Usage:",
    "  node Scripts/src/node/commands/runtime-blocker-capture-arm-verify.mjs",
    "  node Scripts/src/node/commands/runtime-blocker-capture-arm-verify.mjs --preset battle --readiness-wait-ms 3000",
    "  node Scripts/src/node/commands/runtime-blocker-capture-arm-verify.mjs --dry-run --readiness-wait-ms 0",
    "",
    "Runs the blocker-capture pre-arm runner, then immediately runs the read-only readiness check.",
    "Only treat a live page as armed when summary.ready is true.",
    "The runner --arm-fast path keeps required battle watchers for SGS_BLOCKER_CAPTURE_ARM_FAST_WATCH_MS ms, default 300000."
  ].join("\n");
}

function quoteArg(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, "\\\"")}"` : text;
}

function parseStdoutJson(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

async function runNodeStep(stepName, scriptPath, args, outDir, options) {
  const logsDir = path.join(outDir, "logs");
  await mkdir(logsDir, { recursive: true });
  const stdoutPath = path.join(logsDir, `${stepName}.stdout.log`);
  const stderrPath = path.join(logsDir, `${stepName}.stderr.log`);
  const started = Date.now();
  const commandArgs = [scriptPath, ...args];

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(process.execPath, commandArgs, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill();
      } catch {}
    }, options.stepTimeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `${error?.stack || error}\n`;
    });
    child.on("close", async (exitCode, signal) => {
      settled = true;
      clearTimeout(timer);
      await writeFile(stdoutPath, stdout, "utf8");
      await writeFile(stderrPath, stderr, "utf8");
      const durationMs = Date.now() - started;
      const timedOut = durationMs >= options.stepTimeoutMs && exitCode !== 0;
      const parsed = parseStdoutJson(stdout);
      resolve({
        step: stepName,
        command: [process.execPath, ...commandArgs].map(quoteArg).join(" "),
        status: timedOut ? "timed-out" : exitCode === 0 ? "ok" : "failed",
        exitCode,
        signal: signal || "",
        durationMs,
        timedOut,
        stdoutPath,
        stderrPath,
        outDir: parsed?.outDir || "",
        summary: parsed?.summary || null,
        outputs: parsed?.outputs || null
      });
    });
  });
}

function runnerArgs(options) {
  const args = ["--phase", options.phase || "pre-arm"];
  for (const preset of options.presets) args.push("--preset", preset);
  for (const session of options.sessions) args.push("--session", session);
  for (const requirement of options.requirements) args.push("--requirement", requirement);
  for (const captureCase of options.cases) args.push("--case", captureCase);
  if (options.all) args.push("--all");
  if (options.planDir) args.push("--plan-dir", options.planDir);
  if (options.dryRun) args.push("--dry-run");
  if (options.detach && !options.dryRun) args.push("--detach");
  if (options.armFast) args.push("--arm-fast");
  return args;
}

function readinessArgs(options) {
  return [
    "--wait-ms",
    String(options.readinessWaitMs),
    "--interval-ms",
    String(options.readinessIntervalMs)
  ];
}

function writeTsv(rows, headers) {
  const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    const text = Array.isArray(value) ? value.join("/") : String(value);
    return /[\t\r\n"]/u.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  };
  return [
    headers.join("\t"),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join("\t"))
  ].join("\n") + "\n";
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Blocker Capture Arm Verify");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- ready: ${report.summary.ready ? "true" : "false"}`);
  lines.push(`- dryRun: ${report.options.dryRun ? "true" : "false"}`);
  lines.push(`- runnerStatus: ${report.summary.runnerStatus}`);
  lines.push(`- readinessStatus: ${report.summary.readinessStatus || "(skipped)"}`);
  lines.push(`- cdpAvailable: ${report.summary.cdpAvailable ? "true" : "false"}`);
  lines.push(`- battlePreArmReady: ${report.summary.battlePreArmReady ? "true" : "false"}`);
  lines.push(`- missingRequired: ${report.summary.missingRequired.join(",") || "(none)"}`);
  lines.push(`- runnerOutDir: ${report.summary.runnerOutDir || "(none)"}`);
  lines.push(`- readinessOutDir: ${report.summary.readinessOutDir || "(none)"}`);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  for (const step of report.steps) {
    lines.push(`- ${step.step}: status=${step.status}; exitCode=${step.exitCode}; durationMs=${step.durationMs}; outDir=${step.outDir || "(none)"}`);
  }
  lines.push("");
  lines.push("## Next Use");
  lines.push("");
  lines.push("Run this before the user enters battle:");
  lines.push("");
  lines.push("```powershell");
  lines.push("node Scripts/src/node/commands/runtime-blocker-capture-arm-verify.mjs --preset battle --readiness-wait-ms 3000");
  lines.push("```");
  lines.push("");
  lines.push("Only say the page is armed when `summary.ready` is true.");
  lines.push("");
  lines.push("Default arm-fast watcher duration is `300000` ms. Override with `SGS_BLOCKER_CAPTURE_ARM_FAST_WATCH_MS` when needed.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usageText());
    return;
  }

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const steps = [];

  steps.push(await runNodeStep(
    "runner",
    "Scripts/src/node/commands/runtime-blocker-capture-runner.mjs",
    runnerArgs(options),
    outDir,
    options
  ));

  if (!options.skipReadiness) {
    steps.push(await runNodeStep(
      "readiness",
      "Scripts/src/node/commands/runtime-blocker-capture-readiness-report.mjs",
      readinessArgs(options),
      outDir,
      options
    ));
  }

  const runner = steps.find((step) => step.step === "runner") || {};
  const readiness = steps.find((step) => step.step === "readiness") || {};
  const readinessSummary = readiness.summary || {};
  const summary = {
    ready: runner.status === "ok" && readiness.status === "ok" && readinessSummary.battlePreArmReady === true,
    runnerStatus: runner.status || "",
    readinessStatus: readiness.status || "",
    cdpAvailable: readinessSummary.cdpAvailable === true,
    battlePreArmReady: readinessSummary.battlePreArmReady === true,
    readyWatchers: readinessSummary.readyWatchers || 0,
    watchers: readinessSummary.watchers || 0,
    missingRequired: readinessSummary.missingRequired || [],
    stagePresent: readinessSummary.stagePresent === true,
    scenes: readinessSummary.scenes || 0,
    runnerOutDir: runner.outDir || "",
    readinessOutDir: readiness.outDir || "",
    runnerCommands: runner.summary?.commands || 0,
    runnerExecuted: runner.summary?.executed || 0,
    runnerDetached: runner.summary?.detached || 0,
    runnerMissingScripts: runner.summary?.missingScripts || 0,
    runnerFailed: runner.summary?.failed || 0,
    runnerTimedOut: runner.summary?.timedOut || 0
  };
  const outputs = {
    json: path.join(outDir, "blocker-capture-arm-verify-report.json"),
    stepsTsv: path.join(outDir, "blocker-capture-arm-verify-steps.tsv"),
    readme: path.join(outDir, "README.md")
  };
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    outputs,
    summary,
    steps
  };

  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.stepsTsv, writeTsv(steps, [
    "step",
    "command",
    "status",
    "exitCode",
    "signal",
    "durationMs",
    "timedOut",
    "stdoutPath",
    "stderrPath",
    "outDir"
  ]), "utf8");
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
