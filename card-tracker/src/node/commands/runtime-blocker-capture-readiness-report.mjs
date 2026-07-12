import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const WATCHERS = [
  {
    id: "active-operation-recorder",
    globalName: "__codexActiveOperationRecorder",
    requiredForBattlePreArm: true,
    readyReason: "active recorder installed and wrapperCount > 0"
  },
  {
    id: "prompt-automation-monitor",
    globalName: "__codexPromptAutomationMonitor",
    requiredForBattlePreArm: true,
    readyReason: "prompt monitor installed and has class/instance/send hooks"
  },
  {
    id: "event-field-transition-watch",
    globalName: "__codexEventFieldTransitionWatch",
    requiredForBattlePreArm: true,
    readyReason: "event-field watcher installed and wrapperCount > 0"
  },
  {
    id: "live-gap-watch",
    globalName: "__codexSgsLiveGapWatch",
    requiredForBattlePreArm: true,
    readyReason: "live-gap watcher installed and wrapperCount > 0"
  },
  {
    id: "qixing-watch",
    globalName: "__codexQixingShenZhugeWatch",
    requiredForBattlePreArm: false,
    readyReason: "qixing watcher installed for real popup sample"
  },
  {
    id: "yanjiao-list-watch",
    globalName: "__codexYanJiaoListWatch",
    requiredForBattlePreArm: false,
    readyReason: "yanjiao watcher installed for real window sample"
  }
];

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

function outputDir() {
  return path.resolve(
    process.env.SGS_BLOCKER_CAPTURE_READINESS_DIR ||
      path.join(explorationRoot, `${timestampName()}-blocker-capture-readiness-report`)
  );
}

function parseArgs(argv) {
  const options = {
    waitMs: Number(process.env.SGS_BLOCKER_CAPTURE_READINESS_WAIT_MS || 0),
    intervalMs: Number(process.env.SGS_BLOCKER_CAPTURE_READINESS_INTERVAL_MS || 500)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || "";
    if (arg === "--wait-ms") options.waitMs = Number(next());
    else if (arg.startsWith("--wait-ms=")) options.waitMs = Number(arg.slice("--wait-ms=".length));
    else if (arg === "--interval-ms") options.intervalMs = Number(next());
    else if (arg.startsWith("--interval-ms=")) options.intervalMs = Number(arg.slice("--interval-ms=".length));
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.waitMs) || options.waitMs < 0) options.waitMs = 0;
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) options.intervalMs = 500;
  return options;
}

function usageText() {
  return [
    "Usage:",
    "  node Scripts/src/node/commands/runtime-blocker-capture-readiness-report.mjs",
    "  node Scripts/src/node/commands/runtime-blocker-capture-readiness-report.mjs --wait-ms 3000",
    "",
    "This is read-only. It checks page globals installed by pre-arm watchers and records current Laya scene state."
  ].join("\n");
}

