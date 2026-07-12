import crypto from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const previewTokenLimit = 120;

const categoryRules = [
  { id: "protocol", pattern: /\b(MsgID|Protocol|Req|Rep|Ntf|MData|OnMsg|sendMsg|SendMsg|proxy)\b/ },
  { id: "event", pattern: /\b(Laya\.Event|GED|Dot\.|CLICK|MOUSE|ROLL|EventDispatcher|event:)\b/i },
  { id: "laya", pattern: /\b(Laya\.|ILaya|Sprite|Image|Texture|graphics|stage|Layer|Handler|Tween)\b/ },
  { id: "resource", pattern: /\b(loadImage|drawTexture|Texture|skin|Resource|URL|Loader|atlas|image|png|jpg)\b/i },
  { id: "scene-window", pattern: /\b(Scene|Window|ShowWindow|CloseWindow|SceneManager|WindowLayer|PopUp|Dialog|View)\b/ },
  { id: "battle", pattern: /\b(TableGameScene|gameStart|gameOver|GameResult|seat|seats|GAME_OVER|battle)\b/i },
  { id: "card", pattern: /\b(Card|CardIDs|MoveCard|SelectCard|Discard|Hand|Deck|Pile|Zone|Poker|UseCard)\b/ },
  { id: "skill", pattern: /\b(Skill|Spell|Response|Responser|GetResponser|OPT_SKILL|AutoUseSkillID)\b/ },
  { id: "automation", pattern: /\b(Auto|auto|Confirm|confirm|ensure|SelectCardResult|PlayCard|sendAuto|quick)\b/ },
  { id: "effect", pattern: /\b(Effect|Animation|Tween|Spine|Movie|Motion|Anim|LABEL|STOPPED)\b/ },
  { id: "rogue", pattern: /\b(Rogue|PveMgr|TriggerCurEvent|TriggerEvent|RogueLike|sendGotoFightMsg)\b/ },
  { id: "yanjiao", pattern: /\b(YanJiao|splitCard|showSplitCard|sendAutoChooseMoveOpt)\b/ },
  { id: "qixing-guanxing", pattern: /\b(GuanXing|Qixing|QiXing|WoLongZhuGeLiang|OutsideCard)\b/ },
  { id: "purchase-risk", pattern: /\b(Buy|buy|Pay|pay|Recharge|YuanBao|Money|confirmBuy|shop|Shop|goods|Goods|purchase|charge)\b/ }
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

async function latestDir(suffix, markerFile = "") {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  if (!markerFile) return dirs[0] || null;
  for (const dir of dirs) {
    if (await exists(path.join(dir, markerFile))) return dir;
  }
  return null;
}

async function latestAllSourceContext() {
  const dir = await latestDir("-all-source-context", "all-source-method-context.tsv");
  if (!dir) throw new Error("No all-source-context report with all-source-method-context.tsv was found.");
  return {
    dir,
    summaryPath: path.join(dir, "all-source-summary.md"),
    classPath: path.join(dir, "all-source-class-index.tsv"),
    methodPath: path.join(dir, "all-source-method-context.tsv")
  };
}

async function latestTriggerIndex() {
  const dir = await latestDir("-trigger-monitoring-report", "trigger-monitoring-index.tsv");
  if (!dir) return null;
  const tsvPath = path.join(dir, "trigger-monitoring-index.tsv");
  const rows = parseTsv(await readFile(tsvPath, "utf8"));
  const byKey = new Map();
  for (const row of rows) byKey.set(rowKey(row), row);
  return { dir, tsvPath, byKey };
}

function cleanCell(value) {
  return String(value ?? "").trim();
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map(cleanCell);
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = cleanCell(values[index]);
    }
    return row;
  });
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(";").replace(/\r?\n|\t/g, " ");
  if (value && typeof value === "object") return JSON.stringify(value).replace(/\r?\n|\t/g, " ");
  return String(value ?? "").replace(/\r?\n|\t/g, " ");
}

function writeTsv(rows, header) {
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function splitSemicolonList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitFlexibleList(value) {
  return String(value || "")
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function hashText(text, size = 24) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, size);
}

function rowKey(row) {
  return `${row.className}\t${row.method}\t${row.sourceKind}`;
}

function jsString(value) {
  return JSON.stringify(String(value ?? ""));
}

