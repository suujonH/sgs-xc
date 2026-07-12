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
    process.env.SGS_ROGUE_BATTLE_ACTION_SURFACE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-battle-action-surface`)
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
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth >= 1 ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 20).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 20).map(String) };
      const keys = own(value).slice(0, 48);
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
        for (const key of keys.slice(0, 18)) {
          if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, pattern, limit = 90) => {
      const out = {};
      if (!obj) return out;
      for (const key of own(obj).slice(0, 1400)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const methodNames = (obj, pattern, limit = 140) => {
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
    const sourceFromObject = (obj, names, limit = 2400) => {
      const out = {};
      for (const name of names) {
        try { out[name] = typeof obj?.[name] === "function" ? String(obj[name]).slice(0, limit) : null; } catch (error) { out[name] = "[throws " + String(error && error.message || error) + "]"; }
      }
      return out;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 60)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            callerLabel: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            methodSource: handler.method ? String(handler.method).slice(0, 1800) : null,
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 8) : simple(handler.args),
            once: handler.once
          })).slice(0, 20);
        } catch (error) {
          out[key] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 18) => {
      if (!root || depth > maxDepth) return;
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth);
      }
    };
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
    const nodeSummary = (node, nodePath, methodLimit = 90) => {
      const methodPattern = /(click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|phase|Phase|opt|Opt|auto|Auto|confirm|Confirm|cancel|Cancel|window|Window|effect|Effect|game|Game|start|Start|over|Over|leave|Leave|handler|Handler|ensure|Ensure|use|Use|drag|Drag|drop|Drop|enable|Enable|disable|Disable|gray|Gray|tip|Tip|show|Show|hide|Hide)/;
      return {
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
        mouseThrough: node?.mouseThrough,
        mouseState: node?._mouseState,
        text: node?.text || node?._text || node?.label || node?._label || "",
        childCount: node?.numChildren || 0,
        fields: safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|phase|Phase|seat|Seat|target|Target|auto|Auto|tip|Tip|name|Name|text|Text|count|Count|index|Index|id|ID|zone|Zone|data|Data|state|State|status|Status|move|Move|effect|Effect|confirm|Confirm|cancel|Cancel|ok|OK|enable|Enable|disable|Disable|gray|Gray|use|Use|hand|Hand)/, 75),
        methods: methodNames(node, methodPattern, methodLimit),
        events: eventSummary(node)
      };
    };
    const scene = currentScene();
    const manager = scene && (scene.manager || scene.gameManager || scene._manager || scene._gameManager || null);
    const seats = Array.isArray(manager?.seats) ? manager.seats : [];
    const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
    const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
    const selfSummary = selfSeat ? {
      index: selfSeatIndex,
      ctor: ctor(selfSeat),
      fields: safeFields(selfSeat, /(id|ID|index|Index|seat|Seat|general|General|player|Player|role|Role|hp|HP|Max|dead|Dead|state|State|status|Status|phase|Phase|turn|Turn|count|Count|hand|Hand|equip|Equip|judge|Judge|region|Region|skill|Skill|spell|Spell|name|Name|country|Country|shield|Shield)/, 90),
      handCardsCount: Array.isArray(selfSeat.handCards) ? selfSeat.handCards.length : null
    } : null;

    const CU = Laya?.ClassUtils || {};
    const classMap = CU._classMap || {};
    const ctorToRegistered = {};
    for (const [registeredName, cls] of Object.entries(classMap)) {
      if (!cls || !cls.name) continue;
      if (!ctorToRegistered[cls.name]) ctorToRegistered[cls.name] = [];
      ctorToRegistered[cls.name].push(registeredName);
    }
    const registeredFor = (node) => ctorToRegistered[ctor(node)] || [];
    const isDescendantOf = (node, ancestor) => {
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) if (cur === ancestor) return true;
      return false;
    };

    const currentPlayerAreas = [];
    const skillPanels = [];
    const handAreas = [];
    const stackAreas = [];
    const visibleWindows = [];
    const actionNodes = [];
    const cardUiNodes = [];
    const buttonNodes = [];
    const promptNodes = [];

    walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const label = labelOf(node);
      const methods = methodNames(node, /(click|Click|touch|Touch|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|opt|Opt|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|tip|Tip|show|Show|hide|Hide|drag|Drag|drop|Drop)/, 50);
      const events = eventSummary(node);
      const eventNames = Object.keys(events);
      const fields = safeFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|id|ID|data|Data|zone|Zone|text|Text|name|Name|tip|Tip|phase|Phase|confirm|Confirm|cancel|Cancel|use|Use|hand|Hand)/, 30);
      const hay = [nodePath, label, Object.keys(fields).join(" "), methods.join(" "), eventNames.join(" ")].join(" ");
      if (/NBi/.test(label)) currentPlayerAreas.push(nodeSummary(node, nodePath, 130));
      if (/pBt|Skill|skill/.test(hay) && /NBi|RogueLikeGameScene|TableGameScene|Window/.test(nodePath)) skillPanels.push(nodeSummary(node, nodePath, 110));
      if (/uBt|Hand|hand/.test(hay) && /NBi|RogueLikeGameScene|TableGameScene/.test(nodePath)) handAreas.push(nodeSummary(node, nodePath, 120));
      if (/Bxt|Stack|stack|Discard|discard/.test(hay)) stackAreas.push(nodeSummary(node, nodePath, 110));
      if (/Window/.test(label) || /WindowLayer|mWt/.test(nodePath)) visibleWindows.push(nodeSummary(node, nodePath, 120));
      if (/Card|card|T6i|SHt|Vts|theCard|descText/.test(hay)) cardUiNodes.push(nodeSummary(node, nodePath, 120));
      if (/Btn|Button|btn|button|confirm|Confirm|ensure|Ensure|cancel|Cancel|dVt|click/.test(hay)) buttonNodes.push(nodeSummary(node, nodePath, 120));
      if (/SelectCardWindow|SkillSelectorWindow|SkillBiFa|SpellMultiSelector|MilitaryOrders|confirm|Confirm|ensure|Ensure|cancel|Cancel|autoSelect|AutoSelect/.test(hay)) promptNodes.push(nodeSummary(node, nodePath, 130));
      if ((methods.length || eventNames.length) && /(RogueLikeGameScene|NBi|pBt|uBt|Bxt|Window|Select|Skill|Card|Hand|Button|Btn|confirm|cancel|ensure|auto|use|play|discard)/i.test(hay)) {
        actionNodes.push({
          summary: nodeSummary(node, nodePath, 90),
          registeredNames: registeredFor(node),
          methodSources: sourceFromObject(node, methods.filter((name) => /(click|Click|touch|Touch|confirm|Confirm|cancel|Cancel|ensure|Ensure|auto|Auto|use|Use|select|Select|card|Card|skill|Skill|play|Play|discard|Discard)/.test(name)).slice(0, 10), 2200)
        });
      }
    });

    const managerMethodNames = methodNames(manager, /(Client|ServerProxy|Send|send|decode|Msg|msg|GsC|Pub|RoleOpt|Select|Card|Skill|Spell|Use|Move|Game|State|Ntf|Rep|Req|Auto|Ask|Operate|Table)/, 180);
    const managerSources = sourceFromObject(manager, [
      "ClientGsPreSelectMsg",
      "ClientTableGameCardOptNtf",
      "MsgGamePlayCard_Notify",
      "SendSelectCards",
      "ServerProxy_GsCRoleOptNtf",
      "ServerProxy_GsCRoleOptTargetNtf",
      "ServerProxy_GsCTriggerSpellEnq",
      "ServerProxy_GsCTriggerSpellNew",
      "ServerProxy_PubGsCMoveCard",
      "ServerProxy_PubGsCUseCard",
      "ServerProxy_PubGsCUseSpell",
      "onRoleOptNtf",
      "onRoleOptTargetNtf",
      "onTriggerSpell",
      "smsgGameAskOperationResult",
      "onGsSelectCardsNtf"
    ], 3600);
    const classSources = {};
    const classSpecs = {
      RogueLikeGameScene: ["showSelectGeneral", "showGameResultWindow", "rogueOverGame", "rogueRestartGame", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell"],
      TableGameScene: ["gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys"],
      SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "onTouchCard", "onTouchEnsure"],
      SkillSelectorWindow: ["enterWindow", "layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
      SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
      SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
      SpellMultiSelectorWindow: ["enterWindow", "onTouch"],
      MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "initUI"],
      MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "initUI"]
    };
    for (const [name, methods] of Object.entries(classSpecs)) {
      const cls = classMap[name];
      classSources[name] = {
        exists: !!cls,
        functionName: cls?.name || "",
        methods: sourceFromObject(cls?.prototype, methods, 3600)
      };
    }

    const proxyEvents = (() => {
      try {
        const popup = CU && CU.getInstance && CU.getInstance("PopUpWindow");
        const ged = popup && popup.ged;
        const hideHandlers = ged && ged._events && ged._events.HIDE_WINDOW;
        const arr = Array.isArray(hideHandlers) ? hideHandlers : hideHandlers ? [hideHandlers] : [];
        const windowManager = arr.map((item) => item && item.caller).find((item) => item && item.proxy) || null;
        const proxy = windowManager && windowManager.proxy;
        return proxy && proxy._events ? Object.keys(proxy._events).filter((name) => /(Card|card|Skill|skill|Role|role|Game|game|Opt|Move|Phase|Table|Seat|General|Figure|State|Rogue|rogue|Select|select)/.test(name)).sort() : [];
      } catch {
        return [];
      }
    })();

    const uniqueRegistered = Array.from(new Set(actionNodes.flatMap((item) => item.registeredNames))).sort();
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        scene: scene ? nodeSummary(scene, "currentScene", 140) : null,
        isRogueLikeGameScene: !!(scene && /RogueLikeGameScene/.test(labelOf(scene))),
        manager: manager ? {
          ctor: ctor(manager),
          registeredNames: ctorToRegistered[ctor(manager)] || [],
          seatCount: seats.length,
          selfSeatIndex,
          fields: safeFields(manager, /(self|Self|seat|Seat|turn|Turn|phase|Phase|round|Round|current|Current|table|Table|game|Game|card|Card|stack|Stack|discard|Discard|auto|Auto|opt|Opt|state|State|mode|Mode|skill|Skill|spell|Spell|over|Over|start|Start)/, 120),
          methodNames: managerMethodNames,
          methodSources: managerSources
        } : null,
        selfSeat: selfSummary
      },
      surfaces: {
        currentPlayerAreas: currentPlayerAreas.slice(0, 12),
        skillPanels: skillPanels.slice(0, 32),
        handAreas: handAreas.slice(0, 24),
        stackAreas: stackAreas.slice(0, 24),
        visibleWindows: visibleWindows.slice(0, 32),
        cardUiNodes: cardUiNodes.slice(0, 80),
        buttonNodes: buttonNodes.slice(0, 100),
        promptNodes: promptNodes.slice(0, 80),
        actionNodes: actionNodes.slice(0, 120)
      },
      registeredNamesFromActionNodes: uniqueRegistered,
      proxyEvents: proxyEvents.slice(0, 260),
      classSources,
      notes: [
        "Read-only action surface inspection. It records nodes, event handlers, method names, and method source snippets but does not invoke them.",
        "Opponent handCards/watchCards are intentionally skipped. Self handCards are counted only through manager.selfSeatIndex.",
        "Use these rows as monitor targets. Active auto-use/confirm still needs a prompt-specific sample before automation."
      ]
    };
  })()`;
}

