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
    process.env.SGS_ROGUE_BATTLE_PROMPT_INSPECT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-battle-prompt-inspect`)
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
    const methodNames = (obj, pattern, limit = 80) => {
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
    const sourceFromObject = (obj, names, limit = 1600) => {
      const out = {};
      for (const name of names) {
        try { out[name] = typeof obj?.[name] === "function" ? String(obj[name]).slice(0, limit) : null; } catch (error) { out[name] = "[throws " + String(error && error.message || error) + "]"; }
      }
      return out;
    };
    const safePrimitive = (value) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      return "[" + ctor(value) + "]";
    };
    const pickFields = (obj, keys) => {
      const out = {};
      if (!obj) return out;
      for (const key of keys) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        try {
          if (key in obj) out[key] = safePrimitive(obj[key]);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const scanFields = (obj, pattern, limit = 40) => {
      const out = {};
      if (!obj) return out;
      for (const key of own(obj).slice(0, 900)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (!pattern.test(key)) continue;
        try { out[key] = safePrimitive(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 50)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            caller: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            methodSource: handler.method ? String(handler.method).slice(0, 1200) : null,
            once: handler.once === true
          })).slice(0, 10);
        } catch (error) {
          out[key] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const nodeBase = (node, nodePath) => ({
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
      childCount: node?.numChildren || 0
    });
    const nodeDetail = (node, nodePath) => {
      const methods = methodNames(node, /(click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|drag|Drag|drop|Drop|tip|Tip|show|Show|hide|Hide|enable|Enable|gray|Gray)/, 80);
      return {
        ...nodeBase(node, nodePath),
        fields: scanFields(node, /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|id|ID|data|Data|zone|Zone|text|Text|name|Name|tip|Tip|phase|Phase|confirm|Confirm|cancel|Cancel|use|Use|hand|Hand|enable|Enable|gray|Gray|count|Count|index|Index)/, 55),
        methods,
        events: eventSummary(node),
        methodSources: sourceFromObject(node, methods.filter((name) => /(click|Click|touch|Touch|confirm|Confirm|cancel|Cancel|ensure|Ensure|auto|Auto|use|Use|select|Select|card|Card|skill|Skill|play|Play|discard|Discard)/.test(name)).slice(0, 10), 1800)
      };
    };
    const cardSummary = (card, index) => {
      const keys = [
        "InstanceId", "cardId", "CardID", "id", "ID", "cardName", "name", "className", "_className_",
        "cardZoneType", "FromZone", "MoveType", "cardType", "type", "Suit", "suit", "Number", "number",
        "color", "isVirtual", "IsVirtual", "isKnown", "isSelected", "selected", "Enabled", "enabled"
      ];
      return { index, ctor: ctor(card), fields: pickFields(card, keys) };
    };

    const CU = Laya?.ClassUtils || {};
    const classMap = CU._classMap || {};
    const scene = currentScene();
    const manager = scene && (scene.manager || scene.gameManager || scene._manager || scene._gameManager || null);
    const seats = Array.isArray(manager?.seats) ? manager.seats : [];
    const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
    const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
    const selfHandCards = Array.isArray(selfSeat?.handCards) ? selfSeat.handCards : [];

    const selected = {
      currentPlayerAreas: [],
      handAreas: [],
      selectAreas: [],
      stackAreas: [],
      visibleWindows: [],
      visibleButtons: [],
      skillNodes: [],
      selfHandCardUis: [],
      promptCandidates: []
    };

    walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const label = labelOf(node);
      const events = Object.keys(eventSummary(node));
      const methods = methodNames(node, /(click|Click|touch|Touch|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|tip|Tip|show|Show|hide|Hide|drag|Drag|drop|Drop)/, 60);
      const fieldNames = own(node).filter((key) => /(card|Card|btn|Btn|button|Button|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|id|ID|data|Data|zone|Zone|text|Text|name|Name|tip|Tip|phase|Phase|confirm|Confirm|cancel|Cancel|use|Use|hand|Hand|enable|Enable|gray|Gray)/.test(key)).slice(0, 80);
      const hay = [nodePath, label, events.join(" "), methods.join(" "), fieldNames.join(" "), node?.text, node?._text, node?.label, node?._label].filter(Boolean).join(" ");
      if (/NBi/.test(label)) selected.currentPlayerAreas.push(nodeDetail(node, nodePath));
      if (/uBt|Hand|hand/.test(hay) && /RogueLikeGameScene|TableGameScene|NBi/.test(nodePath)) selected.handAreas.push(nodeDetail(node, nodePath));
      if (/fHt|Select|select|autoSelect|btnAllSelect|confirm|ensure|cancel/i.test(hay) && /RogueLikeGameScene|TableGameScene|Window|NBi/.test(nodePath)) selected.selectAreas.push(nodeDetail(node, nodePath));
      if (/Bxt|Stack|stack|Discard|discard/.test(hay)) selected.stackAreas.push(nodeDetail(node, nodePath));
      if (/Window/.test(label) || /WindowLayer|mWt/.test(nodePath)) selected.visibleWindows.push(nodeDetail(node, nodePath));
      if (/Button|Btn|btn|dVt|hVi|confirm|Confirm|ensure|Ensure|cancel|Cancel|OK|ok|click/.test(hay) && events.length) selected.visibleButtons.push(nodeDetail(node, nodePath));
      if (/Skill|skill|Spell|spell|pBt|touchSkill|endSkill/.test(hay) && /RogueLikeGameScene|TableGameScene|NBi/.test(nodePath)) selected.skillNodes.push(nodeDetail(node, nodePath));
      if (/xWi|card|Card|theCard|activatedCard|selectedCard/.test(hay) && /uBt|NBi|RogueLikeGameScene|TableGameScene/.test(nodePath)) selected.selfHandCardUis.push(nodeDetail(node, nodePath));
      if (/SelectCardWindow|SkillSelectorWindow|SkillBiFa|SpellMultiSelector|MilitaryOrders|confirm|Confirm|ensure|Ensure|cancel|Cancel|autoSelect|AutoSelect|Ask|ask|Opt|opt/i.test(hay)) selected.promptCandidates.push(nodeDetail(node, nodePath));
    });

    const classSpecs = {
      SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "onTouchCard", "onTouchEnsure", "SendMsgInSelectCardWindow"],
      SkillSelectorWindow: ["enterWindow", "layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
      SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
      SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
      SpellMultiSelectorWindow: ["enterWindow", "onTouch"],
      MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "initUI"],
      MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "initUI"],
      RogueLikeGameScene: ["addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "showGameResultWindow", "gameOverHandler", "showSelectGeneral"]
    };
    const classSources = {};
    for (const [name, methods] of Object.entries(classSpecs)) {
      const cls = classMap[name];
      classSources[name] = {
        exists: !!cls,
        functionName: cls?.name || "",
        methods: sourceFromObject(cls?.prototype, methods, 3000)
      };
    }

    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        scene: scene ? nodeBase(scene, "currentScene") : null,
        isRogueLikeGameScene: !!(scene && /RogueLikeGameScene/.test(labelOf(scene))),
        manager: manager ? {
          ctor: ctor(manager),
          seatCount: seats.length,
          selfSeatIndex,
          fields: scanFields(manager, /(self|Self|seat|Seat|turn|Turn|phase|Phase|round|Round|current|Current|table|Table|game|Game|card|Card|stack|Stack|discard|Discard|auto|Auto|opt|Opt|state|State|mode|Mode|skill|Skill|spell|Spell|over|Over|start|Start|wait|Wait|ask|Ask|operation|Operation)/, 120),
          methodNames: methodNames(manager, /(Client|ServerProxy|Send|send|decode|Msg|msg|GsC|Pub|RoleOpt|Select|Card|Skill|Spell|Use|Move|Game|State|Ntf|Rep|Req|Auto|Ask|Operate|Table)/, 180)
        } : null,
        selfSeat: selfSeat ? {
          ctor: ctor(selfSeat),
          index: selfSeatIndex,
          fields: scanFields(selfSeat, /(id|ID|index|Index|seat|Seat|general|General|player|Player|role|Role|hp|HP|Max|dead|Dead|state|State|status|Status|phase|Phase|turn|Turn|count|Count|hand|Hand|equip|Equip|judge|Judge|region|Region|skill|Skill|spell|Spell|name|Name|country|Country|shield|Shield)/, 90),
          handCardsCount: selfHandCards.length,
          handCards: selfHandCards.slice(0, 40).map(cardSummary)
        } : null
      },
      selected: {
        currentPlayerAreas: selected.currentPlayerAreas.slice(0, 8),
        handAreas: selected.handAreas.slice(0, 12),
        selectAreas: selected.selectAreas.slice(0, 16),
        stackAreas: selected.stackAreas.slice(0, 12),
        visibleWindows: selected.visibleWindows.slice(0, 16),
        visibleButtons: selected.visibleButtons.slice(0, 40),
        skillNodes: selected.skillNodes.slice(0, 24),
        selfHandCardUis: selected.selfHandCardUis.slice(0, 32),
        promptCandidates: selected.promptCandidates.slice(0, 40)
      },
      classSources,
      notes: [
        "Read-only prompt/action inspection for the current RogueLikeGameScene.",
        "Self hand cards are read only through manager.selfSeatIndex; opponent handCards/watchCards are intentionally skipped.",
        "Use visibleButtons/promptCandidates plus classSources as monitor targets. Do not enable auto-confirm/use without a prompt-specific active sample."
      ]
    };
  })()`;
}