function hookTarget(row) {
  const classRef = `Laya.ClassUtils._classMap[${jsString(row.className)}]`;
  const methodRef = `${classRef}[${jsString(row.method)}]`;
  const protoRef = `${classRef}.prototype`;
  const protoMethodRef = `${protoRef}[${jsString(row.method)}]`;
  if (row.sourceKind === "constructor") return classRef;
  if (row.sourceKind === "static-method") return methodRef;
  if (row.sourceKind === "static-getter") return `Object.getOwnPropertyDescriptor(${classRef}, ${jsString(row.method)})?.get`;
  if (row.sourceKind === "static-setter") return `Object.getOwnPropertyDescriptor(${classRef}, ${jsString(row.method)})?.set`;
  if (row.sourceKind === "own-getter") return `Object.getOwnPropertyDescriptor(${protoRef}, ${jsString(row.method)})?.get`;
  if (row.sourceKind === "own-setter") return `Object.getOwnPropertyDescriptor(${protoRef}, ${jsString(row.method)})?.set`;
  return protoMethodRef;
}

function lengthBucket(lengthValue) {
  const length = Number(lengthValue) || 0;
  if (length <= 0) return "0";
  if (length < 64) return "1-63";
  if (length < 128) return "64-127";
  if (length < 256) return "128-255";
  if (length < 512) return "256-511";
  if (length < 1024) return "512-1023";
  if (length < 2048) return "1024-2047";
  if (length < 4096) return "2048-4095";
  if (length < 8192) return "4096-8191";
  if (length < 16384) return "8192-16383";
  return "16384+";
}

function countBucket(count) {
  const value = Number(count) || 0;
  if (value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 3) return "2-3";
  if (value <= 7) return "4-7";
  if (value <= 15) return "8-15";
  if (value <= 31) return "16-31";
  return "32+";
}

function informativeString(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.length < 2 && !/[\u3400-\u9fff]/.test(text)) return false;
  if (/^[\W_]+$/.test(text)) return false;
  if (/^(true|false|null|undefined|constructor|prototype)$/i.test(text)) return false;
  return true;
}

function stableConstant(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(this|self|that|_this)\./.test(text)) return false;
  if (/^[a-z_$]{1,2}\./.test(text) && !/^(Laya|GED|Dot)\./.test(text)) return false;
  return /^(Laya\.|laya\.|ILaya|HTMLStyle|Handler|Tween|Texture|Sprite|SoundManager|SceneManager|WindowLayer|GED|Dot\.|Protocol|MsgID|MData|Config|exports\.|window\.|document\.|Math\.|JSON\.|Array\.|Object\.|String\.|Number\.|Boolean\.|Date\.|RegExp\.)/.test(text);
}

function normalizeToken(kind, value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return `${kind}:${text}`;
}

function tokenSetsFor(row) {
  const roles = splitFlexibleList(row.roles).filter((role) => role && role !== "unclassified");
  const constants = splitSemicolonList(row.constants);
  const strings = splitSemicolonList(row.strings);
  const protocolFields = splitSemicolonList(row.protocolFields);
  const eventBindings = splitSemicolonList(row.eventBindings);
  const stableStrings = strings.filter(informativeString);
  const stableConstants = constants.filter(stableConstant);
  const stableTokens = uniqueSorted([
    ...stableStrings.map((item) => normalizeToken("str", item)),
    ...stableConstants.map((item) => normalizeToken("const", item)),
    ...protocolFields.map((item) => normalizeToken("field", item)),
    ...eventBindings.map((item) => normalizeToken("event", item))
  ]);
  const contextTokens = uniqueSorted([
    ...stableTokens,
    ...constants.map((item) => normalizeToken("const", item)),
    ...roles.map((item) => normalizeToken("role", item))
  ]);
  return {
    roles,
    constants,
    strings,
    protocolFields,
    eventBindings,
    stableStrings,
    stableConstants,
    stableTokens,
    contextTokens
  };
}

function categoryHintsFor(tokenSets) {
  const haystack = [
    ...tokenSets.stableTokens,
    ...tokenSets.contextTokens,
    ...tokenSets.roles.map((role) => `role:${role}`)
  ].join(" ");
  return categoryRules.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.id);
}

function confidenceFor(tokenSets, categoryHints) {
  let score = 0;
  const basis = [];
  if (tokenSets.protocolFields.length) {
    score += 4 + Math.min(4, tokenSets.protocolFields.length);
    basis.push("protocol-fields");
  }
  if (tokenSets.eventBindings.length) {
    score += 4 + Math.min(4, tokenSets.eventBindings.length);
    basis.push("event-bindings");
  }
  if (tokenSets.stableConstants.length) {
    score += Math.min(4, tokenSets.stableConstants.length);
    basis.push("stable-api-constants");
  }
  if (tokenSets.stableStrings.length) {
    score += Math.min(4, tokenSets.stableStrings.length);
    basis.push("string-literals");
  }
  if (tokenSets.roles.length) {
    score += 1;
    basis.push("source-role");
  }
  if (categoryHints.length) {
    score += 1;
    basis.push("category-hints");
  }
  if (!basis.length) basis.push("source-length-only");
  const level = score >= 10 ? "high" : score >= 6 ? "medium" : score >= 2 ? "low" : "weak";
  return { score, level, basis };
}

