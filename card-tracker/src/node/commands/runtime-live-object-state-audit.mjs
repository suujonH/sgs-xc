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
    process.env.SGS_LIVE_OBJECT_STATE_AUDIT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-live-object-state-audit`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  return String(value).replace(/\t|\r?\n/g, " ");
}

function inspectionExpression() {
  return String.raw`(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const isForbiddenHiddenCardKey = (key) => /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(String(key || ""));
    const isCardIdentityKey = (key) => /^(InstanceId|cardId|CardID|id|ID|cardName|name|Suit|suit|Number|number|type|Type|cardType|color|isVirtual|IsVirtual|selected|isSelected|Enabled|enabled)$/i.test(String(key || ""));
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
    const valueKind = (value) => {
      if (value == null) return String(value);
      if (Array.isArray(value)) return "array";
      if (value instanceof Map) return "map";
      if (value instanceof Set) return "set";
      return typeof value === "object" ? (ctor(value) || "object") : typeof value;
    };
    const valueSummary = (value, depth = 0) => {
      const kind = valueKind(value);
      if (value == null || kind === "string" || kind === "number" || kind === "boolean") return value;
      if (kind === "function") return "[Function " + (value.name || "anonymous") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      if (depth > 0) return "[" + kind + "]";
      const keys = own(value).filter((key) => !isForbiddenHiddenCardKey(key)).slice(0, 8);
      const parts = [];
      for (const key of keys) {
        try {
          const v = value[key];
          if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            parts.push(key + "=" + String(v));
          } else if (typeof v === "function") {
            parts.push(key + "=[Function " + (v.name || "anonymous") + "]");
          } else if (Array.isArray(v)) {
            parts.push(key + "=[Array " + v.length + "]");
          } else {
            parts.push(key + "=[" + valueKind(v) + "]");
          }
        } catch {
          parts.push(key + "=[throws]");
        }
      }
      return "[" + kind + (parts.length ? " " + parts.join(", ") : "") + "]";
    };
    const fieldCategory = (key) => {
      const name = String(key || "");
      if (/^(x|y|width|height|scaleX|scaleY|pivotX|pivotY|zOrder|alpha|visible|_visible|mouseEnabled|mouseThrough|_mouseState)$/i.test(name)) return "laya-display-input";
      if (/(event|Event|handler|Handler|callback|Callback|listener|Listener|click|Click|touch|Touch|mouse|Mouse)/.test(name)) return "event-handler";
      if (/(window|Window|scene|Scene|view|View|layer|Layer|panel|Panel|page|Page|tab|Tab)/.test(name)) return "scene-window-ui";
      if (/(btn|Btn|button|Button|confirm|Confirm|cancel|Cancel|ensure|Ensure|ok|OK)/.test(name)) return "button-command";
      if (/(card|Card|deck|Deck|pile|Pile|zone|Zone|hand|Hand|equip|Equip|judge|Judge|discard|Discard|stack|Stack)/.test(name)) return "card-zone";
      if (/(skill|Skill|spell|Spell|zhanfa|ZhanFa|trigger|Trigger|responser|Responser)/.test(name)) return "skill-spell";
      if (/(select|Select|choose|Choose|auto|Auto|opt|Opt|operation|Operation|ask|Ask)/.test(name)) return "selection-automation";
      if (/(effect|Effect|anim|Anim|motion|Motion|tween|Tween|spine|Spine|movie|Movie)/.test(name)) return "effect-animation";
      if (/(state|State|status|Status|phase|Phase|round|Round|turn|Turn|current|Current|over|Over|start|Start|wait|Wait)/.test(name)) return "state-machine";
      if (/(id|ID|index|Index|type|Type|mode|Mode|data|Data|vo|VO|config|Config|name|Name|text|Text|title|Title|desc|Desc)/.test(name)) return "identity-config";
      if (/(money|Money|yuanbao|YuanBao|price|Price|cost|Cost|buy|Buy|pay|Pay|shop|Shop|reward|Reward|award|Award|free|Free)/.test(name)) return "currency-reward-risk";
      if (/(res|Res|skin|Skin|texture|Texture|image|Image|graphics|Graphics|url|Url|URL)/.test(name)) return "resource-drawing";
      return "other";
    };
    const fieldMeaning = (key) => {
      const category = fieldCategory(key);
      const meanings = {
        "laya-display-input": "Laya display geometry, visibility, alpha, or input hit-state.",
        "event-handler": "Event binding or callback entry point; inspect _events/method owner before calling.",
        "scene-window-ui": "Scene/window/view/layer reference or UI container state.",
        "button-command": "Button node or confirm/cancel command; block purchase-risk handlers by default.",
        "card-zone": "Card object, card UI, or zone reference; hidden opponent hand arrays are not expanded.",
        "skill-spell": "Skill/spell/zhanfa object, trigger, prompt, or handler reference.",
        "selection-automation": "Selection state, auto-select helper, prompt operation, or ask/opt context.",
        "effect-animation": "Animation/effect/motion/tween object or lifecycle state.",
        "state-machine": "Runtime state/phase/round/current-turn flag; exact enum needs source/live branch context.",
        "identity-config": "Id/type/name/text/config/data field used to map UI/runtime object to config.",
        "currency-reward-risk": "Currency/reward/shop/free-state field; treat active calls as purchase-risk until proven safe.",
        "resource-drawing": "Laya resource, skin, texture, graphics, or formatted URL field.",
        "other": "Unclassified live field; keep owner/path/value sample for focused follow-up."
      };
      return meanings[category] || meanings.other;
    };
    const publicFieldNames = (obj, pattern, limit = 80) => {
      const names = [];
      for (const key of own(obj).slice(0, 1200)) {
        if (isForbiddenHiddenCardKey(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        names.push(key);
        if (names.length >= limit) break;
      }
      return names;
    };
    const readFieldSamples = (obj, pattern, limit = 80, pathPrefix = "") => {
      const out = [];
      for (const key of publicFieldNames(obj, pattern, limit)) {
        try {
          const value = obj[key];
          out.push({
            field: key,
            category: fieldCategory(key),
            meaning: fieldMeaning(key),
            kind: valueKind(value),
            value: valueSummary(value),
            path: pathPrefix ? pathPrefix + "." + key : key
          });
        } catch {
          out.push({
            field: key,
            category: fieldCategory(key),
            meaning: fieldMeaning(key),
            kind: "throws",
            value: "[throws]",
            path: pathPrefix ? pathPrefix + "." + key : key
          });
        }
      }
      return out;
    };
    const methodNames = (obj, pattern, limit = 120) => {
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
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 60)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            caller: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            once: handler.once === true
          })).slice(0, 10);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const buildCtorNameMap = () => {
      const map = new Map();
      const classMap = Laya?.ClassUtils?._classMap || {};
      for (const name of own(classMap)) {
        let fn = null;
        try { fn = classMap[name]; } catch {}
        if (typeof fn !== "function") continue;
        if (!map.has(fn)) map.set(fn, []);
        map.get(fn).push(name);
      }
      for (const names of map.values()) names.sort();
      return map;
    };
    const ctorNameMap = buildCtorNameMap();
    const registeredNamesFor = (obj) => {
      const names = ctorNameMap.get(obj && obj.constructor) || [];
      return names.slice(0, 20);
    };
    const nodeBase = (node, nodePath) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      registeredNames: registeredNamesFor(node),
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
      childCount: node?.numChildren || 0,
      text: typeof node?.text === "string" ? node.text.slice(0, 160) : ""
    });
    const nodeDetail = (node, nodePath, group) => {
      const methods = methodNames(node, /(enter|Enter|click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|drag|Drag|drop|Drop|tip|Tip|show|Show|hide|Hide|enable|Enable|gray|Gray|effect|Effect|window|Window|close|Close|open|Open|send|Send|handler|Handler)/, 120);
      const fields = readFieldSamples(node, /(id|ID|index|Index|type|Type|mode|Mode|data|Data|vo|VO|config|Config|name|Name|text|Text|title|Title|desc|Desc|event|Event|handler|Handler|callback|Callback|listener|Listener|click|Click|touch|Touch|mouse|Mouse|window|Window|scene|Scene|view|View|layer|Layer|panel|Panel|page|Page|tab|Tab|btn|Btn|button|Button|confirm|Confirm|cancel|Cancel|ensure|Ensure|card|Card|deck|Deck|pile|Pile|zone|Zone|hand|Hand|equip|Equip|judge|Judge|discard|Discard|stack|Stack|skill|Skill|spell|Spell|zhanfa|ZhanFa|trigger|Trigger|select|Select|choose|Choose|auto|Auto|opt|Opt|operation|Operation|ask|Ask|effect|Effect|anim|Anim|motion|Motion|tween|Tween|state|State|status|Status|phase|Phase|round|Round|turn|Turn|current|Current|over|Over|start|Start|wait|Wait|res|Res|skin|Skin|texture|Texture|image|Image|graphics|Graphics|url|Url|URL|money|Money|price|Price|cost|Cost|buy|Buy|pay|Pay|shop|Shop|reward|Reward|award|Award|free|Free)/, 90, nodePath);
      return {
        group,
        ...nodeBase(node, nodePath),
        fields,
        fieldCategoryCounts: fields.reduce((acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + 1;
          return acc;
        }, {}),
        methods,
        methodRoles: methods.map((name) => ({ name, category: fieldCategory(name), meaning: fieldMeaning(name) })).slice(0, 120),
        events: eventSummary(node)
      };
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 18, seen = new Set()) => {
      if (!root || seen.has(root) || depth > maxDepth) return 0;
      seen.add(root);
      let count = 1;
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        count += walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth, seen);
      }
      return count;
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
    const scene = currentScene();
    const manager = scene && (scene.manager || scene.gameManager || scene._manager || scene._gameManager || scene.PveMgr || null);
    const seats = Array.isArray(manager?.seats) ? manager.seats : [];
    const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
    const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
    const selfHandCards = Array.isArray(selfSeat?.handCards) ? selfSeat.handCards : [];
    const samples = [];
    const maybePush = (node, nodePath, group) => {
      if (!node || !isVisible(node)) return;
      if (samples.some((item) => item.path === nodePath && item.group === group)) return;
      samples.push(nodeDetail(node, nodePath, group));
    };
    const groupLimits = {
      scene: 1,
      window: 18,
      button: 80,
      card: 90,
      skill: 90,
      prompt: 80,
      effect: 60,
      resource: 80,
      stateful: 120
    };
    const groupCounts = {};
    const pushLimited = (node, nodePath, group) => {
      groupCounts[group] = groupCounts[group] || 0;
      if (groupCounts[group] >= (groupLimits[group] || 50)) return;
      maybePush(node, nodePath, group);
      groupCounts[group]++;
    };
    if (scene) pushLimited(scene, "currentScene", "scene");
    const visitedCount = walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const label = labelOf(node);
      const events = Object.keys(eventSummary(node));
      const fields = publicFieldNames(node, /(id|ID|index|Index|type|Type|mode|Mode|data|Data|vo|VO|config|Config|name|Name|text|Text|title|Title|desc|Desc|event|Event|handler|Handler|callback|Callback|listener|Listener|click|Click|touch|Touch|mouse|Mouse|window|Window|scene|Scene|view|View|layer|Layer|panel|Panel|page|Page|tab|Tab|btn|Btn|button|Button|confirm|Confirm|cancel|Cancel|ensure|Ensure|card|Card|deck|Deck|pile|Pile|zone|Zone|hand|Hand|equip|Equip|judge|Judge|discard|Discard|stack|Stack|skill|Skill|spell|Spell|zhanfa|ZhanFa|trigger|Trigger|select|Select|choose|Choose|auto|Auto|opt|Opt|operation|Operation|ask|Ask|effect|Effect|anim|Anim|motion|Motion|tween|Tween|state|State|status|Status|phase|Phase|round|Round|turn|Turn|current|Current|over|Over|start|Start|wait|Wait|res|Res|skin|Skin|texture|Texture|image|Image|graphics|Graphics|url|Url|URL|money|Money|price|Price|cost|Cost|buy|Buy|pay|Pay|shop|Shop|reward|Reward|award|Award|free|Free)/, 50);
      const methods = methodNames(node, /(enter|Enter|click|Click|touch|Touch|mouse|Mouse|card|Card|skill|Skill|spell|Spell|select|Select|discard|Discard|play|Play|move|Move|auto|Auto|confirm|Confirm|cancel|Cancel|ensure|Ensure|use|Use|drag|Drag|drop|Drop|tip|Tip|show|Show|hide|Hide|enable|Enable|gray|Gray|effect|Effect|window|Window|close|Close|open|Open|send|Send|handler|Handler)/, 90);
      const text = typeof node?.text === "string" ? node.text : "";
      const hay = [nodePath, label, text, events.join(" "), methods.join(" "), fields.join(" ")].filter(Boolean).join(" ");
      if (/Window|WindowLayer|mWt/.test(hay)) pushLimited(node, nodePath, "window");
      if (/(Button|Btn|btn|click|Click|confirm|Confirm|cancel|Cancel|ensure|Ensure|start|Start)/.test(hay) && (events.length || /click|Click|confirm|Confirm|cancel|Cancel|ensure|Ensure/.test(methods.join(" ")))) pushLimited(node, nodePath, "button");
      if (/(card|Card|deck|Deck|pile|Pile|zone|Zone|discard|Discard|stack|Stack|xWi|Bxt|uBt)/.test(hay)) pushLimited(node, nodePath, "card");
      if (/(skill|Skill|spell|Spell|zhanfa|ZhanFa|pBt|g6i|_6i|BiFa)/.test(hay)) pushLimited(node, nodePath, "skill");
      if (/(SelectCardWindow|SkillSelectorWindow|Select|select|choose|Choose|autoSelect|AutoSelect|prompt|Prompt|ask|Ask|opt|Opt|operation|Operation|fHt|FWi)/.test(hay)) pushLimited(node, nodePath, "prompt");
      if (/(effect|Effect|anim|Anim|motion|Motion|tween|Tween|spine|Spine|movie|Movie|killEffect|effectPool)/.test(hay)) pushLimited(node, nodePath, "effect");
      if (/(res|Res|skin|Skin|texture|Texture|image|Image|graphics|Graphics|url|Url|URL|loadImage|drawTexture)/.test(hay)) pushLimited(node, nodePath, "resource");
      if (/(state|State|status|Status|phase|Phase|round|Round|turn|Turn|current|Current|over|Over|start|Start|wait|Wait|manager|Manager|seat|Seat)/.test(hay)) pushLimited(node, nodePath, "stateful");
    });
    const managerFields = manager ? readFieldSamples(manager, /(self|Self|seat|Seat|turn|Turn|phase|Phase|round|Round|current|Current|table|Table|game|Game|card|Card|stack|Stack|discard|Discard|auto|Auto|opt|Opt|state|State|mode|Mode|skill|Skill|spell|Spell|over|Over|start|Start|wait|Wait|ask|Ask|operation|Operation|select|Select|player|Player)/, 160, "manager") : [];
    const selfSeatFields = selfSeat ? readFieldSamples(selfSeat, /(id|ID|index|Index|seat|Seat|general|General|player|Player|role|Role|hp|HP|Max|dead|Dead|state|State|status|Status|phase|Phase|turn|Turn|count|Count|equip|Equip|judge|Judge|region|Region|skill|Skill|spell|Spell|name|Name|country|Country|shield|Shield|hand|Hand)/, 120, "selfSeat") : [];
    const otherSeatPublic = seats.map((seat, index) => {
      if (index === selfSeatIndex) return null;
      return {
        index,
        ctor: ctor(seat),
        registeredNames: registeredNamesFor(seat),
        fields: readFieldSamples(seat, /(id|ID|index|Index|seat|Seat|general|General|player|Player|role|Role|hp|HP|Max|dead|Dead|state|State|status|Status|phase|Phase|turn|Turn|count|Count|equip|Equip|judge|Judge|region|Region|skill|Skill|spell|Spell|name|Name|country|Country|shield|Shield)/, 60, "seats[" + index + "]")
      };
    }).filter(Boolean);
    const handCards = selfHandCards.slice(0, 60).map((card, index) => {
      const fields = [];
      for (const key of own(card).filter(isCardIdentityKey).slice(0, 40)) {
        try {
          fields.push({
            field: key,
            category: fieldCategory(key),
            meaning: fieldMeaning(key),
            kind: valueKind(card[key]),
            value: valueSummary(card[key]),
            path: "selfSeat.handCards[" + index + "]." + key
          });
        } catch {
          fields.push({ field: key, category: fieldCategory(key), meaning: fieldMeaning(key), kind: "throws", value: "[throws]", path: "selfSeat.handCards[" + index + "]." + key });
        }
      }
      return { index, ctor: ctor(card), registeredNames: registeredNamesFor(card), fields };
    });
    const allFieldRows = [];
    const pushRows = (owner, fields, group, registeredNames = []) => {
      for (const field of fields || []) {
        allFieldRows.push({
          group,
          ownerPath: owner.path || owner,
          ownerLabel: owner.label || owner.ctor || "",
          registeredNames,
          field: field.field,
          category: field.category,
          meaning: field.meaning,
          kind: field.kind,
          value: field.value,
          path: field.path
        });
      }
    };
    if (manager) pushRows({ path: "manager", label: ctor(manager), ctor: ctor(manager) }, managerFields, "manager", registeredNamesFor(manager));
    if (selfSeat) pushRows({ path: "selfSeat", label: ctor(selfSeat), ctor: ctor(selfSeat) }, selfSeatFields, "self-seat", registeredNamesFor(selfSeat));
    for (const seat of otherSeatPublic) pushRows({ path: "seats[" + seat.index + "]", label: seat.ctor, ctor: seat.ctor }, seat.fields, "public-seat", seat.registeredNames);
    for (const card of handCards) pushRows({ path: "selfSeat.handCards[" + card.index + "]", label: card.ctor, ctor: card.ctor }, card.fields, "self-hand-card", card.registeredNames);
    for (const sample of samples) pushRows(sample, sample.fields, sample.group, sample.registeredNames);
    const fieldCategoryCounts = allFieldRows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] || 0) + 1;
      return acc;
    }, {});
    const registeredNameCounts = samples.reduce((acc, sample) => {
      const key = sample.registeredNames?.[0] || sample.className || sample.sceneName || sample.ctor || "(unknown)";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        layaVersion: Laya?.version || "",
        classMapSize: own(Laya?.ClassUtils?._classMap || {}).length,
        visitedNodeCount: visitedCount,
        stage: {
          width: Laya.stage?.width,
          height: Laya.stage?.height,
          childCount: Laya.stage?.numChildren
        },
        currentScene: scene ? nodeBase(scene, "currentScene") : null,
        manager: manager ? {
          ctor: ctor(manager),
          registeredNames: registeredNamesFor(manager),
          fieldCount: managerFields.length,
          fields: managerFields,
          methodNames: methodNames(manager, /(Client|ServerProxy|Send|send|decode|Msg|msg|GsC|Pub|RoleOpt|Select|Card|Skill|Spell|Use|Move|Game|State|Ntf|Rep|Req|Auto|Ask|Operate|Table|Rogue)/, 220)
        } : null,
        seats: {
          count: seats.length,
          selfSeatIndex,
          selfSeat: selfSeat ? {
            ctor: ctor(selfSeat),
            registeredNames: registeredNamesFor(selfSeat),
            fieldCount: selfSeatFields.length,
            fields: selfSeatFields,
            handCardsCount: selfHandCards.length,
            handCards
          } : null,
          otherSeatPublic
        }
      },
      sampleStats: {
        samples: samples.length,
        groups: samples.reduce((acc, sample) => {
          acc[sample.group] = (acc[sample.group] || 0) + 1;
          return acc;
        }, {}),
        fieldRows: allFieldRows.length,
        fieldCategoryCounts,
        registeredNameCounts
      },
      samples,
      fieldRows: allFieldRows,
      notes: [
        "Read-only CDP Runtime.evaluate sample from Laya.stage.",
        "Opponent hidden hand arrays are intentionally not expanded.",
        "Self hand is read only through manager.selfSeatIndex -> selfSeat.handCards.",
        "Field meanings are heuristic categories tied to owner path and live value; exact enum values still need source/live branch evidence."
      ]
    };
  })()`;
}

function markdownReport(value) {
  const lines = [];
  lines.push("# Live Object State Audit");
  lines.push("");
  lines.push(`- Captured: ${value.capturedAt || ""}`);
  lines.push(`- Page: ${value.page?.title || ""} ${value.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${value.runtime?.resourceVersion || ""}`);
  lines.push(`- Laya: ${value.runtime?.layaVersion || ""}`);
  lines.push(`- Current scene: ${value.runtime?.currentScene?.label || ""}`);
  lines.push(`- ClassUtils names: ${value.runtime?.classMapSize || 0}`);
  lines.push(`- Visited Laya nodes: ${value.runtime?.visitedNodeCount || 0}`);
  lines.push(`- Sampled objects: ${value.sampleStats?.samples || 0}`);
  lines.push(`- Field rows: ${value.sampleStats?.fieldRows || 0}`);
  lines.push("");
  lines.push("## Runtime Anchors");
  lines.push("");
  const scene = value.runtime?.currentScene || {};
  lines.push(`- Scene path: ${scene.path || "currentScene"}`);
  lines.push(`- Scene registered names: ${(scene.registeredNames || []).join(", ")}`);
  lines.push(`- Scene visible: ${scene.effectiveVisible === true}`);
  const manager = value.runtime?.manager;
  if (manager) {
    lines.push(`- Manager: ${manager.ctor || ""}; registered=${(manager.registeredNames || []).join(", ")}; fields=${manager.fieldCount || 0}; methods=${manager.methodNames?.length || 0}`);
  }
  const seats = value.runtime?.seats || {};
  lines.push(`- Seats: count=${seats.count || 0}; selfSeatIndex=${Number.isInteger(seats.selfSeatIndex) ? seats.selfSeatIndex : ""}; selfHandCards=${seats.selfSeat?.handCardsCount || 0}`);
  lines.push("");
  lines.push("## Sample Groups");
  lines.push("");
  for (const [group, count] of Object.entries(value.sampleStats?.groups || {}).sort()) {
    lines.push(`- ${group}: ${count}`);
  }
  lines.push("");
  lines.push("## Field Categories");
  lines.push("");
  for (const [category, count] of Object.entries(value.sampleStats?.fieldCategoryCounts || {}).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("");
  lines.push("## Key Manager Fields");
  lines.push("");
  for (const field of (manager?.fields || []).slice(0, 80)) {
    lines.push(`- ${field.path}: ${field.kind} ${field.value} (${field.category})`);
  }
  lines.push("");
  lines.push("## Self Seat / Hand");
  lines.push("");
  for (const field of (seats.selfSeat?.fields || []).slice(0, 70)) {
    lines.push(`- ${field.path}: ${field.kind} ${field.value} (${field.category})`);
  }
  for (const card of (seats.selfSeat?.handCards || []).slice(0, 20)) {
    const values = (card.fields || []).map((field) => `${field.field}=${field.value}`).join(", ");
    lines.push(`- selfSeat.handCards[${card.index}] ${card.ctor || ""}: ${values}`);
  }
  lines.push("");
  lines.push("## Interesting Objects");
  lines.push("");
  for (const sample of (value.samples || []).slice(0, 120)) {
    const fields = (sample.fields || []).slice(0, 8).map((field) => `${field.field}=${field.value}`).join(", ");
    const events = Object.keys(sample.events || {}).join(",");
    lines.push(`- [${sample.group}] ${sample.path} ${sample.label} registered=${(sample.registeredNames || []).join("|")} fields=${fields} events=${events}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const note of value.notes || []) lines.push(`- ${note}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function fieldRowsTsv(rows) {
  const header = ["group", "ownerPath", "ownerLabel", "registeredNames", "field", "category", "kind", "value", "meaning", "path"];
  const lines = [header.join("\t")];
  for (const row of rows || []) {
    lines.push(header.map((key) => tsvEscape(row[key])).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectionExpression(), { timeoutMs: 45000, cdpTimeoutMs: 90000 });
  const value = result.value;
  await writeJson(path.join(dir, "live-object-state-audit.json"), value);
  await writeFile(path.join(dir, "live-object-state-audit.md"), markdownReport(value), "utf8");
  await writeFile(path.join(dir, "live-object-field-samples.tsv"), fieldRowsTsv(value.fieldRows || []), "utf8");
  await writeFile(path.join(dir, "README.md"), markdownReport(value), "utf8");
  console.log(JSON.stringify({
    dir,
    scene: value.runtime?.currentScene?.label || "",
    classMapSize: value.runtime?.classMapSize || 0,
    visitedNodeCount: value.runtime?.visitedNodeCount || 0,
    sampleStats: value.sampleStats,
    selfHandCards: value.runtime?.seats?.selfSeat?.handCardsCount || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