function readmeText(value) {
  const surfaces = value.surfaces || {};
  return [
    "# Rogue Battle Action Surface",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- ResourceVersion: ${value.runtime?.resourceVersion || ""}`,
    `- Scene: ${value.runtime?.scene?.sceneName || value.runtime?.scene?.className || ""}`,
    `- Manager: ${value.runtime?.manager?.ctor || ""}; seats=${value.runtime?.manager?.seatCount ?? ""}; self=${value.runtime?.manager?.selfSeatIndex ?? ""}`,
    `- Current player areas: ${surfaces.currentPlayerAreas?.length || 0}`,
    `- Skill panels: ${surfaces.skillPanels?.length || 0}`,
    `- Hand areas: ${surfaces.handAreas?.length || 0}`,
    `- Stack areas: ${surfaces.stackAreas?.length || 0}`,
    `- Visible windows: ${surfaces.visibleWindows?.length || 0}`,
    `- Card UI nodes: ${surfaces.cardUiNodes?.length || 0}`,
    `- Button nodes: ${surfaces.buttonNodes?.length || 0}`,
    `- Prompt nodes: ${surfaces.promptNodes?.length || 0}`,
    `- Action nodes: ${surfaces.actionNodes?.length || 0}`,
    "",
    "This probe is read-only. It does not click, confirm, cancel, play cards, discard, use skills, buy, refresh, or pay.",
    "",
    "Use the JSON sidecar for event handler sources, node paths, registered class mappings, manager send/proxy methods, and prompt/window class source snippets.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "rogue-battle-action-surface.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  const surfaces = result.value?.surfaces || {};
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.runtime?.scene?.sceneName || result.value?.runtime?.scene?.className || null,
    manager: result.value?.runtime?.manager ? {
      ctor: result.value.runtime.manager.ctor,
      seatCount: result.value.runtime.manager.seatCount,
      selfSeatIndex: result.value.runtime.manager.selfSeatIndex
    } : null,
    counts: {
      currentPlayerAreas: surfaces.currentPlayerAreas?.length || 0,
      skillPanels: surfaces.skillPanels?.length || 0,
      handAreas: surfaces.handAreas?.length || 0,
      stackAreas: surfaces.stackAreas?.length || 0,
      visibleWindows: surfaces.visibleWindows?.length || 0,
      cardUiNodes: surfaces.cardUiNodes?.length || 0,
      buttonNodes: surfaces.buttonNodes?.length || 0,
      promptNodes: surfaces.promptNodes?.length || 0,
      actionNodes: surfaces.actionNodes?.length || 0
    },
    registeredNamesFromActionNodes: result.value?.registeredNamesFromActionNodes || []
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
