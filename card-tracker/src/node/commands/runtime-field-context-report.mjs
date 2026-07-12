import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const highlightedClasses = [
  "YanJiao",
  "YanJiaoWindow",
  "GuanXing",
  "GuanXingPo",
  "GuanXingPoker",
  "GuanXingRace",
  "GuanXingWindow",
  "QiMenBaZhen",
  "WoLongZhuGeLiang",
  "SkillSelectorWindow",
  "SkillPopUpWindow",
  "SelectCardWindow",
  "SpellMultiSelectorWindow",
  "TableGameScene",
  "RogueSmallMapScene",
  "RogueFightWindow",
  "RogueJiShiWindow",
  "BlessNewWindow",
  "BlessNewWindowView",
  "KanShuWindow"
];

const rolePriority = [
  "yanjiao",
  "qixing-guanxing",
  "hover-popup",
  "effect-animation",
  "bless-qifu",
  "rogue",
  "kanshu",
  "battle-lifecycle",
  "card-operation",
  "skill-trigger",
  "auto-operation",
  "window-open-close",
  "scene-switch",
  "event-registration",
  "purchase-risk",
  "resource-drawing"
];

const meaningPatterns = [
  { pattern: /handCards|watchCards|cardsInHand|hidden/i, meaning: "hand/hidden-card field; do not use as a known-card source unless visible/protocol-authorized", confidence: "risk-flag" },
  { pattern: /^(x|y|width|height|alpha|visible|scaleX|scaleY|zOrder|rotation|mouseEnabled|mouseThrough)$/i, meaning: "Laya display/layout/input property", confidence: "name-pattern" },
  { pattern: /(manager|Manager|mgr|Mgr|PveMgr|shop|Shop|goods|Goods|reward|Award|Money|pay|Pay|buy|Buy)/, meaning: "manager/shop/reward/currency context; purchase-like calls stay blocked unless allowed", confidence: "source-context" },
  { pattern: /(confirm|cancel|auto|quick|ok).*btn|btn|button/i, meaning: "Laya button or click target", confidence: "source-context" },
  { pattern: /(effect|Effect|anim|Anim|movie|Movie|spine|Spine|tween|Tween)/, meaning: "animation/effect state", confidence: "source-context" },
  { pattern: /(skill|spell|Skill|Spell|responser|Response)/, meaning: "skill/spell response or skill-window state", confidence: "source-context" },
  { pattern: /(card|cards|CardIDs|selfCard|targetCard|split|zone|pile)/i, meaning: "card list, card UI, or card-zone state", confidence: "source-context" },
  { pattern: /(scene|Scene|window|Window|view|View|page|Page|layer|Layer|contentSprite|modalBg|closeBtn)/, meaning: "scene/window/view lifecycle or container state", confidence: "source-context" },
  { pattern: /(data|Data|vo|Vo|info|Info|state|State|status|Status|id|ID|type|Type|name|Name|desc|Desc|text|Text|MData|Protocol|MsgID)/, meaning: "business data, identity, state, text, or protocol payload", confidence: "source-context" },
  { pattern: /^_/, meaning: "private/minified runtime field; needs source branch or live sample for exact meaning", confidence: "unknown-private" }
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

async function latestAllNamesReport() {
  const dir = await latestDir("-all-names-report");
  if (!dir) return null;
  return {
    dir,
    classRows: await readJson(path.join(dir, "all-registered-classes.json")),
    methodRoleIndex: await readJson(path.join(dir, "method-role-index.json")),
    fieldGlossary: await readJson(path.join(dir, "field-meaning-glossary.json"))
  };
}

async function latestFocusedSourceDump() {
  const dir = process.env.SGS_RUNTIME_FOLLOWUP_DIR || await latestDir("-followup-report");
  if (!dir) throw new Error("No followup report found.");
  const filePath = path.join(dir, "focused-source-dump.json");
  const value = await readJson(filePath);
  return { dir, filePath, value };
}

function descriptorMethods(cls) {
  const methods = new Set();
  for (const descriptor of cls.staticDescriptors || []) {
    if (descriptor.fn) methods.add(descriptor.name);
  }
  for (const level of cls.prototypeChain || []) {
    for (const descriptor of level.descriptors || []) {
      if (descriptor.fn) methods.add(descriptor.name);
    }
  }
  return methods;
}

function descriptorFields(cls) {
  const fields = [];
  for (const descriptor of cls.staticDescriptors || []) {
    if (descriptor.name === "prototype" || descriptor.name === "length" || descriptor.name === "name") continue;
    if (descriptor.fn) continue;
    fields.push({ name: descriptor.name, kind: descriptor.kind === "accessor" ? "static-accessor" : "static" });
  }
  const ownProto = cls.prototypeChain?.[0]?.descriptors || [];
  for (const descriptor of ownProto) {
    if (descriptor.name === "constructor" || descriptor.fn) continue;
    fields.push({ name: descriptor.name, kind: descriptor.kind === "accessor" ? "accessor" : "prototype" });
  }
  return fields;
}

function allFunctionSources(cls) {
  const out = [];
  for (const descriptor of cls.staticDescriptors || []) {
    if (descriptor.fn?.source) {
      out.push({
        method: descriptor.name,
        ownerLevel: "static",
        ownerCtor: cls.functionName,
        sourceKind: "method",
        arity: descriptor.fn.arity,
        hash: descriptor.fn.sourceHash,
        length: descriptor.fn.sourceLength,
        source: descriptor.fn.source
      });
    }
    if (descriptor.get?.source) {
      out.push({ method: descriptor.name, ownerLevel: "static", ownerCtor: cls.functionName, sourceKind: "getter", arity: descriptor.get.arity, hash: descriptor.get.sourceHash, length: descriptor.get.sourceLength, source: descriptor.get.source });
    }
    if (descriptor.set?.source) {
      out.push({ method: descriptor.name, ownerLevel: "static", ownerCtor: cls.functionName, sourceKind: "setter", arity: descriptor.set.arity, hash: descriptor.set.sourceHash, length: descriptor.set.sourceLength, source: descriptor.set.source });
    }
  }
  for (const level of cls.prototypeChain || []) {
    for (const descriptor of level.descriptors || []) {
      if (descriptor.fn?.source) {
        out.push({
          method: descriptor.name,
          ownerLevel: level.level,
          ownerCtor: level.ctor,
          sourceKind: "method",
          arity: descriptor.fn.arity,
          hash: descriptor.fn.sourceHash,
          length: descriptor.fn.sourceLength,
          source: descriptor.fn.source
        });
      }
      if (descriptor.get?.source) {
        out.push({ method: descriptor.name, ownerLevel: level.level, ownerCtor: level.ctor, sourceKind: "getter", arity: descriptor.get.arity, hash: descriptor.get.sourceHash, length: descriptor.get.sourceLength, source: descriptor.get.source });
      }
      if (descriptor.set?.source) {
        out.push({ method: descriptor.name, ownerLevel: level.level, ownerCtor: level.ctor, sourceKind: "setter", arity: descriptor.set.arity, hash: descriptor.set.sourceHash, length: descriptor.set.sourceLength, source: descriptor.set.source });
      }
    }
  }
  return out;
}

function buildRoleMap(methodRoleIndex) {
  const map = new Map();
  for (const [role, rows] of Object.entries(methodRoleIndex || {})) {
    for (const row of rows || []) {
      const key = `${row.className}.${row.method}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(role);
    }
  }
  return map;
}

function rolesFor(roleMap, className, method) {
  const roles = Array.from(roleMap.get(`${className}.${method}`) || []);
  roles.sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b));
  return roles;
}

function buildClassMaps(classRows) {
  const categories = new Map();
  const functions = new Map();
  for (const row of classRows || []) {
    categories.set(row.name, row.categories || []);
    functions.set(row.name, row.functionName || "");
  }
  return { categories, functions };
}

function buildGlossaryMap(rows) {
  return new Map((rows || []).map((row) => [row.name, row]));
}

function compactSnippet(source, index, length = 170) {
  const start = Math.max(0, index - Math.floor(length / 2));
  const end = Math.min(source.length, index + Math.floor(length / 2));
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function classifyMemberUse(source, matchEnd, matchStart) {
  const after = source.slice(matchEnd, matchEnd + 16);
  const before = source.slice(Math.max(0, matchStart - 8), matchStart);
  if (/^\s*\(/.test(after)) return "call";
  if (/^\s*(?:\+\+|--)/.test(after) || /(?:\+\+|--)\s*$/.test(before)) return "mutate";
  if (/^\s*(?:=|\+=|-=|\*=|\/=|%=|\?\?=|\|\|=|&&=)/.test(after)) return "write";
  return "read";
}

function uniqueLimit(values, limit = 40) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const item = String(value ?? "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function extractStringLiterals(source) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1).){0,120})\1/g;
  for (const match of source.matchAll(re)) {
    const text = match[2].replace(/\\n/g, " ").trim();
    if (!text || text.length > 100) continue;
    out.push(text);
  }
  return uniqueLimit(out, 80);
}

function extractConstants(source) {
  const dotted = source.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g) || [];
  return uniqueLimit(dotted.filter((item) =>
    /(?:Laya\.Event|MSG_|OPT_|ZONE_|Type_|RECORD_|WindowName|MsgID|Protocol|CLIENT_|SERVER_|EVENT|Req|Rep|Ntf)/.test(item)
  ), 100);
}

function extractProtocolFields(source) {
  const out = [];
  const re = /\b([A-Za-z_$][\w$]*)\.([A-Z][A-Za-z0-9_]*|MData|Protocol|Params|Timeout|SeatID|ToZone|FromZone|CardIDs|SrcSeatID|WindowName|Type|Index|ID|Name|Status)\b/g;
  for (const match of source.matchAll(re)) {
    out.push(`${match[1]}.${match[2]}`);
  }
  return uniqueLimit(out, 100);
}

function extractCallNames(source) {
  const out = [];
  const re = /\b((?:this\.)?[A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (["if", "for", "while", "switch", "return", "new", "typeof"].includes(name)) continue;
    out.push(name);
  }
  return uniqueLimit(out, 80);
}

function extractEventBindings(source) {
  const out = [];
  const addRemove = /\b(AddEventListener|RemoveEventListener)\(([^,()]+(?:\.[^,()]+)*),this,this\.([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(addRemove)) {
    out.push({ kind: match[1], event: match[2], handler: match[3] });
  }
  const layaOnOff = /\.((?:on)|(?:off)|(?:once))\((Laya\.Event\.[A-Za-z_$][\w$]*|[^,()]+),this,this\.([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(layaOnOff)) {
    out.push({ kind: match[1], event: match[2], handler: match[3] });
  }
  const updateWindow = /\bUpdateWindow\((["'`])([^"'`]+)\1/g;
  for (const match of source.matchAll(updateWindow)) {
    out.push({ kind: "UpdateWindow", event: match[2], handler: "window-update" });
  }
  const windowName = /\bWindowName\s*=\s*(["'`])([^"'`]+)\1/g;
  for (const match of source.matchAll(windowName)) {
    out.push({ kind: "WindowName", event: match[2], handler: "responser-window" });
  }
  return out;
}

function analyzeSource(source, methodSet) {
  const uses = [];
  const re = /this(?:\.([A-Za-z_$][\w$]*)|\[["']([^"']+)["']\])/g;
  for (const match of source.matchAll(re)) {
    const member = match[1] || match[2];
    const operation = classifyMemberUse(source, match.index + match[0].length, match.index);
    const isKnownMethod = methodSet.has(member);
    const isStateField = operation !== "call";
    uses.push({
      member,
      operation,
      isKnownMethod,
      isStateField,
      snippet: compactSnippet(source, match.index)
    });
  }
  return {
    uses,
    strings: extractStringLiterals(source),
    constants: extractConstants(source),
    protocolFields: extractProtocolFields(source),
    calls: extractCallNames(source),
    eventBindings: extractEventBindings(source)
  };
}

function fieldMeaning(fieldName, aggregate, glossaryMap) {
  const glossary = glossaryMap.get(fieldName);
  if (glossary) {
    return {
      meaning: glossary.meaning,
      confidence: "glossary-inferred",
      risk: /hidden|handCards|watchCards|cardsInHand/i.test(`${fieldName} ${glossary.meaning}`)
    };
  }
  for (const item of meaningPatterns) {
    if (item.pattern.test(fieldName)) {
      return {
        meaning: item.meaning,
        confidence: item.confidence,
        risk: item.confidence === "risk-flag"
      };
    }
  }
  const contextText = [
    fieldName,
    ...(aggregate.constants || []),
    ...(aggregate.eventBindings || []),
    ...(aggregate.protocolFields || []),
    ...(aggregate.snippets || [])
  ].join(" ");
  for (const item of meaningPatterns) {
    if (item.pattern.test(contextText)) {
      return {
        meaning: item.meaning,
        confidence: item.confidence,
        risk: item.confidence === "risk-flag"
      };
    }
  }
  return {
    meaning: "source-visible instance field; exact business meaning still needs a class-specific source/live explanation",
    confidence: "source-context",
    risk: false
  };
}

function summarizeClass(cls, roleMap, classMaps, glossaryMap) {
  const className = cls.registeredName;
  const methodSet = descriptorMethods(cls);
  const descriptorFieldRows = descriptorFields(cls);
  const functions = allFunctionSources(cls);
  const fields = new Map();
  const memberCalls = new Map();
  const methodRows = [];
  const eventBindings = [];

  const ensureField = (name) => {
    if (!fields.has(name)) {
      fields.set(name, {
        name,
        descriptorKinds: [],
        operations: {},
        methods: [],
        constants: [],
        strings: [],
        protocolFields: [],
        eventBindings: [],
        snippets: []
      });
    }
    return fields.get(name);
  };

  for (const descriptorField of descriptorFieldRows) {
    const item = ensureField(descriptorField.name);
    item.descriptorKinds.push(descriptorField.kind);
  }

  for (const fn of functions) {
    const roles = rolesFor(roleMap, className, fn.method);
    const analyzed = analyzeSource(fn.source || "", methodSet);
    methodRows.push({
      method: fn.method,
      sourceKind: fn.sourceKind,
      ownerLevel: fn.ownerLevel,
      ownerCtor: fn.ownerCtor,
      roles,
      hash: fn.hash,
      length: fn.length,
      arity: fn.arity,
      constants: analyzed.constants.slice(0, 30),
      strings: analyzed.strings.slice(0, 30),
      protocolFields: analyzed.protocolFields.slice(0, 30),
      eventBindings: analyzed.eventBindings,
      thisCalls: analyzed.uses.filter((use) => use.operation === "call").map((use) => use.member).slice(0, 40)
    });
    eventBindings.push(...analyzed.eventBindings.map((item) => ({ ...item, method: fn.method, roles })));
    for (const use of analyzed.uses) {
      if (!use.isStateField) {
        if (!memberCalls.has(use.member)) memberCalls.set(use.member, { name: use.member, methods: new Set(), snippets: [] });
        const call = memberCalls.get(use.member);
        call.methods.add(fn.method);
        if (call.snippets.length < 4) call.snippets.push(use.snippet);
        continue;
      }
      const field = ensureField(use.member);
      field.operations[use.operation] = (field.operations[use.operation] || 0) + 1;
      const origin = fn.ownerLevel === 0 || fn.ownerLevel === "static" ? "own" : "inherited";
      if (!field.methods.some((item) => item.method === fn.method)) {
        field.methods.push({ method: fn.method, roles, ownerLevel: fn.ownerLevel, sourceKind: fn.sourceKind, origin });
      }
      field.constants.push(...analyzed.constants);
      field.strings.push(...analyzed.strings);
      field.protocolFields.push(...analyzed.protocolFields);
      field.eventBindings.push(...analyzed.eventBindings.map((item) => `${item.kind}:${item.event}:${item.handler}`));
      if (field.snippets.length < 8) field.snippets.push(use.snippet);
    }
  }

  const fieldRows = Array.from(fields.values()).map((field) => {
    field.descriptorKinds = uniqueLimit(field.descriptorKinds, 10);
    field.constants = uniqueLimit(field.constants, 20);
    field.strings = uniqueLimit(field.strings, 20);
    field.protocolFields = uniqueLimit(field.protocolFields, 20);
    field.eventBindings = uniqueLimit(field.eventBindings, 20);
    field.snippets = uniqueLimit(field.snippets, 8);
    const meaning = fieldMeaning(field.name, field, glossaryMap);
    const ownMethods = field.methods.filter((item) => item.origin === "own");
    const inheritedMethods = field.methods.filter((item) => item.origin !== "own");
    let origin = "descriptor-only";
    if (ownMethods.length && inheritedMethods.length) origin = "mixed";
    else if (ownMethods.length) origin = "own-source";
    else if (inheritedMethods.length) origin = "inherited-source";
    return {
      ...field,
      origin,
      operationsText: Object.entries(field.operations).map(([key, value]) => `${key}:${value}`).join(","),
      methodNames: field.methods.map((item) => item.method),
      ownMethodNames: ownMethods.map((item) => item.method),
      inheritedMethodNames: inheritedMethods.map((item) => item.method),
      meaning: meaning.meaning,
      confidence: meaning.confidence,
      risk: meaning.risk
    };
  }).sort((a, b) => scoreField(b) - scoreField(a) || a.name.localeCompare(b.name));

  const callRows = Array.from(memberCalls.values()).map((item) => ({
    name: item.name,
    methods: Array.from(item.methods).sort(),
    snippets: item.snippets
  })).sort((a, b) => b.methods.length - a.methods.length || a.name.localeCompare(b.name));

  return {
    className,
    functionName: cls.functionName || classMaps.functions.get(className) || "",
    reverseNames: cls.reverseNames || [],
    categories: classMaps.categories.get(className) || [],
    constructorHash: cls.constructorSource?.sourceHash || "",
    constructorLength: cls.constructorSource?.sourceLength || 0,
    methodCount: functions.length,
    fieldCount: fieldRows.length,
    descriptorFieldCount: descriptorFieldRows.length,
    sourceDiscoveredFieldCount: fieldRows.filter((field) => field.methodNames.length).length,
    ownSourceDiscoveredFieldCount: fieldRows.filter((field) => field.ownMethodNames.length).length,
    riskFieldCount: fieldRows.filter((field) => field.risk).length,
    unknownPrivateFieldCount: fieldRows.filter((field) => field.confidence === "unknown-private").length,
    eventBindingCount: eventBindings.length,
    eventBindings: eventBindings.slice(0, 120),
    fields: fieldRows,
    methodContexts: methodRows,
    thisMethodCalls: callRows.slice(0, 160)
  };
}

function scoreField(field) {
  const operations = Object.values(field.operations || {}).reduce((sum, count) => sum + count, 0);
  const roleWeight = field.methods.some((item) => (item.roles || []).some((role) => rolePriority.includes(role))) ? 20 : 0;
  const riskWeight = field.risk ? 30 : 0;
  const originWeight = field.origin === "own-source" || field.origin === "mixed" ? 400 : field.origin === "descriptor-only" ? 100 : 0;
  return originWeight + operations + roleWeight + riskWeight + field.eventBindings.length * 3 + field.protocolFields.length;
}

function buildSummary(classes) {
  return {
    sourceClassCount: classes.length,
    methodContexts: classes.reduce((sum, cls) => sum + cls.methodCount, 0),
    fieldRows: classes.reduce((sum, cls) => sum + cls.fieldCount, 0),
    descriptorFields: classes.reduce((sum, cls) => sum + cls.descriptorFieldCount, 0),
    sourceDiscoveredFields: classes.reduce((sum, cls) => sum + cls.sourceDiscoveredFieldCount, 0),
    ownSourceDiscoveredFields: classes.reduce((sum, cls) => sum + cls.ownSourceDiscoveredFieldCount, 0),
    riskFields: classes.reduce((sum, cls) => sum + cls.riskFieldCount, 0),
    unknownPrivateFields: classes.reduce((sum, cls) => sum + cls.unknownPrivateFieldCount, 0),
    eventBindings: classes.reduce((sum, cls) => sum + cls.eventBindingCount, 0),
    highlightedCovered: highlightedClasses.filter((name) => classes.some((cls) => cls.className === name)).length
  };
}

function buildTsv(classes) {
  const header = [
    "className",
    "functionName",
    "categories",
    "field",
    "confidence",
    "risk",
    "meaning",
    "descriptorKinds",
    "origin",
    "operations",
    "methods",
    "ownMethods",
    "inheritedMethods",
    "roles",
    "constants",
    "strings",
    "protocolFields",
    "eventBindings",
    "snippets"
  ];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    for (const field of cls.fields) {
      const roles = uniqueLimit(field.methods.flatMap((item) => item.roles || []), 20).join(",");
      lines.push([
        cls.className,
        cls.functionName,
        cls.categories.join(","),
        field.name,
        field.confidence,
        String(field.risk),
        field.meaning,
        field.descriptorKinds.join(","),
        field.origin,
        field.operationsText,
        field.methodNames.slice(0, 30).join(","),
        field.ownMethodNames.slice(0, 30).join(","),
        field.inheritedMethodNames.slice(0, 30).join(","),
        roles,
        field.constants.join(";"),
        field.strings.join(";"),
        field.protocolFields.join(";"),
        field.eventBindings.join(";"),
        field.snippets.slice(0, 4).join(" || ")
      ].map(tsvCell).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildMethodTsv(classes) {
  const header = [
    "className",
    "method",
    "ownerLevel",
    "ownerCtor",
    "roles",
    "hash",
    "length",
    "constants",
    "strings",
    "protocolFields",
    "eventBindings",
    "thisCalls"
  ];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    for (const method of cls.methodContexts) {
      lines.push([
        cls.className,
        method.method,
        method.ownerLevel,
        method.ownerCtor,
        method.roles.join(","),
        method.hash,
        method.length,
        method.constants.join(";"),
        method.strings.join(";"),
        method.protocolFields.join(";"),
        method.eventBindings.map((item) => `${item.kind}:${item.event}:${item.handler}`).join(";"),
        method.thisCalls.join(",")
      ].map(tsvCell).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Field Context Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Focused source dump: ${report.inputs.focusedSourceDump}`);
  lines.push(`- All-names report: ${report.inputs.allNamesReport}`);
  lines.push(`- Source classes: ${report.summary.sourceClassCount}`);
  lines.push(`- Method contexts: ${report.summary.methodContexts}`);
  lines.push(`- Field rows: ${report.summary.fieldRows}`);
  lines.push(`- Source-discovered instance fields: ${report.summary.sourceDiscoveredFields}`);
  lines.push(`- Own-source instance fields: ${report.summary.ownSourceDiscoveredFields}`);
  lines.push(`- Descriptor fields/accessors/static fields: ${report.summary.descriptorFields}`);
  lines.push(`- Event binding rows: ${report.summary.eventBindings}`);
  lines.push("");
  lines.push("## Meaning");
  lines.push("");
  lines.push("- This report fills the gap left by descriptor-only audits: fields assigned as `this.x = ...` inside constructors or methods are treated as source-visible instance fields.");
  lines.push("- `source-context` means the field is proved by method source and surrounding constants/calls, but exact game semantics may still require live protocol/runtime evidence.");
  lines.push("- `risk-flag` marks hidden-hand or purchase-like context that must not be used for known-card facts or automated purchases.");
  lines.push("");
  lines.push("## Highlighted Classes");
  lines.push("");
  lines.push("| Class | Function | Categories | Fields | Source Fields | Events | Important Fields |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- |");
  for (const cls of report.classes.filter((item) => highlightedClasses.includes(item.className))) {
    const important = cls.fields
      .filter((field) => field.origin === "own-source" || field.origin === "mixed" || field.origin === "descriptor-only")
      .slice(0, 10)
      .map((field) => `${field.name}:${field.confidence}/${field.origin}`)
      .join("; ");
    lines.push(`| \`${escapeCell(cls.className)}\` | \`${escapeCell(cls.functionName)}\` | ${escapeCell(cls.categories.join(","))} | ${cls.fieldCount} | ${cls.ownSourceDiscoveredFieldCount}/${cls.sourceDiscoveredFieldCount} | ${cls.eventBindingCount} | ${escapeCell(important)} |`);
  }
  lines.push("");
  lines.push("## Class Details");
  lines.push("");
  for (const cls of report.classes.filter((item) => highlightedClasses.includes(item.className))) {
    lines.push(`### ${cls.className}`);
    lines.push("");
    lines.push(`- functionName: \`${cls.functionName}\`; fields=${cls.fieldCount}; methods=${cls.methodCount}; eventBindings=${cls.eventBindingCount}`);
    if (cls.eventBindings.length) {
      lines.push(`- event bindings: ${cls.eventBindings.slice(0, 12).map((event) => `\`${event.method}:${event.kind}:${event.event}->${event.handler}\``).join(", ")}`);
    }
    lines.push("");
    lines.push("| Field | Meaning | Confidence | Origin | Ops | Own Methods | Constants / Events |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    const detailFields = [
      ...cls.fields.filter((field) => field.origin === "own-source" || field.origin === "mixed" || field.origin === "descriptor-only"),
      ...cls.fields.filter((field) => field.origin === "inherited-source")
    ];
    for (const field of detailFields.slice(0, 24)) {
      const constants = uniqueLimit([
        ...field.constants,
        ...field.eventBindings,
        ...field.protocolFields
      ], 8).join("; ");
      lines.push(`| \`${escapeCell(field.name)}\` | ${escapeCell(field.meaning)} | \`${field.confidence}${field.risk ? "/risk" : ""}\` | \`${field.origin}\` | ${escapeCell(field.operationsText || "(descriptor)")} | ${escapeCell(field.ownMethodNames.slice(0, 8).join(", "))} | ${escapeCell(constants)} |`);
    }
    lines.push("");
  }
  lines.push("## Files");
  lines.push("");
  lines.push("- `field-context-report.json`: full field/method/event context.");
  lines.push("- `field-context-fields.tsv`: flattened source-visible fields.");
  lines.push("- `field-context-methods.tsv`: flattened method constants/events/calls.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

async function main() {
  const focused = await latestFocusedSourceDump();
  const allNames = await latestAllNamesReport();
  if (!allNames) throw new Error("No all-names report found.");

  const dump = focused.value.value || focused.value;
  const roleMap = buildRoleMap(allNames.methodRoleIndex);
  const classMaps = buildClassMaps(allNames.classRows);
  const glossaryMap = buildGlossaryMap(allNames.fieldGlossary);
  const classes = (dump.classes || [])
    .map((cls) => summarizeClass(cls, roleMap, classMaps, glossaryMap))
    .sort((a, b) => {
      const ai = highlightedClasses.indexOf(a.className);
      const bi = highlightedClasses.indexOf(b.className);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return b.fieldCount - a.fieldCount || a.className.localeCompare(b.className);
    });

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      focusedSourceDump: focused.filePath,
      focusedSourceDir: focused.dir,
      allNamesReport: allNames.dir
    },
    summary: buildSummary(classes),
    classes
  };

  const outDir = path.resolve(
    process.env.SGS_RUNTIME_FIELD_CONTEXT_DIR ||
      path.join(explorationRoot, `${timestampName()}-field-context-report`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "field-context-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "field-context-fields.tsv"), buildTsv(classes), "utf8");
  await writeFile(path.join(outDir, "field-context-methods.tsv"), buildMethodTsv(classes), "utf8");
  await writeFile(path.join(outDir, "field-context-report.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Field Context Report",
    "",
    `- Markdown: ${path.join(outDir, "field-context-report.md")}`,
    `- JSON: ${path.join(outDir, "field-context-report.json")}`,
    `- Field TSV: ${path.join(outDir, "field-context-fields.tsv")}`,
    `- Method TSV: ${path.join(outDir, "field-context-methods.tsv")}`,
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    focusedSourceDump: focused.filePath,
    allNamesReport: allNames.dir,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