function readmeText(value) {
  const selected = value.selected || {};
  const runtime = value.runtime || {};
  return [
    "# Rogue Battle Prompt Inspect",
    "",
    `- Captured: ${value.capturedAt || ""}`,
    `- Scene: ${runtime.scene?.sceneName || runtime.scene?.className || ""}`,
    `- Manager: ${runtime.manager?.ctor || ""}; seats=${runtime.manager?.seatCount ?? ""}; self=${runtime.manager?.selfSeatIndex ?? ""}`,
    `- Self hand cards: ${runtime.selfSeat?.handCardsCount ?? ""}`,
    `- Current player areas: ${selected.currentPlayerAreas?.length || 0}`,
    `- Hand areas: ${selected.handAreas?.length || 0}`,
    `- Select areas: ${selected.selectAreas?.length || 0}`,
    `- Visible buttons: ${selected.visibleButtons?.length || 0}`,
    `- Skill nodes: ${selected.skillNodes?.length || 0}`,
    `- Prompt candidates: ${selected.promptCandidates?.length || 0}`,
    "",
    "This probe is read-only. It does not click, confirm, cancel, play cards, discard, use skills, buy, refresh, or pay.",
    "",
    "The JSON sidecar contains selected event handlers and method sources for prompt/auto/select/card UI surfaces.",
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
  await writeJson(path.join(dir, "rogue-battle-prompt-inspect.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  const selected = result.value?.selected || {};
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.runtime?.scene?.sceneName || result.value?.runtime?.scene?.className || null,
    manager: result.value?.runtime?.manager ? {
      ctor: result.value.runtime.manager.ctor,
      seatCount: result.value.runtime.manager.seatCount,
      selfSeatIndex: result.value.runtime.manager.selfSeatIndex
    } : null,
    selfHandCards: result.value?.runtime?.selfSeat?.handCardsCount ?? null,
    counts: {
      currentPlayerAreas: selected.currentPlayerAreas?.length || 0,
      handAreas: selected.handAreas?.length || 0,
      selectAreas: selected.selectAreas?.length || 0,
      stackAreas: selected.stackAreas?.length || 0,
      visibleWindows: selected.visibleWindows?.length || 0,
      visibleButtons: selected.visibleButtons?.length || 0,
      skillNodes: selected.skillNodes?.length || 0,
      selfHandCardUis: selected.selfHandCardUis?.length || 0,
      promptCandidates: selected.promptCandidates?.length || 0
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
