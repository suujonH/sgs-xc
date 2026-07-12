import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const triggerRoleOrder = [
  "scene-switch",
  "window-open-close",
  "battle-lifecycle",
  "skill-trigger",
  "card-operation",
  "auto-operation",
  "hover-popup",
  "effect-animation",
  "resource-drawing",
  "qixing-guanxing",
  "yanjiao",
  "rogue",
  "kanshu",
  "bless-qifu",
  "event-registration",
  "purchase-risk"
];

const inferredPatterns = [
  { pattern: /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i, meaning: "hidden or hand-card related field; do not use as known-card fact without source authorization", confidence: "risk-flag" },
  { pattern: /^(x|y|width|height|alpha|visible|scaleX|scaleY|zOrder|rotation|mouseEnabled|mouseThrough)$/i, meaning: "Laya display/layout/input property", confidence: "name-pattern" },
  { pattern: /(scene|Scene|mode|Mode|window|Window|view|View|page|Page|tab|Tab)/, meaning: "scene/window/view/page navigation context", confidence: "name-pattern" },
  { pattern: /(skill|Skill|spell|Spell|card|Card|poker|Poker|zone|Zone)/, meaning: "skill/card/zone context; exact semantics require source or live protocol evidence", confidence: "name-pattern" },
  { pattern: /(btn|Btn|button|Button|click|Click|touch|Touch|handler|Handler)/, meaning: "UI input handler or button reference", confidence: "name-pattern" },
  { pattern: /(effect|Effect|anim|Anim|movie|Movie|spine|Spine)/, meaning: "animation/effect surface", confidence: "name-pattern" },
  { pattern: /(reward|Reward|award|Award|goods|Goods|shop|Shop|buy|Buy|pay|Pay|yuanbao|YuanBao|money|Money)/, meaning: "reward/shop/currency context; treat purchase-like paths as blocked unless explicitly allowed", confidence: "name-pattern" },
  { pattern: /(data|Data|vo|Vo|info|Info|state|State|status|Status|id|ID|type|Type|name|Name|desc|Desc|text|Text)/, meaning: "business data/state/identity/description field", confidence: "name-pattern" },
  { pattern: /^_/, meaning: "private/minified runtime field; exact meaning needs source branch or live sample", confidence: "unknown-private" }
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

function fieldMeaning(name, glossaryMap) {
  const glossary = glossaryMap.get(name);
  if (glossary) {
    return {
      name,
      meaning: glossary.meaning,
      confidence: "glossary-inferred",
      sources: (glossary.sources || []).slice(0, 8),
      hiddenRisk: /hidden|handCards|WatchCards|cardsInHand/i.test(`${name} ${glossary.meaning}`)
    };
  }
  for (const item of inferredPatterns) {
    if (item.pattern.test(name)) {
      return {
        name,
        meaning: item.meaning,
        confidence: item.confidence,
        sources: [],
        hiddenRisk: /hidden|hand-card|handCards|WatchCards|cardsInHand/i.test(`${name} ${item.meaning}`)
      };
    }
  }
  return {
    name,
    meaning: "unknown from static name index; needs source branch or live sample",
    confidence: "unknown",
    sources: [],
    hiddenRisk: false
  };
}

function methodTriggerRows(row) {
  return (row.ownMethods || [])
    .filter((method) => (method.roles || []).some((role) => triggerRoleOrder.includes(role)))
    .map((method) => ({
      name: method.name,
      roles: method.roles || [],
      hash: method.hash,
      length: method.length,
      arity: method.arity
    }));
}

function eventSummaryFor(row, eventsByCtor) {
  const rows = eventsByCtor.get(row.functionName) || [];
  return rows.slice(0, 50).map((event) => ({
    kind: event.kind,
    eventName: event.eventName,
    methodName: event.methodName,
    once: event.once === true
  }));
}

function summarizeClass(row, glossaryMap, eventsByCtor) {
  const fieldItems = [
    ...(row.ownFields || []).map((name) => ({ kind: "own", ...fieldMeaning(name, glossaryMap) })),
    ...(row.staticFields || []).map((name) => ({ kind: "static", ...fieldMeaning(name, glossaryMap) })),
    ...(row.accessors || []).map((name) => ({ kind: "accessor", ...fieldMeaning(name, glossaryMap) }))
  ];
  const triggerMethods = methodTriggerRows(row);
  const eventBindings = eventSummaryFor(row, eventsByCtor);
  const counts = {
    fields: fieldItems.length,
    glossaryInferred: fieldItems.filter((item) => item.confidence === "glossary-inferred").length,
    namePattern: fieldItems.filter((item) => item.confidence === "name-pattern").length,
    riskFlag: fieldItems.filter((item) => item.confidence === "risk-flag" || item.hiddenRisk).length,
    unknownPrivate: fieldItems.filter((item) => item.confidence === "unknown-private").length,
    unknown: fieldItems.filter((item) => item.confidence === "unknown").length,
    triggerMethods: triggerMethods.length,
    eventBindings: eventBindings.length
  };
  let semanticStatus = "no-fields";
  if (counts.fields > 0 && counts.unknown + counts.unknownPrivate === 0 && counts.glossaryInferred === counts.fields) semanticStatus = "glossary-inferred";
  else if (counts.fields > 0 && counts.unknown + counts.unknownPrivate === 0) semanticStatus = "name-inferred";
  else if (counts.fields > 0) semanticStatus = "partial-unknown";
  const liveNeeded = counts.unknown > 0 || counts.unknownPrivate > 0 || counts.riskFlag > 0 || triggerMethods.some((method) => method.roles.some((role) => ["skill-trigger", "card-operation", "auto-operation", "hover-popup", "effect-animation", "purchase-risk"].includes(role)));
  return {
    name: row.name,
    functionName: row.functionName,
    categories: row.categories || [],
    methodRoles: row.methodRoles || [],
    ownMethodCount: row.ownMethodCount || 0,
    inheritedMethodCount: row.inheritedMethodCount || 0,
    staticMethodCount: row.staticMethodCount || 0,
    semanticStatus,
    liveNeeded,
    counts,
    triggerMethods,
    eventBindings,
    fields: fieldItems
  };
}

function statusCounts(classes) {
  const out = {};
  for (const item of classes) out[item.semanticStatus] = (out[item.semanticStatus] || 0) + 1;
  return out;
}

function writeTsv(rows) {
  const header = [
    "name",
    "functionName",
    "categories",
    "semanticStatus",
    "liveNeeded",
    "fieldCount",
    "glossaryInferred",
    "namePattern",
    "unknownPrivate",
    "unknown",
    "riskFlag",
    "triggerMethodCount",
    "eventBindingCount",
    "triggerMethods",
    "fieldSummary"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    const triggerMethods = row.triggerMethods.slice(0, 16).map((method) => `${method.name}:${method.roles.join(",")}`).join(";");
    const fieldSummary = row.fields.slice(0, 30).map((field) => `${field.kind}:${field.name}:${field.confidence}:${field.meaning}`).join(";");
    lines.push([
      row.name,
      row.functionName,
      row.categories.join(","),
      row.semanticStatus,
      String(row.liveNeeded),
      row.counts.fields,
      row.counts.glossaryInferred,
      row.counts.namePattern,
      row.counts.unknownPrivate,
      row.counts.unknown,
      row.counts.riskFlag,
      row.counts.triggerMethods,
      row.counts.eventBindings,
      triggerMethods,
      fieldSummary
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function topClasses(classes, predicate, limit = 25) {
  return classes
    .filter(predicate)
    .sort((a, b) =>
      (b.counts.unknown + b.counts.unknownPrivate + b.counts.riskFlag + b.counts.triggerMethods) -
      (a.counts.unknown + a.counts.unknownPrivate + a.counts.riskFlag + a.counts.triggerMethods)
    )
    .slice(0, limit);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Class Field Audit Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Source all-names report: ${report.sourceDir}`);
  lines.push(`- Registered classes: ${report.summary.classCount}`);
  lines.push(`- Classes with fields/accessors/static fields: ${report.summary.classesWithFields}`);
  lines.push(`- Field slots: ${report.summary.fieldSlots}`);
  lines.push(`- Status counts: ${Object.entries(report.summary.statusCounts).map(([key, value]) => `${key}=${value}`).join("; ")}`);
  lines.push("");
  lines.push("## Meaning Status");
  lines.push("");
  lines.push("- `glossary-inferred`: every field/accessor/static field has an entry in `field-meaning-glossary`; still inferred unless source/live evidence says otherwise.");
  lines.push("- `name-inferred`: no unknown fields, but at least one field is classified only by a naming pattern.");
  lines.push("- `partial-unknown`: at least one private/minified/unknown field remains; source branch or live sample is needed.");
  lines.push("- `no-fields`: no direct field/accessor/static field was found in the class inventory.");
  lines.push("");
  lines.push("## Coverage Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  for (const [key, value] of Object.entries(report.summary.metrics)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## High-Priority Unknown / Runtime Needed Classes");
  lines.push("");
  lines.push("| Class | Function | Categories | Status | Unknown/Risk | Trigger Methods | Event Bindings |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: |");
  for (const row of report.highPriority) {
    const unknownRisk = row.counts.unknown + row.counts.unknownPrivate + row.counts.riskFlag;
    lines.push(`| \`${escapeCell(row.name)}\` | \`${escapeCell(row.functionName)}\` | ${escapeCell(row.categories.join(","))} | \`${row.semanticStatus}\` | ${unknownRisk} | ${row.counts.triggerMethods} | ${row.counts.eventBindings} |`);
  }
  lines.push("");
  lines.push("## Role-Focused Samples");
  lines.push("");
  for (const [role, rows] of Object.entries(report.roleSamples)) {
    lines.push(`### ${role}`);
    lines.push("");
    if (!rows.length) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const row of rows) {
      const methods = row.triggerMethods.filter((method) => method.roles.includes(role)).slice(0, 5).map((method) => method.name).join(", ");
      const fieldNames = row.fields.slice(0, 8).map((field) => `${field.name}:${field.confidence}`).join(", ");
      lines.push(`- \`${row.name}\` / \`${row.functionName}\`: status=\`${row.semanticStatus}\`, methods=${methods || "(none)"}, fields=${fieldNames || "(none)"}`);
    }
    lines.push("");
  }
  lines.push("## Files");
  lines.push("");
  lines.push("- `class-field-audit.json`: full per-class field, trigger-method, and event-binding audit.");
  lines.push("- `class-field-audit.tsv`: spreadsheet-friendly flattened audit.");
  lines.push("- `unknown-field-worklist.tsv`: classes and fields requiring source/live follow-up.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function unknownWorklist(classes) {
  const rows = [];
  for (const cls of classes) {
    for (const field of cls.fields) {
      if (!["unknown", "unknown-private", "risk-flag"].includes(field.confidence) && !field.hiddenRisk) continue;
      rows.push({
        className: cls.name,
        functionName: cls.functionName,
        categories: cls.categories.join(","),
        semanticStatus: cls.semanticStatus,
        liveNeeded: cls.liveNeeded,
        kind: field.kind,
        field: field.name,
        confidence: field.confidence,
        meaning: field.meaning,
        triggerMethods: cls.triggerMethods.slice(0, 10).map((method) => `${method.name}:${method.roles.join(",")}`).join(";"),
        eventBindings: cls.eventBindings.slice(0, 10).map((event) => `${event.kind}:${event.eventName}:${event.methodName}`).join(";")
      });
    }
  }
  rows.sort((a, b) => Number(b.liveNeeded) - Number(a.liveNeeded) || a.className.localeCompare(b.className));
  const header = Object.keys(rows[0] || {
    className: "",
    functionName: "",
    categories: "",
    semanticStatus: "",
    liveNeeded: "",
    kind: "",
    field: "",
    confidence: "",
    meaning: "",
    triggerMethods: "",
    eventBindings: ""
  });
  return `${[header.join("\t"), ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))].join("\n")}\n`;
}

async function main() {
  const allNamesDir = process.env.SGS_ALL_NAMES_DIR || await latestDir("-all-names-report");
  if (!allNamesDir) throw new Error("No all-names report found.");
  const classesPath = path.join(allNamesDir, "all-registered-classes.json");
  const glossaryPath = path.join(allNamesDir, "field-meaning-glossary.json");
  const eventPath = path.join(allNamesDir, "event-handler-index.json");
  const classes = await readJson(classesPath);
  const glossaryRows = await readJson(glossaryPath);
  const eventRows = await readJson(eventPath);
  const glossaryMap = new Map(glossaryRows.map((row) => [row.name, row]));
  const eventsByCtor = new Map();
  for (const event of eventRows) {
    const key = event.callerCtor || event.functionName || "";
    if (!key) continue;
    if (!eventsByCtor.has(key)) eventsByCtor.set(key, []);
    eventsByCtor.get(key).push(event);
  }
  const classAudits = classes.map((row) => summarizeClass(row, glossaryMap, eventsByCtor));
  const status = statusCounts(classAudits);
  const summary = {
    classCount: classAudits.length,
    classesWithFields: classAudits.filter((row) => row.counts.fields > 0).length,
    fieldSlots: classAudits.reduce((sum, row) => sum + row.counts.fields, 0),
    statusCounts: status,
    metrics: {
      glossaryInferredFields: classAudits.reduce((sum, row) => sum + row.counts.glossaryInferred, 0),
      namePatternFields: classAudits.reduce((sum, row) => sum + row.counts.namePattern, 0),
      unknownPrivateFields: classAudits.reduce((sum, row) => sum + row.counts.unknownPrivate, 0),
      unknownFields: classAudits.reduce((sum, row) => sum + row.counts.unknown, 0),
      hiddenRiskFields: classAudits.reduce((sum, row) => sum + row.counts.riskFlag, 0),
      triggerMethods: classAudits.reduce((sum, row) => sum + row.counts.triggerMethods, 0),
      eventBindings: classAudits.reduce((sum, row) => sum + row.counts.eventBindings, 0),
      liveNeededClasses: classAudits.filter((row) => row.liveNeeded).length
    }
  };
  const roleSamples = {};
  for (const role of triggerRoleOrder) {
    roleSamples[role] = classAudits
      .filter((row) => row.triggerMethods.some((method) => method.roles.includes(role)))
      .slice(0, 8);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir: allNamesDir,
    inputs: { classesPath, glossaryPath, eventPath },
    summary,
    highPriority: topClasses(classAudits, (row) => row.liveNeeded && row.counts.fields > 0, 40),
    roleSamples,
    classes: classAudits
  };
  const outDir = path.resolve(
    process.env.SGS_CLASS_FIELD_AUDIT_DIR ||
      path.join(explorationRoot, `${timestampName()}-class-field-audit`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "class-field-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "class-field-audit.tsv"), writeTsv(classAudits), "utf8");
  await writeFile(path.join(outDir, "unknown-field-worklist.tsv"), unknownWorklist(classAudits), "utf8");
  await writeFile(path.join(outDir, "class-field-audit.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Class Field Audit Report",
    "",
    `- Markdown: ${path.join(outDir, "class-field-audit.md")}`,
    `- JSON: ${path.join(outDir, "class-field-audit.json")}`,
    `- TSV: ${path.join(outDir, "class-field-audit.tsv")}`,
    `- Unknown worklist: ${path.join(outDir, "unknown-field-worklist.tsv")}`,
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    outDir,
    classCount: summary.classCount,
    fieldSlots: summary.fieldSlots,
    statusCounts: summary.statusCounts,
    metrics: summary.metrics
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
