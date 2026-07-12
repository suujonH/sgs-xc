import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

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

const fieldMeaningPatterns = [
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
  const dir = process.env.SGS_RUNTIME_ALL_NAMES_DIR || await latestDir("-all-names-report");
  if (!dir) return null;
  return {
    dir,
    classesPath: path.join(dir, "all-registered-classes.json"),
    methodRoleIndexPath: path.join(dir, "method-role-index.json"),
    fieldGlossaryPath: path.join(dir, "field-meaning-glossary.json"),
    classes: await readJson(path.join(dir, "all-registered-classes.json")),
    methodRoleIndex: await readJson(path.join(dir, "method-role-index.json")),
    fieldGlossary: await readJson(path.join(dir, "field-meaning-glossary.json"))
  };
}

function classifyName(name) {
  const categories = [];
  const add = (value) => { if (!categories.includes(value)) categories.push(value); };
  if (/Scene$/.test(name)) add("scene");
  if (/GameScene$|TableGameScene|RaidTableGameScene/.test(name)) add("game-scene");
  if (/Window$/.test(name)) add("window");
  if (/View$|UI$|Item$|Panel$|Page$|Tab$|Btn$|Button$/.test(name)) add("ui");
  if (/(Req|Rep|Ntf|Msg|Protocol)$|^(C|S|Gs|Msg|Pub)/.test(name)) add("protocol");
  if (/Manager|Mgr|Controler|Controller/.test(name)) add("manager");
  if (/Skill|Spell|YanJiao|GuanXing|QiMen|ZhuGe|WoLong|BiFa|MilitaryOrders/.test(name)) add("skill");
  if (/Card|Poker|Select|Choose|Discard|Use|Hand|Deck|Pile|Zone|Move/.test(name)) add("card-flow");
  if (/Effect|Animation|Tween|Spine|Movie|Motion|Anim/.test(name)) add("effect");
  if (/Rogue|ShanHe|Shanhetu|Roguo|JiShi/.test(name)) add("rogue");
  if (/Bless|QiFu|Qifu/.test(name)) add("bless-qifu");
  if (/KanShu|Jbp|FaCai|Tree/.test(name)) add("kanshu");
  if (/YanJiao/.test(name)) add("yanjiao");
  if (/GuanXing|Qixing|QiXing/.test(name)) add("guanxing-qixing");
  if (!categories.length) add("other");
  return categories;
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
  roles.sort((a, b) => {
    const ai = rolePriority.indexOf(a);
    const bi = rolePriority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
  });
  return roles;
}

function buildGlossaryMap(rows) {
  return new Map((rows || []).map((row) => [row.name, row]));
}

function buildEstimateExpression(depth) {
  return `(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}); } catch { return []; } };
    const CU = window.Laya && window.Laya.ClassUtils;
    const classMap = CU && CU._classMap || {};
    const top = [];
    const totals = {
      classCount: 0,
      constructorCount: 0,
      constructorSourceChars: 0,
      staticMethodCount: 0,
      staticSourceChars: 0,
      ownMethodCount: 0,
      ownSourceChars: 0,
      ownAccessorCount: 0,
      ownAccessorSourceChars: 0,
      inheritedSummaryMethodCount: 0
    };
    for (const name of Object.keys(classMap).sort()) {
      const cls = classMap[name];
      if (typeof cls !== "function") continue;
      totals.classCount++;
      let clsChars = 0;
      const ctorSource = String(cls);
      totals.constructorCount++;
      totals.constructorSourceChars += ctorSource.length;
      clsChars += ctorSource.length;
      for (const key of own(cls)) {
        if (["prototype", "length", "name"].includes(key)) continue;
        const d = Object.getOwnPropertyDescriptor(cls, key);
        if (typeof d?.value === "function") {
          const len = String(d.value).length;
          totals.staticMethodCount++;
          totals.staticSourceChars += len;
          clsChars += len;
        }
        if (d?.get) {
          const len = String(d.get).length;
          totals.ownAccessorCount++;
          totals.ownAccessorSourceChars += len;
          clsChars += len;
        }
        if (d?.set) {
          const len = String(d.set).length;
          totals.ownAccessorCount++;
          totals.ownAccessorSourceChars += len;
          clsChars += len;
        }
      }
      let p = cls.prototype;
      for (let level = 0; level < ${Number(depth)} && p; level++, p = Object.getPrototypeOf(p)) {
        for (const key of own(p)) {
          const d = Object.getOwnPropertyDescriptor(p, key);
          if (typeof d?.value === "function") {
            if (level === 0) {
              const len = String(d.value).length;
              totals.ownMethodCount++;
              totals.ownSourceChars += len;
              clsChars += len;
            } else {
              totals.inheritedSummaryMethodCount++;
            }
          }
          if (level === 0 && d?.get) {
            const len = String(d.get).length;
            totals.ownAccessorCount++;
            totals.ownAccessorSourceChars += len;
            clsChars += len;
          }
          if (level === 0 && d?.set) {
            const len = String(d.set).length;
            totals.ownAccessorCount++;
            totals.ownAccessorSourceChars += len;
            clsChars += len;
          }
        }
      }
      top.push({ name, functionName: cls.name || "", sourceChars: clsChars });
    }
    top.sort((a, b) => b.sourceChars - a.sourceChars);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      totals,
      top: top.slice(0, 40)
    };
  })()`;
}

