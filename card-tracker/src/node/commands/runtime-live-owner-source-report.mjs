import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

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
    process.env.SGS_LIVE_OWNER_SOURCE_REPORT_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-owner-source-report`)
  );
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function ownerPriority(owner) {
  let score = Number(owner.priority || 0);
  const surfaces = owner.surfaceCounts || {};
  for (const key of ["skill-trigger", "card-selection-movement", "auto-play-select-discard", "button-ui-click", "battle-lifecycle"]) {
    score += Number(surfaces[key] || 0) * 8;
  }
  if (/NBi|uBt|pBt|fHt|_6i|manager|selfSeat|currentScene|RogueLikeGameScene/.test(owner.ownerPath || owner.ownerLabel || "")) score += 200;
  return score;
}

function buildTargetSpecs(gapReport, limit = 45) {
  const owners = [...(gapReport.ownerSummary || [])]
    .sort((a, b) => ownerPriority(b) - ownerPriority(a))
    .slice(0, limit)
    .map((owner) => ({
      ownerPath: owner.ownerPath,
      ownerLabel: owner.ownerLabel,
      groups: owner.groups || [],
      registeredNames: owner.registeredNames || [],
      totalWeakRows: owner.totalWeakRows || 0,
      priority: owner.priority || 0,
      riskCounts: owner.riskCounts || {},
      categoryCounts: owner.categoryCounts || {},
      surfaceCounts: owner.surfaceCounts || {},
      fields: unique([
        ...(owner.topFields || []).map((field) => field.field),
        ...(owner.fields || []).slice(0, 40).map((field) => field.field)
      ]).slice(0, 80)
    }));

  for (const extra of [
    { ownerPath: "currentScene", ownerLabel: "currentScene" },
    { ownerPath: "manager", ownerLabel: "manager" },
    { ownerPath: "selfSeat", ownerLabel: "selfSeat" },
    { ownerPath: "seats[0]", ownerLabel: "seat0" }
  ]) {
    if (!owners.some((owner) => owner.ownerPath === extra.ownerPath)) {
      owners.push({ ...extra, groups: ["manual"], fields: [], totalWeakRows: 0, priority: 0, riskCounts: {}, categoryCounts: {}, surfaceCounts: {} });
    }
  }
  return owners;
}

function inspectExpression(targetSpecs) {
  return `(() => {
    const targetSpecs = ${JSON.stringify(targetSpecs)};
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const fnv1a = (text) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const pathLabelOf = (node) => node && (node.name || node._className_ || node.sceneName || node.SceneName || ctor(node)) || "";
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const hiddenFieldPattern = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
    const forbiddenHiddenKey = (key, allowSelfHand) => {
      const text = String(key || "");
      if (allowSelfHand && /^handCards$/i.test(text)) return false;
      return hiddenFieldPattern.test(text);
    };
    const valueKind = (value) => {
      if (value == null) return String(value);
      if (Array.isArray(value)) return "array";
      if (value instanceof Map) return "map";
      if (value instanceof Set) return "set";
      return typeof value === "object" ? (ctor(value) || "object") : typeof value;
    };
    const primitiveSummary = (value, depth = 0) => {
      const kind = valueKind(value);
      if (value == null || kind === "string" || kind === "number" || kind === "boolean") return value;
      if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      if (depth > 0) return "[" + kind + "]";
      const keys = own(value).filter((key) => !forbiddenHiddenKey(key, false)).slice(0, 10);
      const parts = [];
      for (const key of keys) {
        try {
          const child = value[key];
          if (child == null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
            parts.push(key + "=" + String(child));
          } else if (typeof child === "function") {
            parts.push(key + "=[Function " + (child.name || "anonymous") + "]");
          } else if (Array.isArray(child)) {
            parts.push(key + "=[Array " + child.length + "]");
          } else {
            parts.push(key + "=[" + valueKind(child) + "]");
          }
        } catch {
          parts.push(key + "=[throws]");
        }
      }
      return "[" + kind + (parts.length ? " " + parts.join(", ") : "") + "]";
    };
    const nodeBase = (node, nodePath) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node?.name || "",
      className: node?._className_ || "",
      sceneName: node?.sceneName || node?.SceneName || "",
      uiid: node?._uiid || "",
      resName: node?._resName || "",
      visible: node?.visible,
      alpha: node?.alpha,
      effectiveVisible: isVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node?.x,
      y: node?.y,
      width: node?.width,
      height: node?.height,
      mouseEnabled: node?.mouseEnabled,
      mouseThrough: node?.mouseThrough,
      mouseState: node?._mouseState,
      childCount: node?.numChildren || 0,
      text: typeof node?.text === "string" ? node.text.slice(0, 180) : ""
    });
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 18, seen = new Set()) => {
      if (!root || seen.has(root) || depth > maxDepth) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = pathLabelOf(child) || ("#" + i);
        walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth, seen);
      }
    };
    const pathMap = new Map();
    const labelMap = new Map();
    walk(Laya.stage, (node, nodePath) => {
      pathMap.set(nodePath, node);
      const label = labelOf(node) || ctor(node);
      if (!labelMap.has(label)) labelMap.set(label, []);
      labelMap.get(label).push({ node, nodePath });
      const shortLabel = ctor(node);
      if (shortLabel) {
        if (!labelMap.has(shortLabel)) labelMap.set(shortLabel, []);
        labelMap.get(shortLabel).push({ node, nodePath });
      }
    });
    const currentScene = () => {
      let layer = null;
      walk(Laya.stage, (node) => {
        if (!layer && /LBi|SceneLayer/.test(labelOf(node))) layer = node;
      }, "Laya.stage", 0, 1);
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = layer.getChildAt(i);
        if (isVisible(candidate)) return candidate;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const scene = currentScene();
    const manager = scene && (scene.manager || scene.gameManager || scene._manager || scene._gameManager || null);
    const seats = Array.isArray(manager?.seats) ? manager.seats : [];
    const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
    const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
    const classMap = Laya?.ClassUtils?._classMap || {};
    const fnToNames = new Map();
    const nameToNamesByCtor = {};
    for (const [registeredName, fn] of Object.entries(classMap)) {
      if (typeof fn !== "function") continue;
      if (!fnToNames.has(fn)) fnToNames.set(fn, []);
      fnToNames.get(fn).push(registeredName);
      const name = fn.name || "";
      if (name) {
        if (!nameToNamesByCtor[name]) nameToNamesByCtor[name] = [];
        nameToNamesByCtor[name].push(registeredName);
      }
    }
    for (const names of fnToNames.values()) names.sort();
    for (const names of Object.values(nameToNamesByCtor)) names.sort();
    const registeredNamesFor = (obj) => ({
      byIdentity: fnToNames.get(obj && obj.constructor) || [],
      byConstructorName: nameToNamesByCtor[ctor(obj)] || []
    });
    const methodRole = (name) => {
      const roles = [];
      const add = (role) => { if (!roles.includes(role)) roles.push(role); };
      if (/click|Click|touch|Touch|confirm|Confirm|cancel|Cancel|ensure|Ensure/.test(name)) add("button-click");
      if (/card|Card|hand|Hand|discard|Discard|move|Move|zone|Zone|pile|Pile/.test(name)) add("card-ui-move");
      if (/skill|Skill|spell|Spell|responser|Responser|trigger|Trigger/.test(name)) add("skill-trigger");
      if (/select|Select|auto|Auto|choose|Choose|opt|Opt|ask|Ask/.test(name)) add("selection-auto");
      if (/show|Show|hide|Hide|window|Window|close|Close|open|Open|enter|Enter/.test(name)) add("window-scene");
      if (/effect|Effect|anim|Anim|motion|Motion|tween|Tween/.test(name)) add("effect");
      if (/send|Send|Req|Rep|Ntf|proxy|Proxy|Msg|msg/.test(name)) add("protocol-send");
      if (/buy|Buy|pay|Pay|shop|Shop|money|Money|yuanbao|YuanBao|refresh|Refresh/.test(name)) add("purchase-risk");
      return roles;
    };
    const methodDescriptors = (obj, focusFields, suppressHiddenSeatSource = false) => {
      const rows = [];
      const seen = new Set();
      let proto = obj;
      let depth = -1;
      while (proto && proto !== Object.prototype && depth < 4) {
        if (depth >= 0) {
          for (const key of own(proto)) {
            if (seen.has(key) || key === "constructor") continue;
            seen.add(key);
            let fn = null;
            try { fn = proto[key]; } catch {}
            if (typeof fn !== "function") continue;
            let source = "";
            try { source = Function.prototype.toString.call(fn); } catch {}
            if (suppressHiddenSeatSource && hiddenFieldPattern.test(key + " " + source)) continue;
            const referencedFields = focusFields.filter((field) => field && source.includes(field)).slice(0, 20);
            const interesting = referencedFields.length || methodRole(key).length || /(click|Click|touch|Touch|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|drag|Drag|drop|Drop|tip|Tip|show|Show|hide|Hide|enable|Enable|gray|Gray|effect|Effect|window|Window|close|Close|open|Open|send|Send|handler|Handler|game|Game|round|Round|turn|Turn|phase|Phase)/.test(key);
            if (!interesting) continue;
            rows.push({
              ownerCtor: ctor(proto.constructor && proto.constructor.prototype ? proto.constructor.prototype : obj),
              depth,
              name: key,
              arity: fn.length,
              sourceLength: source.length,
              sourceHash: source ? fnv1a(source) : "",
              roles: methodRole(key),
              referencedFields,
              source: source.replace(/\\s+/g, " ").slice(0, 700)
            });
          }
        }
        proto = depth < 0 ? Object.getPrototypeOf(obj || {}) : Object.getPrototypeOf(proto);
        depth += 1;
      }
      return rows.sort((a, b) => b.referencedFields.length - a.referencedFields.length || b.roles.length - a.roles.length || a.name.localeCompare(b.name)).slice(0, 120);
    };
    const eventSummary = (node, focusFields, suppressHiddenSeatSource = false) => {
      const out = [];
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 80)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          for (const handler of handlers.filter(Boolean).slice(0, 16)) {
            const source = handler.method ? Function.prototype.toString.call(handler.method) : "";
            if (suppressHiddenSeatSource && hiddenFieldPattern.test(source)) continue;
            out.push({
              event: key,
              caller: handler.caller ? labelOf(handler.caller) : "",
              callerCtor: ctor(handler.caller),
              methodName: handler.method && (handler.method.name || ""),
              once: handler.once === true,
              referencedFields: focusFields.filter((field) => field && source.includes(field)).slice(0, 20),
              source: source.replace(/\\s+/g, " ").slice(0, 700)
            });
          }
        } catch (error) {
          out.push({ event: key, error: String(error && error.message || error) });
        }
      }
      return out;
    };
    const readFields = (obj, fields, allowSelfHand = false) => {
      const rows = [];
      const fieldSet = new Set(fields || []);
      for (const key of own(obj).slice(0, 1600)) {
        if (forbiddenHiddenKey(key, allowSelfHand)) continue;
        if (fieldSet.size && !fieldSet.has(key)) continue;
        try {
          const value = obj[key];
          rows.push({
            field: key,
            kind: valueKind(value),
            value: primitiveSummary(value),
            isFunction: typeof value === "function",
            arrayLength: Array.isArray(value) ? value.length : null,
            objectCtor: value && typeof value === "object" ? ctor(value) : "",
            objectRegisteredNames: value && typeof value === "object" ? registeredNamesFor(value) : null
          });
        } catch (error) {
          rows.push({ field: key, kind: "throws", value: String(error && error.message || error) });
        }
      }
      return rows;
    };
    const resolveTarget = (spec) => {
      if (spec.ownerPath === "currentScene") return { obj: scene, resolvedPath: "currentScene", match: "special-currentScene" };
      if (spec.ownerPath === "manager") return { obj: manager, resolvedPath: "manager", match: "special-manager" };
      if (spec.ownerPath === "selfSeat") return { obj: selfSeat, resolvedPath: "selfSeat", match: "special-selfSeat" };
      const seatMatch = /^seats\\[(\\d+)\\]$/.exec(spec.ownerPath || "");
      if (seatMatch) {
        const index = Number(seatMatch[1]);
        return { obj: seats[index], resolvedPath: "seats[" + index + "]", match: "special-seat" };
      }
      if (pathMap.has(spec.ownerPath)) return { obj: pathMap.get(spec.ownerPath), resolvedPath: spec.ownerPath, match: "exact-path" };
      const candidates = [];
      for (const [label, nodes] of labelMap.entries()) {
        if (!spec.ownerLabel) continue;
        if (label === spec.ownerLabel || label.includes(spec.ownerLabel)) candidates.push(...nodes);
      }
      const visible = candidates.find((item) => isVisible(item.node)) || candidates[0];
      return visible ? { obj: visible.node, resolvedPath: visible.nodePath, match: "label-fallback" } : { obj: null, resolvedPath: "", match: "missing" };
    };
    const seatIndexOf = (ownerPath) => {
      const match = /^seats\\[(\\d+)\\]$/.exec(ownerPath || "");
      return match ? Number(match[1]) : null;
    };
    const inspectTarget = (spec) => {
      const resolved = resolveTarget(spec);
      const obj = resolved.obj;
      if (!obj) return { spec, resolvedPath: resolved.resolvedPath, match: resolved.match, missing: true };
      const seatIndex = seatIndexOf(spec.ownerPath);
      const allowSelfHand = spec.ownerPath === "selfSeat" || (seatIndex != null && seatIndex === selfSeatIndex);
      const suppressHiddenSeatSource = seatIndex != null && !allowSelfHand;
      const focusFields = Array.from(new Set(spec.fields || [])).filter((field) => !forbiddenHiddenKey(field, allowSelfHand));
      const allOwnFields = own(obj).filter((field) => !forbiddenHiddenKey(field, allowSelfHand));
      const sampledFields = focusFields.length ? focusFields : allOwnFields.slice(0, 80);
      return {
        spec,
        resolvedPath: resolved.resolvedPath,
        match: resolved.match,
        missing: false,
        base: nodeBase(obj, resolved.resolvedPath),
        registeredNames: registeredNamesFor(obj),
        allOwnFieldCount: allOwnFields.length,
        allOwnFieldNames: allOwnFields.slice(0, 180),
        sampledFields,
        fields: readFields(obj, sampledFields, allowSelfHand),
        methods: methodDescriptors(obj, sampledFields, suppressHiddenSeatSource),
        events: eventSummary(obj, sampledFields, suppressHiddenSeatSource)
      };
    };
    const targets = targetSpecs.map(inspectTarget);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        layaVersion: Laya && (Laya.version || Laya.Laya && Laya.Laya.version) || "",
        classMapSize: Object.keys(classMap).length,
        scene: scene ? nodeBase(scene, "currentScene") : null,
        manager: manager ? { ctor: ctor(manager), seatCount: seats.length, selfSeatIndex } : null
      },
      targetCount: targets.length,
      targets,
      notes: [
        "Read-only owner/source inspection for current top live-field-gap owners.",
        "Hidden opponent hand arrays and watch-card residue are filtered; selfSeat handCards is allowed only through manager.selfSeatIndex.",
        "Use match=exact-path as current object proof; label-fallback is weaker and should be re-sampled before active automation."
      ]
    };
  })()`;
}

function buildMarkdown(report, outDir) {
  const lines = [];
  lines.push("# Live Owner Source Report");
  lines.push("");
  lines.push(`- Generated: ${report.capturedAt}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`.trim());
  lines.push(`- ResourceVersion: ${report.runtime?.resourceVersion || ""}`);
  lines.push(`- Laya: ${report.runtime?.layaVersion || ""}`);
  lines.push(`- Scene: ${report.runtime?.scene?.label || ""}`);
  lines.push(`- Targets: ${report.targetCount || 0}`);
  lines.push("");
  lines.push("## Match Counts");
  lines.push("");
  const matchCounts = {};
  for (const target of report.targets || []) matchCounts[target.match || "unknown"] = (matchCounts[target.match || "unknown"] || 0) + 1;
  for (const [match, count] of Object.entries(matchCounts).sort()) lines.push(`- ${match}: ${count}`);
  lines.push("");
  lines.push("## Top Targets");
  lines.push("");
  lines.push("| Match | Weak rows | Owner | Resolved | Registered | Fields | Methods referencing fields | Events |");
  lines.push("| --- | ---: | --- | --- | --- | ---: | ---: | ---: |");
  for (const target of (report.targets || []).slice(0, 35)) {
    const spec = target.spec || {};
    const registered = unique([...(target.registeredNames?.byIdentity || []), ...(target.registeredNames?.byConstructorName || [])]).slice(0, 8);
    const fieldRefs = (target.methods || []).filter((method) => method.referencedFields?.length).length;
    lines.push(`| ${target.match || ""} | ${spec.totalWeakRows || 0} | \`${spec.ownerPath || ""}\`/${spec.ownerLabel || ""} | \`${target.resolvedPath || ""}\` | ${registered.map((name) => `\`${name}\``).join(", ") || "(none)"} | ${(target.fields || []).length} | ${fieldRefs} | ${(target.events || []).length} |`);
  }
  lines.push("");
  lines.push("## High-Signal Field References");
  lines.push("");
  for (const target of (report.targets || []).filter((item) => (item.methods || []).some((method) => method.referencedFields?.length)).slice(0, 18)) {
    const spec = target.spec || {};
    lines.push(`### ${spec.ownerPath || target.resolvedPath}`);
    lines.push("");
    lines.push(`- label: ${target.base?.label || spec.ownerLabel || ""}`);
    lines.push(`- match: ${target.match}; resolved: ${target.resolvedPath}`);
    lines.push(`- registered: ${unique([...(target.registeredNames?.byIdentity || []), ...(target.registeredNames?.byConstructorName || [])]).join(", ") || "(none)"}`);
    lines.push("");
    lines.push("| Method | Roles | Referenced fields | Hash | Source snippet |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const method of (target.methods || []).filter((item) => item.referencedFields?.length).slice(0, 12)) {
      lines.push(`| \`${method.name}\` | ${method.roles.join(", ") || ""} | ${method.referencedFields.map((field) => `\`${field}\``).join(", ")} | \`${method.sourceHash}\` | \`${String(method.source || "").replaceAll("|", "\\|")}\` |`);
    }
    lines.push("");
  }
  lines.push("## Files");
  lines.push("");
  lines.push(`- ${path.join(outDir, "live-owner-source-report.json")}`);
  lines.push(`- ${path.join(outDir, "live-owner-targets.tsv")}`);
  lines.push(`- ${path.join(outDir, "live-owner-field-method-refs.tsv")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const gapDir = process.env.SGS_LIVE_FIELD_GAP_REPORT_DIR ||
    await latestDir("-live-field-gap-report", "live-field-gap-report.json");
  if (!gapDir) throw new Error("No live-field-gap-report directory found.");
  const gapPath = path.join(gapDir, "live-field-gap-report.json");
  const gapReport = await readJson(gapPath);
  const targetSpecs = buildTargetSpecs(gapReport, Number.parseInt(process.env.SGS_LIVE_OWNER_TARGET_LIMIT || "45", 10));

  const { value } = await evaluateOnSgs(inspectExpression(targetSpecs), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const report = {
    ...value,
    sourceGapDir: gapDir,
    sourceGapPath: gapPath,
    targetSpecs
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "live-owner-source-report.json"), report);

  const targetHeader = [
    "match",
    "missing",
    "ownerPath",
    "ownerLabel",
    "resolvedPath",
    "weakRows",
    "ctor",
    "label",
    "registeredByIdentity",
    "registeredByConstructorName",
    "fieldCount",
    "methodCount",
    "fieldRefMethodCount",
    "eventCount",
    "sampledFields"
  ];
  const targetLines = [targetHeader.join("\t")];
  for (const target of report.targets || []) {
    targetLines.push([
      target.match || "",
      target.missing ? "true" : "false",
      target.spec?.ownerPath || "",
      target.spec?.ownerLabel || "",
      target.resolvedPath || "",
      target.spec?.totalWeakRows || 0,
      target.base?.ctor || "",
      target.base?.label || "",
      tsvEscape(target.registeredNames?.byIdentity || []),
      tsvEscape(target.registeredNames?.byConstructorName || []),
      target.fields?.length || 0,
      target.methods?.length || 0,
      (target.methods || []).filter((method) => method.referencedFields?.length).length,
      target.events?.length || 0,
      tsvEscape(target.sampledFields || [])
    ].join("\t"));
  }
  await writeFile(path.join(outDir, "live-owner-targets.tsv"), `${targetLines.join("\n")}\n`, "utf8");

  const refsHeader = ["ownerPath", "resolvedPath", "ownerLabel", "method", "roles", "referencedFields", "hash", "source"];
  const refsLines = [refsHeader.join("\t")];
  for (const target of report.targets || []) {
    for (const method of target.methods || []) {
      if (!method.referencedFields?.length) continue;
      refsLines.push([
        target.spec?.ownerPath || "",
        target.resolvedPath || "",
        target.spec?.ownerLabel || "",
        method.name,
        tsvEscape(method.roles || []),
        tsvEscape(method.referencedFields || []),
        method.sourceHash || "",
        tsvEscape(method.source || "")
      ].join("\t"));
    }
  }
  await writeFile(path.join(outDir, "live-owner-field-method-refs.tsv"), `${refsLines.join("\n")}\n`, "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(report, outDir), "utf8");

  const matchCounts = {};
  for (const target of report.targets || []) matchCounts[target.match || "unknown"] = (matchCounts[target.match || "unknown"] || 0) + 1;
  console.log(JSON.stringify({
    outDir,
    sourceGapDir: gapDir,
    targetCount: report.targetCount,
    scene: report.runtime?.scene?.label || "",
    matchCounts,
    targetsWithFieldRefs: (report.targets || []).filter((target) => (target.methods || []).some((method) => method.referencedFields?.length)).length,
    refs: (report.targets || []).reduce((sum, target) => sum + (target.methods || []).filter((method) => method.referencedFields?.length).length, 0)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
