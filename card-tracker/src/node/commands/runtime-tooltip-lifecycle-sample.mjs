import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-hover-popup-sample.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_TOOLTIP_LIFECYCLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-tooltip-lifecycle-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function lifecycleExpression() {
  return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const own = (obj) => { try { return Object.getOwnPropertyNames(obj || {}).sort(); } catch { return []; } };
    const ctor = (obj) => { try { return obj && obj.constructor && obj.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
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
    const simple = (value) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + (ctor(value) || type) + "]";
    };
    const fields = (node) => {
      const out = {};
      for (const key of own(node).slice(0, 500)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (!/(ToolTip|toolTip|Tip|tip|skill|Skill|card|Card|general|General|text|Text|name|Name|data|Data|id|ID|state|State|visible|Visible|close|Close)/.test(key)) continue;
        try { out[key] = simple(node[key]); } catch { out[key] = "[throws]"; }
      }
      return out;
    };
    const events = (node) => {
      const out = {};
      const ev = node && node._events;
      if (!ev || typeof ev !== "object") return out;
      for (const key of own(ev).slice(0, 60)) {
        if (!/mouse|click|roll|over|out|tip|resize|removed/i.test(key)) continue;
        try {
          const handlers = Array.isArray(ev[key]) ? ev[key] : [ev[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            caller: handler.caller ? labelOf(handler.caller) || ctor(handler.caller) : "",
            method: handler.method ? (handler.method.name || String(handler.method).slice(0, 160)) : "",
            args: Array.isArray(handler.args) ? handler.args.map(simple).slice(0, 8) : simple(handler.args),
            once: handler.once
          })).slice(0, 12);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const nodeSummary = (node, nodePath = "") => ({
      gid: node && node.$_GID,
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      uiid: node && node._uiid || "",
      resName: node && node._resName || "",
      visible: node && node.visible,
      alpha: node && node.alpha,
      effectiveVisible: effectiveVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node && node.x,
      y: node && node.y,
      width: node && node.width,
      height: node && node.height,
      text: node && (node.text || node._text || node.innerHTML || node._innerHTML || "") || "",
      fields: fields(node),
      events: events(node)
    });
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 14, seen = new Set()) => {
      if (!root || depth > maxDepth || seen.has(root)) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childName + "#" + i, depth + 1, maxDepth, seen);
      }
    };
    const stageChildren = () => {
      const out = [];
      for (let i = 0; i < (Laya.stage && Laya.stage.numChildren || 0); i++) {
        try { out.push(Laya.stage.getChildAt(i)); } catch {}
      }
      return out;
    };
    const currentScene = () => {
      const layer = stageChildren().find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" ")));
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = layer.getChildAt(i);
        if (effectiveVisible(candidate)) return candidate;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const windowLayer = () => stageChildren().find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const snapshot = (label) => {
      const tips = [];
      const windows = [];
      walk(Laya.stage, (node, nodePath) => {
        const hay = [nodePath, labelOf(node), node && node.name, node && node._className_, node && node._resName, ctor(node)].filter(Boolean).join(" ");
        if (effectiveVisible(node) && /ToolTip|Tooltip|Tip|Tips|CommonPropTip|PropTip|SkillPopUp|PopUp|Popup|GameFlower|UWi|ujt|cWi/i.test(hay)) tips.push(nodeSummary(node, nodePath));
        if (effectiveVisible(node) && /Window|modalBg|mWt|Dialog/i.test(hay)) windows.push(nodeSummary(node, nodePath));
      });
      return {
        label,
        scene: nodeSummary(currentScene(), "currentScene"),
        windowLayer: nodeSummary(windowLayer(), "windowLayer"),
        tips: tips.slice(0, 100),
        windows: windows.slice(0, 120)
      };
    };
    const candidates = [];
    walk(windowLayer(), (node, nodePath) => {
      if (!effectiveVisible(node)) return;
      const fn = node && (node.ToolTip || node.toolTip || node.GeneralToolTip || node.generalToolTip);
      if (typeof fn !== "function") return;
      const hay = [nodePath, labelOf(node), node && (node.text || node._text || ""), Object.keys(fields(node)).join(" ")].join(" ");
      let score = 0;
      if (/RogueFightWindow/.test(nodePath)) score += 1000;
      if (/Vts|aKi|g6i|Skill|skill|General|general/.test(hay)) score += 200;
      if (/ToolTip/.test(Object.keys(fields(node)).join(" "))) score += 50;
      candidates.push({ node, path: nodePath, score });
    });
    walk(currentScene(), (node, nodePath) => {
      if (!effectiveVisible(node)) return;
      const fn = node && (node.ToolTip || node.toolTip || node.GeneralToolTip || node.generalToolTip);
      if (typeof fn !== "function") return;
      const hay = [nodePath, labelOf(node), node && (node.text || node._text || ""), Object.keys(fields(node)).join(" ")].join(" ");
      let score = 0;
      if (/aKi|g6i|Skill|skill/.test(hay)) score += 300;
      if (/RogueSmallMapScene/.test(nodePath)) score += 100;
      candidates.push({ node, path: "currentScene/" + nodePath, score });
    });
    candidates.sort((a, b) => b.score - a.score);
    const target = candidates[0] || null;
    const before = snapshot("before");
    const result = {
      ok: true,
      time: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 20).map((item) => ({ score: item.score, summary: nodeSummary(item.node, item.path) })),
      target: target ? nodeSummary(target.node, target.path) : null,
      before,
      mouseOver: null,
      afterMouseOver: null,
      mouseOut: null,
      afterMouseOut: null,
      call: null,
      returned: null,
      afterDirectCreate: null,
      cleanup: [],
      afterCleanup: null,
      notes: [
        "This sample calls one visible node ToolTip/GeneralToolTip function and then attempts to clean only the returned tooltip object.",
        "It does not click, confirm, enter battle, discard, use skills, buy, refresh, or read hidden hand fields."
      ]
    };
    if (!target) {
      result.ok = false;
      result.call = { ok: false, reason: "No visible function ToolTip target found" };
      return result;
    }
    try {
      let overEvent = null;
      try {
        overEvent = new Laya.Event();
        if (typeof overEvent.setTo === "function") overEvent.setTo(Laya.Event.MOUSE_OVER, target.node, target.node);
        else overEvent.type = Laya.Event.MOUSE_OVER;
      } catch {}
      target.node.event(Laya.Event.MOUSE_OVER, overEvent ? [overEvent] : undefined);
      result.mouseOver = { ok: true, event: Laya.Event.MOUSE_OVER };
    } catch (error) {
      result.mouseOver = { ok: false, error: String(error && error.message || error) };
    }
    await sleep(500);
    result.afterMouseOver = snapshot("afterMouseOver");
    try {
      let outEvent = null;
      try {
        outEvent = new Laya.Event();
        if (typeof outEvent.setTo === "function") outEvent.setTo(Laya.Event.MOUSE_OUT, target.node, target.node);
        else outEvent.type = Laya.Event.MOUSE_OUT;
      } catch {}
      target.node.event(Laya.Event.MOUSE_OUT, outEvent ? [outEvent] : undefined);
      result.mouseOut = { ok: true, event: Laya.Event.MOUSE_OUT };
    } catch (error) {
      result.mouseOut = { ok: false, error: String(error && error.message || error) };
    }
    await sleep(350);
    result.afterMouseOut = snapshot("afterMouseOut");
    let returned = null;
    try {
      const fn = target.node.ToolTip || target.node.toolTip || target.node.GeneralToolTip || target.node.generalToolTip;
      returned = fn.call(target.node);
      result.call = { ok: true, functionName: fn.name || "", targetPath: target.path };
      result.returned = nodeSummary(returned, "returnedTooltip");
    } catch (error) {
      result.ok = false;
      result.call = { ok: false, error: String(error && error.message || error), targetPath: target.path };
      return result;
    }
    await sleep(350);
    result.afterDirectCreate = snapshot("afterDirectCreate");
    if (returned) {
      for (const method of ["Close", "close", "hide", "removeSelf"]) {
        try {
          if (typeof returned[method] === "function") {
            returned[method]();
            result.cleanup.push({ method, ok: true });
            break;
          }
        } catch (error) {
          result.cleanup.push({ method, ok: false, error: String(error && error.message || error) });
        }
      }
      try {
        if (!result.cleanup.some((item) => item.ok) && typeof returned.destroy === "function") {
          returned.destroy(true);
          result.cleanup.push({ method: "destroy(true)", ok: true });
        }
      } catch (error) {
        result.cleanup.push({ method: "destroy(true)", ok: false, error: String(error && error.message || error) });
      }
    }
    try {
      if (target.node && typeof target.node.tipsRollOut === "function") {
        target.node.tipsRollOut();
        result.cleanup.push({ method: "target.tipsRollOut", ok: true });
      }
    } catch (error) {
      result.cleanup.push({ method: "target.tipsRollOut", ok: false, error: String(error && error.message || error) });
    }
    await sleep(350);
    result.afterCleanup = snapshot("afterCleanup");
    return result;
  })()`;
}

function readmeText(payload) {
  const value = payload.lifecycle?.value || {};
  const monitorStatus = payload.dump?.value?.status || {};
  const target = value.target || {};
  const mouseOverTipDelta = Math.max(0, (value.afterMouseOver?.tips?.length || 0) - (value.before?.tips?.length || 0));
  const directCreatedTips = Math.max(0, (value.afterDirectCreate?.tips?.length || 0) - (value.afterMouseOut?.tips?.length || value.before?.tips?.length || 0));
  const remainingTips = value.afterCleanup?.tips?.length || 0;
  return [
    "# Tooltip Lifecycle Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- Scene: ${value.before?.scene?.sceneName || value.before?.scene?.className || ""}`,
    `- Target: ${target.path || ""} | ${target.label || ""} | text=${target.text || ""}`,
    `- Candidate count: ${value.candidateCount || 0}`,
    `- Mouse over ok: ${value.mouseOver?.ok === true}`,
    `- Mouse out ok: ${value.mouseOut?.ok === true}`,
    `- Call ok: ${value.call?.ok === true}`,
    `- Returned: ${value.returned?.label || value.returned?.ctor || ""}`,
    `- Tips before/mouseover/mouseout/direct/cleanup: ${value.before?.tips?.length || 0}/${value.afterMouseOver?.tips?.length || 0}/${value.afterMouseOut?.tips?.length || 0}/${value.afterDirectCreate?.tips?.length || 0}/${remainingTips}`,
    `- Mouseover tip delta: ${mouseOverTipDelta}`,
    `- Direct-call tip delta: ${directCreatedTips}`,
    `- Cleanup calls: ${(value.cleanup || []).map((item) => `${item.method}:${item.ok}`).join(", ") || "(none)"}`,
    `- Hover monitor method records: ${monitorStatus.methodRecords || 0}`,
    `- Hover monitor event records: ${monitorStatus.eventRecords || 0}`,
    "",
    "This sample creates a tooltip through the runtime tooltip function and then cleans up the returned object when possible. It does not click, confirm, start battle, use skills, buy, refresh, discard, or read hidden hand fields.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const install = await evaluateOnSgs(installExpression({
    maxRecords: Number(process.env.SGS_TOOLTIP_LIFECYCLE_MAX_RECORDS || 2000),
    mouseIntervalMs: 120
  }), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const lifecycle = await evaluateOnSgs(lifecycleExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = { target: install.target, install, lifecycle, dump, stop };
  await writeJson(path.join(dir, "tooltip-lifecycle-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    ok: lifecycle.value?.ok === true,
    dir,
    scene: lifecycle.value?.before?.scene?.sceneName || lifecycle.value?.before?.scene?.className || null,
    target: lifecycle.value?.target?.path || null,
    targetLabel: lifecycle.value?.target?.label || null,
    mouseOverOk: lifecycle.value?.mouseOver?.ok === true,
    mouseOutOk: lifecycle.value?.mouseOut?.ok === true,
    callOk: lifecycle.value?.call?.ok === true,
    returned: lifecycle.value?.returned?.label || lifecycle.value?.returned?.ctor || null,
    tipsBefore: lifecycle.value?.before?.tips?.length || 0,
    tipsAfterMouseOver: lifecycle.value?.afterMouseOver?.tips?.length || 0,
    tipsAfterMouseOut: lifecycle.value?.afterMouseOut?.tips?.length || 0,
    tipsAfterDirectCreate: lifecycle.value?.afterDirectCreate?.tips?.length || 0,
    tipsAfterCleanup: lifecycle.value?.afterCleanup?.tips?.length || 0,
    methodRecords: dump.value?.status?.methodRecords || 0,
    eventRecords: dump.value?.status?.eventRecords || 0
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
