import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, selectSgsTarget, valueFromEvaluation } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_HOVER_HANDLER_FIELD_TRANSITION_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-hover-handler-field-transition-sample`)
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

function browserProbe(options) {
  return (async () => {
    const maxNodes = Number(options.maxNodes || 900);
    const sampleLimit = Number(options.sampleLimit || 8);
    const sampleOffset = Number(options.sampleOffset || 0);
    const waitMs = Number(options.waitMs || 450);
    const blockedKey = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
    const interestingField = /(skill|Skill|spell|Spell|card|Card|select|Select|auto|Auto|button|Button|btn|Btn|click|Click|handler|Handler|event|Event|state|State|phase|Phase|tip|Tip|tooltip|ToolTip|text|Text|name|Name|id|ID|confirm|Confirm|send|Send|use|Use|discard|Discard|enabled|Enabled|mouse|Mouse|over|Over|out|Out|hover|Hover|value|Value|selected|Selected|data|Data)/;
    const hoverMethod = /(show.*tip|tip.*handler|roll.*over|roll.*out|mouse.*over|mouse.*out|card.*tip|general.*tip|skill.*tip|ToolTip|AppToolTip|tipsRollOut|onMouse|onRoll)/i;
    const hoverEvent = /(mouseover|mouseout|rollover|rollout|mouse_over|mouse_out|roll_over|roll_out)/i;
    const tipLike = /(tip|tooltip|toolTip|ToolTip|SkillToolTip|SkillPopUp|popup|PopUp|AppToolTip|tips)/i;
    const ctor = (value) => { try { return value?.constructor?.name || ""; } catch { return ""; } };
    const own = (value) => { try { return Object.getOwnPropertyNames(value || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(`${label}:visible=false`);
        if (cur.alpha === 0) out.push(`${label}:alpha=0`);
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
    const safeValue = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length, sourcePreview: String(value).replace(/\s+/g, " ").slice(0, 220) };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 5).map((item) => safeValue(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 12).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 12).map(String) };
      const keys = own(value).filter((key) => !blockedKey.test(key)).slice(0, 16);
      const out = { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 6)) {
          try { out.values[key] = safeValue(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const fieldsOf = (node) => {
      const fields = {};
      for (const key of own(node).slice(0, 900)) {
        if (blockedKey.test(key) || !interestingField.test(key)) continue;
        try { fields[key] = safeValue(node[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= 60) break;
      }
      return fields;
    };
    const diffFields = (before, after) => {
      const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort();
      const out = [];
      for (const key of keys) {
        const oldValue = before?.[key];
        const newValue = after?.[key];
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
        out.push({ key, before: oldValue, after: newValue });
      }
      return out.slice(0, 80);
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 14 || seen.size > maxNodes) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child?.name || child?._className_ || child?.sceneName || child?.SceneName || ctor(child) || `#${i}`;
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
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        if (!p) return null;
        return { x: p.x, y: p.y, width: Number(node.width) || 0, height: Number(node.height) || 0 };
      } catch {
        return null;
      }
    };
    const canvasRect = () => {
      const canvas = document.querySelector("canvas");
      const rect = canvas?.getBoundingClientRect?.();
      if (!rect) return null;
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
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
      return { left, top, right, bottom, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    };
    const handlerSummary = (handler) => {
      const method = handler?.method;
      const source = typeof method === "function" ? String(method).replace(/\s+/g, " ") : "";
      return {
        handlerCtor: ctor(handler),
        callerLabel: handler?.caller ? labelOf(handler.caller) || ctor(handler.caller) : "",
        callerCtor: ctor(handler?.caller),
        methodName: method?.name || "",
        methodArity: method?.length,
        once: handler?.once === true,
        args: Array.isArray(handler?.args) ? handler.args.slice(0, 5).map((item) => safeValue(item, 1)) : safeValue(handler?.args, 1),
        sourcePreview: source.slice(0, 420),
        tags: [
          /show.*tip|tip|ToolTip|AppToolTip|SkillToolTip/i.test(source) ? "tooltip-path" : "",
          /selected|select|_selected|value/i.test(source) ? "selection-state" : "",
          /visible|alpha|addChild|removeChild|destroy|Close/i.test(source) ? "visibility-lifecycle" : "",
          /proxy\.L|send|Req|Ntf|confirm/i.test(source) ? "send-or-confirm-risk" : "",
          /buy|pay|shop|refresh|YuanBao|充值|购买|刷新/i.test(source) ? "purchase-risk" : ""
        ].filter(Boolean)
      };
    };
    const eventSummary = (node) => {
      const events = node?._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const key of own(events)) {
        if (!/(mouse|roll|over|out|tip|move)/i.test(key)) continue;
        try {
          const raw = events[key];
          const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
          out[key] = handlers.filter(Boolean).map(handlerSummary).slice(0, 12);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const methodKeys = (node) => {
      const out = [];
      const seen = new Set();
      for (let proto = Object.getPrototypeOf(node || {}); proto && proto !== Object.prototype && out.length < 30; proto = Object.getPrototypeOf(proto)) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          if (!hoverMethod.test(key)) continue;
          try {
            if (typeof node[key] === "function") out.push(key);
          } catch {}
        }
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
        text: textOf(node).slice(0, 240),
        visible: node?.visible,
        alpha: node?.alpha,
        effectiveVisible: effectiveVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        childCount: node?.numChildren || 0,
        stageBounds,
        pageBounds: toPageBounds(stageBounds),
        eventKeys: Object.keys(eventSummary(node)),
        methodKeys: methodKeys(node)
      };
    };
    const snapshot = (label) => {
      const scene = currentScene();
      const layer = windowLayer();
      const tips = [];
      const windows = [];
      let nodeCount = 0;
      walk(Laya.stage, (node, nodePath) => {
        nodeCount += 1;
        if (!effectiveVisible(node)) return;
        const hay = [nodePath, labelOf(node), textOf(node)].join(" ");
        if (/Window|WindowLayer|mWt/.test(hay)) {
          windows.push(nodeSummary(node, nodePath));
        }
        if (tipLike.test(hay)) {
          tips.push(nodeSummary(node, nodePath));
        }
      });
      return {
        label,
        time: new Date().toISOString(),
        nodeCount,
        scene: scene ? nodeSummary(scene, "currentScene") : null,
        stageChildren: Laya.stage?.numChildren || 0,
        windowLayerChildren: layer?.numChildren || 0,
        tips: tips.slice(0, 120),
        windows: windows.slice(0, 120)
      };
    };
    const findByGid = (gid) => {
      let found = null;
      walk(Laya.stage, (node) => {
        if (!found && node?.$_GID === gid) found = node;
      });
      return found;
    };
    const scoreTarget = (summary, events, methodNames) => {
      const hay = [summary.path, summary.label, summary.text, summary.eventKeys.join(" "), methodNames.join(" ")].join(" ");
      let score = 0;
      if (Object.keys(events).some((key) => hoverEvent.test(key))) score += 500;
      if (Object.values(events).flat().some((handler) => handler?.tags?.includes("tooltip-path"))) score += 360;
      if (methodNames.length) score += 180;
      if (/Skill|skill|Card|card|General|general|Rogue|rogue|战法|技能|牌/.test(hay)) score += 120;
      if (/Tip|tip|ToolTip|Tooltip|Pop|Window/.test(hay)) score += 80;
      if (summary.text) score += 20;
      if ((summary.width || 0) > 700 || (summary.height || 0) > 500) score -= 120;
      if ((summary.width || 0) < 8 || (summary.height || 0) < 8) score -= 50;
      return score;
    };
    const candidates = () => {
      const roots = [
        { node: windowLayer(), path: "WindowLayer" },
        { node: currentScene(), path: "CurrentScene" }
      ];
      const out = [];
      for (const root of roots) {
        walk(root.node, (node, nodePath) => {
          if (!effectiveVisible(node)) return;
          const summary = nodeSummary(node, nodePath);
          if (!summary.pageBounds || summary.pageBounds.width < 4 || summary.pageBounds.height < 4) return;
          const events = eventSummary(node);
          const eventKeys = Object.keys(events);
          const methods = methodKeys(node);
          if (!eventKeys.some((key) => hoverEvent.test(key)) && !methods.length) return;
          const score = scoreTarget(summary, events, methods);
          if (score <= 0) return;
          out.push({ score, ...summary, events, methodKeys: methods });
        }, root.path);
      }
      out.sort((a, b) => b.score - a.score || (a.pageBounds.width * a.pageBounds.height) - (b.pageBounds.width * b.pageBounds.height));
      return out;
    };
    const safety = {
      proxyLBlockedCalls: [],
      installed: [],
      errors: []
    };
    const restoreFns = [];
    const installBlocker = () => {
      try {
        const proxyObj = globalThis.proxy;
        if (proxyObj && typeof proxyObj.L === "function" && !proxyObj.L.__codexHoverBlocked) {
          const old = proxyObj.L;
          const wrapped = function (...args) {
            safety.proxyLBlockedCalls.push({
              args: args.map((item) => safeValue(item, 1)),
              stack: String(new Error().stack || "").split("\n").slice(0, 6).join("\n")
            });
            return undefined;
          };
          wrapped.__codexHoverBlocked = true;
          proxyObj.L = wrapped;
          safety.installed.push("proxy.L");
          restoreFns.push(() => { proxyObj.L = old; });
        }
      } catch (error) {
        safety.errors.push(String(error?.message || error));
      }
    };
    const restore = () => {
      for (const fn of restoreFns.reverse()) {
        try { fn(); } catch (error) { safety.errors.push(String(error?.message || error)); }
      }
    };
    const makeEvent = (type, node) => {
      try {
        const event = new Laya.Event();
        if (typeof event.setTo === "function") event.setTo(type, node, node);
        else {
          event.type = type;
          event.target = node;
          event.currentTarget = node;
        }
        return event;
      } catch {
        return { type, target: node, currentTarget: node };
      }
    };
    const sampleOne = async (candidate) => {
      const node = findByGid(candidate.gid);
      const result = {
        target: candidate,
        found: !!node,
        beforeFields: null,
        afterOverFields: null,
        afterOutFields: null,
        overFieldChanges: [],
        outFieldChanges: [],
        beforeSnapshot: null,
        afterOverSnapshot: null,
        afterOutSnapshot: null,
        mouseOver: null,
        mouseOut: null
      };
      if (!node) return result;
      result.beforeFields = fieldsOf(node);
      result.beforeSnapshot = snapshot("before-hover");
      try {
        node.event(Laya.Event.MOUSE_OVER, [makeEvent(Laya.Event.MOUSE_OVER, node)]);
        result.mouseOver = { ok: true, event: Laya.Event.MOUSE_OVER };
      } catch (error) {
        result.mouseOver = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      result.afterOverFields = fieldsOf(node);
      result.afterOverSnapshot = snapshot("after-mouse-over");
      try {
        node.event(Laya.Event.MOUSE_OUT, [makeEvent(Laya.Event.MOUSE_OUT, node)]);
        result.mouseOut = { ok: true, event: Laya.Event.MOUSE_OUT };
      } catch (error) {
        result.mouseOut = { ok: false, error: String(error?.message || error) };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(200, Math.floor(waitMs / 2))));
      result.afterOutFields = fieldsOf(node);
      result.afterOutSnapshot = snapshot("after-mouse-out");
      result.overFieldChanges = diffFields(result.beforeFields, result.afterOverFields);
      result.outFieldChanges = diffFields(result.afterOverFields, result.afterOutFields);
      return result;
    };
    installBlocker();
    try {
      const found = candidates();
      const selected = found.slice(sampleOffset, sampleOffset + sampleLimit);
      const samples = [];
      for (const candidate of selected) {
        samples.push(await sampleOne(candidate));
      }
      const positiveDelta = (before, after) => ({
        stageChildDelta: (after?.stageChildren || 0) - (before?.stageChildren || 0),
        windowLayerChildDelta: (after?.windowLayerChildren || 0) - (before?.windowLayerChildren || 0),
        tipDelta: (after?.tips?.length || 0) - (before?.tips?.length || 0),
        windowDelta: (after?.windows?.length || 0) - (before?.windows?.length || 0),
        newTips: (after?.tips || []).filter((tip) => !(before?.tips || []).some((oldTip) => oldTip.gid === tip.gid)).slice(0, 12),
        newWindows: (after?.windows || []).filter((win) => !(before?.windows || []).some((oldWin) => oldWin.gid === win.gid)).slice(0, 12)
      });
      const enrichedSamples = samples.map((sample) => ({
        ...sample,
        overDelta: positiveDelta(sample.beforeSnapshot, sample.afterOverSnapshot),
        cleanupDelta: positiveDelta(sample.beforeSnapshot, sample.afterOutSnapshot)
      }));
      return {
        ok: true,
        capturedAt: new Date().toISOString(),
        page: { title: document.title, url: location.href },
        runtime: {
          resourceVersion: window.resourceVersion || "",
          layaVersion: Laya.version || "",
          stage: { width: Laya.stage?.width, height: Laya.stage?.height, children: Laya.stage?.numChildren },
          scene: currentScene() ? nodeSummary(currentScene(), "currentScene") : null
        },
        safety,
        selection: { sampleOffset, sampleLimit },
        candidates: found.slice(0, 40),
        samples: enrichedSamples
      };
    } finally {
      restore();
    }
  })();
}