function buildSourceDumpExpression(names, depth) {
  return `(() => {
    const names = ${JSON.stringify(names)};
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const simpleValue = (v) => {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (t === "function") return "[Function " + (v.name || "") + "]";
      if (Array.isArray(v)) return "[Array " + v.length + "]";
      if (v instanceof Map) return "[Map " + v.size + "]";
      return "[" + (ctor(v) || t) + "]";
    };
    const hashString = (text) => {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    const sourceOf = (fn, includeSource = true) => {
      if (typeof fn !== "function") return null;
      const source = Function.prototype.toString.call(fn);
      const out = { name: fn.name || "", arity: fn.length, sourceLength: source.length, sourceHash: hashString(source) };
      if (includeSource) out.source = source;
      return out;
    };
    const descSources = (o, includeSource) => own(o).map((name) => {
      try {
        const d = Object.getOwnPropertyDescriptor(o, name);
        const item = { name, kind: d?.get || d?.set ? "accessor" : "value", enumerable: !!d?.enumerable, configurable: !!d?.configurable };
        if (d?.get) item.get = sourceOf(d.get, includeSource);
        if (d?.set) item.set = sourceOf(d.set, includeSource);
        if ("value" in d) {
          item.type = typeof d.value;
          item.ctor = ctor(d.value);
          item.value = simpleValue(d.value);
          if (typeof d.value === "function") item.fn = sourceOf(d.value, includeSource);
        }
        return item;
      } catch (error) {
        return { name, error: String(error?.message || error) };
      }
    });
    const classMap = window.Laya?.ClassUtils?._classMap || {};
    const classDump = (registeredName) => {
      const cls = classMap[registeredName];
      if (!cls) return { registeredName, exists: false };
      const reverseNames = Object.entries(classMap).filter(([, value]) => value === cls).map(([name]) => name).sort();
      const chain = [];
      let p = cls.prototype || null;
      for (let level = 0; level < ${Number(depth)} && p; level++, p = Object.getPrototypeOf(p)) {
        chain.push({ level, ctor: ctor(p), descriptors: descSources(p, level === 0) });
      }
      return {
        registeredName,
        exists: true,
        functionName: cls.name || "",
        reverseNames,
        constructorSource: sourceOf(cls, true),
        staticDescriptors: descSources(cls, true),
        prototypeChain: chain
      };
    };
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      depth: ${Number(depth)},
      requested: names.length,
      classes: names.map(classDump)
    };
  })()`;
}

