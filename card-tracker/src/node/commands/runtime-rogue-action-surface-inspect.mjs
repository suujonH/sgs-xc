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
    process.env.SGS_ROGUE_ACTION_SURFACE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-action-surface-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectExpression() {
  return String.raw`(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const classLabel = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = classLabel(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const effectiveVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const simple = (value) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + (ctor(value) || type) + "]";
    };
    const plainFields = (obj, pattern, limit = 120) => {
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
    const methodSourcesFromProto = (ctorValue, names, limit = 6000) => {
      const out = {};
      const proto = ctorValue && ctorValue.prototype;
      for (const name of names) {
        try {
          const fn = proto && proto[name];
          out[name] = typeof fn === "function" ? String(fn).slice(0, limit) : null;
        } catch (error) {
          out[name] = "[throws " + String(error && error.message || error) + "]";
        }
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
            caller: handler.caller ? "[" + classLabel(handler.caller) + "]" : null,
            method: handler.method && (handler.method.name || String(handler.method).slice(0, 220)),
            args: Array.isArray(handler.args) ? handler.args.map(simple).slice(0, 12) : simple(handler.args),
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
      const count = root.numChildren || 0;
      for (let i = 0; i < count; i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth);
      }
    };
    const nodeSummary = (node, nodePath) => ({
      path: nodePath,
      label: classLabel(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      resName: node && node._resName || "",
      uiid: node && node._uiid || "",
      visible: node && node.visible,
      alpha: node && node.alpha,
      effectiveVisible: effectiveVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node && node.x,
      y: node && node.y,
      width: node && node.width,
      height: node && node.height,
      text: node && (node.text || node._text || node.label || node._label || "") || "",
      childCount: node && node.numChildren || 0,
      fields: plainFields(node, /(id|ID|fight|Fight|rogue|Rogue|event|Event|skill|Skill|spell|Spell|zhan|Zhan|card|Card|select|Select|btn|Btn|button|Button|data|Data|state|State|status|Status|name|Name|text|Text|label|Label|tool|Tool|tip|Tip|visible|Visible|disabled|Disabled|gray|Gray|enable|Enable|reward|Reward|general|General|effect|Effect)/, 100),
      events: eventSummary(node),
      methods: methodNames(node, /(click|Click|touch|Touch|select|Select|confirm|Confirm|cancel|Cancel|auto|Auto|send|Send|use|Use|skill|Skill|spell|Spell|tip|Tip|show|Show|hide|Hide|start|Start|fight|Fight|rogue|Rogue|refresh|Refresh|change|Change)/, 120)
    });
    const locateSceneManager = () => {
      const CU = Laya && Laya.ClassUtils;
      let popup = null, ged = null, sceneManager = null;
      try { popup = CU && CU.getInstance && CU.getInstance("PopUpWindow") || null; } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try {
        const handlers = ged && ged._events && ged._events.SWITCH_SCENE;
        const arr = Array.isArray(handlers) ? handlers : handlers ? [handlers] : [];
        sceneManager = arr.map((item) => item && item.caller).find((item) => item && ("CurrentScene" in item || "IsGameScene" in item || typeof item.SwitchScene === "function")) || null;
      } catch {}
      return sceneManager;
    };
    const currentScene = () => {
      const sceneManager = locateSceneManager();
      if (sceneManager && sceneManager.CurrentScene) return sceneManager.CurrentScene;
      let layer = null;
      walk(Laya.stage, (node) => {
        if (!layer && /LBi|SceneLayer/.test(classLabel(node))) layer = node;
      }, "Laya.stage", 0, 1);
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const child = layer.getChildAt(i);
        if (effectiveVisible(child)) return child;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const classMap = Laya && Laya.ClassUtils && Laya.ClassUtils._classMap || {};
    const classSpecs = {
      RogueSmallMapScene: ["TriggerCurEvent", "TriggerEvent", "sendGotoFightMsg", "sendGotoGambleMsg", "UpdateRogueData", "updateZhanFaItemTrigger"],
      RogueFightWindow: ["enterWindow", "createSkillBtn", "showTipHandler", "showGeneralTipHandler", "startbtnClick", "gotoJishi", "enableEffect", "removeEffect"],
      ChangeSKillWindow: ["enterWindow", "showTipHandler", "showSkillPanel", "onSelect", "onChange", "forgetChange"],
      Rogue1v1ChangeSkillWindow: ["enterWindow", "showTipHandler", "showSkillPanel", "onSelect", "onChange", "forgetChange"],
      SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
      RogueJiShiWindow: ["enterWindow", "shopBtnClick", "refreshBtnClick", "buy", "confirmBuy", "Close"]
    };
    const classSources = {};
    for (const [registeredName, methods] of Object.entries(classSpecs)) {
      const cls = classMap[registeredName];
      classSources[registeredName] = {
        exists: !!cls,
        functionName: cls && cls.name || "",
        methods: methodSourcesFromProto(cls, methods)
      };
    }
    const scene = currentScene();
    const windowNodes = [];
    const rogueFightWindows = [];
    const changeSkillWindows = [];
    const bottomSkillButtons = [];
    const zhanfaButtons = [];
    const generalTooltipNodes = [];
    const clickableNodes = [];
    walk(Laya.stage, (node, nodePath) => {
      const label = classLabel(node);
      if (/WindowLayer|mWt/.test(label) || /Window|modalBg|RogueFightWindow|ChangeSKillWindow|RogueComChangeWindow|Rogue1v1ChangeSkillWindow|SkillBiFaRogueWindow/.test(label)) {
        if (effectiveVisible(node) && (/Window|modalBg|RogueFightWindow|ChangeSKillWindow|RogueComChangeWindow|Rogue1v1ChangeSkillWindow|SkillBiFaRogueWindow/.test(label))) {
          windowNodes.push(nodeSummary(node, nodePath));
        }
      }
      if (/RogueFightWindow/.test(label) && effectiveVisible(node)) rogueFightWindows.push({ node, path: nodePath });
      if (/ChangeSKillWindow|Rogue1v1ChangeSkillWindow|RogueComChangeWindow|SkillBiFaRogueWindow/.test(label) && effectiveVisible(node)) changeSkillWindows.push({ node, path: nodePath });
      if (/aKi/.test(label) && effectiveVisible(node)) bottomSkillButtons.push({ node, path: nodePath });
      if (/g6i/.test(label) && effectiveVisible(node)) zhanfaButtons.push({ node, path: nodePath });
      if (node && (node.GeneralToolTip || node.generalToolTip) && effectiveVisible(node)) generalTooltipNodes.push({ node, path: nodePath });
      if (effectiveVisible(node) && node && node._events && (node._events.click || node._events.mousedown || node._events.mouseover)) {
        clickableNodes.push(nodeSummary(node, nodePath));
      }
    });
    const pveMgr = scene && (scene.PveMgr || scene.pveMgr || scene.manager) || null;
    const chapter = pveMgr && (pveMgr.ChapterData || pveMgr.chapterData || pveMgr.AllDatas && pveMgr.AllDatas.chapterData || pveMgr.allDatas && pveMgr.allDatas.chapterData) || null;
    const sceneData = {
      scene: nodeSummary(scene, "currentScene"),
      pveMgr: pveMgr ? {
        ctor: ctor(pveMgr),
        fields: plainFields(pveMgr, /(Chapter|chapter|Current|current|Money|money|Shop|shop|Event|event|Fight|fight|Skill|skill|Data|data|State|state|Status|status|Map|map|Line|line|Diff|diff|Id|ID)/, 160),
        methodSources: {
          RogueLikeEventSelectReq: typeof pveMgr.RogueLikeEventSelectReq === "function" ? String(pveMgr.RogueLikeEventSelectReq).slice(0, 5000) : null,
          RogueLikeDataReq: typeof pveMgr.RogueLikeDataReq === "function" ? String(pveMgr.RogueLikeDataReq).slice(0, 5000) : null,
          ClientRogueLikeSelectMoveReq: typeof pveMgr.ClientRogueLikeSelectMoveReq === "function" ? String(pveMgr.ClientRogueLikeSelectMoveReq).slice(0, 5000) : null
        }
      } : null,
      chapter: chapter ? {
        ctor: ctor(chapter),
        fields: plainFields(chapter, /(cur|Cur|location|Location|chapter|Chapter|event|Event|fight|Fight|select|Select|data|Data|state|State|line|Line|boss|Boss|shop|Shop|id|ID)/, 180),
        curEventData: chapter.curEventData ? plainFields(chapter.curEventData, /(event|Event|type|Type|id|ID|data|Data|select|Select|fight|Fight|lose|Lose|reward|Reward|state|State)/, 140) : null
      } : null
    };
    const fightWindows = rogueFightWindows.map(({ node, path }) => ({
      summary: nodeSummary(node, path),
      specific: {
        fightId: node.fightId,
        isBoss: node.isBoss,
        rewardItemsLength: Array.isArray(node.rewardItems) ? node.rewardItems.length : null,
        generalItemsLength: Array.isArray(node.generalItems) ? node.generalItems.length : null,
        generalHeadItemsLength: Array.isArray(node.generalHeadItems) ? node.generalHeadItems.length : null,
        skillBtnsLength: Array.isArray(node.skillBtns) ? node.skillBtns.length : null,
        startBtn: node.startBtn ? nodeSummary(node.startBtn, path + ".startBtn") : null,
        closeBtn: node.closeBtn ? nodeSummary(node.closeBtn, path + ".closeBtn") : null,
        playVideoBtn: node.playVideoBtn ? nodeSummary(node.playVideoBtn, path + ".playVideoBtn") : null,
        skillBtns: Array.isArray(node.skillBtns) ? node.skillBtns.map((btn, index) => nodeSummary(btn, path + ".skillBtns[" + index + "]")) : []
      }
    }));
    const summarizeButton = ({ node, path }) => ({
      summary: nodeSummary(node, path),
      tooltipKind: typeof node.ToolTip === "function" || typeof node.toolTip === "function"
        ? "function"
        : node.ToolTip || node.toolTip || node.GeneralToolTip || node.generalToolTip ? "value" : "none",
      tooltipValue: simple(node.ToolTip || node.toolTip || node.GeneralToolTip || node.generalToolTip),
      dataSource: node.dataSource ? plainFields(node.dataSource, /(id|ID|skill|Skill|spell|Spell|name|Name|desc|Desc|type|Type|data|Data|state|State)/, 80) : null,
      relateData: node.relateData ? plainFields(node.relateData, /(id|ID|skill|Skill|spell|Spell|name|Name|desc|Desc|type|Type|data|Data|state|State)/, 80) : null
    });
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      resourceVersion: window.resourceVersion || "",
      sceneData,
      windowNodes: windowNodes.slice(0, 120),
      fightWindows,
      changeSkillWindows: changeSkillWindows.map(({ node, path }) => nodeSummary(node, path)),
      bottomSkillButtons: bottomSkillButtons.map(summarizeButton),
      zhanfaButtons: zhanfaButtons.map(summarizeButton),
      generalTooltipNodes: generalTooltipNodes.map(({ node, path }) => nodeSummary(node, path)).slice(0, 80),
      clickableNodes: clickableNodes.slice(0, 160),
      classSources,
      conclusions: {
        stableIdentity: "Use Laya.ClassUtils registered class strings plus node._className_/name/_resName/effective visibility; do not key automation on minified constructor names.",
        fightConfirm: "RogueFightWindow.startbtnClick builds {eventId:this.fightId,eventType:sW.Fight}, calls AYt.I().RogueLikeEventSelectReq, plays rogue_guanqia, and emits SHOW_FULL_MASK_LOADING.",
        safeMonitor: "Passive monitor should hook RogueFightWindow.startbtnClick, RogueSmallMapScene.sendGotoFightMsg/sendGotoGambleMsg, PveMgr.RogueLikeEventSelectReq, GED/window events, and proxy.L; do not call startbtnClick without an explicit active-use run.",
        bottomButtons: "Visible aKi/g6i nodes expose Laya events and tooltip/data fields; active use needs a per-skill sample because some buttons are passive skill descriptors while others may open selection/send paths."
      }
    };
  })()`;
}

