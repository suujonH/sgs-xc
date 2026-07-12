import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, selectSgsTarget, valueFromEvaluation } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-hover-popup-sample.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_HOVER_FIELD_TOOLTIP_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-hover-field-tooltip-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function evaluate(session, expression, timeoutMs = 45000) {
  const evaluated = await session.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs
    },
    timeoutMs + 15000
  );
  return valueFromEvaluation(evaluated);
}

function browserHelperInstaller(options) {
    const maxNodes = options.maxNodes || 900;
    const ctor = (obj) => { try { return obj?.constructor?.name || ""; } catch { return ""; } };
    const own = (obj) => { try { return Object.getOwnPropertyNames(obj || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
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
    const textOf = (node) => {
      try {
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.innerHTML === "string") return node.innerHTML;
        if (typeof node?._innerHTML === "string") return node._innerHTML;
      } catch {}
      return "";
    };
    const safe = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 4).map((item) => safe(item, depth + 1)) };
      const keys = own(value)
        .filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key))
        .slice(0, 14);
      return { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
    };
    const tooltipFields = (node) => {
      const out = {};
      for (const key of ["toolTip", "ToolTip", "generalToolTip", "GeneralToolTip", "_toolTip", "_ToolTip"]) {
        try {
          if (node && node[key] != null) out[key] = safe(node[key]);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const eventSummary = (node) => {
      const events = node?._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const key of own(events)) {
        if (!/mouse|click|roll|over|out|tip/i.test(key)) continue;
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            caller: handler.caller ? labelOf(handler.caller) || ctor(handler.caller) : "",
            method: handler.method ? (handler.method.name || String(handler.method).slice(0, 160)) : "",
            args: Array.isArray(handler.args) ? handler.args.map((arg) => safe(arg, 1)).slice(0, 6) : safe(handler.args, 1),
            once: handler.once
          })).slice(0, 12);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const canvasRect = () => {
      const canvas = document.querySelector("canvas");
      const rect = canvas?.getBoundingClientRect?.();
      if (!rect) return null;
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        const width = Number(node.width) || 0;
        const height = Number(node.height) || 0;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return { x: p.x, y: p.y, width, height };
      } catch {
        return null;
      }
    };
    const toPageBounds = (stageBounds) => {
      const rect = canvasRect();
      const stageWidth = Number(Laya.stage?.width) || 0;
      const stageHeight = Number(Laya.stage?.height) || 0;
      if (!rect || !stageWidth || !stageHeight || !stageBounds) return null;
      const left = rect.left + stageBounds.x * rect.width / stageWidth;
      const top = rect.top + stageBounds.y * rect.height / stageHeight;
      const right = rect.left + (stageBounds.x + stageBounds.width) * rect.width / stageWidth;
      const bottom = rect.top + (stageBounds.y + stageBounds.height) * rect.height / stageHeight;
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2
      };
    };
    const nodeSummary = (node, nodePath) => {
      const stageBounds = boundsOf(node);
      return {
        gid: node?.$_GID ?? null,
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
        effectiveVisible: effectiveVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        childCount: node?.numChildren || 0,
        text: textOf(node).slice(0, 240),
        tooltipFields: tooltipFields(node),
        events: eventSummary(node),
        stageBounds,
        pageBounds: toPageBounds(stageBounds)
      };
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || depth > 14 || seen.has(root) || seen.size > maxNodes) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child?.name || child?._className_ || child?.sceneName || child?.SceneName || ctor(child) || ("#" + i);
        walk(child, visitor, `${nodePath}/${childName}#${i}`, depth + 1, seen);
      }
    };
    const stageChildren = () => {
      const out = [];
      for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
        try { out.push(Laya.stage.getChildAt(i)); } catch {}
      }
      return out;
    };
    const currentScene = () => {
      const layer = stageChildren().find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = layer.getChildAt(i);
        if (effectiveVisible(candidate)) return candidate;
      }
      return null;
    };
    const windowLayer = () => stageChildren().find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" "))) || null;
    const findByGid = (gid) => {
      let found = null;
      walk(Laya.stage, (node) => {
        if (found) return;
        if (node?.$_GID === gid) found = node;
      });
      return found;
    };
    const scoreTarget = (summary) => {
      const fields = summary.tooltipFields || {};
      const eventKeys = Object.keys(summary.events || {});
      const hay = [summary.path, summary.label, summary.text, Object.keys(fields).join(" "), JSON.stringify(fields), eventKeys.join(" ")].join(" ");
      let score = 0;
      if (Object.values(fields).some((value) => value?.kind === "function")) score += 700;
      if (Object.values(fields).some((value) => typeof value === "string" && value)) score += 500;
      if (Object.keys(fields).length) score += 350;
      if (eventKeys.some((key) => /mouseover|mouseout|rollover|rollout/i.test(key))) score += 240;
      if (/Skill|skill|General|general|Card|card|RogueFight|ChangeSKill/.test(hay)) score += 150;
      if (/Tip|tip|ToolTip|Tooltip/.test(hay)) score += 90;
      if (summary.text) score += 25;
      if (/Chat|chat|\$Bt|综合信息|系统信息/.test(hay)) score -= 30;
      if ((summary.width || 0) > 800 || (summary.height || 0) > 600) score -= 80;
      if ((summary.width || 0) < 8 || (summary.height || 0) < 8) score -= 40;
      return score;
    };
    const snapshot = (label) => {
      const tips = [];
      const windows = [];
      const tooltipNodes = [];
      const stageChildren = [];
      try {
        for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
          const child = Laya.stage.getChildAt(i);
          stageChildren.push({
            index: i,
            label: labelOf(child),
            effectiveVisible: effectiveVisible(child),
            childCount: child?.numChildren || 0
          });
        }
      } catch {}
      walk(Laya.stage, (node, nodePath) => {
        const summary = nodeSummary(node, nodePath);
        const hay = [summary.path, summary.label, summary.name, summary.className, summary.resName, summary.ctor].join(" ");
        const hasTooltip = Object.keys(summary.tooltipFields || {}).length > 0;
        if (effectiveVisible(node) && /ToolTip|Tooltip|Tip|Tips|CommonPropTip|PropTip|SkillPopUp|PopUp|Popup|GameFlower|UWi|ujt|cWi/i.test(hay)) tips.push(summary);
        if (effectiveVisible(node) && /Window|modalBg|Dialog|mWt/i.test(hay)) windows.push(summary);
        if (effectiveVisible(node) && hasTooltip) tooltipNodes.push(summary);
      });
      return {
        label,
        time: new Date().toISOString(),
        scene: nodeSummary(currentScene(), "currentScene"),
        windowLayer: nodeSummary(windowLayer(), "windowLayer"),
        stageChildren,
        tips: tips.slice(0, 120),
        windows: windows.slice(0, 120),
        tooltipNodes: tooltipNodes.slice(0, 160)
      };
    };
    const candidates = (limit = 24) => {
      const out = [];
      const roots = [
        { node: windowLayer(), path: "WindowLayer" },
        { node: currentScene(), path: "CurrentScene" }
      ];
      for (const root of roots) {
        walk(root.node, (node, nodePath) => {
          if (!effectiveVisible(node)) return;
          const summary = nodeSummary(node, nodePath);
          const hasTooltip = Object.keys(summary.tooltipFields || {}).length > 0;
          const hasOverEvent = Object.keys(summary.events || {}).some((key) => /mouseover|mouseout|rollover|rollout/i.test(key));
          const page = summary.pageBounds;
          if (!page || page.width < 4 || page.height < 4) return;
          if (!hasTooltip && !hasOverEvent) return;
          const score = scoreTarget(summary);
          if (score <= 0) return;
          out.push({ score, ...summary });
        });
      }
      out.sort((a, b) => b.score - a.score || (a.pageBounds.width * a.pageBounds.height) - (b.pageBounds.width * b.pageBounds.height));
      return {
        time: new Date().toISOString(),
        page: { title: document.title, url: location.href },
        canvas: canvasRect(),
        stage: { width: Laya.stage?.width, height: Laya.stage?.height, children: Laya.stage?.numChildren },
        scene: nodeSummary(currentScene(), "currentScene"),
        candidates: out.slice(0, limit)
      };
    };
    const directHover = async (gid, waitMs = 550) => {
      const node = findByGid(gid);
      const before = snapshot("beforeDirectHover");
      const result = {
        ok: !!node,
        target: node ? nodeSummary(node, "target") : null,
        before,
        mouseOver: null,
        afterMouseOver: null,
        mouseOut: null,
        afterMouseOut: null
      };
      if (!node) return result;
      try {
        let event = null;
        try {
          event = new Laya.Event();
          if (typeof event.setTo === "function") event.setTo(Laya.Event.MOUSE_OVER, node, node);
          else event.type = Laya.Event.MOUSE_OVER;
        } catch {}
        node.event(Laya.Event.MOUSE_OVER, event ? [event] : undefined);
        result.mouseOver = { ok: true, event: Laya.Event.MOUSE_OVER };
      } catch (error) {
        result.mouseOver = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      result.afterMouseOver = snapshot("afterMouseOver");
      try {
        let event = null;
        try {
          event = new Laya.Event();
          if (typeof event.setTo === "function") event.setTo(Laya.Event.MOUSE_OUT, node, node);
          else event.type = Laya.Event.MOUSE_OUT;
        } catch {}
        node.event(Laya.Event.MOUSE_OUT, event ? [event] : undefined);
        result.mouseOut = { ok: true, event: Laya.Event.MOUSE_OUT };
      } catch (error) {
        result.mouseOut = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, Math.floor(waitMs / 2))));
      result.afterMouseOut = snapshot("afterMouseOut");
      return result;
    };
    window.__codexSgsHoverFieldTooltipHelper = {
      installedAt: new Date().toISOString(),
      candidates,
      snapshot,
      directHover,
      stop() {
        try { delete window.__codexSgsHoverFieldTooltipHelper; } catch { window.__codexSgsHoverFieldTooltipHelper = null; }
        return { ok: true };
      }
    };
    return {
      ok: true,
      installedAt: window.__codexSgsHoverFieldTooltipHelper.installedAt,
      snapshot: snapshot("install")
    };
}

