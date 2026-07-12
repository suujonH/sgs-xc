import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
    await readFile(filePath);
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_LIVE_FIELD_GAP_TRIAGE_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-field-gap-triage-report`)
  );
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value !== "" && value != null)));
}

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function addToList(existing, incoming, key) {
  existing[key] = unique([...(existing[key] || []), ...(incoming[key] || [])]);
}

function fieldRisk(row) {
  if (row.purchaseRisk) return "purchase-risk";
  if (row.matchLevel === "live-only" && row.joinConfidence === "live-only") return "unclassified-live-only";
  if (row.matchLevel === "live-only") return "live-category-only";
  if (row.matchLevel === "field-global") return "field-name-global-only";
  if (row.matchLevel === "owner+field" && !row.sourceMatchCount && !row.semanticMatchCount) return "owner-unresolved";
  return "weak";
}

function isWeak(row) {
  if (row.purchaseRisk) return true;
  if (row.matchLevel === "live-only") return true;
  if (row.matchLevel === "field-global") return true;
  if (row.joinConfidence === "live-only" || row.joinConfidence === "live-category-only") return true;
  return false;
}

function surfacePriority(row) {
  const surfaces = new Set(splitList(row.surfaces));
  let score = 0;
  if (row.purchaseRisk) score -= 50;
  if (surfaces.has("skill-trigger")) score += 45;
  if (surfaces.has("card-selection-movement")) score += 42;
  if (surfaces.has("auto-play-select-discard")) score += 42;
  if (surfaces.has("button-ui-click")) score += 38;
  if (surfaces.has("scene-window-switch")) score += 35;
  if (surfaces.has("battle-lifecycle")) score += 35;
  if (surfaces.has("effect-animation")) score += 25;
  if (surfaces.has("hover-popup")) score += 25;
  if (surfaces.has("rogue")) score += 20;
  if (row.liveCategory === "skill-spell") score += 30;
  if (row.liveCategory === "card-zone") score += 30;
  if (row.liveCategory === "selection-automation") score += 28;
  if (row.liveCategory === "button-command") score += 24;
  if (row.liveCategory === "event-handler") score += 22;
  if (row.liveCategory === "state-machine") score += 18;
  if (row.liveCategory === "scene-window-ui") score += 16;
  if (row.matchLevel === "live-only") score += 12;
  if (row.joinConfidence === "live-only") score += 8;
  if (/currentScene|manager|RogueLikeGameScene|TableGameScene|Window/i.test(row.ownerPath || "")) score += 12;
  if (/skill|spell|card|select|auto|confirm|button|handler|event|state|phase|turn|window|scene/i.test(row.field || "")) score += 10;
  return score;
}

function dedupeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = [
      row.ownerPath || "",
      row.ownerLabel || "",
      row.field || "",
      row.liveKind || "",
      row.liveValue || "",
      row.joinConfidence || "",
      row.matchLevel || ""
    ].join("\t");
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...row,
        risk: row.risk || fieldRisk(row),
        group: splitList(row.group).join("|"),
        groups: splitList(row.group),
        registeredNames: splitList(row.registeredNames),
        surfaces: splitList(row.surfaces),
        sourceClasses: splitList(row.sourceClasses),
        sourceMethods: splitList(row.sourceMethods),
        operations: splitList(row.operations),
        roles: splitList(row.roles),
        duplicateRows: 1
      });
      continue;
    }
    const existing = byKey.get(key);
    existing.duplicateRows += 1;
    existing.groups = unique([...existing.groups, ...splitList(row.group)]);
    existing.group = existing.groups.join("|");
    addToList(existing, { registeredNames: splitList(row.registeredNames) }, "registeredNames");
    addToList(existing, { surfaces: splitList(row.surfaces) }, "surfaces");
    addToList(existing, { sourceClasses: splitList(row.sourceClasses) }, "sourceClasses");
    addToList(existing, { sourceMethods: splitList(row.sourceMethods) }, "sourceMethods");
    addToList(existing, { operations: splitList(row.operations) }, "operations");
    addToList(existing, { roles: splitList(row.roles) }, "roles");
    existing.purchaseRisk ||= row.purchaseRisk;
    existing.sourceMatchCount = Math.max(existing.sourceMatchCount || 0, row.sourceMatchCount || 0);
    existing.semanticMatchCount = Math.max(existing.semanticMatchCount || 0, row.semanticMatchCount || 0);
    existing.triggerMatchCount = Math.max(existing.triggerMatchCount || 0, row.triggerMatchCount || 0);
  }
  return Array.from(byKey.values());
}

async function buildWeakRows(gapReport) {
  if (gapReport.sourceJoinPath) {
    try {
      const sourceJoin = await readJson(gapReport.sourceJoinPath);
      return dedupeRows((sourceJoin.joinedRows || []).filter(isWeak));
    } catch {
      // Fall back to the capped worklist below.
    }
  }
  return (gapReport.worklist || []).map((row) => ({
    ...row,
    risk: row.risk || fieldRisk(row),
    registeredNames: splitList(row.registeredNames),
    surfaces: splitList(row.surfaces),
    sourceClasses: splitList(row.sourceClasses),
    sourceMethods: splitList(row.sourceMethods),
    operations: splitList(row.operations),
    roles: splitList(row.roles)
  }));
}

function ownerFieldKey(ownerPath, field) {
  return `${ownerPath || ""}\t${field || ""}`;
}

function confidenceRank(confidence) {
  return {
    "high-live-source": 5,
    "medium-live-source": 4,
    "medium-live-joined": 3,
    "live-only": 2,
    "source-ref-only": 1,
    weak: 0
  }[confidence || ""] ?? 0;
}

function buildSemanticIndex(semanticsReport) {
  const index = new Map();
  for (const row of semanticsReport.rows || []) {
    const key = ownerFieldKey(row.ownerPath, row.field);
    const previous = index.get(key);
    if (!previous || confidenceRank(row.confidence) > confidenceRank(previous.confidence)) {
      index.set(key, row);
    }
  }
  return index;
}

const genericLayaFields = new Set([
  "_events",
  "eventDispatcher",
  "_selected",
  "selectedEnabled",
  "buttonMode",
  "mouseThrough",
  "mouseEnabled",
  "startX",
  "startY",
  "startAlpha",
  "autoSize",
  "cancelTokens",
  "defaultClickScale",
  "userClickScale",
  "clickTips",
  "_stateChanged",
  "phase",
  "background",
  "_mouseState",
  "TweenPos",
  "_bits",
  "_boundStyle",
  "_cacheStyle",
  "_children",
  "_graphics",
  "_extUIChild",
  "IsRelateOtherX",
  "IsRelateOtherY"
]);

const sceneWindowBaseFields = new Set([
  "autoReclaimRes",
  "autoGuideOnOpen",
  "canCloseAuto",
  "needAihelpEvent",
  "closeOnClickModal",
  "autoReclaim",
  "bgRes",
  "closeEvent",
  "eventAdded",
  "isActionClearWindow",
  "isFightWindow",
  "closeCallbackListenerAdded",
  "needInAnimate",
  "titleBgY",
  "closeBtnRight",
  "closeBtnTop",
  "isShowWait"
]);

const seatPublicFields = new Set([
  "index",
  "handCardCount",
  "equipCards",
  "judgeCards",
  "judgeCardID",
  "judgeSpellID",
  "outsideCards",
  "outsideCardCount",
  "regionCards",
  "stateCards",
  "roundShowCardIDs",
  "reflectEquipCards",
  "virtualSkills",
  "skillsOnSeat",
  "cardUseTypeState",
  "useCardCountInRound",
  "equipSortArr",
  "delayDeleteSkillS",
  "halfShowSkillDict",
  "huashenSkillId",
  "lastJudgeSkillID"
]);

const battleUiFields = new Set([
  "cardContainer",
  "cardUis",
  "virtualCardUis",
  "equipCardUIs",
  "decideCardUIs",
  "skillItems",
  "spellSelector",
  "selectCardContext",
  "selectedOptCardUi",
  "needSelectCardComplete",
  "areChoosingCard",
  "CanDragHandCard",
  "handCardRect",
  "btnAllSelect",
  "btnQuickSelect",
  "btnRAllSelect",
  "btnRQuickSelect",
  "btnReset",
  "btnIgnoreWuxie",
  "showDiscardTime",
  "buttonEnabledFunc",
  "txtOptMsg"
]);

const sceneRuntimeFields = new Set([
  "gameRoundInfo",
  "sceneIsActivate",
  "sceneData",
  "chatViewUI",
  "BackBtnClickHandler",
  "cardMotionDatas",
  "cardMotionGap",
  "cardMotionPool",
  "cardTweenPos",
  "stackCardContainer",
  "needShowSelectGeneralWin",
  "cardTweenAlpha",
  "showHandTips",
  "hideFullMaskNow",
  "taskEntrance",
  "animationContainer"
]);

function classifyRow(row, semantic) {
  const owner = `${row.ownerPath || ""} ${row.ownerLabel || ""}`;
  const field = row.field || "";
  const surfaces = splitList(row.surfaces);
  const semanticConfidence = semantic?.confidence || "";

  if (row.purchaseRisk || row.risk === "purchase-risk" || semantic?.purchaseRisk) {
    return {
      bucket: "permission-gated-purchase-risk",
      action: "keep evidence-only unless explicit permission is granted",
      reason: "purchase-risk method or field context"
    };
  }

  if (semantic && confidenceRank(semanticConfidence) >= 4) {
    return {
      bucket: "explained-by-live-source",
      action: "treat as explained for this owner; resample only after scene/resource drift",
      reason: `owner field has ${semanticConfidence} evidence`
    };
  }

  if (genericLayaFields.has(field)) {
    return {
      bucket: "generic-laya-display-input",
      action: "document as common Laya/control display/input state",
      reason: "field is a repeated Laya display/input/control field"
    };
  }

  if (sceneWindowBaseFields.has(field)) {
    return {
      bucket: "generic-window-lifecycle",
      action: "document as common window lifecycle/config state",
      reason: "field repeats across windows and base window behavior"
    };
  }

  if (/^(selfSeat|seats\[\d+\])$/.test(row.ownerPath || "") && seatPublicFields.has(field)) {
    return {
      bucket: "seat-public-zone-state",
      action: "document as public seat/card-zone state; do not expand hidden hand arrays",
      reason: "seat field is public count/zone/skill state, not hidden hand content"
    };
  }

  if (/NBi|uBt|pBt|fHt/.test(owner) && battleUiFields.has(field)) {
    return {
      bucket: "battle-ui-card-skill-anchor",
      action: "document as current-player battle UI/card/skill selector state",
      reason: "field sits on sampled NBi/uBt/pBt/fHt action anchors"
    };
  }

  if (/currentScene|RogueLikeGameScene/.test(owner) && sceneRuntimeFields.has(field)) {
    return {
      bucket: "scene-runtime-state",
      action: "document as RogueLikeGameScene runtime state; resample in non-ended battle for value transitions",
      reason: "field is on the visible current scene"
    };
  }

  if (semantic && confidenceRank(semanticConfidence) >= 2) {
    return {
      bucket: "partially-explained-needs-event-sample",
      action: "keep in watchlist; sample an event that changes this owner/field",
      reason: `semantic row exists with ${semanticConfidence} confidence`
    };
  }

  if ((row.risk || "").includes("unclassified-live-only") || row.matchLevel === "live-only" || row.confidence === "live-only") {
    return {
      bucket: "needs-focused-live-sample",
      action: "capture a targeted scene/window/event transition for this owner",
      reason: "live-only field has no owner-specific source or semantic match"
    };
  }

  if (surfaces.includes("qixing-shen-zhuge")) {
    return {
      bucket: "needs-qixing-live-sample",
      action: "wait for real Qixing/GuanXing popup and capture visible/public fields",
      reason: "Qixing surface still lacks real live popup sample"
    };
  }

  if (surfaces.includes("yanjiao")) {
    return {
      bucket: "needs-yanjiao-live-window",
      action: "wait for real YanJiaoWindow and capture list/row click preview",
      reason: "YanJiao surface still lacks real visible window sample"
    };
  }

  return {
    bucket: "needs-owner-specific-source-or-transition",
    action: "use source refs or a live transition sample for this owner",
    reason: "field name is known globally but not yet tied to this live owner"
  };
}

function topRows(rows, count = 40) {
  return rows
    .slice()
    .sort((a, b) =>
      Number(b.priority || 0) - Number(a.priority || 0) ||
      a.bucket.localeCompare(b.bucket) ||
      a.ownerPath.localeCompare(b.ownerPath) ||
      a.field.localeCompare(b.field)
    )
    .slice(0, count);
}

function buildMarkdown(report, outDir) {
  const lines = [];
  const s = report.summary;
  lines.push("# Live Field Gap Triage Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Source gap report: ${report.sourceGapPath}`);
  lines.push(`- Source semantics report: ${report.sourceSemanticsPath}`);
  lines.push(`- Scene: ${s.scene}`);
  lines.push(`- Input weak rows: ${s.inputWeakRows}`);
  lines.push(`- Explained or generic rows: ${s.explainedRows}`);
  lines.push(`- Still needs live/sample rows: ${s.needsLiveRows}`);
  lines.push(`- Permission gated rows: ${s.permissionGatedRows}`);
  lines.push("");
  lines.push("## Buckets");
  lines.push("");
  lines.push("| Bucket | Rows | Meaning |");
  lines.push("| --- | ---: | --- |");
  for (const [bucket, count] of Object.entries(s.bucketCounts)) {
    const action = report.bucketActions[bucket] || "";
    lines.push(`| ${bucket} | ${count} | ${action} |`);
  }
  lines.push("");
  lines.push("## Remaining Live Targets");
  lines.push("");
  lines.push("| Priority | Bucket | Owner | Field | Action | Reason |");
  lines.push("| ---: | --- | --- | --- | --- | --- |");
  for (const row of topRows(report.rows.filter((item) => item.requiresLiveSample), 40)) {
    lines.push(`| ${row.priority || 0} | ${row.bucket} | \`${row.ownerPath}\` (${row.ownerLabel || ""}) | \`${row.field}\` | ${row.action} | ${row.reason} |`);
  }
  lines.push("");
  lines.push("## Explained High-Value Rows");
  lines.push("");
  lines.push("| Priority | Bucket | Owner | Field | Meaning | Evidence |");
  lines.push("| ---: | --- | --- | --- | --- | --- |");
  for (const row of topRows(report.rows.filter((item) => !item.requiresLiveSample && !item.permissionGated), 40)) {
    lines.push(`| ${row.priority || 0} | ${row.bucket} | \`${row.ownerPath}\` (${row.ownerLabel || ""}) | \`${row.field}\` | ${row.inferredMeaning || row.joinedMeaning || ""} | ${row.semanticConfidence || row.matchLevel || ""} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This report does not delete or rewrite the raw weak-field worklist; it classifies it into actionable buckets.");
  lines.push("- `explained-by-live-source` is owner-specific evidence from the live semantics report.");
  lines.push("- Generic Laya/window buckets are safe to document as UI framework/control fields, but they are not game-rule semantics.");
  lines.push("- Seat public-zone buckets intentionally keep hidden hand content out of scope; hand count and public zones are safe, opponent `handCards` contents are not.");
  lines.push("- Remaining live targets should be sampled by actual window/skill/event occurrence rather than by calling risky send/confirm methods.");
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push(`- ${path.join(outDir, "live-field-gap-triage-report.json")}`);
  lines.push(`- ${path.join(outDir, "field-gap-triage.tsv")}`);
  lines.push(`- ${path.join(outDir, "bucket-summary.tsv")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const gapDir = process.env.SGS_LIVE_FIELD_GAP_REPORT_DIR ||
    await latestDir("-live-field-gap-report", "live-field-gap-report.json");
  if (!gapDir) throw new Error("No live-field-gap-report output found.");
  const semanticsDir = process.env.SGS_LIVE_FIELD_SEMANTICS_DIR ||
    await latestDir("-live-field-semantics-report", "live-field-semantics-report.json");
  if (!semanticsDir) throw new Error("No live-field-semantics-report output found.");

  const gapPath = path.join(gapDir, "live-field-gap-report.json");
  const semanticsPath = path.join(semanticsDir, "live-field-semantics-report.json");
  const gapReport = await readJson(gapPath);
  const semanticsReport = await readJson(semanticsPath);
  const semanticsByOwnerField = buildSemanticIndex(semanticsReport);

  const weakRows = await buildWeakRows(gapReport);
  const rows = weakRows.map((row) => {
    const normalized = {
      ...row,
      surfaces: splitList(row.surfaces),
      registeredNames: splitList(row.registeredNames),
      sourceClasses: splitList(row.sourceClasses),
      sourceMethods: splitList(row.sourceMethods),
      operations: splitList(row.operations),
      roles: splitList(row.roles),
      risk: row.risk || fieldRisk(row),
      confidence: row.confidence || row.joinConfidence || ""
    };
    const semantic = semanticsByOwnerField.get(ownerFieldKey(normalized.ownerPath, normalized.field)) || null;
    const classification = classifyRow(normalized, semantic);
    const requiresLiveSample = /needs-|partially-explained/.test(classification.bucket);
    const permissionGated = classification.bucket === "permission-gated-purchase-risk";
    return {
      priority: Number(normalized.priority || surfacePriority(normalized) || 0),
      bucket: classification.bucket,
      action: classification.action,
      reason: classification.reason,
      requiresLiveSample,
      permissionGated,
      ownerPath: normalized.ownerPath || "",
      ownerLabel: normalized.ownerLabel || "",
      registeredNames: normalized.registeredNames,
      field: normalized.field || "",
      risk: normalized.risk || "",
      group: normalized.group || "",
      liveCategory: normalized.liveCategory || "",
      liveKind: normalized.liveKind || "",
      liveValue: normalized.liveValue ?? "",
      confidence: normalized.confidence || "",
      matchLevel: normalized.matchLevel || "",
      joinedMeaning: normalized.joinedMeaning || "",
      inferredMeaning: semantic?.inferredMeaning || "",
      semanticConfidence: semantic?.confidence || "",
      semanticSourceRefCount: semantic?.sourceRefCount || 0,
      semanticEventRefCount: semantic?.eventRefCount || 0,
      surfaces: normalized.surfaces,
      sourceClasses: normalized.sourceClasses,
      sourceMethods: normalized.sourceMethods,
      operations: normalized.operations,
      roles: normalized.roles
    };
  });

  const bucketCounts = countBy(rows, (row) => row.bucket);
  const bucketActions = {};
  for (const row of rows) {
    bucketActions[row.bucket] ||= row.action;
  }
  const summary = {
    scene: gapReport.summary?.scene || semanticsReport.summary?.scene || "",
    inputWeakRows: rows.length,
    explainedRows: rows.filter((row) => !row.requiresLiveSample && !row.permissionGated).length,
    needsLiveRows: rows.filter((row) => row.requiresLiveSample).length,
    permissionGatedRows: rows.filter((row) => row.permissionGated).length,
    bucketCounts,
    topNeedsLiveBuckets: countBy(rows.filter((row) => row.requiresLiveSample), (row) => row.bucket),
    topNeedsLiveOwners: Object.entries(countBy(rows.filter((row) => row.requiresLiveSample), (row) => `${row.ownerPath} (${row.ownerLabel})`))
      .slice(0, 20)
      .map(([owner, count]) => ({ owner, count }))
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sourceGapDir: gapDir,
    sourceGapPath: gapPath,
    sourceSemanticsDir: semanticsDir,
    sourceSemanticsPath: semanticsPath,
    summary,
    bucketActions,
    rows
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "live-field-gap-triage-report.json"), report);

  const rowHeader = [
    "priority",
    "bucket",
    "requiresLiveSample",
    "permissionGated",
    "ownerPath",
    "ownerLabel",
    "field",
    "risk",
    "liveCategory",
    "liveKind",
    "semanticConfidence",
    "action",
    "reason",
    "inferredMeaning",
    "joinedMeaning",
    "surfaces",
    "sourceMethods"
  ];
  const rowLines = [rowHeader.join("\t")];
  for (const row of rows) rowLines.push(rowHeader.map((key) => tsvEscape(row[key])).join("\t"));
  await writeFile(path.join(outDir, "field-gap-triage.tsv"), `${rowLines.join("\n")}\n`, "utf8");

  const bucketHeader = ["bucket", "rows", "action"];
  const bucketLines = [bucketHeader.join("\t")];
  for (const [bucket, count] of Object.entries(bucketCounts)) {
    bucketLines.push([bucket, count, bucketActions[bucket] || ""].map(tsvEscape).join("\t"));
  }
  await writeFile(path.join(outDir, "bucket-summary.tsv"), `${bucketLines.join("\n")}\n`, "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(report, outDir), "utf8");

  console.log(JSON.stringify({
    outDir,
    inputWeakRows: summary.inputWeakRows,
    explainedRows: summary.explainedRows,
    needsLiveRows: summary.needsLiveRows,
    permissionGatedRows: summary.permissionGatedRows,
    bucketCounts: summary.bucketCounts,
    topNeedsLiveOwners: summary.topNeedsLiveOwners.slice(0, 8)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
