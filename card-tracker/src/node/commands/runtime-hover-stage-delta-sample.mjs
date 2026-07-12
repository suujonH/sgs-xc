import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, selectSgsTarget, valueFromEvaluation } from "../cdp/client.mjs";

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
    process.env.SGS_HOVER_STAGE_DELTA_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-hover-stage-delta-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function evaluate(session, expression, timeoutMs = 12000) {
  const evaluated = await session.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs
    },
    timeoutMs + 8000
  );
  return valueFromEvaluation(evaluated);
}

function browserHoverStageProbe() {
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
      } catch {}
      return "";
    };
    const stageChildren = () => {
      const out = [];
      for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
        try { out.push(Laya.stage.getChildAt(i)); } catch {}
      }
      return out;
    };
    const sceneLayer = () => stageChildren().find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" "))) || null;
    const windowLayer = () => stageChildren().find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" "))) || null;
    const currentScene = () => {
      const layer = sceneLayer();
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = layer.getChildAt(i);
        if (effectiveVisible(candidate)) return candidate;
      }
      return null;
    };
    const walk = (root, visitor, nodePath = "root", depth = 0, seen = new Set()) => {
      if (!root || depth > 11 || seen.has(root) || seen.size > 2200) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child?.name || child?._className_ || child?.sceneName || child?.SceneName || ctor(child) || ("#" + i);
        walk(child, visitor, `${nodePath}/${childName}#${i}`, depth + 1, seen);
      }
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        const width = Number(node.width) || 0;
        const height = Number(node.height) || 0;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || width < 6 || height < 6) return null;
        return { x: p.x, y: p.y, width, height };
      } catch {
        return null;
      }
    };
    const canvasRect = () => {
      const canvas = document.querySelector("canvas");
      const rect = canvas?.getBoundingClientRect?.();
      if (!rect) return null;
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
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
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      if (centerX < rect.left || centerY < rect.top || centerX > rect.right || centerY > rect.bottom) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top, centerX, centerY };
    };
    const tooltipFieldKeys = (node) => ["toolTip", "ToolTip", "generalToolTip", "GeneralToolTip", "_toolTip", "_ToolTip", "AppToolTip"]
      .filter((key) => {
        try { return node && node[key] != null; } catch { return false; }
      });
    const eventKeys = (node) => {
      const events = node?._events;
      if (!events || typeof events !== "object") return [];
      return own(events).filter((key) => /mouse|roll|over|out|tip/i.test(key));
    };
    const methodKeys = (node) => {
      const out = [];
      let proto = Object.getPrototypeOf(node || {});
      const seen = new Set();
      while (proto && proto !== Object.prototype && out.length < 20) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          if (!/(show.*tip|tip.*handler|roll.*over|roll.*out|mouse.*over|mouse.*out|card.*tip|general.*tip|skill.*tip|ToolTip|AppToolTip|tipsRollOut)/i.test(key)) continue;
          try {
            if (typeof node[key] === "function") out.push(key);
          } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return out;
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
        text: textOf(node).slice(0, 180),
        visible: node?.visible,
        effectiveVisible: effectiveVisible(node),
        hiddenReasons: hiddenReasons(node).slice(0, 4),
        width: node?.width,
        height: node?.height,
        childCount: node?.numChildren || 0,
        tooltipFieldKeys: tooltipFieldKeys(node),
        eventKeys: eventKeys(node),
        methodKeys: methodKeys(node),
        stageBounds,
        pageBounds: toPageBounds(stageBounds)
      };
    };
    const score = (summary) => {
      const hay = [summary.path, summary.label, summary.text, summary.tooltipFieldKeys.join(" "), summary.eventKeys.join(" "), summary.methodKeys.join(" ")].join(" ");
      let value = 0;
      if (summary.tooltipFieldKeys.length) value += 400;
      if (summary.eventKeys.some((key) => /over|roll/i.test(key))) value += 220;
      if (summary.methodKeys.length) value += 180;
      if (/Skill|skill|Card|card|General|general|Rogue|rogue/.test(hay)) value += 90;
      if (/Tip|tip|ToolTip|AppToolTip|Pop|Window/.test(hay)) value += 80;
      if (summary.text) value += 20;
      if ((summary.width || 0) > 700 || (summary.height || 0) > 500) value -= 120;
      if ((summary.width || 0) < 12 || (summary.height || 0) < 12) value -= 50;
      if (/Chat|\$Bt|Input/.test(hay)) value -= 15;
      return value;
    };
    const candidates = (limit = 16) => {
      const roots = [
        { node: windowLayer(), path: "WindowLayer" },
        { node: currentScene(), path: "CurrentScene" }
      ];
      const out = [];
      for (const root of roots) {
        walk(root.node, (node, nodePath) => {
          if (!effectiveVisible(node)) return;
          const summary = nodeSummary(node, nodePath);
          if (!summary.pageBounds) return;
          if (!summary.tooltipFieldKeys.length && !summary.eventKeys.length && !summary.methodKeys.length) return;
          const itemScore = score(summary);
          if (itemScore <= 0) return;
          out.push({ score: itemScore, ...summary });
        }, root.path);
      }
      out.sort((a, b) => b.score - a.score || (a.pageBounds.width * a.pageBounds.height) - (b.pageBounds.width * b.pageBounds.height));
      return {
        time: new Date().toISOString(),
        page: { title: document.title, url: location.href },
        canvas: canvasRect(),
        stage: { width: Laya.stage?.width, height: Laya.stage?.height, childCount: Laya.stage?.numChildren },
        scene: nodeSummary(currentScene(), "currentScene"),
        candidates: out.slice(0, limit)
      };
    };
    const findByGid = (gid) => {
      let found = null;
      walk(Laya.stage, (node) => {
        if (found) return;
        if (node?.$_GID === gid) found = node;
      }, "Laya.stage", 0, new Set());
      return found;
    };
    const directHover = async (gid, waitMs = 450) => {
      const node = findByGid(gid);
      const before = snapshot("beforeDirect");
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
        result.mouseOver = { ok: true };
      } catch (error) {
        result.mouseOver = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      result.afterMouseOver = snapshot("afterDirectMouseOver");
      try {
        let event = null;
        try {
          event = new Laya.Event();
          if (typeof event.setTo === "function") event.setTo(Laya.Event.MOUSE_OUT, node, node);
          else event.type = Laya.Event.MOUSE_OUT;
        } catch {}
        node.event(Laya.Event.MOUSE_OUT, event ? [event] : undefined);
        result.mouseOut = { ok: true };
      } catch (error) {
        result.mouseOut = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(180, Math.floor(waitMs / 2))));
      result.afterMouseOut = snapshot("afterDirectMouseOut");
      return result;
    };
    const snapshot = (label) => {
      const children = stageChildren();
      const layer = windowLayer();
      const windowChildren = [];
      if (layer) {
        for (let i = 0; i < (layer.numChildren || 0); i++) {
          try {
            const child = layer.getChildAt(i);
            windowChildren.push(nodeSummary(child, `WindowLayer#${i}`));
          } catch {}
        }
      }
      const tipLike = [];
      walk(Laya.stage, (node, nodePath) => {
        if (tipLike.length >= 90 || !effectiveVisible(node)) return;
        const summary = nodeSummary(node, nodePath);
        const hay = [summary.path, summary.label, summary.name, summary.className, summary.text, summary.tooltipFieldKeys.join(" "), summary.methodKeys.join(" ")].join(" ");
        if (/ToolTip|Tooltip|Tip|Tips|SkillPopUp|PopUp|Popup|Window|CommonProp|GameFlower|UWi|cWi|ujt|Dqi/i.test(hay)) tipLike.push(summary);
      }, "Laya.stage", 0, new Set());
      return {
        label,
        time: new Date().toISOString(),
        mouse: { x: Laya.stage?.mouseX, y: Laya.stage?.mouseY },
        scene: nodeSummary(currentScene(), "currentScene"),
        stageChildren: children.map((child, index) => ({
          index,
          label: labelOf(child),
          childCount: child?.numChildren || 0,
          effectiveVisible: effectiveVisible(child)
        })),
        windowLayer: layer ? {
          label: labelOf(layer),
          childCount: layer.numChildren || 0,
          effectiveVisible: effectiveVisible(layer)
        } : null,
        windowChildren,
        tipLike
      };
    };
    return { candidates, snapshot, directHover };
}