function probeExpression(options) {
  return `(${browserProbe.toString()})(${JSON.stringify(options)})`;
}

function readmeText(payload) {
  const samples = payload.value?.samples || [];
  const positive = samples.filter((sample) =>
    (sample.overFieldChanges?.length || 0) > 0 ||
    (sample.outFieldChanges?.length || 0) > 0 ||
    (sample.overDelta?.tipDelta || 0) > 0 ||
    (sample.overDelta?.windowLayerChildDelta || 0) > 0 ||
    (sample.overDelta?.stageChildDelta || 0) > 0 ||
    (sample.overDelta?.newTips?.length || 0) > 0
  );
  const lines = [
    "# Hover Handler Field Transition Sample",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Target: ${payload.target?.url || ""}`,
    `- Scene: ${payload.value?.runtime?.scene?.label || ""}`,
    `- Candidates: ${payload.value?.candidates?.length || 0}`,
    `- Sample offset: ${payload.value?.selection?.sampleOffset || 0}`,
    `- Sampled targets: ${samples.length}`,
    `- Targets with field or visible-node delta: ${positive.length}`,
    `- proxy.L blocked calls: ${payload.value?.safety?.proxyLBlockedCalls?.length || 0}`,
    "",
    "This sample dispatches only Laya `MOUSE_OVER` and `MOUSE_OUT` on visible hover-capable nodes. It does not click, confirm, start battle, discard, use skills, buy, refresh, or read hidden hand fields.",
    "",
    "## Samples",
    "",
    ...samples.map((sample, index) => {
      const target = sample.target || {};
      return `- ${index + 1}. score=${target.score ?? ""} ${target.path || ""} | ${target.label || ""} | text=${target.text || ""} | overOk=${sample.mouseOver?.ok === true} outOk=${sample.mouseOut?.ok === true} overFields=${sample.overFieldChanges?.length || 0} outFields=${sample.outFieldChanges?.length || 0} tipDelta=${sample.overDelta?.tipDelta || 0} windowLayerDelta=${sample.overDelta?.windowLayerChildDelta || 0} stageDelta=${sample.overDelta?.stageChildDelta || 0}`;
    })
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const target = await selectSgsTarget();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    await session.send("Runtime.enable");
    const value = await evaluate(
      session,
      probeExpression({
        maxNodes: Number(process.env.SGS_HOVER_HANDLER_MAX_NODES || 900),
        sampleLimit: Number(process.env.SGS_HOVER_HANDLER_SAMPLES || 1),
        sampleOffset: Number(process.env.SGS_HOVER_HANDLER_OFFSET || 0),
        waitMs: Number(process.env.SGS_HOVER_HANDLER_WAIT_MS || 450)
      }),
      Number(process.env.SGS_HOVER_HANDLER_TIMEOUT_MS || 60000)
    );
    const dir = outputDir();
    await mkdir(dir, { recursive: true });
    const payload = { target, value };
    await writeJson(path.join(dir, "hover-handler-field-transition-sample.json"), payload);
    await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
    console.log(JSON.stringify({
      output: dir,
      scene: value?.runtime?.scene?.label || "",
      candidates: value?.candidates?.length || 0,
      sampleOffset: value?.selection?.sampleOffset || 0,
      samples: value?.samples?.length || 0,
      fieldDeltaTargets: (value?.samples || []).filter((sample) => (sample.overFieldChanges?.length || 0) > 0 || (sample.outFieldChanges?.length || 0) > 0).length,
      visibleDeltaTargets: (value?.samples || []).filter((sample) => (sample.overDelta?.tipDelta || 0) > 0 || (sample.overDelta?.windowLayerChildDelta || 0) > 0 || (sample.overDelta?.stageChildDelta || 0) > 0).length,
      proxyLBlockedCalls: value?.safety?.proxyLBlockedCalls?.length || 0
    }, null, 2));
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
