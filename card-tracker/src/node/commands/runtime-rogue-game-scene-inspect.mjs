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
    process.env.SGS_ROGUE_GAME_SCENE_INSPECT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-game-scene-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectExpression() {
  return String.raw`(() => {
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
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth >= 1 ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 16).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 16).map(String) };
      const keys = own(value).slice(0, 32);
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
        for (const key of keys.slice(0, 14)) {
          if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, pattern, limit = 90) => {
      const out = {};
      if (!obj) return out;
      for (const key of own(obj).slice(0, 1000)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const methodNames = (obj, pattern, limit = 100) => {
      const names = [];
      const seen = new Set();
      let proto = Object.getPrototypeOf(obj || {});
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
      return names.sort().slice(0, limit);
    };
    const methodSourcesFromProto = (cls, names, limit = 4200) => {
      const out = {};
      const proto = cls && cls.prototype;
      for (const name of names) {
        try { out[name] = typeof proto?.[name] === "function" ? String(proto[name]).slice(0, limit) : null; } catch (error) { out[name] = "[throws " + String(error && error.message || error) + "]"; }
      }
      return out;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 40)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            callerLabel: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            methodSource: handler.method ? String(handler.method).slice(0, 1600) : null,
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 8) : simple(handler.args),
            once: handler.once
          })).slice(0, 20);
        } catch (error) {
          out[key] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 16) => {
      if (!root || depth > maxDepth) return;
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth);
      }
    };
    const nodeSummary = (node, nodePath) => ({
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
      mouseState: node?._mouseState,
      text: node?.text || node?._text || node?.label || node?._label || "",
      childCount: node?.numChildren || 0,
      fields: safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|phase|Phase|seat|Seat|target|Target|auto|Auto|tip|Tip|name|Name|text|Text|count|Count|index|Index|id|ID|zone|Zone|data|Data|state|State|status|Status|move|Move|effect|Effect|confirm|Confirm|cancel|Cancel|ok|OK)/, 70),
      methods: methodNames(node, /(click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|phase|Phase|opt|Opt|auto|Auto|confirm|Confirm|cancel|Cancel|window|Window|effect|Effect|game|Game|start|Start|over|Over|leave|Leave|handler|Handler|ensure|Ensure|use|Use)/, 90),
      events: eventSummary(node)
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
    const managerCandidates = [
      ["manager", scene && scene.manager],
      ["gameManager", scene && scene.gameManager],
      ["_manager", scene && scene._manager],
      ["_gameManager", scene && scene._gameManager]
    ].filter(([, value]) => value);
    const managers = managerCandidates.map(([name, manager]) => {
      const seats = Array.isArray(manager.seats) ? manager.seats : Array.isArray(manager.Seats) ? manager.Seats : null;
      const selfSeatIndex = Number.isInteger(manager.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager.SelfSeatIndex) ? manager.SelfSeatIndex : null;
      const seatRows = [];
      if (seats) {
        for (let i = 0; i < seats.length; i++) {
          const seat = seats[i];
          const isSelf = i === selfSeatIndex;
          seatRows.push({
            index: i,
            isSelf,
            ctor: ctor(seat),
            fields: safeFields(seat, /(id|ID|index|Index|seat|Seat|general|General|player|Player|role|Role|hp|HP|Max|dead|Dead|state|State|status|Status|phase|Phase|turn|Turn|count|Count|hand|Hand|equip|Equip|judge|Judge|region|Region|skill|Skill|spell|Spell|name|Name|country|Country|shield|Shield)/, 80),
            selfHandCount: isSelf && Array.isArray(seat.handCards) ? seat.handCards.length : undefined
          });
        }
      }
      return {
        name,
        ctor: ctor(manager),
        fields: safeFields(manager, /(self|Self|seat|Seat|turn|Turn|phase|Phase|round|Round|current|Current|table|Table|game|Game|card|Card|stack|Stack|discard|Discard|auto|Auto|opt|Opt|state|State|mode|Mode|skill|Skill|spell|Spell)/, 120),
        methods: methodNames(manager, /(card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|phase|Phase|opt|Opt|auto|Auto|game|Game|seat|Seat|table|Table|send|Send|handler|Handler|confirm|Confirm|cancel|Cancel|use|Use)/, 140),
        seatCount: seats ? seats.length : null,
        selfSeatIndex,
        seats: seatRows
      };
    });
    const interestingNodes = [];
    const buttonNodes = [];
    const cardNodes = [];
    const windowNodes = [];
    const selectNodes = [];
    walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const label = labelOf(node);
      const methods = methodNames(node, /(click|Click|touch|Touch|card|Card|skill|Skill|select|Select|discard|Discard|play|Play|move|Move|opt|Opt|confirm|Confirm|auto|Auto|effect|Effect|ensure|Ensure|use|Use)/, 40);
      const fields = safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|id|ID|data|Data|zone|Zone|text|Text|name|Name|tip|Tip|phase|Phase|confirm|Confirm|cancel|Cancel)/, 35);
      const hay = [label, Object.keys(fields).join(" "), methods.join(" "), nodePath].join(" ");
      if (!/RogueLikeGameScene|TableGameScene|Window|Select|Skill|Spell|Card|card|Hand|hand|Discard|discard|Button|Btn|btn|Effect|effect|Tip|tip|Phase|phase|Auto|auto|pWt|Uxt|seat|Seat|stack|Stack|Bxt|SHt|GP|Vts|N9t|hU|dVt/.test(hay)) return;
      const summary = nodeSummary(node, nodePath);
      interestingNodes.push(summary);
      if (/Window/.test(label)) windowNodes.push(summary);
      if (/Btn|Button|btn|button|dVt/.test(hay)) buttonNodes.push(summary);
      if (/Card|card|poker|Poker|SHt|Vts|Bxt|stack|Stack/.test(hay)) cardNodes.push(summary);
      if (/Select|select|SkillSelector|SelectCard|confirm|Confirm|ensure|Ensure/.test(hay)) selectNodes.push(summary);
    });
    const classMap = Laya?.ClassUtils?._classMap || {};
    const classSpecs = {
      RogueLikeGameScene: ["addEventListener", "gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showSelectGeneral", "showGameResultWindow", "rogueOverGame", "rogueRestartGame"],
      TableGameScene: ["addEventListener", "gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showSelectGeneral", "showGameResultWindow"],
      SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "addSelectCardNormalUi", "onTouchCard", "onTouchEnsure"],
      SkillSelectorWindow: ["enterWindow", "layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
      SkillPopUpWindow: ["constructor", "Skill", "initBg", "layoutTxt"],
      SpellMultiSelectorWindow: ["enterWindow", "onTouch"],
      SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
      SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
      MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "initUI"],
      MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "initUI"]
    };
    const classSources = {};
    for (const [name, methods] of Object.entries(classSpecs)) {
      const cls = classMap[name];
      classSources[name] = {
        exists: !!cls,
        functionName: cls?.name || "",
        methods: methodSourcesFromProto(cls, methods)
      };
    }
    const proxyEvents = (() => {
      try {
        const CU = Laya.ClassUtils;
        const popup = CU && CU.getInstance && CU.getInstance("PopUpWindow");
        const ged = popup && popup.ged;
        const handlers = ged && ged._events && ged._events.HIDE_WINDOW;
        const arr = Array.isArray(handlers) ? handlers : handlers ? [handlers] : [];
        const windowManager = arr.map((item) => item && item.caller).find((item) => item && item.proxy) || null;
        const proxy = windowManager && windowManager.proxy;
        return proxy && proxy._events ? Object.keys(proxy._events).filter((name) => /(Card|card|Skill|skill|Role|role|Game|game|Opt|Move|Phase|Table|Seat|General|Figure|State|Rogue|rogue)/.test(name)).sort() : [];
      } catch {
        return [];
      }
    })();
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        scene: scene ? nodeSummary(scene, "currentScene") : null,
        isRogueLikeGameScene: !!(scene && /RogueLikeGameScene/.test(labelOf(scene))),
        isTableGameScene: !!(scene && /TableGameScene/.test(labelOf(scene)))
      },
      managers,
      interestingNodes: interestingNodes.slice(0, 260),
      buttonNodes: buttonNodes.slice(0, 180),
      cardNodes: cardNodes.slice(0, 180),
      windowNodes: windowNodes.slice(0, 80),
      selectNodes: selectNodes.slice(0, 120),
      proxyEvents: proxyEvents.slice(0, 240),
      classSources,
      notes: [
        "Read-only inspection. It does not click, confirm, discard, play cards, use skills, buy, refresh, or pay.",
        "Opponent handCards arrays are intentionally not read. Self handCards are counted only when selfSeatIndex is known.",
        "RogueLikeGameScene reuses many TableGameScene-style lifecycle and card-motion methods, so tracker/automation hooks should include both registered class names."
      ]
    };
  })()`;
}