function helperExpression() {
  return `(() => { window.__codexHoverStageDeltaProbe = (${browserHoverStageProbe.toString()})(); return { ok: true, candidates: window.__codexHoverStageDeltaProbe.candidates(1) }; })()`;
}

function candidatesExpression(limit) {
  return `(() => window.__codexHoverStageDeltaProbe.candidates(${JSON.stringify(limit)}))()`;
}

function snapshotExpression(label) {
  return `(() => window.__codexHoverStageDeltaProbe.snapshot(${JSON.stringify(label)}))()`;
}

function directHoverExpression(gid, waitMs) {
  return `(() => window.__codexHoverStageDeltaProbe.directHover(${JSON.stringify(gid)}, ${JSON.stringify(waitMs)}))()`;
}

function cleanupExpression() {
  return "(() => { try { delete window.__codexHoverStageDeltaProbe; } catch { window.__codexHoverStageDeltaProbe = undefined; } return { ok: !window.__codexHoverStageDeltaProbe }; })()";
}

function signature(item) {
  return [
    item?.path || "",
    item?.label || "",
    item?.text || "",
    item?.childCount ?? "",
    item?.effectiveVisible ?? ""
  ].join("\t");
}

function newItems(beforeItems, afterItems) {
  const before = new Set((beforeItems || []).map(signature));
  return (afterItems || []).filter((item) => !before.has(signature(item)));
}

