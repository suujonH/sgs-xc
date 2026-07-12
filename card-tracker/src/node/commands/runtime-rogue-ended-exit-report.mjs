import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

const exitMethodNames = [
  "BackBtnClickHandler",
  "onClickContinue",
  "leaveGameHandler",
  "leaveGameHandler2",
  "leaveGameHandler3",
  "leaveTableHandler",
  "confirmQuitTbale",
  "confirmQuitReplay",
  "gameStopBack",
  "voiceLeaveSuccess",
  "rogueOverGame",
  "rogueRestartGame",
  "rogueCanQuitBtnGrayHandler",
  "rogueCanQuitTimeHandler",
  "rogueRestartBtnGrayHandler",
  "rogueRestartTimeHandler",
  "showAutoLeaveTableUI",
  "showGameResultWindow",
  "closeWindowBeforeSelectGeneral"
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ROGUE_ENDED_EXIT_REPORT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-ended-exit-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashSource(source) {
  return source ? createHash("sha1").update(source).digest("hex").slice(0, 16) : "";
}

function compactSource(source, max = 260) {
  return String(source || "").replace(/\s+/g, " ").slice(0, max);
}

function classifySource(source) {
  const text = String(source || "");
  const tags = [];
  if (/RogueLike.*Req|proxy\.L|\.L\(|send|Send|Client|Ntf|Req|Leave|leaveTable|leaveGame/i.test(text)) tags.push("send-or-leave-path");
  if (/SwitchScene|enterNextScene|SceneManager|gotoUI|BackFrontView|ModeScene|RogueSmallMapScene/i.test(text)) tags.push("scene-switch");
  if (/Confirm|confirm|ON_SHOW_COMFIRM|SHOW_COMFIRM|确定|离开|退出/.test(text)) tags.push("confirm-gated");
  if (/buy|Buy|pay|Pay|shop|Shop|refresh|Refresh|YuanBao|Recharge/i.test(text)) tags.push("purchase-risk");
  if (/GameResultWindow|showGameResultWindow|gameOver|isGameOver|rogueOverGame/i.test(text)) tags.push("battle-end");
  if (/restart|Restart|重新|复活|lose|Lose/i.test(text)) tags.push("restart-or-retry");
  if (!tags.length) tags.push("source-only");
  return tags;
}

function inspectionExpression(methodNames) {
  return "(" + String.raw`(methodNames) => {
    const blockedFieldPattern = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
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
      const out = { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const fields = {};
      for (const key of own(obj).slice(0, 1600)) {
        if (blockedFieldPattern.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { fields[key] = simple(obj[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= limit) break;
      }
      return fields;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const eventName of own(events).slice(0, 48)) {
        try {
          const raw = events[eventName];
          const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
          out[eventName] = handlers.filter(Boolean).map((handler) => ({
            caller: labelOf(handler.caller),
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
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        return p ? { x: p.x, y: p.y, width: node.width || 0, height: node.height || 0 } : null;
      } catch {
        return null;
      }
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 14, seen = new Set()) => {
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
    const sceneSummary = currentScene ? {
      path: "currentScene",
      label: labelOf(currentScene),
      ctor: ctor(currentScene),
      name: currentScene.name || "",
      className: currentScene._className_ || "",
      sceneName: currentScene.sceneName || currentScene.SceneName || "",
      effectiveVisible: isVisible(currentScene),
      childCount: currentScene.numChildren || 0,
      fields: safeFields(currentScene, /(Back|back|leave|Leave|quit|Quit|continue|Continue|restart|Restart|rogue|Rogue|game|Game|over|Over|scene|Scene|state|State|status|Status|can|Can|is[A-Z]|need|Need|result|Result|window|Window|select|Select)/, 90),
      events: eventSummary(currentScene)
    } : null;
    const visibleWindows = [];
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) {
        const child = windowLayer.getChildAt(i);
        if (!isVisible(child)) continue;
        visibleWindows.push({
          path: "WindowLayer#" + i,
          label: labelOf(child),
          ctor: ctor(child),
          className: child._className_ || "",
          sceneName: child.sceneName || child.SceneName || "",
          fields: safeFields(child, /(name|Name|close|Close|confirm|Confirm|result|Result|window|Window|game|Game|modal|Modal|is[A-Z]|can[A-Z])/, 60)
        });
      }
    }
    const buttonCandidates = [];
    for (const root of [currentScene, windowLayer].filter(Boolean)) {
      walk(root, (node, nodePath) => {
        if (!isVisible(node)) return;
        const label = labelOf(node);
        const text = (() => { try { return typeof node.text === "string" ? node.text : typeof node._text === "string" ? node._text : ""; } catch { return ""; } })();
        const events = eventSummary(node);
        const fieldKeys = Object.keys(safeFields(node, /(Back|back|return|Return|leave|Leave|continue|Continue|restart|Restart|click|Click|btn|Btn|button|Button|text|Text|tip|Tip|card|Card|skill|Skill|select|Select)/, 24)).join(" ");
        const hay = [nodePath, label, text, Object.keys(events).join(" "), fieldKeys].join(" ");
        if (!/(返回|继续|重开|离开|退出|Back|back|Return|return|Continue|continue|Restart|restart|leave|Leave|quit|Quit|Button|Btn|hVi|SgsTabButton|click|mouseover|toolTip|card|Card|skill|Skill|select|Select)/.test(hay)) return;
        buttonCandidates.push({
          path: nodePath,
          label,
          ctor: ctor(node),
          text,
          bounds: boundsOf(node),
          events,
          fields: safeFields(node, /(Back|back|return|Return|leave|Leave|continue|Continue|restart|Restart|click|Click|btn|Btn|button|Button|text|Text|tip|Tip|card|Card|skill|Skill|select|Select)/, 30)
        });
      }, root === currentScene ? "CurrentScene" : "WindowLayer", 0, root === currentScene ? 10 : 12);
    }
    const cls = (() => {
      try { return Laya.ClassUtils.getClass?.("RogueLikeGameScene") || Laya.ClassUtils._classMap?.RogueLikeGameScene || null; } catch { return null; }
    })();
    const classMethods = {};
    for (const name of methodNames) {
      const instanceFn = currentScene && typeof currentScene[name] === "function" ? currentScene[name] : null;
      const protoFn = cls && cls.prototype && typeof cls.prototype[name] === "function" ? cls.prototype[name] : null;
      const fn = protoFn || instanceFn;
      classMethods[name] = fn ? {
        exists: true,
        functionName: fn.name || "",
        arity: fn.length,
        owner: protoFn ? "RogueLikeGameScene.prototype" : "currentScene",
        source: String(fn)
      } : { exists: false };
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
      currentScene: sceneSummary,
      manager: manager ? {
        ctor: ctor(manager),
        seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
        selfSeatIndex: Number.isInteger(manager.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager.SelfSeatIndex) ? manager.SelfSeatIndex : null,
        isGameOver: manager.isGameOver === true,
        hasGameOverData: !!manager.gameOverData,
        gameRound: manager.gameRound,
        gameTurn: manager.gameTurn,
        currentRoundSeatID: manager.currentRoundSeatID,
        fields: safeFields(manager, /(game|Game|round|Round|turn|Turn|state|State|status|Status|over|Over|seat|Seat|current|Current|self|Self|can|Can|is[A-Z]|rogue|Rogue|quit|Quit|leave|Leave)/, 80)
      } : null,
      visibleWindows,
      buttonCandidates: buttonCandidates.slice(0, 180),
      class: {
        exists: !!cls,
        functionName: cls && cls.name || "",
        methods: classMethods
      },
      safety: {
        clicked: false,
        calledSceneMethod: false,
        purchaseCallsMade: false,
        hiddenOpponentHandRead: false,
        note: "Read-only Rogue ended-state exit report. Sensitive hand/watch/hidden fields are filtered by key."
      }
    };
  }` + ")(" + JSON.stringify(methodNames) + ")";
}

function enrich(value) {
  const methods = value.class?.methods || {};
  const enrichedMethods = {};
  for (const [name, item] of Object.entries(methods)) {
    if (!item?.exists) {
      enrichedMethods[name] = item;
      continue;
    }
    const source = item.source || "";
    enrichedMethods[name] = {
      ...item,
      sourceHash: hashSource(source),
      sourceLength: source.length,
      sourcePreview: compactSource(source, 420),
      tags: classifySource(source),
      mentions: {
        proxySend: /proxy\.L|\.L\(|send|Send|Req|Ntf|Client/i.test(source),
        confirm: /Confirm|confirm|ON_SHOW_COMFIRM|确定|离开|退出/.test(source),
        sceneSwitch: /SwitchScene|enterNextScene|SceneManager|gotoUI|BackFrontView|ModeScene|RogueSmallMapScene/i.test(source),
        purchase: /buy|Buy|pay|Pay|shop|Shop|refresh|Refresh|YuanBao|Recharge/i.test(source)
      }
    };
  }
  return {
    ...value,
    class: {
      ...value.class,
      methods: enrichedMethods
    },
    summary: {
      scene: value.currentScene?.sceneName || value.currentScene?.className || "",
      manager: value.manager?.ctor || "",
      isGameOver: value.manager?.isGameOver === true,
      visibleWindows: value.visibleWindows?.length || 0,
      buttonCandidates: value.buttonCandidates?.length || 0,
      methodCount: Object.values(enrichedMethods).filter((item) => item.exists).length,
      purchaseRiskMethods: Object.entries(enrichedMethods).filter(([, item]) => item.tags?.includes("purchase-risk")).map(([name]) => name),
      confirmGatedMethods: Object.entries(enrichedMethods).filter(([, item]) => item.tags?.includes("confirm-gated")).map(([name]) => name),
      sceneSwitchMethods: Object.entries(enrichedMethods).filter(([, item]) => item.tags?.includes("scene-switch")).map(([name]) => name),
      sendOrLeaveMethods: Object.entries(enrichedMethods).filter(([, item]) => item.tags?.includes("send-or-leave-path")).map(([name]) => name)
    }
  };
}

function readmeText(report) {
  const summary = report.summary || {};
  const lines = [];
  lines.push("# Rogue Ended-State Exit Path Report");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${report.resourceVersion || ""}`);
  lines.push(`- Current scene: ${summary.scene}`);
  lines.push(`- Manager: ${summary.manager}; isGameOver=${summary.isGameOver}; seats=${report.manager?.seatCount ?? ""}; selfSeatIndex=${report.manager?.selfSeatIndex ?? ""}`);
  lines.push(`- Visible windows: ${summary.visibleWindows}`);
  lines.push(`- Button candidates: ${summary.buttonCandidates}`);
  lines.push(`- Exit/source methods present: ${summary.methodCount}`);
  lines.push(`- Confirm-gated methods: ${(summary.confirmGatedMethods || []).join(", ") || "(none)"}`);
  lines.push(`- Scene-switch methods: ${(summary.sceneSwitchMethods || []).join(", ") || "(none)"}`);
  lines.push(`- Send/leave methods: ${(summary.sendOrLeaveMethods || []).join(", ") || "(none)"}`);
  lines.push(`- Purchase-risk methods: ${(summary.purchaseRiskMethods || []).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("This report is read-only. It does not click, call scene methods, confirm, leave, restart, buy, or read hidden opponent hand fields.");
  lines.push("");
  lines.push("## Current Visible Windows");
  lines.push("");
  for (const win of report.visibleWindows || []) {
    lines.push(`- ${win.path} ${win.label}`);
  }
  if (!(report.visibleWindows || []).length) lines.push("- (none)");
  lines.push("");
  lines.push("## Button / UI Candidates");
  lines.push("");
  for (const node of (report.buttonCandidates || []).slice(0, 80)) {
    const events = Object.keys(node.events || {}).slice(0, 8).join(",");
    lines.push(`- ${node.path} ${node.label} text=${node.text || ""} events=${events || "(none)"}`);
  }
  lines.push("");
  lines.push("## Exit Method Sources");
  lines.push("");
  lines.push("| Method | Exists | Tags | Hash | Source preview |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const name of exitMethodNames) {
    const item = report.class?.methods?.[name] || {};
    const preview = compactSource(item.sourcePreview || item.source || "", 180).replaceAll("|", "\\|");
    lines.push(`| \`${name}\` | ${item.exists === true ? "yes" : "no"} | ${(item.tags || []).join(",") || ""} | \`${item.sourceHash || ""}\` | \`${preview}\` |`);
  }
  lines.push("");
  lines.push("## Practical Interpretation");
  lines.push("");
  lines.push("- `BackBtnClickHandler()` already has a live sample returning `false` in this ended Rogue scene; it is not a reliable exit by itself in the current state.");
  lines.push("- Methods tagged `confirm-gated` or `send-or-leave-path` should not be called unattended. They need a visible confirmation/window proof or explicit action sample.");
  lines.push("- Methods tagged `restart-or-retry` are not equivalent to safe exit; treat them as separate active samples.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const raw = await evaluateOnSgs(inspectionExpression(exitMethodNames), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const report = enrich(raw.value);
  await writeJson(path.join(dir, "rogue-ended-exit-report.json"), report);
  await writeFile(path.join(dir, "README.md"), readmeText(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: report.summary.scene,
    isGameOver: report.summary.isGameOver,
    visibleWindows: report.summary.visibleWindows,
    buttonCandidates: report.summary.buttonCandidates,
    methodCount: report.summary.methodCount,
    confirmGatedMethods: report.summary.confirmGatedMethods,
    sceneSwitchMethods: report.summary.sceneSwitchMethods,
    sendOrLeaveMethods: report.summary.sendOrLeaveMethods,
    purchaseRiskMethods: report.summary.purchaseRiskMethods
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
