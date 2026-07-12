import { createHash } from "node:crypto";
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
    process.env.SGS_ROGUE_CURRENT_ACTION_HANDLER_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-current-action-handler-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashSource(source) {
  return source ? createHash("sha1").update(source).digest("hex").slice(0, 16) : "";
}

function compactSource(source, max = 420) {
  return String(source || "").replace(/\s+/g, " ").slice(0, max);
}

function classifyText(text) {
  const value = String(text || "");
  const tags = [];
  if (/buy|Buy|pay|Pay|shop|Shop|refresh|Refresh|YuanBao|Recharge|充值|购买|刷新/.test(value)) tags.push("purchase-risk");
  if (/send|Send|Req|Ntf|proxy\.L|\.L\(|Client|confirm|Confirm|确定|发送|请求/.test(value)) tags.push("send-or-confirm-path");
  if (/auto|Auto|自动/.test(value)) tags.push("automation-path");
  if (/skill|Skill|spell|Spell|技能|战法|乱击|丰饶/.test(value)) tags.push("skill");
  if (/card|Card|牌|弃|选/.test(value)) tags.push("card-selection");
  if (/mouse|Mouse|over|Over|tip|Tip|tooltip|ToolTip|悬浮/.test(value)) tags.push("hover-tooltip");
  if (/leave|Leave|Back|Quit|Restart|返回|退出|重开/.test(value)) tags.push("leave-or-restart");
  if (!tags.length) tags.push("ui-event");
  return Array.from(new Set(tags));
}

function inspectExpression() {
  return String.raw`(() => {
    const blockedKey = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
    const interestingField = /(skill|Skill|spell|Spell|card|Card|select|Select|auto|Auto|button|Button|btn|Btn|click|Click|handler|Handler|event|Event|state|State|phase|Phase|tip|Tip|tooltip|ToolTip|text|Text|name|Name|id|ID|confirm|Confirm|send|Send|use|Use|discard|Discard|enabled|Enabled|round|Round)/;
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
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
    const textOf = (node) => {
      try {
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.innerHTML === "string") return node.innerHTML;
        if (typeof node?._innerHTML === "string") return node._innerHTML;
      } catch {}
      return "";
    };
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length, sourcePreview: String(value).replace(/\s+/g, " ").slice(0, 180) };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 5).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 12).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 12).map(String) };
      const keys = own(value).filter((key) => !blockedKey.test(key)).slice(0, 20);
      const out = { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (node) => {
      const fields = {};
      for (const key of own(node).slice(0, 900)) {
        if (blockedKey.test(key) || !interestingField.test(key)) continue;
        try { fields[key] = simple(node[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= 40) break;
      }
      return fields;
    };
    const methodOwnerLabel = (handler) => {
      const caller = handler && handler.caller;
      return caller ? labelOf(caller) || ctor(caller) : "";
    };
    const summarizeHandler = (handler) => {
      const method = handler && handler.method;
      const source = typeof method === "function" ? String(method) : "";
      return {
        handlerCtor: ctor(handler),
        callerLabel: methodOwnerLabel(handler),
        callerClassName: handler?.caller?._className_ || "",
        callerCtor: ctor(handler?.caller),
        methodName: method && method.name || "",
        methodArity: method && method.length,
        once: handler && handler.once === true,
        args: Array.isArray(handler?.args) ? handler.args.slice(0, 6).map((arg) => simple(arg, 1)) : simple(handler?.args, 1),
        source
      };
    };
    const eventSummary = (node) => {
      const events = node && node._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 80)) {
        if (!/(click|mouse|over|out|down|up|move|select|change|touch|tap|skill|card|endSkill|CLEAR_SKILL_TIPS|SELECT)/i.test(key)) continue;
        try {
          const raw = events[key];
          const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
          out[key] = handlers.filter(Boolean).map(summarizeHandler).slice(0, 10);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        return p ? { x: p.x, y: p.y, width: Number(node.width) || 0, height: Number(node.height) || 0 } : null;
      } catch {
        return null;
      }
    };
    const walk = (root, visitor, nodePath, depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 13) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childName + "#" + i, depth + 1, seen);
      }
    };
    const stageChildren = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, index) => Laya.stage.getChildAt(index));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (effectiveVisible(candidate)) { currentScene = candidate; break; }
      }
    }
    const manager = currentScene && currentScene.manager || null;
    const nodes = [];
    const roots = [
      { node: currentScene, path: "CurrentScene" },
      { node: windowLayer, path: "WindowLayer" }
    ];
    for (const root of roots) {
      walk(root.node, (node, nodePath, depth) => {
        if (!effectiveVisible(node)) return;
        const label = labelOf(node);
        const text = textOf(node);
        const fields = safeFields(node);
        const events = eventSummary(node);
        const eventKeys = Object.keys(events);
        const hay = [nodePath, label, text, Object.keys(fields).join(" "), eventKeys.join(" ")].join(" ");
        if (!eventKeys.length && !/(skill|Skill|spell|Spell|card|Card|select|Select|button|Button|btn|Btn|Rogue|NBi|pBt|uBt|fHt|_6i|tU|SgsTabButton|GameResult|Window|确认|确定|出牌|弃牌|技能|战法|牌)/.test(hay)) return;
        nodes.push({
          path: nodePath,
          depth,
          label,
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          sceneName: node.sceneName || node.SceneName || "",
          uiid: node._uiid || "",
          resName: node._resName || "",
          text,
          visible: node.visible,
          alpha: node.alpha,
          effectiveVisible: true,
          bounds: boundsOf(node),
          childCount: node.numChildren || 0,
          fields,
          events
        });
      }, root.path);
    }
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      resourceVersion: window.resourceVersion || "",
      layaVersion: Laya.version || "",
      currentScene: currentScene ? {
        label: labelOf(currentScene),
        ctor: ctor(currentScene),
        className: currentScene._className_ || "",
        sceneName: currentScene.sceneName || currentScene.SceneName || "",
        childCount: currentScene.numChildren || 0
      } : null,
      manager: manager ? {
        ctor: ctor(manager),
        seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
        selfSeatIndex: Number.isInteger(manager.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager.SelfSeatIndex) ? manager.SelfSeatIndex : null,
        isGameOver: manager.isGameOver === true,
        gameRound: manager.gameRound,
        gameTurn: manager.gameTurn,
        currentRoundSeatID: manager.currentRoundSeatID
      } : null,
      stageChildren: stageChildren.map((node, index) => ({ index, label: labelOf(node), childCount: node && node.numChildren || 0, effectiveVisible: effectiveVisible(node) })),
      nodes,
      safety: {
        readOnly: true,
        clicked: false,
        calledAction: false,
        purchaseCallsMade: false,
        hiddenOpponentHandRead: false,
        note: "Read-only current Rogue action handler report. Hidden hand/watch fields are filtered by key."
      }
    };
  })()`;
}

function enrich(report) {
  const rows = [];
  const actionNodeTypeCounts = {};
  const tagCounts = {};
  let eventHandlerCount = 0;
  let purchaseRiskHandlers = 0;
  let sendOrConfirmHandlers = 0;
  for (const node of report.nodes || []) {
    const hay = [node.path, node.label, node.text, Object.keys(node.fields || {}).join(" "), Object.keys(node.events || {}).join(" ")].join(" ");
    const nodeTags = classifyText(hay);
    for (const tag of nodeTags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    const type = nodeTags.includes("skill") ? "skill" :
      nodeTags.includes("card-selection") ? "card-selection" :
      nodeTags.includes("hover-tooltip") ? "hover-tooltip" :
      nodeTags.includes("leave-or-restart") ? "leave-or-restart" :
      nodeTags.includes("send-or-confirm-path") ? "send-or-confirm" :
      "ui-event";
    actionNodeTypeCounts[type] = (actionNodeTypeCounts[type] || 0) + 1;
    const events = {};
    for (const [eventName, handlers] of Object.entries(node.events || {})) {
      events[eventName] = (Array.isArray(handlers) ? handlers : []).map((handler) => {
        const source = handler.source || "";
        const text = `${eventName} ${handler.methodName || ""} ${handler.callerLabel || ""} ${source}`;
        const tags = classifyText(text);
        eventHandlerCount += 1;
        if (tags.includes("purchase-risk")) purchaseRiskHandlers += 1;
        if (tags.includes("send-or-confirm-path")) sendOrConfirmHandlers += 1;
        return {
          ...handler,
          sourceHash: hashSource(source),
          sourceLength: source.length,
          sourcePreview: compactSource(source, 520),
          source: undefined,
          tags
        };
      });
    }
    rows.push({
      ...node,
      nodeTags,
      nodeType: type,
      events
    });
  }
  return {
    ...report,
    nodes: rows,
    summary: {
      scene: report.currentScene?.sceneName || report.currentScene?.className || "",
      managerCtor: report.manager?.ctor || "",
      isGameOver: report.manager?.isGameOver === true,
      nodeCount: rows.length,
      eventNodeCount: rows.filter((node) => Object.keys(node.events || {}).length).length,
      eventHandlerCount,
      purchaseRiskHandlers,
      sendOrConfirmHandlers,
      actionNodeTypeCounts,
      tagCounts,
      topTexts: rows
        .map((node) => node.text)
        .filter(Boolean)
        .slice(0, 30)
    }
  };
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function readmeText(report) {
  const s = report.summary || {};
  const lines = [];
  lines.push("# Rogue Current Action Handler Report");
  lines.push("");
  lines.push(`- Captured: ${report.time}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${report.resourceVersion || ""}`);
  lines.push(`- Laya: ${report.layaVersion || ""}`);
  lines.push(`- Scene: ${s.scene}; manager=${s.managerCtor}; isGameOver=${s.isGameOver}`);
  lines.push(`- Action nodes: ${s.nodeCount}; event nodes: ${s.eventNodeCount}; event handlers: ${s.eventHandlerCount}`);
  lines.push(`- Send/confirm handlers: ${s.sendOrConfirmHandlers}; purchase-risk handlers: ${s.purchaseRiskHandlers}`);
  lines.push(`- Node types: ${Object.entries(s.actionNodeTypeCounts || {}).map(([key, count]) => `${key}:${count}`).join(",") || "(none)"}`);
  lines.push("");
  lines.push("This report is read-only. It records current visible Laya nodes, event handlers, and handler source previews without clicking, confirming, using skills, discarding, buying, refreshing, or reading hidden opponent hand fields.");
  lines.push("");
  lines.push("## High-Value Nodes");
  lines.push("");
  lines.push("| Path | Type | Text | Events | Handler tags |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const node of report.nodes.slice(0, 80)) {
    const handlerTags = Object.values(node.events || {})
      .flat()
      .flatMap((handler) => handler.tags || []);
    lines.push(`| \`${node.path}\` | ${node.nodeType} | ${tsvEscape(node.text)} | ${Object.keys(node.events || {}).join(",") || "(none)"} | ${Array.from(new Set(handlerTags)).join(",") || "(none)"} |`);
  }
  lines.push("");
  lines.push("## Handler Source Preview");
  lines.push("");
  for (const node of report.nodes.slice(0, 45)) {
    const eventEntries = Object.entries(node.events || {});
    if (!eventEntries.length) continue;
    lines.push(`### ${node.path}`);
    lines.push("");
    lines.push(`- label: \`${node.label}\`; text: ${node.text || "(none)"}; type: ${node.nodeType}`);
    for (const [eventName, handlers] of eventEntries) {
      for (const handler of handlers.slice(0, 4)) {
        lines.push(`- ${eventName}: caller=\`${handler.callerLabel || ""}\`; method=\`${handler.methodName || ""}\`; tags=${(handler.tags || []).join(",") || "(none)"}; hash=\`${handler.sourceHash || ""}\`; source=\`${tsvEscape(handler.sourcePreview || "")}\``);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const raw = await evaluateOnSgs(inspectExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const report = enrich(raw.value);
  await writeJson(path.join(dir, "rogue-current-action-handler-report.json"), report);
  await writeFile(path.join(dir, "README.md"), readmeText(report), "utf8");

  const nodeHeader = ["path", "nodeType", "label", "text", "eventNames", "nodeTags"];
  const nodeLines = [nodeHeader.join("\t")];
  for (const node of report.nodes) {
    nodeLines.push([
      node.path,
      node.nodeType,
      node.label,
      node.text,
      Object.keys(node.events || {}).join("|"),
      node.nodeTags
    ].map(tsvEscape).join("\t"));
  }
  await writeFile(path.join(dir, "action-nodes.tsv"), `${nodeLines.join("\n")}\n`, "utf8");

  const handlerHeader = ["nodePath", "nodeText", "eventName", "callerLabel", "methodName", "tags", "sourceHash", "sourcePreview"];
  const handlerLines = [handlerHeader.join("\t")];
  for (const node of report.nodes) {
    for (const [eventName, handlers] of Object.entries(node.events || {})) {
      for (const handler of handlers || []) {
        handlerLines.push([
          node.path,
          node.text,
          eventName,
          handler.callerLabel,
          handler.methodName,
          handler.tags,
          handler.sourceHash,
          handler.sourcePreview
        ].map(tsvEscape).join("\t"));
      }
    }
  }
  await writeFile(path.join(dir, "event-handlers.tsv"), `${handlerLines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    dir,
    scene: report.summary.scene,
    isGameOver: report.summary.isGameOver,
    nodeCount: report.summary.nodeCount,
    eventNodeCount: report.summary.eventNodeCount,
    eventHandlerCount: report.summary.eventHandlerCount,
    sendOrConfirmHandlers: report.summary.sendOrConfirmHandlers,
    purchaseRiskHandlers: report.summary.purchaseRiskHandlers,
    actionNodeTypeCounts: report.summary.actionNodeTypeCounts,
    topTexts: report.summary.topTexts.slice(0, 12)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