function delta(before, after) {
  return {
    stageChildDelta: (after?.stageChildren?.length || 0) - (before?.stageChildren?.length || 0),
    windowLayerChildDelta: (after?.windowLayer?.childCount || 0) - (before?.windowLayer?.childCount || 0),
    windowChildrenDelta: (after?.windowChildren?.length || 0) - (before?.windowChildren?.length || 0),
    tipLikeDelta: (after?.tipLike?.length || 0) - (before?.tipLike?.length || 0),
    newWindowChildren: newItems(before?.windowChildren, after?.windowChildren).slice(0, 8).map((item) => ({
      path: item.path,
      label: item.label,
      text: item.text
    })),
    newTipLike: newItems(before?.tipLike, after?.tipLike).slice(0, 8).map((item) => ({
      path: item.path,
      label: item.label,
      text: item.text
    }))
  };
}

function positiveDelta(d) {
  return (d?.stageChildDelta || 0) > 0 ||
    (d?.windowLayerChildDelta || 0) > 0 ||
    (d?.windowChildrenDelta || 0) > 0 ||
    (d?.tipLikeDelta || 0) > 0 ||
    (d?.newWindowChildren?.length || 0) > 0 ||
    (d?.newTipLike?.length || 0) > 0;
}

function sampleSummary(candidates, samples, cleanup) {
  return {
    scene: candidates?.scene?.sceneName || candidates?.scene?.className || "",
    candidates: candidates?.candidates?.length || 0,
    sampledTargets: samples.length,
    cdpHoverOk: samples.filter((sample) => sample.dispatch?.hover?.ok === true).length,
    cdpHoverTimeouts: samples.filter((sample) => sample.dispatch?.hover?.ok === false).length,
    directOk: samples.filter((sample) => sample.direct?.ok === true && sample.direct?.mouseOver?.ok === true).length,
    cdpDeltaObserved: samples.some((sample) => positiveDelta(sample.cdpDelta)),
    directDeltaObserved: samples.some((sample) => positiveDelta(sample.directDelta)),
    cleanupOk: cleanup?.ok === true,
    sampledTexts: samples.map((sample) => sample.target?.text || sample.target?.label || "").filter(Boolean).slice(0, 24)
  };
}