function helperInstallExpression(options) {
  return `(${browserHelperInstaller.toString()})(${JSON.stringify(options)})`;
}

function helperCandidatesExpression(limit) {
  return `(() => window.__codexSgsHoverFieldTooltipHelper.candidates(${JSON.stringify(limit)}))()`;
}

function helperSnapshotExpression(label) {
  return `(() => window.__codexSgsHoverFieldTooltipHelper.snapshot(${JSON.stringify(label)}))()`;
}

function helperDirectHoverExpression(gid, waitMs) {
  return `(() => window.__codexSgsHoverFieldTooltipHelper.directHover(${JSON.stringify(gid)}, ${JSON.stringify(waitMs)}))()`;
}

function helperStopExpression() {
  return "(() => window.__codexSgsHoverFieldTooltipHelper ? window.__codexSgsHoverFieldTooltipHelper.stop() : { ok: false, error: 'not installed' })()";
}

function hoverMonitorCleanupExpression() {
  return "(() => { try { if (window.__codexSgsHoverPopupSample && window.__codexSgsHoverPopupSample.installed && typeof window.__codexSgsHoverPopupSample.stop === 'function') window.__codexSgsHoverPopupSample.stop(); } catch (error) {} try { delete window.__codexSgsHoverPopupSample; } catch (error) { window.__codexSgsHoverPopupSample = null; } return { ok: !window.__codexSgsHoverPopupSample }; })()";
}

