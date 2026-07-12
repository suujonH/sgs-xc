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
    process.env.SGS_CURRENT_WINDOW_ACTION_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-current-window-action-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectionExpression() {
  return String.raw`(() => {
    const blockedFieldPattern = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
    const purchasePattern = /buy|Buy|pay|Pay|recharge|Recharge|yuanbao|YuanBao|confirmBuy|shopBtnClick|refreshBtnClick|gotoPay|buyPorpItem/i;
    const closePattern = /(^|[^A-Za-z])(close|Close|back|Back|return|Return|cancel|Cancel|leave|Leave|返回|取消|关闭)([^A-Za-z]|$)/;
    const confirmPattern = /(^|[^A-Za-z])(confirm|Confirm|ensure|Ensure|ok|OK|startbtnClick|onClickChallenge|trueReq|继续|确定|确认|挑战|开始)([^A-Za-z]|$)/;
    const tooltipPattern = /tip|Tip|tooltip|ToolTip|over|Over|hover|Hover/i;
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
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
    const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const simple = (value, depth = 0) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 12).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 12).map(String) };
      const keys = own(value).filter((key) => !blockedFieldPattern.test(key)).slice(0, 24);
      const out = {
        kind: "object",
        ctor: ctor(value),
        name: value.name || "",
        className: value._className_ || "",
        sceneName: value.sceneName || value.SceneName || "",
        uiid: value._uiid || "",
        keys
      };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        if (!p) return null;
        return { x: p.x, y: p.y, width: node.width || 0, height: node.height || 0 };
      } catch {
        return null;
      }
    };
    const methodNames = (obj, pattern, limit = 80) => {
      const out = [];
      const seen = new Set();
      let proto = Object.getPrototypeOf(obj || {});
      while (proto && proto !== Object.prototype) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) out.push(key);
          } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return out.sort().slice(0, limit);
    };
    const safeFields = (node, limit = 40) => {
      const pattern = /(id|ID|name|Name|text|Text|title|Title|desc|Desc|btn|Btn|button|Button|click|Click|confirm|Confirm|cancel|Cancel|close|Close|back|Back|return|Return|shop|Shop|buy|Buy|pay|Pay|tip|Tip|skill|Skill|card|Card|select|Select|state|State|status|Status|data|Data|effect|Effect|window|Window)/;
      const fields = {};
      for (const key of own(node).slice(0, 1200)) {
        if (blockedFieldPattern.test(key) || !pattern.test(key)) continue;
        try { fields[key] = simple(node[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= limit) break;
      }
      return fields;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const eventName of own(events).slice(0, 36)) {
        try {
          const raw = events[eventName];
          const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
          out[eventName] = handlers.filter(Boolean).map((handler) => ({
            caller: labelOf(handler.caller),
            callerCtor: ctor(handler.caller),
            method: handler.method && handler.method.name || "",
            once: handler.once === true,
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 4) : simple(handler.args)
          })).slice(0, 8);
        } catch {
          out[eventName] = "[throws]";
        }
      }
      return out;
    };
    const primitiveFieldValues = (fields) => Object.values(fields || {})
      .filter((item) => item == null || ["string", "number", "boolean"].includes(typeof item))
      .map(String)
      .join(" ");
    const eventMethodNames = (events) => Object.values(events || {})
      .flatMap((handlers) => Array.isArray(handlers) ? handlers : [])
      .map((handler) => handler.method || "")
      .filter(Boolean)
      .join(" ");
    const riskTags = (summary) => {
      const fieldKeys = Object.keys(summary.fields || {}).join(" ");
      const textHay = [summary.text, primitiveFieldValues(summary.fields)].join(" ");
      const methodHay = [(summary.methods || []).join(" "), eventMethodNames(summary.events)].join(" ");
      const structuralHay = [summary.path, summary.label, summary.className, summary.sceneName, fieldKeys, textHay, methodHay].join(" ");
      const tags = [];
      if (purchasePattern.test(structuralHay)) tags.push("purchase-risk");
      if (closePattern.test([textHay, methodHay, fieldKeys.match(/\b(backBtn|backFunction|closeBtn|cancelBtn)\b/i)?.[0] || ""].join(" "))) tags.push("close-back");
      if (confirmPattern.test([textHay, methodHay].join(" "))) tags.push("confirm-action");
      if (tooltipPattern.test([fieldKeys, textHay, Object.keys(summary.events || {}).join(" ")].join(" "))) tags.push("tooltip-hover");
      if (/BlessTabBtn|SgsTabButton|\b(tab|Tab|page|Page|switch|Switch|btnList|TabBtn)\b/.test(structuralHay)) tags.push("navigation");
      if (/(^|[^A-Za-z])(card|Card|skill|Skill|select|Select|generalCard|SkillItem)([^A-Za-z]|$)/.test(structuralHay)) tags.push("card-skill-select");
      return tags;
    };
    const nodeSummary = (node, nodePath, includeMethods = false) => {
      const text = (() => {
        try {
          return [
            typeof node.text === "string" ? node.text : "",
            typeof node._text === "string" ? node._text : "",
            typeof node.label === "string" ? node.label : ""
          ].find(Boolean) || "";
        } catch {
          return "";
        }
      })();
      const summary = {
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
        effectiveVisible: isVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node && node.x,
        y: node && node.y,
        width: node && node.width || 0,
        height: node && node.height || 0,
        bounds: boundsOf(node),
        childCount: node && node.numChildren || 0,
        buttonMode: node && node.buttonMode === true,
        mouseEnabled: node && node.mouseEnabled,
        mouseThrough: node && node.mouseThrough,
        text,
        fields: safeFields(node),
        events: eventSummary(node),
        methods: includeMethods ? methodNames(node, /(enter|show|Show|hide|Hide|Close|close|click|Click|touch|Touch|confirm|Confirm|cancel|Cancel|back|Back|return|Return|start|Start|challenge|Challenge|select|Select|card|Card|skill|Skill|buy|Buy|pay|Pay|shop|Shop|refresh|Refresh|effect|Effect|tip|Tip|update|Update|layout|Layout|send|Send)/, 120) : []
      };
      summary.tags = riskTags(summary);
      return summary;
    };
    const walk = (root, visitor, nodePath, depth = 0, maxDepth = 16, seen = new Set()) => {
      if (!root || depth > maxDepth || seen.has(root)) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childLabel + "#" + i, depth + 1, maxDepth, seen);
      }
    };
    const stageChildren = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, index) => Laya.stage.getChildAt(index));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (isVisible(candidate)) { currentScene = candidate; break; }
      }
    }
    const manager = currentScene && (currentScene.manager || currentScene.gameManager || currentScene._manager || null);
    const windows = [];
    const buttonCandidates = [];
    const targetRoots = [];
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) {
        const child = windowLayer.getChildAt(i);
        targetRoots.push({ node: child, path: "WindowLayer#" + i });
      }
    }
    if (currentScene) targetRoots.push({ node: currentScene, path: "CurrentScene" });
    for (const root of targetRoots) {
      walk(root.node, (node, nodePath) => {
        const summary = nodeSummary(node, nodePath, /Window|Scene|View/.test(labelOf(node)));
        const label = summary.label;
        const fieldKeys = Object.keys(summary.fields || {}).join(" ");
        const eventKeys = Object.keys(summary.events || {}).join(" ");
        const hasClickEvent = /click|mousedown|mouseup|touch|change|selected/i.test(eventKeys);
        const buttonLike = summary.buttonMode || hasClickEvent || /(Button|Btn|hVi|SgsTabButton|btn|返回|确定|确认|继续|关闭|取消|挑战|开始)/i.test(label + " " + summary.text + " " + fieldKeys);
        const windowLike = /Window|View|Pop|Dialog|PWt|GameResult|Bless|QiFu|KanShu|YanJiao|GuanXing|QiXing/i.test(label + " " + summary.className + " " + summary.sceneName);
        if (windowLike && nodePath.startsWith("WindowLayer")) windows.push(summary);
        if (buttonLike && isVisible(node)) buttonCandidates.push(summary);
      }, root.path, 0, root.path === "CurrentScene" ? 10 : 14);
    }
    const tagCounts = {};
    for (const item of [...windows, ...buttonCandidates]) {
      for (const tag of item.tags || []) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      resourceVersion: window.resourceVersion || "",
      stage: {
        width: Laya.stage && Laya.stage.width,
        height: Laya.stage && Laya.stage.height,
        childCount: Laya.stage && Laya.stage.numChildren,
        childLabels: stageChildren.map((node, index) => ({ index, label: labelOf(node), childCount: node && node.numChildren || 0, effectiveVisible: isVisible(node) }))
      },
      currentScene: currentScene ? nodeSummary(currentScene, "CurrentScene", true) : null,
      manager: manager ? {
        ctor: ctor(manager),
        seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
        selfSeatIndex: Number.isInteger(manager.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager.SelfSeatIndex) ? manager.SelfSeatIndex : null,
        isGameOver: manager.isGameOver === true,
        fields: safeFields(manager, 50)
      } : null,
      windowLayer: windowLayer ? nodeSummary(windowLayer, "WindowLayer", false) : null,
      windows: windows.slice(0, 160),
      buttonCandidates: buttonCandidates
        .sort((a, b) => {
          const ar = a.tags.includes("purchase-risk") ? 1 : 0;
          const br = b.tags.includes("purchase-risk") ? 1 : 0;
          if (ar !== br) return ar - br;
          return (b.tags.length || 0) - (a.tags.length || 0);
        })
        .slice(0, 220),
      counts: {
        windows: windows.length,
        visibleWindows: windows.filter((item) => item.effectiveVisible).length,
        buttonCandidates: buttonCandidates.length,
        purchaseRiskButtons: buttonCandidates.filter((item) => item.tags.includes("purchase-risk")).length,
        closeBackButtons: buttonCandidates.filter((item) => item.tags.includes("close-back")).length,
        confirmActionButtons: buttonCandidates.filter((item) => item.tags.includes("confirm-action")).length,
        tooltipHoverButtons: buttonCandidates.filter((item) => item.tags.includes("tooltip-hover")).length,
        tagCounts
      },
      safety: {
        clicked: false,
        purchaseCallsMade: false,
        hiddenOpponentHandRead: false,
        note: "Read-only Laya.stage inspection; sensitive hand/watch/hidden fields are filtered by key."
      }
    };
  })()`;
}

