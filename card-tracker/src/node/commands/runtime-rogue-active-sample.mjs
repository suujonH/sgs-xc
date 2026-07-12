import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-event-monitor.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ROGUE_ACTIVE_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-active-sample`)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function helpers() {
  return String.raw`
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
    const simple = (value) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + (ctor(value) || type) + "]";
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj).slice(0, 1000)) {
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
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
            ctor: ctor(handler),
            caller: handler.caller ? "[" + labelOf(handler.caller) + "]" : null,
            method: handler.method && (handler.method.name || String(handler.method).slice(0, 180)),
            args: Array.isArray(handler.args) ? handler.args.map(simple).slice(0, 10) : simple(handler.args),
            once: handler.once
          })).slice(0, 25);
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
      mouseEnabled: node && node.mouseEnabled,
      mouseState: node && node._mouseState,
      gray: node && node.gray,
      disabled: node && node.disabled,
      text: node && (node.text || node._text || node.label || node._label || "") || "",
      childCount: node && node.numChildren || 0,
      fields: safeFields(node, /(id|ID|fight|Fight|rogue|Rogue|event|Event|type|Type|skill|Skill|card|Card|select|Select|btn|Btn|button|Button|data|Data|state|State|status|Status|name|Name|text|Text|label|Label|visible|Visible|disabled|Disabled|gray|Gray|enable|Enable|reward|Reward|general|General|effect|Effect)/, 90),
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
    const findVisibleWindows = () => {
      const windows = [];
      walk(Laya.stage, (node, nodePath) => {
        const label = labelOf(node);
        if (isVisible(node) && (/Window|modalBg/.test(label))) windows.push(nodeSummary(node, nodePath));
      });
      return windows;
    };
    const findFightWindow = () => {
      const candidates = [];
      walk(Laya.stage, (node, nodePath) => {
        if (isVisible(node) && /RogueFightWindow/.test(labelOf(node))) candidates.push({ node, path: nodePath });
      });
      return candidates[0] || null;
    };
    const classMap = () => {
      try { return Laya && Laya.ClassUtils && Laya.ClassUtils._classMap || {}; } catch { return {}; }
    };
    const installPurchaseGuards = () => {
      if (window.__codexSgsRoguePurchaseGuard && window.__codexSgsRoguePurchaseGuard.installed) return window.__codexSgsRoguePurchaseGuard.status();
      const state = {
        installed: true,
        installedAt: new Date().toISOString(),
        wrappers: [],
        blockedCalls: [],
        errors: []
      };
      const wrap = (clsName, methodName) => {
        try {
          const cls = classMap()[clsName];
          const proto = cls && cls.prototype;
          if (!proto || typeof proto[methodName] !== "function") return false;
          const original = proto[methodName];
          const wrapped = function (...args) {
            state.blockedCalls.push({
              time: new Date().toISOString(),
              clsName,
              methodName,
              args: args.slice(0, 8).map(simple)
            });
            throw new Error("Blocked purchase-risk method: " + clsName + "." + methodName);
          };
          Object.defineProperty(proto, methodName, { value: wrapped, configurable: true });
          state.wrappers.push({ proto, methodName, original, clsName });
          return true;
        } catch (error) {
          state.errors.push({ time: new Date().toISOString(), at: clsName + "." + methodName, error: String(error && error.message || error) });
          return false;
        }
      };
      const specs = {
        RogueJiShiWindow: ["refreshBtnClick", "buy", "confirmBuy"],
        BlessNewWindow: ["confirmBuy", "buy", "gotoPay"],
        BlessNewWindowView: ["confirmBuy", "buy", "gotoPay"],
        KanShuWindow: ["buyPorpItem", "gotoPay"],
        SumRecommendGiftWindow: ["buy", "gotoPay", "confirmBuy"],
        VipPayWindow: ["buy", "gotoPay", "confirmBuy"],
        PayWindow: ["buy", "gotoPay", "confirmBuy"]
      };
      for (const [clsName, methods] of Object.entries(specs)) {
        for (const methodName of methods) wrap(clsName, methodName);
      }
      const guard = {
        installed: true,
        state,
        status() {
          return {
            installed: state.installed,
            installedAt: state.installedAt,
            wrapperCount: state.wrappers.length,
            blockedCalls: state.blockedCalls.slice(),
            errors: state.errors.slice()
          };
        },
        stop() {
          for (const item of state.wrappers.splice(0)) {
            try { Object.defineProperty(item.proto, item.methodName, { value: item.original, configurable: true }); } catch (error) {
              state.errors.push({ time: new Date().toISOString(), at: "restore:" + item.clsName + "." + item.methodName, error: String(error && error.message || error) });
            }
          }
          state.installed = false;
          this.installed = false;
          return this.status();
        }
      };
      window.__codexSgsRoguePurchaseGuard = guard;
      return guard.status();
    };
    const stopPurchaseGuards = () => window.__codexSgsRoguePurchaseGuard ? window.__codexSgsRoguePurchaseGuard.stop() : { installed: false, reason: "not installed" };
    const snapshot = () => {
      const scene = currentScene();
      const fight = findFightWindow();
      const table = scene && /TableGameScene/.test(labelOf(scene)) ? {
        managerCtor: ctor(scene.manager),
        seatCount: Array.isArray(scene.manager && scene.manager.seats) ? scene.manager.seats.length : null,
        selfSeatIndex: scene.manager && scene.manager.selfSeatIndex,
        isGameScene: true
      } : null;
      return {
        time: new Date().toISOString(),
        page: { title: document.title, url: location.href },
        resourceVersion: window.resourceVersion || "",
        scene: scene ? nodeSummary(scene, "currentScene") : null,
        visibleWindows: findVisibleWindows(),
        fightWindow: fight ? {
          summary: nodeSummary(fight.node, fight.path),
          fightId: fight.node.fightId,
          isBoss: fight.node.isBoss,
          startBtn: fight.node.startBtn ? nodeSummary(fight.node.startBtn, fight.path + ".startBtn") : null,
          skillBtnCount: Array.isArray(fight.node.skillBtns) ? fight.node.skillBtns.length : null,
          rewardItemCount: Array.isArray(fight.node.rewardItems) ? fight.node.rewardItems.length : null
        } : null,
        tableGame: table
      };
    };
    const isPurchaseRiskWindow = (win) => /JiShi|Shop|Buy|Pay|Recharge|Charge|Mall|Store|Bless|KanShu|Gift|Purchase/i.test(win.label || win.path || "");
  `;
}

function actionExpression(actionName) {
  return `(() => {
    ${helpers()}
    const before = snapshot();
    const guard = installPurchaseGuards();
    const action = {
      ok: false,
      actionName: ${JSON.stringify(actionName)},
      called: "",
      reason: "",
      guardBefore: guard
    };
    try {
      if (${JSON.stringify(actionName)} !== "fight-confirm") {
        action.reason = "Unsupported active action";
      } else if (!/RogueSmallMapScene/.test(before.scene && before.scene.label || "")) {
        action.reason = "Current visible scene is not RogueSmallMapScene";
      } else if ((before.visibleWindows || []).some(isPurchaseRiskWindow)) {
        action.reason = "Purchase-risk window is visible";
        action.purchaseRiskWindows = (before.visibleWindows || []).filter(isPurchaseRiskWindow);
      } else {
        const fight = findFightWindow();
        const startBtn = fight && fight.node && fight.node.startBtn;
        if (!fight) {
          action.reason = "No effectively visible RogueFightWindow found";
        } else if (!startBtn || !isVisible(startBtn)) {
          action.reason = "RogueFightWindow.startBtn is not effectively visible";
          action.target = fight ? nodeSummary(fight.node, fight.path) : null;
        } else if (startBtn.disabled === true || startBtn.gray === true) {
          action.reason = "RogueFightWindow.startBtn appears disabled";
          action.startBtn = nodeSummary(startBtn, fight.path + ".startBtn");
        } else if (typeof fight.node.checkStart !== "function" && typeof fight.node.startbtnClick !== "function") {
          action.reason = "RogueFightWindow.checkStart()/startbtnClick() was not found";
          action.target = nodeSummary(fight.node, fight.path);
        } else {
          action.ok = true;
          action.called = typeof fight.node.checkStart === "function" ? "RogueFightWindow.checkStart()" : "RogueFightWindow.startbtnClick()";
          action.target = {
            fightWindow: nodeSummary(fight.node, fight.path),
            fightId: fight.node.fightId,
            isBoss: fight.node.isBoss,
            startBtn: nodeSummary(startBtn, fight.path + ".startBtn"),
            methodSources: {
              checkStart: typeof fight.node.checkStart === "function" ? String(fight.node.checkStart).slice(0, 1200) : null,
              startbtnClick: typeof fight.node.startbtnClick === "function" ? String(fight.node.startbtnClick).slice(0, 1600) : null
            }
          };
          if (typeof fight.node.checkStart === "function") fight.node.checkStart();
          else fight.node.startbtnClick();
        }
      }
    } catch (error) {
      action.ok = false;
      action.error = String(error && error.stack || error && error.message || error);
    }
    return { before, action };
  })()`;
}

function snapshotExpression() {
  return `(() => { ${helpers()} return snapshot(); })()`;
}

function stopGuardsExpression() {
  return `(() => { ${helpers()} return stopPurchaseGuards(); })()`;
}

function readmeText(payload) {
  const before = payload.action?.before || {};
  const after = payload.after?.value || {};
  const action = payload.action?.action || {};
  const records = payload.dump?.value?.records || [];
  const selectedRecords = records.filter((record) => /Rogue|PveMgr|proxy\.L|SceneManager|WindowManager|SHOW_FULL_MASK|CLIENT_ROGUE/i.test(record.name || ""));
  return [
    "# Rogue Active Runtime Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Action: ${payload.actionName}`,
    `- Action ok: ${!!action.ok}`,
    `- Action call: ${action.called || ""}`,
    `- Reason/error: ${action.reason || action.error || ""}`,
    `- Before scene: ${before.scene?.sceneName || before.scene?.label || ""}`,
    `- Before fightId: ${before.fightWindow?.fightId ?? ""}`,
    `- After scene: ${after.scene?.sceneName || after.scene?.label || ""}`,
    `- After table game: ${after.tableGame ? "yes" : "no"}`,
    `- Event records: ${records.length}`,
    `- Relevant records: ${selectedRecords.length}`,
    `- Purchase guard wrappers: ${action.guardBefore?.wrapperCount ?? ""}`,
    `- Purchase blocked calls: ${payload.guardStop?.blockedCalls?.length || 0}`,
    "",
    "This is an active non-purchase sample. It may enter or advance a Rogue fight, but it does not call purchase, refresh, pay, or hidden-hand reads.",
    "",
    "## Relevant Events",
    "",
    ...selectedRecords.slice(0, 120).map((record) => `- #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`),
    ""
  ].join("\n");
}