function tipCount(snapshot) {
  return snapshot?.tips?.length || 0;
}

function signatureSet(items) {
  return new Set((items || []).map((item) => [
    item.path || "",
    item.label || "",
    item.name || "",
    item.className || "",
    item.sceneName || "",
    item.text || "",
    item.childCount ?? ""
  ].join("\t")));
}

function newItems(beforeItems, afterItems) {
  const before = signatureSet(beforeItems);
  return (afterItems || []).filter((item) => !before.has([
    item.path || "",
    item.label || "",
    item.name || "",
    item.className || "",
    item.sceneName || "",
    item.text || "",
    item.childCount ?? ""
  ].join("\t")));
}

function snapshotDelta(before, after) {
  return {
    tipDelta: (after?.tips?.length || 0) - (before?.tips?.length || 0),
    windowDelta: (after?.windows?.length || 0) - (before?.windows?.length || 0),
    tooltipNodeDelta: (after?.tooltipNodes?.length || 0) - (before?.tooltipNodes?.length || 0),
    stageChildDelta: (after?.stageChildren?.length || 0) - (before?.stageChildren?.length || 0),
    newTips: newItems(before?.tips, after?.tips).slice(0, 8).map((item) => ({
      path: item.path || "",
      label: item.label || "",
      text: item.text || ""
    })),
    newWindows: newItems(before?.windows, after?.windows).slice(0, 8).map((item) => ({
      path: item.path || "",
      label: item.label || "",
      text: item.text || ""
    })),
    newTooltipNodes: newItems(before?.tooltipNodes, after?.tooltipNodes).slice(0, 8).map((item) => ({
      path: item.path || "",
      label: item.label || "",
      text: item.text || ""
    }))
  };
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const samples = payload.samples || [];
  const visibleTipDeltas = samples.map((sample) => ({
    text: sample.target?.text || "",
    path: sample.target?.path || "",
    cdp: snapshotDelta(sample.beforeCdpHover, sample.afterCdpHover),
    direct: snapshotDelta(sample.direct?.before, sample.direct?.afterMouseOver),
    cleanup: snapshotDelta(sample.beforeCdpHover, sample.afterCleanup)
  }));
  const stageObserved = visibleTipDeltas.some((item) =>
    item.cdp.tipDelta > 0 ||
    item.cdp.windowDelta > 0 ||
    item.cdp.tooltipNodeDelta > 0 ||
    item.cdp.stageChildDelta > 0 ||
    item.direct.tipDelta > 0 ||
    item.direct.windowDelta > 0 ||
    item.direct.tooltipNodeDelta > 0 ||
    item.direct.stageChildDelta > 0
  );
  return [
    "# Runtime Hover Field Tooltip Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Scene: ${payload.candidates?.scene?.sceneName || payload.candidates?.scene?.className || ""}`,
    `- Candidates: ${payload.candidates?.candidates?.length || 0}`,
    `- Sampled targets: ${samples.length}`,
    `- Visible tip delta observed: ${stageObserved}`,
    `- Hover monitor method records: ${status.methodRecords || 0}`,
    `- Hover monitor event records: ${status.eventRecords || 0}`,
    `- Hover monitor mouse records: ${status.mouseRecords || 0}`,
    "",
    "This sample only moves the mouse and dispatches Laya mouseover/mouseout on visible tooltip-bound nodes. It does not click, confirm, start battle, discard, use skills, buy, refresh, or read hidden hand fields.",
    "",
    "## Targets",
    "",
    ...samples.map((sample, index) => {
      const delta = visibleTipDeltas[index] || {};
      return `- ${index + 1}. score=${sample.target?.score ?? ""} ${sample.target?.path || ""} | ${sample.target?.label || ""} | text=${sample.target?.text || ""} | cdpTip=${delta.cdp?.tipDelta || 0} cdpWindow=${delta.cdp?.windowDelta || 0} cdpTooltipNode=${delta.cdp?.tooltipNodeDelta || 0} cdpStageChild=${delta.cdp?.stageChildDelta || 0} directTip=${delta.direct?.tipDelta || 0} directWindow=${delta.direct?.windowDelta || 0} directTooltipNode=${delta.direct?.tooltipNodeDelta || 0} directStageChild=${delta.direct?.stageChildDelta || 0}`;
    }),
    ""
  ].join("\n");
}