function readinessExpression() {
  return "(" + String.raw`(watchers) => {
    const now = () => new Date().toISOString();
    const ctor = (value) => {
      try { return value && value.constructor && value.constructor.name || ""; } catch { return ""; }
    };
    const labelOf = (node) => {
      try {
        return [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
      } catch {
        return "";
      }
    };
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const nodeBrief = (node, path) => ({
      path,
      label: labelOf(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      ctor: ctor(node),
      visible: hiddenReasons(node).length === 0,
      hiddenReasons: hiddenReasons(node),
      children: node && node.numChildren || 0
    });
    const findScenes = () => {
      const scenes = [];
      const seen = new Set();
      const walk = (node, nodePath, depth) => {
        if (!node || seen.has(node) || seen.size > 5000 || depth > 10) return;
        seen.add(node);
        const label = labelOf(node);
        if (/TableGameScene|RogueLikeGameScene|GeneralTrialScene|ModeScene|RogueSmallMapScene/i.test(label)) {
          const manager = node.manager || node.Manager || node.gameManager || null;
          const brief = nodeBrief(node, nodePath);
          scenes.push(Object.assign({}, brief, {
            manager: manager ? {
              ctor: ctor(manager),
              selfSeatIndex: manager.selfSeatIndex !== undefined ? manager.selfSeatIndex : manager.SelfSeatIndex !== undefined ? manager.SelfSeatIndex : null,
              seats: Array.isArray(manager.seats) ? manager.seats.length : null,
              isGameOver: manager.isGameOver !== undefined ? manager.isGameOver : manager.IsGameOver !== undefined ? manager.IsGameOver : null
            } : null
          }));
        }
        const count = node.numChildren || 0;
        for (let index = 0; index < count; index += 1) {
          try { walk(node.getChildAt(index), nodePath + "/" + (label || "node") + "#" + index, depth + 1); } catch {}
        }
      };
      try { walk(window.Laya && Laya.stage, "Laya.stage", 0); } catch {}
      return scenes;
    };
    const summarizeStatus = (status) => {
      const get = (key) => status && status[key] !== undefined && status[key] !== null ? status[key] : "";
      const out = {
        installed: status && status.installed === true,
        installedAt: status && status.installedAt || "",
        wrapperCount: get("wrapperCount"),
        recordCount: get("recordCount"),
        sampleCount: get("sampleCount"),
        snapshotCount: get("snapshotCount"),
        blockedCalls: Array.isArray(status && status.blockedCalls) ? status.blockedCalls.length : get("blockedCalls"),
        errors: Array.isArray(status && status.errors) ? status.errors.length : ""
      };
      if (status && typeof status === "object") {
        out.classHookCount = get("classHookCount");
        out.instanceHookCount = get("instanceHookCount");
        out.sendHookCount = get("sendHookCount");
        out.activeMethodCount = get("activeMethodCount");
      }
      return out;
    };
    const watcherRows = watchers.map((watcher) => {
      const api = window[watcher.globalName];
      let status = null;
      let error = "";
      if (api && typeof api.status === "function") {
        try { status = api.status(); } catch (err) { error = String(err && err.message || err); }
      }
      const summary = summarizeStatus(status);
      const installed = !!api && summary.installed === true;
      const hasHooks = Number(summary.wrapperCount || 0) > 0 ||
        Number(summary.classHookCount || 0) > 0 ||
        Number(summary.instanceHookCount || 0) > 0 ||
        Number(summary.sendHookCount || 0) > 0 ||
        Number(summary.activeMethodCount || 0) > 0;
      return {
        id: watcher.id,
        globalName: watcher.globalName,
        requiredForBattlePreArm: watcher.requiredForBattlePreArm === true,
        present: !!api,
        installed,
        hasHooks,
        ready: installed && hasHooks,
        readyReason: watcher.readyReason,
        statusSummary: summary,
        error
      };
    });
    const required = watcherRows.filter((row) => row.requiredForBattlePreArm);
    const stage = (() => {
      try {
        return window.Laya && Laya.stage ? {
          present: true,
          width: Laya.stage.width || 0,
          height: Laya.stage.height || 0,
          children: Laya.stage.numChildren || 0
        } : { present: false };
      } catch (error) {
        return { present: false, error: String(error && error.message || error) };
      }
    })();
    return {
      ok: true,
      checkedAt: now(),
      url: String(location && location.href || ""),
      title: String(document && document.title || ""),
      stage,
      scenes: findScenes(),
      watcherRows,
      battlePreArmReady: required.length > 0 && required.every((row) => row.ready),
      missingRequired: required.filter((row) => !row.ready).map((row) => row.id)
    };
  }` + ")(" + JSON.stringify(WATCHERS) + ")";
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectReadiness(options) {
  const started = Date.now();
  const attempts = [];
  do {
    try {
      const result = await evaluateOnSgs(readinessExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
      attempts.push({ ok: true, target: result.target, value: result.value });
      if (result.value?.battlePreArmReady || Date.now() - started >= options.waitMs) return attempts;
    } catch (error) {
      attempts.push({ ok: false, error: String(error && error.message || error) });
      if (Date.now() - started >= options.waitMs) return attempts;
    }
    await sleep(Math.min(options.intervalMs, Math.max(0, options.waitMs - (Date.now() - started))));
  } while (Date.now() - started <= options.waitMs);
  return attempts;
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

function latestValue(attempts) {
  return attempts.filter((attempt) => attempt.ok && attempt.value).at(-1)?.value || null;
}

function watcherTsvRows(report) {
  const value = latestValue(report.attempts);
  return (value?.watcherRows || []).map((row) => ({
    id: row.id,
    globalName: row.globalName,
    requiredForBattlePreArm: row.requiredForBattlePreArm,
    present: row.present,
    installed: row.installed,
    hasHooks: row.hasHooks,
    ready: row.ready,
    wrapperCount: row.statusSummary?.wrapperCount,
    recordCount: row.statusSummary?.recordCount,
    sampleCount: row.statusSummary?.sampleCount,
    snapshotCount: row.statusSummary?.snapshotCount,
    classHookCount: row.statusSummary?.classHookCount,
    instanceHookCount: row.statusSummary?.instanceHookCount,
    sendHookCount: row.statusSummary?.sendHookCount,
    activeMethodCount: row.statusSummary?.activeMethodCount,
    errors: row.statusSummary?.errors,
    error: row.error,
    readyReason: row.readyReason
  }));
}

function sceneTsvRows(report) {
  const value = latestValue(report.attempts);
  return (value?.scenes || []).map((row) => ({
    path: row.path,
    label: row.label,
    sceneName: row.sceneName,
    className: row.className,
    ctor: row.ctor,
    visible: row.visible,
    hiddenReasons: row.hiddenReasons || [],
    managerCtor: row.manager?.ctor || "",
    selfSeatIndex: row.manager?.selfSeatIndex ?? "",
    seats: row.manager?.seats ?? "",
    isGameOver: row.manager?.isGameOver ?? ""
  }));
}

function buildMarkdown(report) {
  const value = latestValue(report.attempts);
  const watcherRows = watcherTsvRows(report);
  const lines = [];
  lines.push("# Blocker Capture Readiness Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- attempts: ${report.summary.attempts}`);
  lines.push(`- cdpAvailable: ${report.summary.cdpAvailable ? "true" : "false"}`);
  lines.push(`- battlePreArmReady: ${report.summary.battlePreArmReady ? "true" : "false"}`);
  lines.push(`- readyWatchers: ${report.summary.readyWatchers}/${report.summary.watchers}`);
  lines.push(`- missingRequired: ${report.summary.missingRequired.join(",") || "(none)"}`);
  lines.push(`- stagePresent: ${value?.stage?.present === true ? "true" : "false"}`);
  lines.push(`- sceneCount: ${value?.scenes?.length || 0}`);
  lines.push("");
  lines.push("## Watchers");
  lines.push("");
  for (const row of watcherRows) {
    lines.push(`- ${row.id}: present=${row.present}; installed=${row.installed}; ready=${row.ready}; wrappers=${row.wrapperCount}; hooks=${[row.classHookCount, row.instanceHookCount, row.sendHookCount, row.activeMethodCount].filter((item) => item !== "").join("/") || ""}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- This report is read-only: it calls status() on known Codex watcher globals and scans Laya.stage labels/effective visibility.");
  lines.push("- It does not install hooks, stop hooks, click, confirm, buy, refresh, pay, recharge, or read hidden opponent handCards.");
  if (!report.summary.cdpAvailable) {
    lines.push("");
    lines.push("## CDP Error");
    lines.push("");
    lines.push(`- ${report.attempts.at(-1)?.error || "unknown"}`);
  }
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
  const attempts = await collectReadiness(options);
  const value = latestValue(attempts);
  const watcherRows = watcherTsvRows({ attempts });
  const sceneRows = sceneTsvRows({ attempts });
  const summary = {
    attempts: attempts.length,
    cdpAvailable: !!value,
    battlePreArmReady: value?.battlePreArmReady === true,
    watchers: watcherRows.length,
    readyWatchers: watcherRows.filter((row) => row.ready === true).length,
    requiredWatchers: watcherRows.filter((row) => row.requiredForBattlePreArm === true).length,
    missingRequired: value?.missingRequired || WATCHERS.filter((watcher) => watcher.requiredForBattlePreArm).map((watcher) => watcher.id),
    scenes: sceneRows.length,
    stagePresent: value?.stage?.present === true
  };
  const outputs = {
    json: path.join(outDir, "blocker-capture-readiness-report.json"),
    watchersTsv: path.join(outDir, "blocker-capture-readiness-watchers.tsv"),
    scenesTsv: path.join(outDir, "blocker-capture-readiness-scenes.tsv"),
    readme: path.join(outDir, "README.md")
  };
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    outputs,
    summary,
    attempts
  };

  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.watchersTsv, writeTsv(watcherRows, [
    "id",
    "globalName",
    "requiredForBattlePreArm",
    "present",
    "installed",
    "hasHooks",
    "ready",
    "wrapperCount",
    "recordCount",
    "sampleCount",
    "snapshotCount",
    "classHookCount",
    "instanceHookCount",
    "sendHookCount",
    "activeMethodCount",
    "errors",
    "error",
    "readyReason"
  ]), "utf8");
  await writeFile(outputs.scenesTsv, writeTsv(sceneRows, [
    "path",
    "label",
    "sceneName",
    "className",
    "ctor",
    "visible",
    "hiddenReasons",
    "managerCtor",
    "selfSeatIndex",
    "seats",
    "isGameOver"
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