async function main() {
  const actionName = process.argv[2] || "fight-confirm";
  if (!["fight-confirm"].includes(actionName)) throw new Error(`Unsupported rogue active action: ${actionName}`);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  let stop = { value: { skipped: true } };
  let guardStop = { skipped: true };

  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const action = await evaluateOnSgs(actionExpression(actionName), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await sleep(Number(process.env.SGS_ROGUE_ACTIVE_WAIT_MS || 12000));
  const after = await evaluateOnSgs(snapshotExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  try {
    guardStop = (await evaluateOnSgs(stopGuardsExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 })).value;
  } finally {
    stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  }

  const payload = {
    ok: true,
    target: action.target,
    actionName,
    install: install.value,
    action: action.value,
    after,
    dump,
    guardStop,
    stop: stop.value
  };
  await writeJson(path.join(dir, "rogue-active-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), `${readmeText(payload)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    action: payload.action?.action,
    beforeScene: payload.action?.before?.scene?.sceneName || payload.action?.before?.scene?.label || null,
    beforeFightId: payload.action?.before?.fightWindow?.fightId ?? null,
    afterScene: payload.after?.value?.scene?.sceneName || payload.after?.value?.scene?.label || null,
    tableGame: !!payload.after?.value?.tableGame,
    recordCount: payload.dump?.value?.records?.length || 0,
    purchaseBlockedCalls: payload.guardStop?.blockedCalls?.length || 0
  }, null, 2));
}

main().catch(async (error) => {
  try { await evaluateOnSgs(stopGuardsExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 }); } catch {}
  try { await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 }); } catch {}
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