function previewTokens(primaryTokens, fallbackTokens) {
  const tokens = uniqueSorted([...(primaryTokens || []), ...(fallbackTokens || [])]);
  return tokens.slice(0, previewTokenLimit).map((token) => token.length > 180 ? `${token.slice(0, 177)}...` : token);
}

function fingerprintRow(row, triggerMap) {
  const trigger = triggerMap?.get(rowKey(row)) || null;
  const tokenSets = tokenSetsFor(row);
  const categoryHints = categoryHintsFor(tokenSets);
  const confidence = confidenceFor(tokenSets, categoryHints);
  const semanticSignature = [
    `sourceKind:${row.sourceKind}`,
    ...tokenSets.stableTokens
  ].join("\n");
  const contextSignature = [
    `sourceKind:${row.sourceKind}`,
    ...tokenSets.contextTokens,
    ...categoryHints.map((hint) => `hint:${hint}`)
  ].join("\n");
  const structuralSignature = [
    `sourceKind:${row.sourceKind}`,
    `length:${lengthBucket(row.length)}`,
    `constants:${countBucket(tokenSets.constants.length)}`,
    `strings:${countBucket(tokenSets.strings.length)}`,
    `protocolFields:${countBucket(tokenSets.protocolFields.length)}`,
    `eventBindings:${countBucket(tokenSets.eventBindings.length)}`,
    `stableTokens:${countBucket(tokenSets.stableTokens.length)}`,
    `hints:${categoryHints.join(";")}`
  ].join("\n");
  const semanticFingerprint = hashText(semanticSignature);
  const contextFingerprint = hashText(contextSignature);
  const structuralFingerprint = hashText(structuralSignature);
  const candidateFingerprint = hashText(`semantic:${semanticFingerprint}\nstructural:${structuralFingerprint}`);
  const exactSourceFingerprint = hashText([
    `sourceKind:${row.sourceKind}`,
    `hash:${row.hash}`,
    `length:${row.length}`
  ].join("\n"));
  return {
    className: row.className,
    functionName: row.functionName,
    method: row.method,
    sourceKind: row.sourceKind,
    stableTarget: hookTarget(row),
    roles: tokenSets.roles.join(";") || row.roles,
    triggerSurfaces: trigger?.surfaces || "",
    purchaseRisk: trigger?.purchaseRisk || "",
    sourceHash: row.hash,
    sourceLength: Number(row.length) || 0,
    lengthBucket: lengthBucket(row.length),
    exactSourceFingerprint,
    semanticFingerprint,
    candidateFingerprint,
    contextFingerprint,
    structuralFingerprint,
    ownerScopedFingerprint: hashText(`class:${row.className}\nkind:${row.sourceKind}\nsemantic:${semanticFingerprint}`),
    confidenceLevel: confidence.level,
    confidenceScore: confidence.score,
    confidenceBasis: confidence.basis.join(";"),
    categoryHints: categoryHints.join(";"),
    tokenCount: tokenSets.contextTokens.length,
    stableTokenCount: tokenSets.stableTokens.length,
    constantCount: tokenSets.constants.length,
    stableConstantCount: tokenSets.stableConstants.length,
    stringCount: tokenSets.strings.length,
    stableStringCount: tokenSets.stableStrings.length,
    protocolFieldCount: tokenSets.protocolFields.length,
    eventBindingCount: tokenSets.eventBindings.length,
    tokenPreview: previewTokens(tokenSets.stableTokens, tokenSets.contextTokens).join(";")
  };
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const values = splitFlexibleList(row[key] || "");
    if (!values.length) {
      counts.set("(none)", (counts.get("(none)") || 0) + 1);
      continue;
    }
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function groupsBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key] || "";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

function fingerprintStats(rows, key) {
  const groups = groupsBy(rows, key);
  let uniqueRows = 0;
  let collisionRows = 0;
  let collisionGroups = 0;
  for (const group of groups.values()) {
    if (group.length === 1) uniqueRows += 1;
    else {
      collisionGroups += 1;
      collisionRows += group.length;
    }
  }
  return {
    uniqueFingerprints: groups.size,
    uniqueRows,
    collisionRows,
    collisionGroups
  };
}