function readmeText(payload) {
  const observed = payload.summary?.cdpDeltaObserved === true;
  const lines = [];
  lines.push("# Runtime Hover Stage Delta Sample");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Scene: ${payload.summary?.scene || payload.candidates.scene?.sceneName || payload.candidates.scene?.className || ""}`);
  lines.push(`- Candidates: ${payload.summary?.candidates ?? payload.candidates.candidates?.length ?? 0}`);
  lines.push(`- Sampled targets: ${payload.summary?.sampledTargets ?? payload.samples.length}`);
  lines.push(`- CDP hover ok/timeouts: ${payload.summary?.cdpHoverOk ?? 0}/${payload.summary?.cdpHoverTimeouts ?? 0}`);
  lines.push(`- Direct hover ok: ${payload.summary?.directOk ?? 0}`);
  lines.push(`- Stage/window/tip delta observed: ${observed}`);
  lines.push("");
  lines.push("This sample only sends CDP `Input.dispatchMouseEvent` with `type=mouseMoved`. It does not click, confirm, start battle, discard, use skills, buy, refresh, or read hidden hand fields.");
  lines.push("");
  lines.push("## Targets");
  lines.push("");
  for (const [index, sample] of payload.samples.entries()) {
    const target = sample.target || {};
    const d = sample.cdpDelta || {};
    const direct = sample.directDelta || {};
    lines.push(`- ${index + 1}. score=${target.score ?? ""} ${target.path || ""} ${target.label || ""} text=${target.text || ""} cdpOk=${sample.dispatch?.hover?.ok === true} stageChild=${d.stageChildDelta || 0} windowLayerChild=${d.windowLayerChildDelta || 0} tipLike=${d.tipLikeDelta || 0} newTips=${d.newTipLike?.length || 0} directTipLike=${direct.tipLikeDelta || 0}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function dispatchMouse(session, params, timeoutMs = 2500) {
  try {
    await session.send("Input.dispatchMouseEvent", params, timeoutMs);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function main() {
  const candidateLimit = Number(process.env.SGS_HOVER_STAGE_CANDIDATES || 24);
  const sampleLimit = Number(process.env.SGS_HOVER_STAGE_SAMPLES || 8);
  const sampleOffset = Number(process.env.SGS_HOVER_STAGE_OFFSET || 0);
  const settleMs = Number(process.env.SGS_HOVER_STAGE_SETTLE_MS || 650);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });

  const target = await selectSgsTarget();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    await session.send("Runtime.enable");
    await session.send("Page.bringToFront").catch(() => {});
    const install = await evaluate(session, helperExpression());
    const candidates = await evaluate(session, candidatesExpression(candidateLimit));
    const canvas = candidates.canvas || {};
    const outsideX = Math.max(1, Math.min(Number(canvas.right || 12) - 2, Number(canvas.left || 0) + 2));
    const outsideY = Math.max(1, Math.min(Number(canvas.bottom || 12) - 2, Number(canvas.top || 0) + 2));
    const samples = [];
    for (const targetNode of (candidates.candidates || []).slice(sampleOffset, sampleOffset + sampleLimit)) {
      const pageX = Number(targetNode.pageBounds?.centerX);
      const pageY = Number(targetNode.pageBounds?.centerY);
      if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) continue;
      const outsideBefore = await dispatchMouse(session, { type: "mouseMoved", x: outsideX, y: outsideY, buttons: 0, pointerType: "mouse" });
      await sleep(180);
      const before = await evaluate(session, snapshotExpression("before"));
      const hover = await dispatchMouse(session, { type: "mouseMoved", x: pageX, y: pageY, buttons: 0, pointerType: "mouse" });
      if (hover.ok) await sleep(settleMs);
      else await sleep(120);
      const after = await evaluate(session, snapshotExpression("afterCdpHover"));
      const direct = targetNode.gid == null
        ? { ok: false, error: "missing gid" }
        : await evaluate(session, directHoverExpression(targetNode.gid, Math.max(280, Math.floor(settleMs / 2))));
      const outsideAfter = await dispatchMouse(session, { type: "mouseMoved", x: outsideX, y: outsideY, buttons: 0, pointerType: "mouse" });
      await sleep(220);
      const afterOut = await evaluate(session, snapshotExpression("afterOut"));
      samples.push({
        target: targetNode,
        move: { pageX, pageY, outsideX, outsideY },
        dispatch: { outsideBefore, hover, outsideAfter },
        before,
        after,
        direct,
        afterOut,
        cdpDelta: delta(before, after),
        directDelta: delta(direct?.before, direct?.afterMouseOver),
        cleanupDelta: delta(before, afterOut)
      });
    }
    const cleanup = await evaluate(session, cleanupExpression());
    const summary = sampleSummary(candidates, samples, cleanup);
    const payload = { target, install, candidates, selection: { sampleOffset, sampleLimit }, summary, samples, cleanup };
    await writeJson(path.join(dir, "hover-stage-delta-sample.json"), payload);
    await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
    console.log(JSON.stringify({
      dir,
      scene: candidates.scene ? { sceneName: candidates.scene.sceneName, className: candidates.scene.className, ctor: candidates.scene.ctor } : null,
      candidates: candidates.candidates?.length || 0,
      sampleOffset,
      samples: samples.length,
      observed: samples.some((sample) => {
        const d = sample.cdpDelta || {};
        return d.stageChildDelta > 0 || d.windowLayerChildDelta > 0 || d.windowChildrenDelta > 0 || d.tipLikeDelta > 0 || d.newWindowChildren?.length || d.newTipLike?.length;
      }),
      deltas: samples.map((sample) => ({
        target: sample.target?.path || "",
        text: sample.target?.text || "",
        cdpDelta: sample.cdpDelta
      })),
      cleanup
    }, null, 2));
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
