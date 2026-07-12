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
    process.env.SGS_ROGUE_SKILL_ZHANFA_PROBE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-skill-zhanfa-probe`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function probeExpression() {
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
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth >= 1 ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 20).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 20).map(String) };
      const keys = own(value).slice(0, 40);
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
          if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, pattern, limit = 100) => {
      const out = {};
      for (const key of own(obj).slice(0, 1000)) {
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
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
    const methodSources = (obj, names, limit = 2400) => {
      const out = {};
      for (const name of names) {
        try { out[name] = typeof obj?.[name] === "function" ? String(obj[name]).slice(0, limit) : null; } catch (error) { out[name] = "[throws " + String(error && error.message || error) + "]"; }
      }
      return out;
    };
    const methodSourcesFromProto = (cls, names, limit = 5000) => {
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
      for (const key of own(events).slice(0, 80)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            callerLabel: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            methodSource: handler.method ? String(handler.method).slice(0, 2200) : null,
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 10) : simple(handler.args),
            once: handler.once
          })).slice(0, 30);
        } catch (error) {
          out[key] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 14) => {
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
      fields: safeFields(node, /(id|ID|skill|Skill|spell|Spell|zhan|Zhan|item|Item|good|Good|card|Card|type|Type|data|Data|state|State|status|Status|select|Select|trigger|Trigger|btn|Btn|button|Button|name|Name|text|Text|tip|Tip|tool|Tool|visible|Visible|enable|Enable|disable|Disable|gray|Gray|effect|Effect|count|Count|num|Num|slot|Slot)/, 120),
      methods: methodNames(node, /(click|Click|touch|Touch|select|Select|confirm|Confirm|cancel|Cancel|auto|Auto|send|Send|use|Use|skill|Skill|spell|Spell|tip|Tip|show|Show|hide|Hide|zhan|Zhan|trigger|Trigger|refresh|Refresh|change|Change)/, 120),
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
    const bottomView = scene && (scene.bottomView || scene.BottomView || null);
    const buttons = [];
    walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const label = labelOf(node);
      if (/aKi|g6i|FWi|N9t/.test(label)) {
        const parent = node.parent || node._parent || null;
        buttons.push({
          kind: /aKi/.test(label) ? "bottom-skill-aKi" : /g6i/.test(label) ? "zhanfa-button-g6i" : /FWi/.test(label) ? "zhanfa-slot-FWi" : "zhanfa-container-N9t",
          summary: nodeSummary(node, nodePath),
          parent: parent ? nodeSummary(parent, nodePath + ".__parent") : null,
          dataSource: node.dataSource ? safeFields(node.dataSource, /(id|ID|skill|Skill|spell|Spell|zhan|Zhan|item|Item|good|Good|type|Type|name|Name|desc|Desc|data|Data|state|State|trigger|Trigger|count|Count|num|Num)/, 100) : null,
          relateData: node.relateData ? safeFields(node.relateData, /(id|ID|skill|Skill|spell|Spell|zhan|Zhan|item|Item|good|Good|type|Type|name|Name|desc|Desc|data|Data|state|State|trigger|Trigger|count|Count|num|Num)/, 100) : null,
          tooltip: simple(node.ToolTip || node.toolTip || node.GeneralToolTip || node.generalToolTip)
        });
      }
    });
    const classMap = Laya?.ClassUtils?._classMap || {};
    const classSpecs = {
      RogueSmallMapScene: ["updateZhanFaItemTrigger", "TriggerEvent", "sendGotoFightMsg", "sendGotoGambleMsg", "SelectEventCallBack"],
      ChangeSKillWindow: ["enterWindow", "showSkillPanel", "onSelect", "onChange", "forgetChange", "showTipHandler"],
      Rogue1v1ChangeSkillWindow: ["enterWindow", "showSkillPanel", "onSelect", "onChange", "forgetChange", "showTipHandler"],
      ChangeZhanFalWindow: ["enterWindow", "UpdateWindow", "clickZhanfaItem", "onChange", "confirmClick", "Close"],
      DeleteZhanFaWindow: ["enterWindow", "UpdateWindow", "clickZhanfaItem", "onChange", "confirmClick", "Close"],
      SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
      RogueFightWindow: ["createSkillBtn", "showTipHandler", "showGeneralTipHandler", "checkStart", "startbtnClick"]
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
    const ctorToRegistered = {};
    for (const [name, cls] of Object.entries(classMap)) {
      if (!cls || !cls.name) continue;
      if (!ctorToRegistered[cls.name]) ctorToRegistered[cls.name] = [];
      ctorToRegistered[cls.name].push(name);
    }
    const buttonCtorNames = Array.from(new Set(buttons.flatMap((button) => [button.summary.ctor, button.parent?.ctor].filter(Boolean))));
    const matchingRegistered = Object.fromEntries(buttonCtorNames.map((name) => [name, ctorToRegistered[name] || []]));
    const bottomViewSummary = bottomView ? {
      summary: nodeSummary(bottomView, "currentScene.bottomView"),
      methods: methodNames(bottomView, /(Get|Update|LayOut|Skill|Card|Zhan|Item|Trigger|Open|Click|Select|Use|Send|Refresh)/, 160),
      methodSources: methodSources(bottomView, [
        "GetSkillitem",
        "GetCardItem",
        "UpdateGameData",
        "UpdateHandCards",
        "LayOutCard",
        "LayOutCardSpacing",
        "updateZhanFaItemTrigger",
        "OpenGeneralWin"
      ], 4200)
    } : null;
    const pveMgr = scene && (scene.PveMgr || scene.pveMgr || null);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        scene: scene ? nodeSummary(scene, "currentScene") : null,
        bottomView: bottomViewSummary,
        pveMgrFields: pveMgr ? safeFields(pveMgr, /(Skill|skill|Zhan|zhan|Item|item|Event|event|Chapter|chapter|Data|data|Trigger|trigger|Cur|cur|Current|current|Money|money)/, 120) : null
      },
      matchingRegistered,
      buttons,
      classSources,
      conclusions: {
        bottomSkillButtons: "Visible aKi nodes are bottom skill descriptors; their automation value depends on their bound click/tip handlers and data fields.",
        zhanfaButtons: "Visible g6i/FWi nodes are zhanfa/item slots; active use must be proven through their click handlers or server notifications before unattended automation.",
        sendPaths: "Replacement/selection windows such as ChangeSKillWindow and ChangeZhanFalWindow send through RogueLikeEventSelectReq; the exact event payload is window-specific and must be sampled per prompt."
      }
    };
  })()`;
}