function allFunctionSources(cls) {
  const out = [];
  if (cls.constructorSource?.source) {
    out.push({
      method: "constructor",
      sourceKind: "constructor",
      ownerLevel: "constructor",
      ownerCtor: cls.functionName,
      arity: cls.constructorSource.arity,
      hash: cls.constructorSource.sourceHash,
      length: cls.constructorSource.sourceLength,
      source: cls.constructorSource.source
    });
  }
  for (const descriptor of cls.staticDescriptors || []) {
    if (["prototype", "name", "length"].includes(descriptor.name)) continue;
    if (descriptor.fn?.source) {
      out.push({ method: descriptor.name, sourceKind: "static-method", ownerLevel: "static", ownerCtor: cls.functionName, arity: descriptor.fn.arity, hash: descriptor.fn.sourceHash, length: descriptor.fn.sourceLength, source: descriptor.fn.source });
    }
    if (descriptor.get?.source) {
      out.push({ method: descriptor.name, sourceKind: "static-getter", ownerLevel: "static", ownerCtor: cls.functionName, arity: descriptor.get.arity, hash: descriptor.get.sourceHash, length: descriptor.get.sourceLength, source: descriptor.get.source });
    }
    if (descriptor.set?.source) {
      out.push({ method: descriptor.name, sourceKind: "static-setter", ownerLevel: "static", ownerCtor: cls.functionName, arity: descriptor.set.arity, hash: descriptor.set.sourceHash, length: descriptor.set.sourceLength, source: descriptor.set.source });
    }
  }
  const ownProto = cls.prototypeChain?.[0]?.descriptors || [];
  for (const descriptor of ownProto) {
    if (descriptor.fn?.source) {
      out.push({ method: descriptor.name, sourceKind: "own-method", ownerLevel: 0, ownerCtor: cls.prototypeChain?.[0]?.ctor || "", arity: descriptor.fn.arity, hash: descriptor.fn.sourceHash, length: descriptor.fn.sourceLength, source: descriptor.fn.source });
    }
    if (descriptor.get?.source) {
      out.push({ method: descriptor.name, sourceKind: "own-getter", ownerLevel: 0, ownerCtor: cls.prototypeChain?.[0]?.ctor || "", arity: descriptor.get.arity, hash: descriptor.get.sourceHash, length: descriptor.get.sourceLength, source: descriptor.get.source });
    }
    if (descriptor.set?.source) {
      out.push({ method: descriptor.name, sourceKind: "own-setter", ownerLevel: 0, ownerCtor: cls.prototypeChain?.[0]?.ctor || "", arity: descriptor.set.arity, hash: descriptor.set.sourceHash, length: descriptor.set.sourceLength, source: descriptor.set.source });
    }
  }
  return out;
}

function descriptorFields(cls) {
  const fields = [];
  for (const descriptor of cls.staticDescriptors || []) {
    if (["prototype", "length", "name"].includes(descriptor.name) || descriptor.fn) continue;
    fields.push({ name: descriptor.name, kind: descriptor.kind === "accessor" ? "static-accessor" : "static" });
  }
  const ownProto = cls.prototypeChain?.[0]?.descriptors || [];
  for (const descriptor of ownProto) {
    if (descriptor.name === "constructor" || descriptor.fn) continue;
    fields.push({ name: descriptor.name, kind: descriptor.kind === "accessor" ? "accessor" : "prototype" });
  }
  return fields;
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
    /(?:Laya\.Event|MSG_|OPT_|ZONE_|Type_|RECORD_|WindowName|MsgID|Protocol|CLIENT_|SERVER_|EVENT|Req|Rep|Ntf|Send|Response|UpdateWindow)/.test(item)
  ), 100);
}

function extractProtocolFields(source) {
  const out = [];
  const re = /\b([A-Za-z_$][\w$]*)\.([A-Z][A-Za-z0-9_]*|MData|Protocol|Params|Timeout|SeatID|ToZone|FromZone|CardIDs|SrcSeatID|WindowName|Type|Index|ID|Name|Status)\b/g;
  for (const match of source.matchAll(re)) out.push(`${match[1]}.${match[2]}`);
  return uniqueLimit(out, 100);
}