function readmeText(value) {
  const fight = value.fightWindows?.[0];
  const methods = value.classSources?.RogueFightWindow?.methods || {};
  const startMethod = methods.startbtnClick ? "`startbtnClick` present" : "`startbtnClick` missing";
  return [
    "# Rogue Action Surface Inspection",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.page?.title || ""} ${value.page?.url || ""}`,
    `- ResourceVersion: ${value.resourceVersion || ""}`,
    `- Scene: ${value.sceneData?.scene?.sceneName || value.sceneData?.scene?.className || ""}`,
    `- Visible windows: ${value.windowNodes?.length || 0}`,
    `- RogueFightWindow instances: ${value.fightWindows?.length || 0}`,
    `- Current fightId: ${fight?.specific?.fightId ?? ""}`,
    `- Bottom skill buttons: ${value.bottomSkillButtons?.length || 0}`,
    `- Zhanfa buttons: ${value.zhanfaButtons?.length || 0}`,
    "",
    "## Findings",
    "",
    `- Fight confirm source: ${startMethod}; it sends through ` + "`AYt.I().RogueLikeEventSelectReq({eventId, eventType: Fight})`.",
    "- Stable monitor points: `RogueFightWindow.startbtnClick`, `RogueSmallMapScene.sendGotoFightMsg`, `RogueSmallMapScene.sendGotoGambleMsg`, `PveMgr.RogueLikeEventSelectReq`, `proxy.L`, GED/window events, and effective visible `WindowLayer` nodes.",
    "- The command did not click, confirm, enter battle, use skills, buy, refresh, or inspect hidden hand fields.",
    "- For unattended active use, use this report as the guard list first; then run a separate explicit active sample that records before/after scene and outgoing protocol calls.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "rogue-action-surface-inspect.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.sceneData?.scene?.sceneName || result.value?.sceneData?.scene?.className || null,
    windows: result.value?.windowNodes?.length || 0,
    fightWindows: result.value?.fightWindows?.length || 0,
    fightId: result.value?.fightWindows?.[0]?.specific?.fightId ?? null,
    bottomSkillButtons: result.value?.bottomSkillButtons?.length || 0,
    zhanfaButtons: result.value?.zhanfaButtons?.length || 0
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