function clusterRows(rows, key, type) {
  return Array.from(groupsBy(rows, key).entries())
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      fingerprintType: type,
      fingerprint,
      count: group.length,
      confidenceLevels: uniqueSorted(group.map((row) => row.confidenceLevel)).join(";"),
      sourceKinds: uniqueSorted(group.map((row) => row.sourceKind)).join(";"),
      categoryHints: uniqueSorted(group.flatMap((row) => splitFlexibleList(row.categoryHints))).join(";"),
      triggerSurfaces: uniqueSorted(group.flatMap((row) => splitFlexibleList(row.triggerSurfaces))).join(";"),
      sourceHashes: uniqueSorted(group.map((row) => row.sourceHash)).slice(0, 24).join(";"),
      sampleTargets: group.slice(0, 16).map((row) => row.stableTarget).join(";"),
      sampleMethods: group.slice(0, 16).map((row) => `${row.className}.${row.method}`).join(";")
    }))
    .sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Function Fingerprint Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- All-source context: ${report.inputs.allSourceContext}`);
  lines.push(`- Trigger index: ${report.inputs.triggerIndex || "(none)"}`);
  lines.push(`- Function rows: ${report.summary.functionRows}`);
  lines.push(`- Semantic fingerprints: ${report.summary.semantic.uniqueFingerprints}`);
  lines.push(`- Candidate fingerprints: ${report.summary.candidate.uniqueFingerprints}`);
  lines.push(`- Context fingerprints: ${report.summary.context.uniqueFingerprints}`);
  lines.push(`- Exact source fingerprints: ${report.summary.exactSource.uniqueFingerprints}`);
  lines.push("");
  lines.push("## Matching Model");
  lines.push("");
  lines.push("- `stableTarget` is the current-build hook path through `Laya.ClassUtils._classMap`.");
  lines.push("- `exactSourceFingerprint` uses the captured source hash and length, so it is strongest inside one build but may drift after repack/minify.");
  lines.push("- `contextFingerprint` ignores class/function/method names but keeps constants, strings, protocol fields, event bindings, roles, and category hints.");
  lines.push("- `semanticFingerprint` is the most name-insensitive form: source kind plus stable API constants, string literals, protocol fields, and event bindings.");
  lines.push("- `candidateFingerprint` combines semantic and structural fingerprints; it is the recommended first cross-build candidate key when method names may change.");
  lines.push("- `structuralFingerprint` is a fallback candidate filter based on source kind, length bucket, evidence counts, and category hints.");
  lines.push("");
  lines.push("## Fingerprint Stats");
  lines.push("");
  lines.push("| Type | Unique Fingerprints | Unique Rows | Collision Rows | Collision Groups |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [type, stats] of Object.entries({
    semantic: report.summary.semantic,
    candidate: report.summary.candidate,
    context: report.summary.context,
    structural: report.summary.structural,
    ownerScoped: report.summary.ownerScoped,
    exactSource: report.summary.exactSource
  })) {
    lines.push(`| \`${type}\` | ${stats.uniqueFingerprints} | ${stats.uniqueRows} | ${stats.collisionRows} | ${stats.collisionGroups} |`);
  }
  lines.push("");
  lines.push("## Confidence Counts");
  lines.push("");
  for (const [level, count] of Object.entries(report.summary.confidenceCounts)) lines.push(`- ${level}: ${count}`);
  lines.push("");
  lines.push("## Source Kind Counts");
  lines.push("");
  for (const [kind, count] of Object.entries(report.summary.sourceKindCounts)) lines.push(`- ${kind}: ${count}`);
  lines.push("");
  lines.push("## Top Semantic Collision Groups");
  lines.push("");
  lines.push("| Fingerprint | Count | Levels | Hints | Samples |");
  lines.push("| --- | ---: | --- | --- | --- |");
  for (const cluster of report.topSemanticClusters.slice(0, 20)) {
    lines.push(`| \`${cluster.fingerprint}\` | ${cluster.count} | ${escapeMd(cluster.confidenceLevels)} | ${escapeMd(cluster.categoryHints)} | ${escapeMd(cluster.sampleMethods.split(";").slice(0, 5).join("; "))} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- `function-fingerprint-index.tsv`: one row per captured function with exact/context/semantic/structural fingerprints.");
  lines.push("- `function-fingerprint-clusters.tsv`: duplicate groups for semantic/candidate/context/structural/owner/exact fingerprints.");
  lines.push("- `function-fingerprint-report.json`: machine-readable summary and top clusters.");
  lines.push("- `function-fingerprint-report.md`: this report.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeMd(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

async function main() {
  const allSource = await latestAllSourceContext();
  const triggerIndex = await latestTriggerIndex();
  const methodRows = parseTsv(await readFile(allSource.methodPath, "utf8"));
  const fingerprintRows = methodRows.map((row) => fingerprintRow(row, triggerIndex?.byKey || null));
  const semanticClusters = clusterRows(fingerprintRows, "semanticFingerprint", "semantic");
  const candidateClusters = clusterRows(fingerprintRows, "candidateFingerprint", "candidate");
  const contextClusters = clusterRows(fingerprintRows, "contextFingerprint", "context");
  const structuralClusters = clusterRows(fingerprintRows, "structuralFingerprint", "structural");
  const ownerClusters = clusterRows(fingerprintRows, "ownerScopedFingerprint", "ownerScoped");
  const exactClusters = clusterRows(fingerprintRows, "exactSourceFingerprint", "exactSource");
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      allSourceContext: allSource.summaryPath,
      methodTsv: allSource.methodPath,
      classTsv: allSource.classPath,
      triggerIndex: triggerIndex?.tsvPath || ""
    },
    summary: {
      functionRows: fingerprintRows.length,
      rowsWithStableTokens: fingerprintRows.filter((row) => row.stableTokenCount > 0).length,
      rowsWithoutStableTokens: fingerprintRows.filter((row) => row.stableTokenCount === 0).length,
      semantic: fingerprintStats(fingerprintRows, "semanticFingerprint"),
      candidate: fingerprintStats(fingerprintRows, "candidateFingerprint"),
      context: fingerprintStats(fingerprintRows, "contextFingerprint"),
      structural: fingerprintStats(fingerprintRows, "structuralFingerprint"),
      ownerScoped: fingerprintStats(fingerprintRows, "ownerScopedFingerprint"),
      exactSource: fingerprintStats(fingerprintRows, "exactSourceFingerprint"),
      confidenceCounts: countBy(fingerprintRows, "confidenceLevel"),
      sourceKindCounts: countBy(fingerprintRows, "sourceKind"),
      categoryHintCounts: countBy(fingerprintRows, "categoryHints"),
      triggerSurfaceCounts: countBy(fingerprintRows, "triggerSurfaces")
    },
    topSemanticClusters: semanticClusters.slice(0, 100),
    topCandidateClusters: candidateClusters.slice(0, 100),
    topContextClusters: contextClusters.slice(0, 100),
    topExactSourceClusters: exactClusters.slice(0, 100)
  };
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_FUNCTION_FINGERPRINT_DIR ||
      path.join(explorationRoot, `${timestampName()}-function-fingerprint-report`)
  );
  const indexHeader = [
    "className",
    "functionName",
    "method",
    "sourceKind",
    "stableTarget",
    "roles",
    "triggerSurfaces",
    "purchaseRisk",
    "sourceHash",
    "sourceLength",
    "lengthBucket",
    "exactSourceFingerprint",
    "semanticFingerprint",
    "candidateFingerprint",
    "contextFingerprint",
    "structuralFingerprint",
    "ownerScopedFingerprint",
    "confidenceLevel",
    "confidenceScore",
    "confidenceBasis",
    "categoryHints",
    "tokenCount",
    "stableTokenCount",
    "constantCount",
    "stableConstantCount",
    "stringCount",
    "stableStringCount",
    "protocolFieldCount",
    "eventBindingCount",
    "tokenPreview"
  ];
  const clusterHeader = [
    "fingerprintType",
    "fingerprint",
    "count",
    "confidenceLevels",
    "sourceKinds",
    "categoryHints",
    "triggerSurfaces",
    "sourceHashes",
    "sampleTargets",
    "sampleMethods"
  ];
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "function-fingerprint-index.tsv"), writeTsv(fingerprintRows, indexHeader), "utf8");
  await writeFile(
    path.join(outDir, "function-fingerprint-clusters.tsv"),
    writeTsv([...semanticClusters, ...candidateClusters, ...contextClusters, ...structuralClusters, ...ownerClusters, ...exactClusters], clusterHeader),
    "utf8"
  );
  await writeFile(path.join(outDir, "function-fingerprint-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "function-fingerprint-report.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Function Fingerprint Report",
    "",
    `- Markdown: ${path.join(outDir, "function-fingerprint-report.md")}`,
    `- JSON: ${path.join(outDir, "function-fingerprint-report.json")}`,
    `- Index TSV: ${path.join(outDir, "function-fingerprint-index.tsv")}`,
    `- Cluster TSV: ${path.join(outDir, "function-fingerprint-clusters.tsv")}`,
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    outDir,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
