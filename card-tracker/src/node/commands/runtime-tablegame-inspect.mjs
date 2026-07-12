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
    process.env.SGS_TABLEGAME_INSPECT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-tablegame-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectionExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const hidden = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) hidden.push(label + ":visible=false");
        if (cur.alpha === 0) hidden.push(label + ":alpha=0");
      }
      return hidden;
    };
    const isVisible = (node) => hiddenReasons(node).length === 0;
    const simple = (value, depth = 0) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      if (depth > 0) return "[" + (ctor(value) || t) + "]";
      return "[" + (ctor(value) || t) + "]";
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj).slice(0, 800)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key], 0); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const methodNames = (obj, pattern) => {
      const names = [];
      let proto = Object.getPrototypeOf(obj || {});
      const seen = new Set();
      while (proto && proto !== Object.prototype) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key);
          } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort();
    };
    const walk = (root, visitor, maxDepth = 14, maxNodes = 16000) => {
      const visited = new Set();
      let count = 0;
      const inner = (node, nodePath, depth) => {
        if (!node || visited.has(node) || depth > maxDepth || count >= maxNodes) return;
        visited.add(node);
        count++;
        visitor(node, nodePath, depth);
        const n = node.numChildren || 0;
        for (let i = 0; i < n; i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          inner(child, nodePath + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
        }
      };
      inner(root, "Laya.stage", 0);
      return count;
    };
    const stageChildren = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    let scene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (isVisible(candidate)) { scene = candidate; break; }
      }
      if (!scene && sceneLayer.numChildren) scene = sceneLayer.getChildAt(sceneLayer.numChildren - 1);
    }
    const nodeSummary = (node, nodePath) => ({
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
      width: node && node.width,
      height: node && node.height,
      childCount: node && node.numChildren || 0,
      fields: safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|select|Select|discard|Discard|play|Play|phase|Phase|seat|Seat|target|Target|auto|Auto|tip|Tip|name|Name|text|Text|count|Count|index|Index|id|ID|zone|Zone|data|Data)/, 55),
      keyMethods: methodNames(node, /(click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|select|Select|discard|Discard|play|Play|move|Move|phase|Phase|opt|Opt|auto|Auto|confirm|Confirm|cancel|Cancel|window|Window|effect|Effect|game|Game|start|Start|over|Over|leave|Leave|handler|Handler)/).slice(0, 80)
    });
    const tableScene = scene && /TableGameScene/.test(labelOf(scene)) ? scene : null;
    const manager = tableScene && tableScene.manager || null;
    const seats = [];
    if (manager && Array.isArray(manager.seats)) {
      for (let i = 0; i < manager.seats.length; i++) {
        const seat = manager.seats[i];
        const selfSeatIndex = Number(manager.selfSeatIndex);
        const isSelf = i === selfSeatIndex;
        const seatItem = {
          index: i,
          isSelf,
          ctor: ctor(seat),
          fields: safeFields(seat, /(index|Index|seat|Seat|role|Role|general|General|hp|Hp|maxHp|MaxHp|dead|Dead|turn|Turn|phase|Phase|sex|Sex|country|Country|shown|Shown|equip|Equip|judge|Judge|name|Name|id|ID|status|Status|camp|Camp)/, 70),
          publicCounts: {}
        };
        for (const key of ["equips", "equipCards", "judgeCards", "handShowCards", "watchCards"]) {
          try {
            if (Array.isArray(seat[key])) seatItem.publicCounts[key] = seat[key].length;
          } catch {}
        }
        if (isSelf) {
          try {
            seatItem.selfHandCards = Array.isArray(seat.handCards)
              ? seat.handCards.map((card) => ({
                  ctor: ctor(card),
                  fields: safeFields(card, /(id|ID|card|Card|name|Name|suit|Suit|point|Point|number|Number|type|Type|color|Color|zone|Zone|spell|Spell|skill|Skill)/, 45)
                })).slice(0, 40)
              : null;
            seatItem.selfHandCount = Array.isArray(seat.handCards) ? seat.handCards.length : null;
          } catch (error) {
            seatItem.selfHandError = String(error && error.message || error);
          }
        }
        seats.push(seatItem);
      }
    }
    const visibleNodes = [];
    const hiddenInterestingNodes = [];
    const cardUiNodes = [];
    const buttonNodes = [];
    const windowNodes = [];
    const visitedCount = walk(Laya.stage, (node, nodePath) => {
      const label = labelOf(node);
      const methods = methodNames(node, /(click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|select|Select|discard|Discard|play|Play|move|Move|opt|Opt|confirm|Confirm|auto|Auto|effect|Effect)/);
      const fields = safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|id|ID|data|Data|zone|Zone|text|Text|name|Name)/, 25);
      const text = (() => { try { return typeof node.text === "string" ? node.text.slice(0, 120) : ""; } catch { return ""; } })();
      const interesting = /TableGameScene|Window|Select|Skill|Card|card|Hand|hand|Discard|discard|Button|Btn|btn|Effect|effect|Tip|tip|Phase|phase|Auto|auto|pWt|Uxt|seat|Seat/.test(label)
        || methods.length
        || Object.keys(fields).length
        || text;
      if (!interesting) return;
      const summary = nodeSummary(node, nodePath);
      if (text) summary.text = text;
      if (summary.effectiveVisible) visibleNodes.push(summary);
      else hiddenInterestingNodes.push(summary);
      if (/Card|card|Hand|hand/.test(label) || /(card|Card)/.test(Object.keys(fields).join(" "))) cardUiNodes.push(summary);
      if (/Btn|Button|btn|button/.test(label) || /(btn|Btn|button|Button|click|Click)/.test(Object.keys(fields).join(" ") + " " + methods.join(" "))) buttonNodes.push(summary);
      if (/Window/.test(label)) windowNodes.push(summary);
    });
    const windows = [];
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) {
        windows.push(nodeSummary(windowLayer.getChildAt(i), "WindowLayer#" + i));
      }
    }
    const proxyEvents = (() => {
      try {
        const popup = Laya.ClassUtils.getInstance("PopUpWindow");
        const ged = popup && popup.ged;
        const windowManager = (ged && ged._events && ged._events.HIDE_WINDOW || [])[0]?.caller || null;
        const proxy = windowManager && windowManager.proxy;
        return proxy && proxy._events ? Object.keys(proxy._events).filter((name) => /(Card|card|Skill|skill|Role|role|Game|game|Opt|Move|Phase|Table|Seat|General|Figure|State)/.test(name)).sort() : [];
      } catch {
        return [];
      }
    })();
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      stage: {
        width: Laya.stage && Laya.stage.width,
        height: Laya.stage && Laya.stage.height,
        childCount: Laya.stage && Laya.stage.numChildren,
        childLabels: stageChildren.map((node, index) => ({ index, label: labelOf(node), childCount: node && node.numChildren || 0, visible: node && node.visible })),
        visitedCount
      },
      currentScene: scene ? nodeSummary(scene, "currentScene") : null,
      isTableGameScene: !!tableScene,
      manager: manager ? {
        ctor: ctor(manager),
        fields: safeFields(manager, /(self|Self|seat|Seat|turn|Turn|phase|Phase|round|Round|current|Current|table|Table|game|Game|card|Card|stack|Stack|discard|Discard|auto|Auto|opt|Opt|state|State|mode|Mode)/, 100),
        methodNames: methodNames(manager, /(card|Card|skill|Skill|select|Select|discard|Discard|play|Play|move|Move|phase|Phase|opt|Opt|auto|Auto|game|Game|seat|Seat|table|Table|send|Send|handler|Handler)/).slice(0, 120),
        seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
        selfSeatIndex: manager.selfSeatIndex
      } : null,
      seats,
      windows,
      visibleNodes: visibleNodes.slice(0, 350),
      hiddenInterestingNodes: hiddenInterestingNodes.slice(0, 180),
      cardUiNodes: cardUiNodes.slice(0, 220),
      buttonNodes: buttonNodes.slice(0, 220),
      windowNodes: windowNodes.slice(0, 120),
      proxyEvents: proxyEvents.slice(0, 260),
      notes: [
        "Opponent handCards arrays are intentionally not read.",
        "Self handCards are summarized only when manager.selfSeatIndex matches the seat.",
        "Visible UI nodes are Laya nodes, not DOM/OCR observations."
      ]
    };
  })()`;
}

function readmeText(value) {
  const lines = [];
  lines.push("# TableGameScene Runtime Inspection");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Page: ${value.page?.title || ""} ${value.page?.url || ""}`);
  lines.push(`- Current scene: ${value.currentScene?.sceneName || value.currentScene?.label || ""}`);
  lines.push(`- Is TableGameScene: ${!!value.isTableGameScene}`);
  lines.push(`- Manager seats: ${value.manager?.seatCount ?? ""}`);
  lines.push(`- Self seat index: ${value.manager?.selfSeatIndex ?? ""}`);
  lines.push(`- Visible interesting nodes: ${value.visibleNodes?.length || 0}`);
  lines.push(`- Button-like nodes: ${value.buttonNodes?.length || 0}`);
  lines.push(`- Card-like nodes: ${value.cardUiNodes?.length || 0}`);
  lines.push(`- Window nodes: ${value.windowNodes?.length || 0}`);
  lines.push("");
  lines.push("## Stable Findings");
  lines.push("");
  if (value.isTableGameScene) {
    lines.push("- Battle is currently proven by an effectively visible `TableGameScene` and a manager with seats.");
  } else {
    lines.push("- Battle is not currently proven; inspect `tablegame-inspection.json` for the visible scene.");
  }
  lines.push("- This capture intentionally skips hidden opponent `handCards` content.");
  lines.push("- Use `manager.selfSeatIndex -> seats[selfSeatIndex].handCards` only for the current player's visible hand.");
  lines.push("");
  lines.push("## Selected Visible Nodes");
  lines.push("");
  for (const node of (value.visibleNodes || []).slice(0, 80)) {
    lines.push(`- ${node.path} ${node.label} methods=${node.keyMethods.slice(0, 8).join(",")}`);
  }
  lines.push("");
  lines.push("## Proxy Event Names");
  lines.push("");
  for (const eventName of (value.proxyEvents || []).slice(0, 160)) {
    lines.push(`- ${eventName}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectionExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await writeJson(path.join(dir, "tablegame-inspection.json"), result.value);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value), "utf8");
  console.log(JSON.stringify({
    dir,
    scene: result.value.currentScene,
    isTableGameScene: result.value.isTableGameScene,
    seatCount: result.value.manager?.seatCount ?? null,
    selfSeatIndex: result.value.manager?.selfSeatIndex ?? null,
    visibleNodes: result.value.visibleNodes?.length || 0,
    buttonNodes: result.value.buttonNodes?.length || 0,
    cardUiNodes: result.value.cardUiNodes?.length || 0,
    proxyEvents: result.value.proxyEvents?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