async function main() {
  const candidateLimit = Number(process.env.SGS_HOVER_FIELD_CANDIDATES || 40);
  const sampleLimit = Number(process.env.SGS_HOVER_FIELD_SAMPLES || 6);
  const settleMs = Number(process.env.SGS_HOVER_FIELD_SETTLE_MS || 900);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });

  const target = await selectSgsTarget();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    await session.send("Runtime.enable");
    await session.send("Page.bringToFront").catch(() => {});
    const hoverInstall = await evaluate(session, installExpression({
      maxRecords: Number(process.env.SGS_HOVER_FIELD_MAX_RECORDS || 5000),
      mouseIntervalMs: Number(process.env.SGS_HOVER_FIELD_MOUSE_INTERVAL_MS || 80),
      recordAllMouse: true
    }));
    const helperInstall = await evaluate(session, helperInstallExpression({
      maxNodes: Number(process.env.SGS_HOVER_FIELD_MAX_NODES || 900)
    }));
    const candidates = await evaluate(session, helperCandidatesExpression(candidateLimit));
    const selected = (candidates.candidates || [])
      .filter((item) => item.gid != null && item.pageBounds)
      .slice(0, sampleLimit);
    const samples = [];
    const canvas = candidates.canvas || {};
    const outsideX = Math.max(1, Math.min(Number(canvas.right || 10) - 2, Number(canvas.left || 0) + 2));
    const outsideY = Math.max(1, Math.min(Number(canvas.bottom || 10) - 2, Number(canvas.top || 0) + 2));
    for (const item of selected) {
      const pageX = Number(item.pageBounds.centerX);
      const pageY = Number(item.pageBounds.centerY);
      if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) continue;
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: outsideX, y: outsideY, buttons: 0, pointerType: "mouse" }, 10000).catch(() => {});
      await sleep(200);
      const beforeCdpHover = await evaluate(session, helperSnapshotExpression("beforeCdpHover"));
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pageX, y: pageY, buttons: 0, pointerType: "mouse" }, 10000);
      await sleep(settleMs);
      const afterCdpHover = await evaluate(session, helperSnapshotExpression("afterCdpHover"));
      const direct = await evaluate(session, helperDirectHoverExpression(item.gid, Math.max(450, Math.floor(settleMs / 2))));
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: outsideX, y: outsideY, buttons: 0, pointerType: "mouse" }, 10000).catch(() => {});
      await sleep(Math.max(300, Math.floor(settleMs / 2)));
      const afterCleanup = await evaluate(session, helperSnapshotExpression("afterCleanup"));
      samples.push({
        target: item,
        pageMove: { x: pageX, y: pageY, outsideX, outsideY },
        beforeCdpHover,
        afterCdpHover,
        direct,
        afterCleanup
      });
      const cdpDelta = tipCount(afterCdpHover) - tipCount(beforeCdpHover);
      const directDelta = tipCount(direct?.afterMouseOver) - tipCount(direct?.before);
      if (cdpDelta > 0 || directDelta > 0) break;
    }
    const dumpValue = await evaluate(session, dumpExpression());
    const stopHover = process.env.SGS_HOVER_FIELD_KEEP_INSTALLED === "1"
      ? { skipped: true }
      : await evaluate(session, stopExpression());
    const cleanupHover = process.env.SGS_HOVER_FIELD_KEEP_INSTALLED === "1"
      ? { skipped: true }
      : await evaluate(session, hoverMonitorCleanupExpression());
    const stopHelper = await evaluate(session, helperStopExpression());
    const payload = {
      target,
      hoverInstall,
      helperInstall,
      candidates,
      samples,
      dump: { value: dumpValue },
      stopHover,
      cleanupHover,
      stopHelper
    };
    await writeJson(path.join(dir, "hover-field-tooltip-sample.json"), payload);
    await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
    console.log(JSON.stringify({
      dir,
      scene: candidates.scene ? { sceneName: candidates.scene.sceneName, className: candidates.scene.className, ctor: candidates.scene.ctor } : null,
      candidates: candidates.candidates?.length || 0,
      samples: samples.length,
      visibleTipDeltas: samples.map((sample) => ({
        target: sample.target?.path || "",
        text: sample.target?.text || "",
        cdp: snapshotDelta(sample.beforeCdpHover, sample.afterCdpHover),
        direct: snapshotDelta(sample.direct?.before, sample.direct?.afterMouseOver),
        cleanup: snapshotDelta(sample.beforeCdpHover, sample.afterCleanup)
      })),
      methodRecords: dumpValue.status?.methodRecords || 0,
      mouseRecords: dumpValue.status?.mouseRecords || 0,
      eventRecords: dumpValue.status?.eventRecords || 0,
      errors: dumpValue.errors?.length || 0
    }, null, 2));
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