function readmeText(value) {
  return [
    "# RogueLikeGameScene Runtime Inspection",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- ResourceVersion: ${value.runtime?.resourceVersion || ""}`,
    `- Scene: ${value.runtime?.scene?.sceneName || value.runtime?.scene?.className || ""}`,
    `- Is RogueLikeGameScene: ${!!value.runtime?.isRogueLikeGameScene}`,
    `- Managers: ${value.managers?.map((manager) => `${manager.name}:${manager.ctor}/seats=${manager.seatCount ?? ""}/self=${manager.selfSeatIndex ?? ""}`).join(", ") || "(none)"}`,
    `- Button-like nodes: ${value.buttonNodes?.length || 0}`,
    `- Card-like nodes: ${value.cardNodes?.length || 0}`,
    `- Select/confirm nodes: ${value.selectNodes?.length || 0}`,
    `- Windows: ${value.windowNodes?.length || 0}`,
    "",
    "This capture intentionally skips hidden opponent `handCards` content. It records visible UI nodes, manager/seat counts, safe fields, events, and selected class source snippets.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "rogue-game-scene-inspection.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.runtime?.scene?.sceneName || result.value?.runtime?.scene?.className || null,
    isRogueLikeGameScene: !!result.value?.runtime?.isRogueLikeGameScene,
    managers: (result.value?.managers || []).map((manager) => ({ name: manager.name, ctor: manager.ctor, seatCount: manager.seatCount, selfSeatIndex: manager.selfSeatIndex })),
    buttonNodes: result.value?.buttonNodes?.length || 0,
    cardNodes: result.value?.cardNodes?.length || 0,
    selectNodes: result.value?.selectNodes?.length || 0,
    windows: result.value?.windowNodes?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