function extractEventBindings(source) {
  const out = [];
  const addRemove = /\b(AddEventListener|RemoveEventListener)\(([^,()]+(?:\.[^,()]+)*),this,this\.([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(addRemove)) out.push({ kind: match[1], event: match[2], handler: match[3] });
  const layaOnOff = /\.((?:on)|(?:off)|(?:once))\((Laya\.Event\.[A-Za-z_$][\w$]*|[^,()]+),this,this\.([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(layaOnOff)) out.push({ kind: match[1], event: match[2], handler: match[3] });
  const updateWindow = /\bUpdateWindow\((["'`])([^"'`]+)\1/g;
  for (const match of source.matchAll(updateWindow)) out.push({ kind: "UpdateWindow", event: match[2], handler: "window-update" });
  const windowName = /\bWindowName\s*=\s*(["'`])([^"'`]+)\1/g;
  for (const match of source.matchAll(windowName)) out.push({ kind: "WindowName", event: match[2], handler: "responser-window" });
  return out;
}

function analyzeSource(source) {
  const uses = [];
  const re = /this(?:\.([A-Za-z_$][\w$]*)|\[["']([^"']+)["']\])/g;
  for (const match of source.matchAll(re)) {
    const member = match[1] || match[2];
    const operation = classifyMemberUse(source, match.index + match[0].length, match.index);
    uses.push({ member, operation, isStateField: operation !== "call", snippet: compactSnippet(source, match.index) });
  }
  return {
    uses,
    strings: extractStringLiterals(source),
    constants: extractConstants(source),
    protocolFields: extractProtocolFields(source),
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
  for (const item of fieldMeaningPatterns) {
    if (item.pattern.test(fieldName)) return { meaning: item.meaning, confidence: item.confidence, risk: item.confidence === "risk-flag" };
  }
  const contextText = [fieldName, ...(aggregate.constants || []), ...(aggregate.eventBindings || []), ...(aggregate.protocolFields || []), ...(aggregate.snippets || [])].join(" ");
  for (const item of fieldMeaningPatterns) {
    if (item.pattern.test(contextText)) return { meaning: item.meaning, confidence: item.confidence, risk: item.confidence === "risk-flag" };
  }
  return {
    meaning: "source-visible instance/static field; exact business meaning still needs a class-specific source/live explanation",
    confidence: "source-context",
    risk: false
  };
}

function summarizeClass(cls, roleMap, glossaryMap, classRowByName) {
  const className = cls.registeredName;
  const classRow = classRowByName.get(className);
  const categories = classRow?.categories || classifyName(className);
  const functions = allFunctionSources(cls);
  const descriptorFieldRows = descriptorFields(cls);
  const fields = new Map();
  const methodContexts = [];
  const eventBindings = [];

  const ensureField = (name) => {
    if (!fields.has(name)) {
      fields.set(name, { name, descriptorKinds: [], operations: {}, methods: [], constants: [], strings: [], protocolFields: [], eventBindings: [], snippets: [] });
    }
    return fields.get(name);
  };

  for (const descriptorField of descriptorFieldRows) {
    ensureField(descriptorField.name).descriptorKinds.push(descriptorField.kind);
  }

  for (const fn of functions) {
    const roles = rolesFor(roleMap, className, fn.method);
    const analyzed = analyzeSource(fn.source || "");
    methodContexts.push({
      className,
      functionName: cls.functionName || "",
      method: fn.method,
      sourceKind: fn.sourceKind,
      ownerLevel: fn.ownerLevel,
      roles,
      hash: fn.hash,
      length: fn.length,
      arity: fn.arity,
      constants: analyzed.constants.slice(0, 30),
      strings: analyzed.strings.slice(0, 30),
      protocolFields: analyzed.protocolFields.slice(0, 30),
      eventBindings: analyzed.eventBindings
    });
    eventBindings.push(...analyzed.eventBindings.map((item) => ({ ...item, className, method: fn.method, roles })));
    for (const use of analyzed.uses) {
      if (!use.isStateField) continue;
      const field = ensureField(use.member);
      field.operations[use.operation] = (field.operations[use.operation] || 0) + 1;
      if (!field.methods.some((item) => item.method === fn.method && item.sourceKind === fn.sourceKind)) {
        field.methods.push({ method: fn.method, roles, sourceKind: fn.sourceKind, ownerLevel: fn.ownerLevel });
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
    return {
      className,
      functionName: cls.functionName || "",
      categories,
      name: field.name,
      descriptorKinds: field.descriptorKinds,
      operations: field.operations,
      operationsText: Object.entries(field.operations).map(([key, value]) => `${key}:${value}`).join(","),
      methods: field.methods,
      methodNames: field.methods.map((item) => item.method),
      roles: uniqueLimit(field.methods.flatMap((item) => item.roles || []), 20),
      constants: field.constants,
      strings: field.strings,
      protocolFields: field.protocolFields,
      eventBindings: field.eventBindings,
      snippets: field.snippets,
      meaning: meaning.meaning,
      confidence: meaning.confidence,
      risk: meaning.risk
    };
  }).sort((a, b) => b.methodNames.length - a.methodNames.length || a.name.localeCompare(b.name));

  return {
    className,
    functionName: cls.functionName || "",
    reverseNames: cls.reverseNames || [],
    categories,
    exists: cls.exists,
    methodContexts,
    fieldRows,
    eventBindings,
    counts: {
      methods: methodContexts.length,
      sourceChars: methodContexts.reduce((sum, item) => sum + (item.length || 0), 0),
      fields: fieldRows.length,
      sourceFields: fieldRows.filter((field) => field.methodNames.length).length,
      descriptorFields: descriptorFieldRows.length,
      eventBindings: eventBindings.length,
      riskFields: fieldRows.filter((field) => field.risk).length,
      unknownPrivateFields: fieldRows.filter((field) => field.confidence === "unknown-private").length
    }
  };
}

function buildCategoryCounts(classes) {
  const out = {};
  for (const cls of classes) {
    for (const category of cls.categories || []) out[category] = (out[category] || 0) + 1;
  }
  return out;
}

function buildSummary(classSummaries, estimate, missingNames) {
  return {
    capturedClassCount: classSummaries.length,
    missingClassCount: missingNames.length,
    categories: buildCategoryCounts(classSummaries),
    methodContexts: classSummaries.reduce((sum, item) => sum + item.counts.methods, 0),
    sourceChars: classSummaries.reduce((sum, item) => sum + item.counts.sourceChars, 0),
    fieldRows: classSummaries.reduce((sum, item) => sum + item.counts.fields, 0),
    sourceFieldRows: classSummaries.reduce((sum, item) => sum + item.counts.sourceFields, 0),
    descriptorFieldRows: classSummaries.reduce((sum, item) => sum + item.counts.descriptorFields, 0),
    eventBindings: classSummaries.reduce((sum, item) => sum + item.counts.eventBindings, 0),
    riskFields: classSummaries.reduce((sum, item) => sum + item.counts.riskFields, 0),
    unknownPrivateFields: classSummaries.reduce((sum, item) => sum + item.counts.unknownPrivateFields, 0),
    estimateTotals: estimate?.totals || null
  };
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(";").replace(/\r?\n/g, " ").replace(/\t/g, " ");
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function buildClassTsv(classes) {
  const header = ["className", "functionName", "categories", "methods", "sourceChars", "fields", "sourceFields", "descriptorFields", "eventBindings", "riskFields", "reverseNames"];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    lines.push([
      cls.className,
      cls.functionName,
      cls.categories,
      cls.counts.methods,
      cls.counts.sourceChars,
      cls.counts.fields,
      cls.counts.sourceFields,
      cls.counts.descriptorFields,
      cls.counts.eventBindings,
      cls.counts.riskFields,
      cls.reverseNames
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildMethodTsv(classes) {
  const header = ["className", "functionName", "method", "sourceKind", "roles", "hash", "length", "constants", "strings", "protocolFields", "eventBindings"];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    for (const method of cls.methodContexts) {
      lines.push([
        method.className,
        method.functionName,
        method.method,
        method.sourceKind,
        method.roles,
        method.hash,
        method.length,
        method.constants,
        method.strings,
        method.protocolFields,
        method.eventBindings.map((event) => `${event.kind}:${event.event}:${event.handler}`)
      ].map(tsvCell).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildFieldTsv(classes) {
  const header = ["className", "functionName", "categories", "field", "confidence", "risk", "meaning", "descriptorKinds", "operations", "methods", "roles", "constants", "strings", "protocolFields", "eventBindings", "snippets"];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    for (const field of cls.fieldRows) {
      lines.push([
        field.className,
        field.functionName,
        field.categories,
        field.name,
        field.confidence,
        String(field.risk),
        field.meaning,
        field.descriptorKinds,
        field.operationsText,
        field.methodNames.slice(0, 40),
        field.roles,
        field.constants,
        field.strings,
        field.protocolFields,
        field.eventBindings,
        field.snippets.slice(0, 4)
      ].map(tsvCell).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildEventTsv(classes) {
  const header = ["className", "functionName", "method", "roles", "kind", "event", "handler"];
  const lines = [header.join("\t")];
  for (const cls of classes) {
    for (const event of cls.eventBindings) {
      lines.push([event.className, cls.functionName, event.method, event.roles, event.kind, event.event, event.handler].map(tsvCell).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime All Source Context Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`);
  lines.push(`- All-names source: ${report.inputs.allNamesReport}`);
  lines.push(`- Captured classes: ${report.summary.capturedClassCount}`);
  lines.push(`- Missing live classes: ${report.summary.missingClassCount}`);
  lines.push(`- Method contexts: ${report.summary.methodContexts}`);
  lines.push(`- Source chars: ${report.summary.sourceChars}`);
  lines.push(`- Field rows: ${report.summary.fieldRows}`);
  lines.push(`- Source field rows: ${report.summary.sourceFieldRows}`);
  lines.push(`- Event bindings: ${report.summary.eventBindings}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- Captures full `Function.toString()` for each registered class constructor, static methods/accessors, and own prototype methods/accessors.");
  lines.push("- Inherited methods are intentionally not expanded by default to avoid repeating the same base/Laya code thousands of times; descriptor hashes in the all-names inventory still identify inherited surfaces.");
  lines.push("- Field rows are source-context evidence, not final semantic proof for every enum or minified private variable.");
  lines.push("");
  lines.push("## Category Counts");
  lines.push("");
  for (const [category, count] of Object.entries(report.summary.categories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("");
  lines.push("## Largest Source Classes");
  lines.push("");
  lines.push("| Class | Function | Categories | Methods | Source Chars | Fields | Events |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const cls of report.classes.slice().sort((a, b) => b.counts.sourceChars - a.counts.sourceChars).slice(0, 40)) {
    lines.push(`| \`${cls.className.replaceAll("|", "\\|")}\` | \`${cls.functionName.replaceAll("|", "\\|")}\` | ${cls.categories.join(",").replaceAll("|", "\\|")} | ${cls.counts.methods} | ${cls.counts.sourceChars} | ${cls.counts.fields} | ${cls.counts.eventBindings} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- `source-chunks/*.json`: full source-bearing class dumps, split by registered class name range.");
  lines.push("- `all-source-index.json`: full class/method/field/event context without method source bodies.");
  lines.push("- `all-source-class-index.tsv`: class-level source/field/event counts.");
  lines.push("- `all-source-method-context.tsv`: method-level roles, constants, strings, protocol fields, event bindings.");
  lines.push("- `all-source-field-context.tsv`: field-level read/write context and inferred meaning.");
  lines.push("- `all-source-event-bindings.tsv`: source-discovered event/window bindings.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function captureChunk(names, depth, options) {
  const expression = buildSourceDumpExpression(names, depth);
  try {
    const result = await evaluateOnSgs(expression, {
      timeoutMs: options.timeoutMs,
      cdpTimeoutMs: options.cdpTimeoutMs,
      returnByValue: true
    });
    return result.value;
  } catch (error) {
    if (names.length <= 1) throw error;
    const mid = Math.ceil(names.length / 2);
    console.error(`chunk failed for ${names.length} classes, splitting: ${error.message}`);
    const left = await captureChunk(names.slice(0, mid), depth, options);
    const right = await captureChunk(names.slice(mid), depth, options);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: left.page || right.page,
      depth,
      requested: names.length,
      classes: [...(left.classes || []), ...(right.classes || [])],
      splitFromFailure: true
    };
  }
}

async function main() {
  const estimateOnly = process.argv.includes("--estimate");
  const allNames = await latestAllNamesReport();
  if (!allNames) throw new Error("No all-names report found.");
  const classNames = allNames.classes.map((row) => row.name).sort();
  const depth = Number(process.env.SGS_ALL_SOURCE_PROTO_DEPTH || 1);
  const chunkSize = Number(process.env.SGS_ALL_SOURCE_CHUNK_SIZE || 80);
  const start = Number(process.env.SGS_ALL_SOURCE_START || 0);
  const limit = Number(process.env.SGS_ALL_SOURCE_LIMIT || 0);
  const selectedNames = classNames.slice(start, limit > 0 ? start + limit : undefined);
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_ALL_SOURCE_CONTEXT_DIR ||
      path.join(explorationRoot, `${timestampName()}-all-source-context`)
  );
  await mkdir(outDir, { recursive: true });
  const estimateResult = await evaluateOnSgs(buildEstimateExpression(depth), { timeoutMs: 90000, cdpTimeoutMs: 120000 });
  await writeFile(path.join(outDir, "source-size-estimate.json"), `${JSON.stringify(estimateResult.value, null, 2)}\n`, "utf8");
  if (estimateOnly) {
    console.log(JSON.stringify({ outDir, allNames: allNames.dir, estimate: estimateResult.value }, null, 2));
    return;
  }

  const chunksDir = path.join(outDir, "source-chunks");
  await mkdir(chunksDir, { recursive: true });
  const roleMap = buildRoleMap(allNames.methodRoleIndex);
  const glossaryMap = buildGlossaryMap(allNames.fieldGlossary);
  const classRowByName = new Map(allNames.classes.map((row) => [row.name, row]));
  const classSummaries = [];
  const missingNames = [];
  let page = estimateResult.value?.page || null;

  for (let offset = 0; offset < selectedNames.length; offset += chunkSize) {
    const batchNames = selectedNames.slice(offset, offset + chunkSize);
    const batchIndex = Math.floor(offset / chunkSize);
    const batch = await captureChunk(batchNames, depth, { timeoutMs: 120000, cdpTimeoutMs: 180000 });
    page = batch.page || page;
    const chunkPath = path.join(chunksDir, `${String(batchIndex).padStart(4, "0")}.json`);
    await writeFile(chunkPath, `${JSON.stringify({ ...batch, classRange: { start: start + offset, count: batchNames.length, names: batchNames } }, null, 2)}\n`, "utf8");
    for (const cls of batch.classes || []) {
      if (!cls.exists) {
        missingNames.push(cls.registeredName);
        continue;
      }
      classSummaries.push(summarizeClass(cls, roleMap, glossaryMap, classRowByName));
    }
    console.error(`source classes ${Math.min(offset + chunkSize, selectedNames.length)}/${selectedNames.length}`);
  }
  classSummaries.sort((a, b) => a.className.localeCompare(b.className));

  const report = {
    generatedAt: new Date().toISOString(),
    page,
    inputs: {
      allNamesReport: allNames.dir,
      allNamesClasses: allNames.classesPath,
      methodRoleIndex: allNames.methodRoleIndexPath,
      fieldGlossary: allNames.fieldGlossaryPath,
      sourceChunks: chunksDir,
      start,
      limit: limit || null,
      depth,
      chunkSize
    },
    summary: buildSummary(classSummaries, estimateResult.value, missingNames),
    missingNames,
    classes: classSummaries
  };

  await writeFile(path.join(outDir, "all-source-index.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "all-source-class-index.tsv"), buildClassTsv(classSummaries), "utf8");
  await writeFile(path.join(outDir, "all-source-method-context.tsv"), buildMethodTsv(classSummaries), "utf8");
  await writeFile(path.join(outDir, "all-source-field-context.tsv"), buildFieldTsv(classSummaries), "utf8");
  await writeFile(path.join(outDir, "all-source-event-bindings.tsv"), buildEventTsv(classSummaries), "utf8");
  await writeFile(path.join(outDir, "all-source-summary.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime All Source Context Report",
    "",
    `- Markdown: ${path.join(outDir, "all-source-summary.md")}`,
    `- JSON index: ${path.join(outDir, "all-source-index.json")}`,
    `- Full source chunks: ${chunksDir}`,
    `- Method TSV: ${path.join(outDir, "all-source-method-context.tsv")}`,
    `- Field TSV: ${path.join(outDir, "all-source-field-context.tsv")}`,
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    allNames: allNames.dir,
    summary: report.summary,
    missingNames: missingNames.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
