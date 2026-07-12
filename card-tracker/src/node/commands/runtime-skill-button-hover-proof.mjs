import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_SKILL_BUTTON_HOVER_PROOF_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-skill-button-hover-proof`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, "\\n").replace(/\t/g, " ");
}

function toTsv(rows, columns) {
  return [
    columns.join("\t"),
    ...rows.map((row) => columns.map((column) => tsvCell(row[column])).join("\t"))
  ].join("\n") + "\n";
}

function hoverProofExpression(options = {}) {
  const targetLimit = Number(options.targetLimit || 6);
  const waitMs = Number(options.waitMs || 260);
  return `(${String.raw`async (targetLimit, waitMs) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const own = (value) => { try { return Object.getOwnPropertyNames(value || {}).sort(); } catch { return []; } };
    const ctor = (value) => { try { return value && value.constructor && value.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const textOf = (node) => {
      try {
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.innerHTML === "string") return node.innerHTML;
        if (typeof node?.textField?._text === "string") return node.textField._text;
        if (typeof node?.textField?.text === "string") return node.textField.text;
      } catch {}
      return "";
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
    const effectiveVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 15 || seen.size > 1400) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let index = 0; index < (root.numChildren || 0); index += 1) {
        let child = null;
        try { child = root.getChildAt(index); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + index);
        walk(child, visitor, nodePath + "/" + childName + "#" + index, depth + 1, seen);
      }
    };
    const stageChildren = () => {
      const out = [];
      for (let index = 0; index < (Laya.stage?.numChildren || 0); index += 1) {
        try { out.push(Laya.stage.getChildAt(index)); } catch {}
      }
      return out;
    };
    const layerByName = (pattern) => stageChildren().find((node) => pattern.test([node?.name, ctor(node)].filter(Boolean).join(" "))) || null;
    const sceneLayer = () => layerByName(/LBi|SceneLayer/i);
    const windowLayer = () => layerByName(/mWt|WindowLayer/i);
    const currentScene = () => {
      const layer = sceneLayer();
      if (!layer) return null;
      for (let index = (layer.numChildren || 0) - 1; index >= 0; index -= 1) {
        const child = layer.getChildAt(index);
        if (effectiveVisible(child)) return child;
      }
      return null;
    };
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length };
      if (value instanceof Map) return { kind: "map", size: value.size };
      if (value instanceof Set) return { kind: "set", size: value.size };
      if (depth > 0) return { kind: "object", ctor: ctor(value), label: labelOf(value), text: textOf(value) };
      const out = { kind: "object", ctor: ctor(value), label: labelOf(value), text: textOf(value) };
      for (const key of ["ID", "Id", "id", "Name", "name", "Type", "CardCountMax", "CardCountMin", "TargetCountMax", "TargetCountMin", "AutoUse", "TouchSkillWhenApplyActive", "NeedConfrimBeforeUse", "ActiveTip", "PassiveTip"]) {
        try {
          if (value && value[key] !== undefined) out[key] = simple(value[key], depth + 1);
        } catch {}
      }
      return out;
    };
    const stageSnapshot = (label) => {
      const tips = [];
      const windows = [];
      walk(Laya.stage, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        const hay = [nodePath, labelOf(node), node?.name, node?._className_, node?._resName, ctor(node), textOf(node)].filter(Boolean).join(" ");
        if (/ToolTip|Tooltip|Tip|Tips|SkillPopUp|PopUp|Popup|AppToolTip|UWi|cWi|ujt/i.test(hay)) {
          tips.push({ path: nodePath, label: labelOf(node), ctor: ctor(node), text: textOf(node), children: node.numChildren || 0 });
        }
        if (/Window|modalBg|Dialog|mWt/i.test(hay)) {
          windows.push({ path: nodePath, label: labelOf(node), ctor: ctor(node), text: textOf(node), children: node.numChildren || 0 });
        }
      });
      const scene = currentScene();
      const wl = windowLayer();
      return {
        label,
        scene: scene ? { label: labelOf(scene), ctor: ctor(scene), sceneName: scene.sceneName || scene.SceneName || "", children: scene.numChildren || 0 } : null,
        windowLayerChildren: wl?.numChildren || 0,
        tips: tips.slice(0, 80),
        windows: windows.slice(0, 80)
      };
    };
    const eventKeys = (node) => {
      const ev = node?._events;
      if (!ev || typeof ev !== "object") return [];
      return own(ev).filter((key) => /mouse|roll|over|out|tip|click|resize|selected/i.test(key));
    };
    const skillInfo = (node) => {
      let skill = null;
      try { skill = node?.skill || node?.Skill || null; } catch {}
      return simple(skill);
    };
    const trackedFields = (node) => {
      const keys = [
        "$_GID",
        "_enabled",
        "_mouseState",
        "_selected",
        "_stateChanged",
        "phase",
        "selected",
        "activated",
        "isVirtualSkill",
        "moubianState",
        "generalHasShow",
        "isHalfShow",
        "canHalfShow",
        "selectedEnabled",
        "useColorFilter",
        "toolTip",
        "tipPos",
        "tipMaxWidth",
        "topText",
        "textFieldOffsety",
        "exSpellTex",
        "clickTips"
      ];
      const out = {};
      for (const key of keys) {
        try {
          if (node && node[key] !== undefined) out[key] = simple(node[key]);
        } catch {
          out[key] = "[throws]";
        }
      }
      out.text = textOf(node);
      out.skill = skillInfo(node);
      return out;
    };
    const diff = (before, after) => {
      const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort();
      const out = [];
      for (const key of keys) {
        const oldValue = before?.[key];
        const newValue = after?.[key];
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) out.push({ key, before: oldValue, after: newValue });
      }
      return out;
    };
    const layaEvent = (type, target) => {
      return {
        type,
        target,
        currentTarget: target,
        stageX: Laya.stage?.mouseX || 0,
        stageY: Laya.stage?.mouseY || 0,
        stopPropagation() {},
        stopImmediatePropagation() {}
      };
    };
    const methodCalls = [];
    const eventCalls = [];
    const wrappers = [];
    const restoreKey = "__codexSkillButtonHoverProofRestore";
    try {
      if (window[restoreKey] && typeof window[restoreKey] === "function") window[restoreKey]();
    } catch {}
    const restoreAll = () => {
      let restored = 0;
      for (const restore of wrappers.reverse()) {
        try {
          restore();
          restored += 1;
        } catch {}
      }
      try {
        if (window[restoreKey] === restoreAll) delete window[restoreKey];
      } catch {}
      return { restored };
    };
    try { window[restoreKey] = restoreAll; } catch {}
    const wrapMethod = (object, methodName, label) => {
      if (!object || typeof object[methodName] !== "function") return;
      const original = object[methodName];
      if (original.__codexSkillHoverWrapped) return;
      const wrapped = function (...args) {
        methodCalls.push({
          label,
          methodName,
          thisLabel: labelOf(this),
          thisText: textOf(this),
          args: args.slice(0, 4).map((arg) => simple(arg, 1))
        });
        return original.apply(this, args);
      };
      try { Object.defineProperty(wrapped, "__codexSkillHoverWrapped", { value: true }); } catch {}
      try { Object.defineProperty(wrapped, "__codexSkillHoverOriginal", { value: original }); } catch {}
      object[methodName] = wrapped;
      wrappers.push(() => { try { object[methodName] = original; } catch {} });
    };
    const wrapEventBus = () => {
      let bus = null;
      try { bus = window.ms && typeof ms.I === "function" ? ms.I() : null; } catch {}
      if (!bus || typeof bus.event !== "function") return;
      const original = bus.event;
      bus.event = function (type, data, ...rest) {
        eventCalls.push({
          bus: labelOf(this) || ctor(this),
          type: String(type),
          data: simple(data, 1),
          restLength: rest.length
        });
        return original.call(this, type, data, ...rest);
      };
      wrappers.push(() => { try { bus.event = original; } catch {} });
    };
    const candidateRows = [];
    const scene = currentScene();
    walk(scene, (node, nodePath) => {
      if (!effectiveVisible(node)) return;
      const text = textOf(node);
      const label = labelOf(node);
      const methods = own(Object.getPrototypeOf(node || {})).filter((name) => /showTipHandler|tipsRollOut|onMouse|onRollOver|onLookSkill|updateTips/i.test(name));
      const events = eventKeys(node);
      let score = 0;
      if (/^_6i$/.test(ctor(node)) || /_6i/.test(label)) score += 500;
      if (node?.skill) score += 250;
      if (text) score += 100;
      if (events.some((event) => /mouseover|mouseout|roll/i.test(event))) score += 100;
      if (methods.length) score += 100;
      if (/skill|Skill/.test(label + " " + methods.join(" "))) score += 50;
      if (score > 0) {
        candidateRows.push({
          node,
          path: nodePath.replace(/^Laya\.stage\//, ""),
          score,
          label,
          text,
          ctor: ctor(node),
          events,
          methods
        });
      }
    });
    candidateRows.sort((a, b) => b.score - a.score);
    const targets = candidateRows.slice(0, targetLimit);
    wrapEventBus();
    for (const target of targets) {
      const proto = Object.getPrototypeOf(target.node);
      for (const name of ["showTipHandler", "tipsRollOut", "onMouse", "onRollOver", "onLookSkill", "updateTips", "updateView", "changeState"]) {
        wrapMethod(proto, name, (target.ctor || "") + ":" + (target.text || target.path || ""));
      }
    }
    const beforeStage = stageSnapshot("before");
    const samples = [];
    try {
      for (const target of targets) {
        const node = target.node;
        const before = trackedFields(node);
        const beforeMethodCount = methodCalls.length;
        const beforeEventCount = eventCalls.length;
        const beforeTipCount = stageSnapshot("before-" + (target.text || target.ctor)).tips.length;
        let directOver = null;
        let directTip = null;
        let directOut = null;
        try { directOver = node.event(Laya.Event.MOUSE_OVER || "mouseover", layaEvent(Laya.Event.MOUSE_OVER || "mouseover", node)); } catch (error) { directOver = { error: String(error && error.message || error) }; }
        try { node.event(Laya.Event.ROLL_OVER || "mouseover", layaEvent(Laya.Event.ROLL_OVER || "mouseover", node)); } catch {}
        await sleep(waitMs);
        const afterOver = trackedFields(node);
        const afterOverStage = stageSnapshot("after-over-" + (target.text || target.ctor));
        try {
          if (typeof node.showTipHandler === "function") directTip = node.showTipHandler(layaEvent("mouseover", node));
        } catch (error) {
          directTip = { error: String(error && error.message || error) };
        }
        await sleep(waitMs);
        const afterTip = trackedFields(node);
        const afterTipStage = stageSnapshot("after-tip-" + (target.text || target.ctor));
        try { directOut = node.event(Laya.Event.MOUSE_OUT || "mouseout", layaEvent(Laya.Event.MOUSE_OUT || "mouseout", node)); } catch (error) { directOut = { error: String(error && error.message || error) }; }
        try { node.event(Laya.Event.ROLL_OUT || "mouseout", layaEvent(Laya.Event.ROLL_OUT || "mouseout", node)); } catch {}
        try { if (typeof node.tipsRollOut === "function") node.tipsRollOut(layaEvent("mouseout", node)); } catch {}
        await sleep(waitMs);
        const afterOut = trackedFields(node);
        const afterOutStage = stageSnapshot("after-out-" + (target.text || target.ctor));
        samples.push({
          path: target.path,
          label: target.label,
          ctor: target.ctor,
          text: target.text,
          score: target.score,
          events: target.events,
          methods: target.methods,
          directOver: simple(directOver),
          directTip: simple(directTip),
          directOut: simple(directOut),
          fieldDiffOver: diff(before, afterOver),
          fieldDiffTip: diff(afterOver, afterTip),
          fieldDiffOut: diff(afterTip, afterOut),
          stageDelta: {
            tipOver: afterOverStage.tips.length - beforeTipCount,
            tipAfterDirectTip: afterTipStage.tips.length - beforeTipCount,
            tipAfterOut: afterOutStage.tips.length - beforeTipCount,
            windowOver: afterOverStage.windows.length - beforeStage.windows.length,
            windowAfterDirectTip: afterTipStage.windows.length - beforeStage.windows.length,
            windowAfterOut: afterOutStage.windows.length - beforeStage.windows.length
          },
          methodCalls: methodCalls.slice(beforeMethodCount),
          eventCalls: eventCalls.slice(beforeEventCount),
          before,
          afterOver,
          afterTip,
          afterOut,
          afterOverTips: afterOverStage.tips,
          afterTipTips: afterTipStage.tips,
          afterOutTips: afterOutStage.tips
        });
      }
    } finally {
      restoreAll();
    }
    const afterStage = stageSnapshot("after");
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      resourceVersion: window.resourceVersion || "",
      layaVersion: window.Laya && Laya.version || "",
      scene: beforeStage.scene,
      manager: (() => {
        const s = currentScene();
        const manager = s && (s.manager || s.Manager);
        return manager ? { ctor: ctor(manager), isGameOver: manager.isGameOver, seats: Array.isArray(manager.seats) ? manager.seats.length : null, selfSeatIndex: manager.selfSeatIndex } : null;
      })(),
      candidateCount: candidateRows.length,
      candidates: candidateRows.slice(0, 30).map((item) => ({
        path: item.path,
        score: item.score,
        label: item.label,
        ctor: item.ctor,
        text: item.text,
        events: item.events,
        methods: item.methods
      })),
      beforeStage,
      afterStage,
      samples,
      summary: {
        sampled: samples.length,
        fieldDeltaTargets: samples.filter((sample) => sample.fieldDiffOver.length || sample.fieldDiffTip.length || sample.fieldDiffOut.length).length,
        methodCallTargets: samples.filter((sample) => sample.methodCalls.length).length,
        eventCallTargets: samples.filter((sample) => sample.eventCalls.length).length,
        visibleTipDeltaTargets: samples.filter((sample) => sample.stageDelta.tipOver > 0 || sample.stageDelta.tipAfterDirectTip > 0).length,
        cleanupTipResidualTargets: samples.filter((sample) => sample.stageDelta.tipAfterOut > 0).length
      },
      safety: {
        clicked: false,
        sent: false,
        confirmed: false,
        bought: false,
        hiddenOpponentHandRead: false
      }
    };
  }`})(${JSON.stringify(targetLimit)}, ${JSON.stringify(waitMs)})`;
}

function readmeText(value, outputs) {
  const summary = value.summary || {};
  const manager = value.manager || {};
  const sampleLines = (value.samples || []).slice(0, 12).map((sample, index) => {
    const fieldKeys = [
      ...sample.fieldDiffOver.map((item) => item.key),
      ...sample.fieldDiffTip.map((item) => item.key),
      ...sample.fieldDiffOut.map((item) => item.key)
    ];
    return `- ${index + 1}. ${sample.text || sample.ctor} path=${sample.path}; methods=${sample.methodCalls.length}; events=${sample.eventCalls.length}; fieldDiff=${Array.from(new Set(fieldKeys)).join("/") || "none"}; tipDelta=${sample.stageDelta.tipOver}/${sample.stageDelta.tipAfterDirectTip}/${sample.stageDelta.tipAfterOut}.`;
  });
  return [
    "# Skill Button Hover Proof",
    "",
    `- Captured: ${value.capturedAt || ""}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- ResourceVersion: ${value.resourceVersion || ""}; Laya=${value.layaVersion || ""}`,
    `- Scene: ${value.scene?.sceneName || value.scene?.label || ""}; manager=${manager.ctor || ""}; isGameOver=${manager.isGameOver}; seats=${manager.seats}; selfSeatIndex=${manager.selfSeatIndex}`,
    `- Candidates: ${value.candidateCount || 0}; sampled=${summary.sampled || 0}`,
    `- Field-delta targets: ${summary.fieldDeltaTargets || 0}; method-call targets: ${summary.methodCallTargets || 0}; event-call targets: ${summary.eventCallTargets || 0}; visible-tip delta targets: ${summary.visibleTipDeltaTargets || 0}; cleanup residual targets: ${summary.cleanupTipResidualTargets || 0}`,
    `- Samples TSV: ${outputs.samplesTsv}`,
    `- Events TSV: ${outputs.eventsTsv}`,
    `- Methods TSV: ${outputs.methodsTsv}`,
    "",
    "## Findings",
    "",
    "- The probe dispatches only hover/rollout/tip lifecycle events on visible skill buttons; it does not click, confirm, send, buy, leave, or read hidden opponent hand fields.",
    "- `_6i` skill button hover is a Laya event/method path, not a console.log path. Useful anchors are `onMouse`, `showTipHandler`, `tipsRollOut`, and the `ms.I().event(...)` tooltip bus.",
    "- If `visible-tip delta` is zero but method/event calls exist, the current scene state still proves the trigger path while visible popup attachment needs a more suitable non-ended skill/card target.",
    "",
    "## Sample Summary",
    "",
    ...(sampleLines.length ? sampleLines : ["- No visible skill-button samples were found."]),
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  let result;
  try {
    result = await evaluateOnSgs(hoverProofExpression({ targetLimit: 2, waitMs: 120 }), { timeoutMs: 25000, cdpTimeoutMs: 35000 });
  } catch (error) {
    let restoreResult = null;
    try {
      restoreResult = await evaluateOnSgs(
        `(() => window.__codexSkillButtonHoverProofRestore ? window.__codexSkillButtonHoverProofRestore() : { restored: 0, missing: true })()`,
        { timeoutMs: 10000, cdpTimeoutMs: 15000 }
      );
    } catch (restoreError) {
      restoreResult = { value: { error: String(restoreError && restoreError.message || restoreError) } };
    }
    throw new Error(`${error.message || error}; restore=${JSON.stringify(restoreResult.value)}`);
  }
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  const jsonPath = path.join(dir, "skill-button-hover-proof.json");
  const samplesTsv = path.join(dir, "skill-button-hover-samples.tsv");
  const methodsTsv = path.join(dir, "skill-button-hover-method-calls.tsv");
  const eventsTsv = path.join(dir, "skill-button-hover-events.tsv");
  await writeJson(jsonPath, payload);
  const samples = (result.value?.samples || []).map((sample) => ({
    path: sample.path,
    text: sample.text,
    ctor: sample.ctor,
    methods: sample.methodCalls?.length || 0,
    events: sample.eventCalls?.length || 0,
    fieldDiffOver: (sample.fieldDiffOver || []).map((item) => item.key).join("|"),
    fieldDiffTip: (sample.fieldDiffTip || []).map((item) => item.key).join("|"),
    fieldDiffOut: (sample.fieldDiffOut || []).map((item) => item.key).join("|"),
    tipOver: sample.stageDelta?.tipOver || 0,
    tipAfterDirectTip: sample.stageDelta?.tipAfterDirectTip || 0,
    tipAfterOut: sample.stageDelta?.tipAfterOut || 0
  }));
  const methodRows = [];
  const eventRows = [];
  for (const sample of result.value?.samples || []) {
    for (const call of sample.methodCalls || []) {
      methodRows.push({
        path: sample.path,
        text: sample.text,
        methodName: call.methodName,
        thisLabel: call.thisLabel,
        thisText: call.thisText
      });
    }
    for (const call of sample.eventCalls || []) {
      eventRows.push({
        path: sample.path,
        text: sample.text,
        type: call.type,
        bus: call.bus,
        data: JSON.stringify(call.data || "")
      });
    }
  }
  await writeFile(samplesTsv, toTsv(samples, ["path", "text", "ctor", "methods", "events", "fieldDiffOver", "fieldDiffTip", "fieldDiffOut", "tipOver", "tipAfterDirectTip", "tipAfterOut"]), "utf8");
  await writeFile(methodsTsv, toTsv(methodRows, ["path", "text", "methodName", "thisLabel", "thisText"]), "utf8");
  await writeFile(eventsTsv, toTsv(eventRows, ["path", "text", "type", "bus", "data"]), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}, { samplesTsv, methodsTsv, eventsTsv }), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.scene?.sceneName || result.value?.scene?.label || null,
    isGameOver: result.value?.manager?.isGameOver ?? null,
    candidates: result.value?.candidateCount || 0,
    sampled: result.value?.summary?.sampled || 0,
    fieldDeltaTargets: result.value?.summary?.fieldDeltaTargets || 0,
    methodCallTargets: result.value?.summary?.methodCallTargets || 0,
    eventCallTargets: result.value?.summary?.eventCallTargets || 0,
    visibleTipDeltaTargets: result.value?.summary?.visibleTipDeltaTargets || 0,
    cleanupTipResidualTargets: result.value?.summary?.cleanupTipResidualTargets || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