function readmeText(value) {
  const counts = value.counts || {};
  const scene = value.currentScene?.sceneName || value.currentScene?.className || "";
  const lines = [];
  lines.push("# Current Window Action Surface Report");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Page: ${value.page?.title || ""} ${value.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${value.resourceVersion || ""}`);
  lines.push(`- Current scene: ${scene}`);
  lines.push(`- Manager: ${value.manager?.ctor || ""}; seats=${value.manager?.seatCount ?? ""}; selfSeatIndex=${value.manager?.selfSeatIndex ?? ""}; isGameOver=${value.manager?.isGameOver === true}`);
  lines.push(`- Window nodes: ${counts.windows || 0}; visible=${counts.visibleWindows || 0}`);
  lines.push(`- Button candidates: ${counts.buttonCandidates || 0}; purchaseRisk=${counts.purchaseRiskButtons || 0}; closeBack=${counts.closeBackButtons || 0}; confirmAction=${counts.confirmActionButtons || 0}; tooltipHover=${counts.tooltipHoverButtons || 0}`);
  lines.push("");
  lines.push("This report is read-only. It records visible Laya windows, button-like nodes, event bindings, method names, field summaries, and safety tags without clicking, confirming, buying, or reading hidden opponent hand fields.");
  lines.push("");
  lines.push("## Visible Window Roots");
  lines.push("");
  for (const item of (value.windows || []).filter((node) => node.effectiveVisible).slice(0, 80)) {
    const fields = Object.keys(item.fields || {}).slice(0, 8).join(",");
    lines.push(`- ${item.path} ${item.label} text=${item.text || ""} tags=${(item.tags || []).join(",") || "(none)"} fields=${fields}`);
  }
  lines.push("");
  lines.push("## Top Button Candidates");
  lines.push("");
  for (const item of (value.buttonCandidates || []).slice(0, 120)) {
    const eventNames = Object.keys(item.events || {}).slice(0, 8).join(",");
    const fieldKeys = Object.keys(item.fields || {}).slice(0, 8).join(",");
    lines.push(`- ${item.path} ${item.label} text=${item.text || ""} tags=${(item.tags || []).join(",") || "(none)"} events=${eventNames || "(none)"} fields=${fieldKeys || "(none)"}`);
  }
  lines.push("");
  lines.push("Safety classification is heuristic. Treat `purchase-risk` as a blocklist candidate until a source/live proof says otherwise.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectionExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  await writeJson(path.join(dir, "current-window-action-report.json"), result.value);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value.currentScene?.sceneName || result.value.currentScene?.className || null,
    windows: result.value.counts?.windows || 0,
    visibleWindows: result.value.counts?.visibleWindows || 0,
    buttonCandidates: result.value.counts?.buttonCandidates || 0,
    purchaseRiskButtons: result.value.counts?.purchaseRiskButtons || 0,
    closeBackButtons: result.value.counts?.closeBackButtons || 0,
    confirmActionButtons: result.value.counts?.confirmActionButtons || 0,
    tooltipHoverButtons: result.value.counts?.tooltipHoverButtons || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
