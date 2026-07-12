import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

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

function cleanCell(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}

async function readTsvIfExists(filePath) {
  if (!filePath || !await exists(filePath)) return [];
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map(cleanCell);
  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    const row = { __rowIndex: index + 1 };
    for (let fieldIndex = 0; fieldIndex < header.length; fieldIndex += 1) {
      row[header[fieldIndex]] = cleanCell(values[fieldIndex]);
    }
    return row;
  });
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function writeTsv(rows, header) {
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function outputDir() {
  return path.resolve(
    process.env.SGS_BLOCKER_CAPTURE_PLAN_DIR ||
      path.join(explorationRoot, `${timestampName()}-blocker-capture-plan-report`)
  );
}

const FALLBACK_COMMANDS = {
  "object-scene-window-switch": [
    "node Scripts/src/node/commands/runtime-current-window-action-report.mjs",
    "node Scripts/src/node/commands/runtime-event-field-transition-watch.mjs 20000",
    "node Scripts/src/node/commands/runtime-live-gap-watch.mjs 20000",
    "node Scripts/src/node/commands/runtime-ui-state-transition-sample.mjs"
  ],
  "battle-entry-exit-tracker-ui": [
    "node Scripts/src/node/commands/runtime-battle-entry-sample.mjs scan",
    "node Scripts/src/node/commands/runtime-active-operation-recorder.mjs",
    "node Scripts/src/node/commands/runtime-active-operation-dump.mjs",
    "node Scripts/src/node/commands/runtime-battle-end-sample.mjs scan",
    "node Scripts/src/node/commands/runtime-current-window-action-report.mjs"
  ],
  "buttons-clicks-ui": [
    "node Scripts/src/node/commands/runtime-current-window-action-report.mjs",
    "node Scripts/src/node/commands/runtime-event-field-transition-watch.mjs 20000",
    "node Scripts/src/node/commands/runtime-ui-state-transition-sample.mjs",
    "node Scripts/src/node/commands/runtime-live-gap-watch.mjs 20000"
  ],
  "effects-qifu-blocking": [
    "node Scripts/src/node/commands/runtime-bless-effect-block-probe.mjs",
    "node Scripts/src/node/commands/runtime-bless-open-sample.mjs",
    "node Scripts/src/node/commands/runtime-live-gap-watch.mjs 30000"
  ],
  "yanjiao-list-allocation": [
    "node Scripts/src/node/commands/runtime-yanjiao-list-watch.mjs 30000",
    "node Scripts/src/node/commands/runtime-yanjiao-candidate-list-implementation-report.mjs"
  ]
};

const POST_DERIVE_COMMANDS = [
  "node Scripts/src/node/commands/runtime-active-operation-field-transition-report.mjs",
  "node Scripts/src/node/commands/runtime-residual-field-source-report.mjs",
  "node Scripts/src/node/commands/runtime-live-field-semantics-report.mjs",
  "node Scripts/src/node/commands/runtime-field-semantic-index-report.mjs",
  "node Scripts/src/node/commands/runtime-entry-evidence-catalog-report.mjs",
  "node Scripts/src/node/commands/runtime-mechanism-implementation-atlas-report.mjs",
  "node Scripts/src/node/commands/runtime-objective-coverage-report.mjs",
  "node Scripts/src/node/commands/runtime-goal-completion-audit-report.mjs"
];

const CASE_HINTS = {
  "field-transition-semantics": {
    title: "Any real field-changing scene/window",
    precondition: "Open a live scene, prompt, or window with values expected to change; keep the UI visible during the watch window.",
    manualTrigger: "Perform the natural UI action that changes the visible state.",
    successEvidence: "event/field transition rows include before/after values and owner aliases."
  },
  "non-ended-prompt-auto-action": {
    title: "Non-ended battle prompt or skill action",
    precondition: "Enter a live TableGameScene before battle result appears; wait for a prompt, skill, or action surface.",
    manualTrigger: "Use or select a safe non-purchase action while recorder/watchers are armed.",
    successEvidence: "active-operation records contain prompt/skill handler args, visible card ids, and send/proxy path."
  },
  "discard-select-card-auto": {
    title: "Card select/discard/use prompt",
    precondition: "Enter a live battle with a selectable self hand/card UI prompt; do not use ended GameResult state.",
    manualTrigger: "Select a visible self card or execute a discard/use operation.",
    successEvidence: "records show visible/self card metadata, selection flags, movement/state changes, and no hidden opponent hand read."
  },
  "hover-stage-attached-popup": {
    title: "Hover-created popup",
    precondition: "Keep a visible card, skill, or window node that should show a tooltip/popup.",
    manualTrigger: "Hover the target node while hover samplers are running.",
    successEvidence: "stage/window child delta or tooltip lifecycle rows name the attached popup owner and fields."
  },
  "qifu-natural-animation-free-branch": {
    title: "Bless/QiFu free animation branch",
    precondition: "Open Bless/QiFu only on non-purchase/free paths.",
    manualTrigger: "Trigger natural open/effect animation without buying, refreshing, paying, or confirming purchase.",
    successEvidence: "effect/block probe sees lifecycle changes and purchase-risk methods remain skipped."
  },
  "rogue-specific-skill-auto-use": {
    title: "Rogue non-purchase skill/action",
    precondition: "Open a rogue scene/action surface with a non-purchase skill or zhanfa path visible.",
    manualTrigger: "Trigger a safe skill/action surface, skipping shop purchase/refresh/pay buttons.",
    successEvidence: "rogue action/skill reports and prompt monitor agree on handler, visible node, and send path."
  },
  "qixing-shen-zhuge-real-popup": {
    title: "Real QiXing/GuanXing/Shen Zhuge popup",
    precondition: "A real QiXing/GuanXing/Shen Zhuge popup with visible cards/public-general or top-deck facts must be on screen.",
    manualTrigger: "Open the real popup; no hidden handCards field may be used as evidence.",
    successEvidence: "qixing watcher records visible/protocol/log fields for public cards or top-deck facts."
  },
  "yanjiao-real-window-list-click": {
    title: "Real YanJiao candidate list",
    precondition: "A real YanJiaoWindow must be open with the right-side candidate list visible.",
    manualTrigger: "Click a right-side candidate row, stopping before any unsafe send if present.",
    successEvidence: "watcher records candidate coordinates, showSplitCard(index), and layoutCardUIs(true) state change."
  },
  "resource-drawing-replacement": {
    title: "Resource drawing and URL rewrite",
    precondition: "Install/enable resource rewrite or drawing probe only for a harmless resource path.",
    manualTrigger: "Load the target resource through Laya/ResourceVersion path.",
    successEvidence: "resource probe shows final URL, loader path, draw surface, and whether local/network rewrite succeeded."
  }
};

const REQUIREMENT_HINTS = {
  "object-scene-window-switch": {
    title: "Scene/window transition",
    precondition: "Use any visible scene or window transition that opens/closes Laya display objects.",
    manualTrigger: "Open or close a game window, or switch a visible scene.",
    successEvidence: "WindowManager/SceneManager hooks and stage scans agree on effective visible owners."
  },
  "battle-entry-exit-tracker-ui": {
    title: "Battle enter/exit and tracker lifecycle",
    precondition: "Start watchers before entering the next battle; keep running until after battle result or exit.",
    manualTrigger: "Enter a live battle, then naturally finish or leave it.",
    successEvidence: "visible TableGameScene + manager.seats proves enter; GameResult/scene absence proves overlay cleanup."
  },
  "buttons-clicks-ui": {
    title: "Safe UI button/click path",
    precondition: "Choose a non-purchase visible button or in-game UI click target.",
    manualTrigger: "Click the target while transition watchers are running.",
    successEvidence: "click/touch handler, owner node, and resulting state/window transition are recorded."
  }
};

function splitCommands(value) {
  if (!value) return [];
  return String(value)
    .split(/\s+\|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function commandPhase(command) {
  if (/dump-stop/.test(command)) return "cleanup";
  if (/recorder|watch|monitor/.test(command)) return "pre-arm";
  if (/field-transition-report|residual-field-source-report|field-semantic-index-report|live-field-semantics-report|entry-evidence-catalog-report|mechanism-implementation-atlas-report|objective-coverage-report|goal-completion-audit-report|live-proof-playbook-report/.test(command)) return "post-derive";
  return "during-action";
}

function phaseOrder(phase) {
  return {
    "pre-arm": 1,
    "during-action": 2,
    cleanup: 3,
    "post-derive": 4
  }[phase] || 9;
}

function commandScript(command) {
  const match = String(command).match(/node\s+([^\s]+Scripts[\\/]src[\\/]node[\\/]commands[\\/][^\s]+\.mjs|Scripts[\\/]src[\\/]node[\\/]commands[\\/][^\s]+\.mjs)/);
  if (!match) return "";
  return match[1].replaceAll("\\", "/");
}

async function commandExists(command) {
  const script = commandScript(command);
  if (!script) return "";
  return await exists(path.join(projectRoot, script)) ? "true" : "false";
}

function isPurchaseSensitive(row, command) {
  const haystack = [
    row.requirementId,
    row.caseId,
    row.target,
    row.safeBoundary,
    row.nextProof,
    command
  ].join(" ").toLowerCase();
  return /purchase|buy|pay|refresh|shop|bless|qifu|祈福|购买|支付|刷新|商店/.test(haystack);
}

function sessionHint(requirementId, caseId) {
  return CASE_HINTS[caseId] || REQUIREMENT_HINTS[requirementId] || {
    title: requirementId,
    precondition: "Use the real live surface named by the blocker row while the watchers are armed.",
    manualTrigger: "Trigger the natural UI transition/action once.",
    successEvidence: "new live rows close the blocker after objective coverage and completion audit regenerate."
  };
}

function fallbackCommands(requirementId, caseId) {
  if (FALLBACK_COMMANDS[requirementId]) return FALLBACK_COMMANDS[requirementId];
  if (caseId === "qixing-shen-zhuge-real-popup") {
    return [
      "node Scripts/src/node/commands/runtime-qixing-shen-zhuge-watch.mjs 30000",
      "node Scripts/src/node/commands/runtime-live-gap-watch.mjs 30000"
    ];
  }
  if (caseId === "resource-drawing-replacement") {
    return [
      "node Scripts/src/node/commands/runtime-resource-replacement-probe.mjs",
      "node Scripts/src/node/commands/runtime-resource-load-scheme-proof.mjs",
      "node Scripts/src/node/commands/runtime-trigger-monitoring-report.mjs"
    ];
  }
  return [
    "node Scripts/src/node/commands/runtime-event-field-transition-watch.mjs 20000",
    "node Scripts/src/node/commands/runtime-live-gap-watch.mjs 20000",
    "node Scripts/src/node/commands/runtime-ui-state-transition-sample.mjs"
  ];
}

function commandsForSession(blocker, remainingRows) {
  const fromRemaining = remainingRows.flatMap((row) => splitCommands(row.commands));
  const base = fromRemaining.length
    ? fromRemaining
    : fallbackCommands(blocker.requirementId, remainingRows[0]?.caseId || "");
  const needsActiveDerive = base.some((command) => /active-operation-(recorder|dump|dump-stop)/.test(command));
  const derive = needsActiveDerive
    ? POST_DERIVE_COMMANDS
    : POST_DERIVE_COMMANDS.filter((command) => !/active-operation-field-transition-report|residual-field-source-report/.test(command));
  return uniqueStrings([...base, ...derive]);
}

function compactRows(rows, key) {
  return uniqueStrings(rows.map((row) => row[key])).join("|");
}

function buildSessionRows(blockers, remainingLiveRows) {
  const byRequirement = new Map();
  for (const row of remainingLiveRows) {
    const key = row.requirementId || "";
    if (!byRequirement.has(key)) byRequirement.set(key, []);
    byRequirement.get(key).push(row);
  }

  return blockers.map((blocker, index) => {
    const remainingRows = byRequirement.get(blocker.requirementId) || [];
    const caseId = compactRows(remainingRows, "caseId") || blocker.goalCaseIds || "";
    const hint = sessionHint(blocker.requirementId, remainingRows[0]?.caseId || caseId);
    const manualTriggerNeeded = /qixing|yanjiao|hover|prompt|discard|rogue|qifu|resource|battle|window|button|field/.test(`${caseId} ${blocker.requirementId}`);
    return {
      sessionId: `capture-${String(index + 1).padStart(2, "0")}`,
      requirementId: blocker.requirementId,
      caseId,
      title: hint.title,
      blockerVerdict: blocker.verdict,
      proofLevel: blocker.proofLevel,
      coverageStatus: blocker.coverageStatus,
      atlasNeedsLiveRows: blocker.atlasNeedsLiveRows,
      atlasUnresolvedRows: blocker.atlasUnresolvedRows,
      playbookNeedsLiveRows: blocker.playbookNeedsLiveRows,
      playbookPermissionGatedRows: blocker.playbookPermissionGatedRows,
      playbookPurchaseRiskRows: blocker.playbookPurchaseRiskRows,
      precondition: hint.precondition,
      manualTriggerNeeded: manualTriggerNeeded ? "true" : "false",
      manualTrigger: hint.manualTrigger,
      successEvidence: hint.successEvidence,
      safeBoundary: compactRows(remainingRows, "safeBoundary") || "Skip purchase, refresh, pay, recharge, and confirm-buy branches.",
      missingProof: compactRows(remainingRows, "missingProof") || blocker.remainingToComplete,
      nextProof: compactRows(remainingRows, "nextProof") || blocker.nextProof,
      commandCount: commandsForSession(blocker, remainingRows).length
    };
  });
}

async function buildCommandRows(sessionRows, blockers, remainingLiveRows) {
  const byRequirement = new Map();
  for (const row of remainingLiveRows) {
    const key = row.requirementId || "";
    if (!byRequirement.has(key)) byRequirement.set(key, []);
    byRequirement.get(key).push(row);
  }
  const blockerByRequirement = new Map(blockers.map((row) => [row.requirementId, row]));
  const rows = [];
  for (const session of sessionRows) {
    const blocker = blockerByRequirement.get(session.requirementId) || {};
    const remainingRows = byRequirement.get(session.requirementId) || [];
    const commands = commandsForSession(blocker, remainingRows);
    let order = 1;
    for (const command of commands) {
      const phase = commandPhase(command);
      rows.push({
        sessionId: session.sessionId,
        requirementId: session.requirementId,
        caseId: session.caseId,
        phase,
        phaseOrder: phaseOrder(phase),
        order: order++,
        command,
        scriptPath: commandScript(command),
        scriptExists: await commandExists(command),
        purchaseSensitive: isPurchaseSensitive({ ...session, ...remainingRows[0] }, command) ? "true" : "false",
        note: phase === "pre-arm"
          ? "Start before the user enters or triggers the target surface."
          : phase === "post-derive"
            ? "Run after the live sample finishes to refresh coverage/audit evidence."
            : phase === "cleanup"
              ? "Stop or flush the recorder after the interaction ends."
              : "Run while the target surface is still visible."
      });
    }
  }
  return rows.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.phaseOrder - b.phaseOrder || a.order - b.order);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Blocker Capture Plan");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- blockerSessions: ${report.summary.blockerSessions}`);
  lines.push(`- commandRows: ${report.summary.commandRows}`);
  lines.push(`- missingScripts: ${report.summary.missingScripts}`);
  lines.push(`- manualTriggerSessions: ${report.summary.manualTriggerSessions}`);
  lines.push(`- purchaseSensitiveCommands: ${report.summary.purchaseSensitiveCommands}`);
  lines.push("");
  lines.push("## Next Live Routine");
  lines.push("");
  lines.push("1. Pick the relevant session from blocker-capture-sessions.tsv.");
  lines.push("2. Start all pre-arm commands before entering the target battle/window.");
  lines.push("3. Trigger the real UI action once and keep the surface visible until during-action commands finish.");
  lines.push("4. Run cleanup commands, then post-derive commands.");
  lines.push("5. Regenerate objective coverage and goal completion audit before claiming the blocker is closed.");
  lines.push("");
  lines.push("## Runner");
  lines.push("");
  lines.push("- List sessions: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --list`");
  lines.push("- Battle/card/skill one-command pre-arm and verify: `node Scripts/src/node/commands/runtime-blocker-capture-arm-verify.mjs --preset battle --readiness-wait-ms 3000`");
  lines.push("- `--arm-fast` keeps required battle pre-arm watchers installed for `SGS_BLOCKER_CAPTURE_ARM_FAST_WATCH_MS` ms, default `300000`.");
  lines.push("- Battle/card/skill pre-arm dry run: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset battle --phase pre-arm --dry-run`");
  lines.push("- Battle/card/skill fast detached pre-arm: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset battle --phase pre-arm --detach --arm-fast`");
  lines.push("- Confirm page is armed: `node Scripts/src/node/commands/runtime-blocker-capture-readiness-report.mjs --wait-ms 3000`");
  lines.push("- Battle/card/skill blocking pre-arm: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset battle --phase pre-arm`");
  lines.push("- Prompt/card during-action dump: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset card --phase during-action`");
  lines.push("- Cleanup recorder: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --preset card --phase cleanup`");
  lines.push("- Refresh reports after a sample: `node Scripts/src/node/commands/runtime-blocker-capture-runner.mjs --all --phase post-derive --sequential`");
  lines.push("");
  lines.push("## Sessions");
  lines.push("");
  for (const row of report.sessionRows) {
    lines.push(`- ${row.sessionId} ${row.requirementId}: ${row.title}; commands=${row.commandCount}; trigger=${row.manualTrigger}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Purchase, refresh, pay, recharge, and confirm-buy branches stay skipped.");
  lines.push("- Battle/card evidence must use visible self/public/protocol/log data; do not read hidden opponent handCards.");
  lines.push("- A finished GameResult state is not a valid sample for active card/skill selection.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const auditDir = await latestDir("-goal-completion-audit", "goal-completion-audit.json");
  if (!auditDir) throw new Error("No goal completion audit found.");
  const auditJsonPath = path.join(auditDir, "goal-completion-audit.json");
  const blockersTsvPath = path.join(auditDir, "completion-blockers.tsv");
  const remainingTsvPath = path.join(auditDir, "remaining-live-proof.tsv");
  const audit = await readJsonIfExists(auditJsonPath);
  const blockers = await readTsvIfExists(blockersTsvPath);
  const remainingLiveRows = await readTsvIfExists(remainingTsvPath);
  if (!audit?.summary) throw new Error(`Invalid audit JSON: ${auditJsonPath}`);

  const sessionRows = buildSessionRows(blockers, remainingLiveRows);
  const commandRows = await buildCommandRows(sessionRows, blockers, remainingLiveRows);
  const summary = {
    blockerSessions: sessionRows.length,
    commandRows: commandRows.length,
    missingScripts: commandRows.filter((row) => row.scriptPath && row.scriptExists !== "true").length,
    manualTriggerSessions: sessionRows.filter((row) => row.manualTriggerNeeded === "true").length,
    purchaseSensitiveCommands: commandRows.filter((row) => row.purchaseSensitive === "true").length,
    inputGoalComplete: audit.summary.goalComplete === true,
    inputBlockerRows: audit.summary.blockerRows || 0
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const outputs = {
    json: path.join(outDir, "blocker-capture-plan.json"),
    sessionsTsv: path.join(outDir, "blocker-capture-sessions.tsv"),
    commandsTsv: path.join(outDir, "blocker-capture-commands.tsv"),
    readme: path.join(outDir, "README.md")
  };
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      goalCompletionAuditJson: auditJsonPath,
      completionBlockersTsv: blockersTsvPath,
      remainingLiveProofTsv: remainingTsvPath
    },
    outputs,
    summary,
    sessionRows,
    commandRows
  };

  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.sessionsTsv, writeTsv(sessionRows, [
    "sessionId",
    "requirementId",
    "caseId",
    "title",
    "blockerVerdict",
    "proofLevel",
    "coverageStatus",
    "atlasNeedsLiveRows",
    "atlasUnresolvedRows",
    "playbookNeedsLiveRows",
    "playbookPermissionGatedRows",
    "playbookPurchaseRiskRows",
    "precondition",
    "manualTriggerNeeded",
    "manualTrigger",
    "successEvidence",
    "safeBoundary",
    "missingProof",
    "nextProof",
    "commandCount"
  ]), "utf8");
  await writeFile(outputs.commandsTsv, writeTsv(commandRows, [
    "sessionId",
    "requirementId",
    "caseId",
    "phase",
    "phaseOrder",
    "order",
    "command",
    "scriptPath",
    "scriptExists",
    "purchaseSensitive",
    "note"
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