function readmeText(value) {
  const buttons = value.buttons || [];
  const byKind = {};
  for (const item of buttons) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
  const classLines = Object.entries(value.classSources || {}).map(([name, item]) => `- ${name}: exists=${!!item.exists}, function=${item.functionName || ""}`);
  return [
    "# Rogue Skill / Zhanfa Probe",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- ResourceVersion: ${value.runtime?.resourceVersion || ""}`,
    `- Scene: ${value.runtime?.scene?.sceneName || value.runtime?.scene?.className || ""}`,
    `- Buttons: ${JSON.stringify(byKind)}`,
    "",
    "## Registered Class Sources",
    "",
    ...classLines,
    "",
    "## Findings",
    "",
    "- This probe is read-only. It records visible bottom skill/zhanfa button nodes, their Laya events, handler source snippets, related data fields, registered class mappings, and candidate send windows.",
    "- It does not click buttons, use skills/items, buy, refresh, pay, or inspect hidden hand fields.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(probeExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "rogue-skill-zhanfa-probe.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  const byKind = {};
  for (const item of result.value?.buttons || []) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.runtime?.scene?.sceneName || result.value?.runtime?.scene?.className || null,
    buttons: byKind,
    registeredClasses: Object.fromEntries(Object.entries(result.value?.classSources || {}).map(([name, item]) => [name, !!item.exists]))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
