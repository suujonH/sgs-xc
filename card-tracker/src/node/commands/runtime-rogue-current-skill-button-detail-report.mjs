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
    process.env.SGS_ROGUE_CURRENT_SKILL_BUTTON_DETAIL_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-current-skill-button-detail-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashSource(source) {
  return source ? createHash("sha1").update(source).digest("hex").slice(0, 16) : "";
}

function compactSource(source, max = 720) {
  return String(source || "").replace(/\s+/g, " ").slice(0, max);
}

function classifySource(text) {
  const value = String(text || "");
  const tags = [];
  if (/LastActivateSpell|SpellTouch_ConfirmResult|BUTTON_OK|ConfirmResult/i.test(value)) tags.push("repeat-skill-confirm");
  if (/IsOpenAiAutoSelect|aiHelpOptDatas|outputAiHelp|CurStepHelpData|ClearSelfOpertate|AutoUse|AutoSelect|AutoSkip|自动/i.test(value)) tags.push("auto-select-skill");
  if (/EndSelector|SelectContext|CardSelector|SelectedChanged|SelectComplete|FirstSelectedCard/i.test(value)) tags.push("selector-state");
  if (/touchSkill|CardUI_TouchSkill|skill|Skill|spell|Spell|技能/i.test(value)) tags.push("skill-trigger");
  if (/UseHandCard|discard|Discard|btnDiscard|弃牌|出牌|CardUI|card|Card/i.test(value)) tags.push("card-ui-movement");
  if (/mouse|Mouse|ROLL_OVER|MOUSE_OVER|ToolTip|tooltip|Tip|phase|setStateChanged/i.test(value)) tags.push("hover-state");
  if (/proxy\.L|\.L\(|send|Send|Req|request|CLIENT|YSt|confirm|Confirm/i.test(value)) tags.push("send-or-confirm-source");
  if (/console\.log/i.test(value)) tags.push("debug-log-only");
  if (/buy|Buy|pay|Pay|shop|Shop|refresh|Refresh|充值|购买|元宝/i.test(value)) tags.push("purchase-risk");
  return Array.from(new Set(tags));
}

function enrich(report) {
  const methodRows = [];
  const eventRows = [];
  const autoEvidence = [];
  const skillButtonTexts = [];
  for (const node of report.nodes || []) {
    if (node.role === "skill-button" && node.text) skillButtonTexts.push(node.text);
    for (const method of node.methodSources || []) {
      const tags = classifySource(`${method.name} ${method.source || ""}`);
      const row = {
        nodePath: node.path,
        nodeRole: node.role,
        nodeText: node.text || "",
        owner: method.owner || "",
        methodName: method.name || "",
        sourceHash: hashSource(method.source),
        sourceLength: String(method.source || "").length,
        sourcePreview: compactSource(method.source),
        tags
      };
      methodRows.push(row);
      if (tags.some((tag) => ["repeat-skill-confirm", "auto-select-skill", "selector-state", "send-or-confirm-source"].includes(tag))) {
        autoEvidence.push(row);
      }
    }
    for (const [eventName, handlers] of Object.entries(node.events || {})) {
      for (const handler of handlers || []) {
        const tags = classifySource(`${eventName} ${handler.methodName || ""} ${handler.source || ""}`);
        eventRows.push({
          nodePath: node.path,
          nodeRole: node.role,
          nodeText: node.text || "",
          eventName,
          callerLabel: handler.callerLabel || "",
          methodName: handler.methodName || "",
          sourceHash: hashSource(handler.source),
          sourceLength: String(handler.source || "").length,
          sourcePreview: compactSource(handler.source),
          tags
        });
      }
    }
  }

  const tagCount = {};
  for (const row of [...methodRows, ...eventRows]) {
    for (const tag of row.tags || []) tagCount[tag] = (tagCount[tag] || 0) + 1;
  }

  return {
    ...report,
    methodRows,
    eventRows,
    autoEvidence,
    summary: {
      scene: report.currentScene?.sceneName || report.currentScene?.className || report.currentScene?.ctor || "",
      managerCtor: report.manager?.ctor || "",
      isGameOver: report.manager?.isGameOver === true,
      nodeCount: report.nodes?.length || 0,
      skillButtonCount: (report.nodes || []).filter((node) => node.role === "skill-button").length,
      skillButtonTexts: Array.from(new Set(skillButtonTexts)),
      currentPlayerAnchors: (report.nodes || []).filter((node) => node.role === "current-player-root").length,
      skillPanels: (report.nodes || []).filter((node) => node.role === "skill-panel").length,
      cardContainers: (report.nodes || []).filter((node) => node.role === "card-container").length,
      selectPanels: (report.nodes || []).filter((node) => node.role === "select-button-panel").length,
      methodRows: methodRows.length,
      eventRows: eventRows.length,
      autoEvidenceRows: autoEvidence.length,
      sendOrConfirmRows: [...methodRows, ...eventRows].filter((row) => row.tags?.includes("send-or-confirm-source")).length,
      debugLogRows: [...methodRows, ...eventRows].filter((row) => row.tags?.includes("debug-log-only")).length,
      purchaseRiskRows: [...methodRows, ...eventRows].filter((row) => row.tags?.includes("purchase-risk")).length,
      tagCount,
      hiddenOpponentHandRead: false,
      clicked: false,
      calledAction: false
    }
  };
}

function inspectExpression() {
  return String.raw`(() => {
    const blockedKey = /handCards|HandCards|cardsInHand|watchCards|WatchCards|hidden|password|token/i;
    const interestingField = /(skill|Skill|spell|Spell|card|Card|select|Select|auto|Auto|button|Button|btn|Btn|click|Click|handler|Handler|event|Event|state|State|phase|Phase|tip|Tip|tooltip|ToolTip|text|Text|label|Label|name|Name|id|ID|confirm|Confirm|send|Send|use|Use|discard|Discard|enabled|Enabled|round|Round|selector|Selector|context|Context|LastActivate|aiHelp|selected|Selected|NeedHalfShow|isHalfShow)/;
    const methodNamePattern = /(CardUI|TouchSkill|SelectedChanged|EndSkill|Touch|Skill|Spell|Select|Selector|AutoUse|AutoSelect|AutoSkip|AiHelp|Confirm|BUTTON_OK|EndSelector|ClearSelf|ApplyRound|resetAiHelp|outputAiHelp|UseHandCard|Discard|Cancel|AllSelect|UnSelect|Mouse|Roll|Tip|ToolTip|onClick|Click|onTouch|Ensure|Discard|Reset|Quick)/i;
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
        if (cur.destroyed) out.push(label + ":destroyed");
      }
      return out;
    };
    const effectiveVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const textOf = (node) => {
      try {
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.label === "string") return node.label;
        if (typeof node?._label === "string") return node._label;
        if (typeof node?.htmlText === "string") return node.htmlText;
        if (typeof node?._htmlText === "string") return node._htmlText;
      } catch {}
      return "";
    };
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length, sourcePreview: String(value).replace(/\s+/g, " ").slice(0, 220) };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 16).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 16).map(String) };
      const keys = own(value).filter((key) => !blockedKey.test(key)).slice(0, 28);
      const out = { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 10)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const fieldSnapshot = (node) => {
      const fields = {};
      for (const key of own(node).slice(0, 1100)) {
        if (blockedKey.test(key) || !interestingField.test(key)) continue;
        try { fields[key] = simple(node[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= 80) break;
      }
      return fields;
    };
    const methodOwnerLabel = (handler) => {
      const caller = handler && handler.caller;
      return caller ? labelOf(caller) || ctor(caller) : "";
    };
    const summarizeHandler = (handler) => {
      const method = handler && handler.method;
      const source = typeof method === "function" ? String(method).slice(0, 8000) : "";
      return {
        handlerCtor: ctor(handler),
        callerLabel: methodOwnerLabel(handler),
        callerClassName: handler?.caller?._className_ || "",
        callerCtor: ctor(handler?.caller),
        methodName: method && method.name || "",
        methodArity: method && method.length,
        once: handler && handler.once === true,
        args: Array.isArray(handler?.args) ? handler.args.slice(0, 5).map((arg) => simple(arg, 1)) : simple(handler?.args, 1),
        source
      };
    };
    const eventSummary = (node) => {
      const events = node && node._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 120)) {
        if (!/(click|mouse|over|out|down|up|move|select|change|touch|tap|skill|card|endSkill|CLEAR_SKILL_TIPS|SELECT|STATE_CHANGED|ONLINE_STATE_CHANGED|REFRESH_DEAL_CARD_DISPLAY|removed)/i.test(key)) continue;
        try {
          const raw = events[key];
          const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
          out[key] = handlers.filter(Boolean).map(summarizeHandler).slice(0, 14);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const methodSources = (node) => {
      const rows = [];
      const seen = new Set();
      const push = (owner, name, fn) => {
        if (seen.has(owner + "." + name) || typeof fn !== "function") return;
        const source = String(fn);
        if (!methodNamePattern.test(name) && !methodNamePattern.test(source)) return;
        seen.add(owner + "." + name);
        rows.push({ owner, name, arity: fn.length, source: source.slice(0, 10000) });
      };
      for (const key of own(node)) {
        try { push("own", key, node[key]); } catch {}
      }
      let proto = null;
      try { proto = Object.getPrototypeOf(node); } catch {}
      for (let depth = 0; proto && depth < 5; depth++, proto = Object.getPrototypeOf(proto)) {
        const owner = ctor(proto.constructor && proto.constructor.prototype === proto ? proto.constructor : proto) || ("prototype-" + depth);
        for (const key of own(proto)) {
          if (key === "constructor") continue;
          try { push(owner || ("prototype-" + depth), key, proto[key]); } catch {}
          if (rows.length >= 80) break;
        }
        if (rows.length >= 80) break;
      }
      return rows;
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        return p ? { x: p.x, y: p.y, width: Number(node.width) || 0, height: Number(node.height) || 0, localX: Number(node.x) || 0, localY: Number(node.y) || 0 } : null;
      } catch {
        return null;
      }
    };
    const parentChain = (node) => {
      const out = [];
      for (let cur = node; cur && out.length < 12; cur = cur.parent || cur._parent || null) {
        out.push({ label: labelOf(cur), ctor: ctor(cur), text: textOf(cur), name: cur.name || "", className: cur._className_ || "", sceneName: cur.sceneName || cur.SceneName || "" });
      }
      return out;
    };
    const dispatcherSummary = (node) => {
      const dispatcher = node && node.eventDispatcher;
      if (!dispatcher) return null;
      const events = dispatcher._events || dispatcher.events || null;
      return {
        ctor: ctor(dispatcher),
        keys: own(dispatcher).filter((key) => !blockedKey.test(key)).slice(0, 40),
        eventKeys: events && typeof events === "object" ? own(events).slice(0, 60) : []
      };
    };
    const roleOf = (node, nodePath, text) => {
      const c = ctor(node);
      const hay = [nodePath, c, labelOf(node), text].join(" ");
      if (c === "NBi" || /\/NBi#/.test(nodePath)) {
        if (c === "NBi") return "current-player-root";
        if (c === "_6i") return "skill-button";
        if (c === "uBt") return "card-container";
        if (c === "fHt") return "select-button-panel";
        if (/\/_6i#/.test(nodePath)) return "skill-button-label";
        if (c === "pBt" || /\/pBt#/.test(nodePath)) return "skill-panel";
      }
      if (c === "_6i") return "skill-button";
      if (c === "uBt") return "card-container";
      if (c === "fHt") return "select-button-panel";
      if (c === "tU" && /\/fHt#/.test(nodePath)) return "select-panel-richtext";
      if (/btnOK|btnCancel|btnDiscard|btnAllSelect|btnQuickSelect/.test(hay)) return "select-button-child";
      return "";
    };
    const walk = (root, visitor, nodePath, depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 15) return;
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
    for (const root of [{ node: currentScene, path: "CurrentScene" }, { node: windowLayer, path: "WindowLayer" }]) {
      walk(root.node, (node, nodePath, depth) => {
        if (!effectiveVisible(node)) return;
        const text = textOf(node);
        const role = roleOf(node, nodePath, text);
        const eventKeys = Object.keys(eventSummary(node));
        const methodKeys = methodSources(node).map((item) => item.name);
        const hay = [nodePath, labelOf(node), text, eventKeys.join(" "), methodKeys.join(" ")].join(" ");
        const include = !!role || /NBi|pBt|_6i|uBt|fHt|CardUI_TouchSkill|SELECTED_CHANGED|touchSkill|endSkill|btnOK|btnCancel|btnDiscard|btnAllSelect|btnQuickSelect|乱击|丰饶/.test(hay);
        if (!include) return;
        nodes.push({
          path: nodePath,
          depth,
          role: role || "related-node",
          label: labelOf(node),
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          sceneName: node.sceneName || node.SceneName || "",
          uiid: node._uiid || "",
          resName: node._resName || "",
          text,
          visible: node.visible,
          alpha: node.alpha,
          mouseEnabled: node.mouseEnabled,
          mouseThrough: node.mouseThrough,
          zOrder: node.zOrder,
          childCount: node.numChildren || 0,
          bounds: boundsOf(node),
          parentChain: parentChain(node),
          fields: fieldSnapshot(node),
          eventDispatcher: dispatcherSummary(node),
          events: eventSummary(node),
          methodSources: methodSources(node)
        });
      }, root.path);
    }
    return {
      time: new Date().toISOString(),
      page: { title: document.title, url: location.href },
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
        currentRoundSeatID: manager.currentRoundSeatID,
        fields: fieldSnapshot(manager)
      } : null,
      nodes,
      safety: {
        readOnly: true,
        clicked: false,
        calledAction: false,
        purchaseCallsMade: false,
        hiddenOpponentHandRead: false,
        note: "Only visible current scene/window nodes were inspected. Keys matching handCards/watchCards/hidden are filtered."
      }
    };
  })()`;
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function readmeText(report) {
  const s = report.summary || {};
  const autoTags = Object.entries(s.tagCount || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
  const lines = [];
  lines.push("# Rogue Current Skill Button Detail Report");
  lines.push("");
  lines.push(`- Captured: ${report.time}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${report.resourceVersion || ""}; Laya=${report.layaVersion || ""}`);
  lines.push(`- Scene: ${s.scene}; manager=${s.managerCtor}; isGameOver=${s.isGameOver}`);
  lines.push(`- Nodes: ${s.nodeCount}; skillButtons=${s.skillButtonCount} (${s.skillButtonTexts.join("/") || "none"}); currentPlayerAnchors=${s.currentPlayerAnchors}; cardContainers=${s.cardContainers}; selectPanels=${s.selectPanels}`);
  lines.push(`- Evidence rows: methods=${s.methodRows}; events=${s.eventRows}; autoEvidence=${s.autoEvidenceRows}; sendOrConfirm=${s.sendOrConfirmRows}; debugLog=${s.debugLogRows}; purchaseRisk=${s.purchaseRiskRows}`);
  lines.push(`- Tags: ${autoTags || "(none)"}`);
  lines.push("");
  lines.push("This is a read-only report. It does not click, confirm, discard, use skills, send proxy messages, buy, refresh, or read hidden opponent hand fields.");
  lines.push("");
  lines.push("## Mechanism Notes");
  lines.push("");
  lines.push("- `_6i` skill buttons such as `乱击` / `丰饶` use their mouse handler to change visual state (`phase`, `_stateChanged`) and then dispatch the same event through `eventDispatcher`; the skill button handler itself is not the final send path.");
  lines.push("- The current `uBt` card area emits `touchSkill`; the observed caller is `NBi.CardUI_TouchSkill`.");
  lines.push("- `NBi.CardUI_TouchSkill` contains the repeat-activation path `LastActivateSpell.ID == skill.ID -> SpellTouch_ConfirmResult(BUTTON_OK)`, plus the auto-selection branch using `IsOpenAiAutoSelect`, `ClearSelfOpertate`, `aiHelpOptDatas`, and selector context.");
  lines.push("- The `console.log` inside that method is diagnostic text on the auto-skill branch; it is not the trigger mechanism. The actual mechanism is Laya event dispatch plus `NBi` selector/confirm methods and later send paths.");
  lines.push("- `fHt` is the quick/confirm/cancel/discard button panel; in the current ended Rogue state many button children appear through removal handlers (`btnOK`, `btnCancel`, `btnDiscard`, `btnAllSelect`, etc.) rather than an active prompt.");
  lines.push("");
  lines.push("## Focus Nodes");
  lines.push("");
  lines.push("| Path | Role | Text | Events | Dispatcher Events | Field Keys |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const node of (report.nodes || []).slice(0, 90)) {
    lines.push(`| \`${node.path}\` | ${node.role} | ${tsvEscape(node.text)} | ${Object.keys(node.events || {}).join(",") || "(none)"} | ${(node.eventDispatcher?.eventKeys || []).join(",") || "(none)"} | ${Object.keys(node.fields || {}).join(",").slice(0, 180)} |`);
  }
  lines.push("");
  lines.push("## Auto / Confirm Evidence");
  lines.push("");
  for (const row of report.autoEvidence.slice(0, 60)) {
    lines.push(`- \`${row.nodePath}\` ${row.nodeRole} ${row.nodeText || ""} :: ${row.owner}.${row.methodName} tags=${(row.tags || []).join(",") || "(none)"} hash=\`${row.sourceHash}\` source=\`${tsvEscape(row.sourcePreview)}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const raw = await evaluateOnSgs(inspectExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const report = enrich(raw.value);
  await writeJson(path.join(dir, "rogue-current-skill-button-detail-report.json"), report);
  await writeFile(path.join(dir, "README.md"), readmeText(report), "utf8");

  const nodeHeaders = ["path", "role", "label", "text", "eventNames", "dispatcherEventKeys", "fieldKeys", "methodNames"];
  const nodeLines = [nodeHeaders.join("\t")];
  for (const node of report.nodes || []) {
    nodeLines.push([
      node.path,
      node.role,
      node.label,
      node.text,
      Object.keys(node.events || {}).join("|"),
      (node.eventDispatcher?.eventKeys || []).join("|"),
      Object.keys(node.fields || {}).join("|"),
      (node.methodSources || []).map((method) => `${method.owner}.${method.name}`).join("|")
    ].map(tsvEscape).join("\t"));
  }
  await writeFile(path.join(dir, "focus-nodes.tsv"), `${nodeLines.join("\n")}\n`, "utf8");

  const methodHeaders = ["nodePath", "nodeRole", "nodeText", "owner", "methodName", "tags", "sourceHash", "sourceLength", "sourcePreview"];
  const methodLines = [methodHeaders.join("\t")];
  for (const row of report.methodRows || []) {
    methodLines.push(methodHeaders.map((key) => tsvEscape(key === "tags" ? row.tags : row[key])).join("\t"));
  }
  await writeFile(path.join(dir, "method-evidence.tsv"), `${methodLines.join("\n")}\n`, "utf8");

  const eventHeaders = ["nodePath", "nodeRole", "nodeText", "eventName", "callerLabel", "methodName", "tags", "sourceHash", "sourceLength", "sourcePreview"];
  const eventLines = [eventHeaders.join("\t")];
  for (const row of report.eventRows || []) {
    eventLines.push(eventHeaders.map((key) => tsvEscape(key === "tags" ? row.tags : row[key])).join("\t"));
  }
  await writeFile(path.join(dir, "event-handler-evidence.tsv"), `${eventLines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: report.summary.scene,
    isGameOver: report.summary.isGameOver,
    nodeCount: report.summary.nodeCount,
    skillButtonTexts: report.summary.skillButtonTexts,
    methodRows: report.summary.methodRows,
    eventRows: report.summary.eventRows,
    autoEvidenceRows: report.summary.autoEvidenceRows,
    sendOrConfirmRows: report.summary.sendOrConfirmRows,
    purchaseRiskRows: report.summary.purchaseRiskRows
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
