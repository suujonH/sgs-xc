import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-event-monitor.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

const supportedActions = new Set([
  "scan",
  "mode-activity",
  "activity-next-page",
  "enter-general-trial",
  "open-challenge",
  "start-challenge"
]);

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir(actionName) {
  return path.resolve(
    process.env.SGS_RUNTIME_BATTLE_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-${actionName}-battle-entry`)
  );
}

function waitMsFor(actionName) {
  if (process.env.SGS_RUNTIME_BATTLE_WAIT_MS) return Number(process.env.SGS_RUNTIME_BATTLE_WAIT_MS);
  if (actionName === "enter-general-trial") return 4500;
  if (actionName === "start-challenge") return 9000;
  if (actionName === "open-challenge") return 1800;
  if (actionName === "activity-next-page") return 1200;
  if (actionName === "mode-activity") return 1200;
  return 500;
}

function runtimeHelpers() {
  return String.raw`
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const effectiveHidden = (node) => {
      const hidden = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) hidden.push(label + ":visible=false");
        if (cur.alpha === 0) hidden.push(label + ":alpha=0");
      }
      return hidden;
    };
    const isEffectivelyVisible = (node) => effectiveHidden(node).length === 0;
    const simpleValue = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (depth > 0) return "[" + (ctor(value) || type) + "]";
      return "[" + (ctor(value) || type) + "]";
    };
    const interestingFields = (node) => {
      const out = {};
      for (const key of own(node)) {
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        if (!/(mode|Mode|trial|Trial|challenge|Challenge|page|Page|index|Index|id|ID|data|Data|item|Item|name|Name|text|Text|label|Label|title|Title|selected|Selected|viewStack|isCan|loction|location)/.test(key)) continue;
        try { out[key] = simpleValue(node[key], 0); } catch { out[key] = "[throws]"; }
      }
      return out;
    };
    const nodeSummary = (node, path) => {
      const proto = Object.getPrototypeOf(node || {});
      const methods = own(proto).filter((key) => {
        try { return typeof node[key] === "function"; } catch { return false; }
      });
      return {
        path,
        label: labelOf(node),
        ctor: ctor(node),
        name: node && node.name || "",
        className: node && node._className_ || "",
        sceneName: node && (node.sceneName || node.SceneName) || "",
        visible: node && node.visible,
        alpha: node && node.alpha,
        hiddenReasons: effectiveHidden(node),
        effectiveVisible: isEffectivelyVisible(node),
        x: node && node.x,
        y: node && node.y,
        width: node && node.width,
        height: node && node.height,
        childCount: node && node.numChildren || 0,
        fields: interestingFields(node),
        keyMethods: methods.filter((key) => /onEnterMode|modeAtivitySelect|onClickChallenge|StartGame|ServerProxy_StartGame|BackBtnClickHandler|enterModePageSuccess|gameStartRep|tableInfoRep|leaveGame|Close|close/i.test(key)).slice(0, 50),
        methodCount: methods.length
      };
    };
    const walkStage = (visitor, maxDepth = 12, maxNodes = 12000) => {
      const visited = new Set();
      let count = 0;
      const walk = (node, path, depth) => {
        if (!node || visited.has(node) || depth > maxDepth || count >= maxNodes) return;
        visited.add(node);
        count++;
        visitor(node, path, depth);
        const n = node.numChildren || 0;
        for (let i = 0; i < n; i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          walk(child, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
        }
      };
      walk(Laya.stage, "Laya.stage", 0);
      return count;
    };
    const sceneLayer = () => Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
      .find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    const windowLayer = () => Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
      .find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    const currentScene = () => {
      const layer = sceneLayer();
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const node = layer.getChildAt(i);
        if (isEffectivelyVisible(node)) return node;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
    const sceneManager = () => {
      try {
        const popup = Laya.ClassUtils.getInstance("PopUpWindow");
        const ged = popup && popup.ged;
        const fromGed = toArray(ged && ged._events && ged._events.SWITCH_SCENE)
          .map((handler) => handler && handler.caller)
          .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function"));
        if (fromGed) return fromGed;
      } catch {}
      return null;
    };
    const modeIdOf = (node) => {
      for (const key of ["modeId", "ModeId", "modeID", "ModeID", "_modeId", "_modeID", "id", "ID"]) {
        try { if (node && Number(node[key]) === 147) return { key, value: node[key] }; } catch {}
      }
      for (const holder of ["data", "_data", "itemData", "_itemData", "modeData", "vo", "_vo"]) {
        try {
          const value = node && node[holder];
          if (!value) continue;
          for (const key of ["modeId", "ModeId", "modeID", "ModeID", "id", "ID"]) {
            if (Number(value[key]) === 147) return { key: holder + "." + key, value: value[key] };
          }
        } catch {}
      }
      return null;
    };
    const collectSnapshot = () => {
      const routeCandidates = [];
      const allScenes = [];
      const windows = [];
      let visitedCount = 0;
      const sLayer = sceneLayer();
      if (sLayer) {
        for (let i = 0; i < (sLayer.numChildren || 0); i++) {
          const node = sLayer.getChildAt(i);
          allScenes.push(nodeSummary(node, "SceneLayer#" + i));
        }
      }
      const wLayer = windowLayer();
      if (wLayer) {
        for (let i = 0; i < (wLayer.numChildren || 0); i++) {
          const node = wLayer.getChildAt(i);
          windows.push(nodeSummary(node, "WindowLayer#" + i));
        }
      }
      visitedCount = walkStage((node, nodePath) => {
        const label = labelOf(node);
        const mode147 = modeIdOf(node);
        const hasEnterMode = typeof node.onEnterMode === "function";
        const hasChallenge = typeof node.onClickChallenge === "function";
        const hasActivitySwitch = typeof node.modeAtivitySelect === "function";
        const hasTableManager = /TableGameScene/.test(label) && !!node.manager;
        if (mode147 || hasEnterMode || hasChallenge || hasActivitySwitch || /ModeScene|ActivityMode|GeneralTrial|Challenge|TableGameScene|GameResultWindow|PWt/.test(label) || hasTableManager) {
          const summary = nodeSummary(node, nodePath);
          if (mode147) summary.mode147 = mode147;
          if (hasTableManager) {
            summary.tableProof = {
              hasManager: !!node.manager,
              hasSeats: !!(node.manager && node.manager.seats),
              seatCount: node.manager && node.manager.seats && node.manager.seats.length,
              selfSeatIndex: node.manager && node.manager.selfSeatIndex
            };
          }
          routeCandidates.push(summary);
        }
      });
      const scene = currentScene();
      const manager = sceneManager();
      return {
        time: new Date().toISOString(),
        page: { url: location.href, title: document.title },
        stage: {
          width: Laya.stage && Laya.stage.width,
          height: Laya.stage && Laya.stage.height,
          childCount: Laya.stage && Laya.stage.numChildren,
          visitedCount
        },
        sceneManager: manager ? {
          ctor: ctor(manager),
          currentCreateScene: manager.currentCreateScene || "",
          lastSceneName: manager.lastSceneName || "",
          isGameScene: !!manager.IsGameScene,
          isTableScene: !!manager.IsTableScene,
          hasNextScene: !!manager.nextScene,
          nextScene: manager.nextScene ? nodeSummary(manager.nextScene, "SceneManager.nextScene") : null
        } : null,
        currentScene: scene ? nodeSummary(scene, "currentScene") : null,
        scenes: allScenes,
        windows,
        routeCandidates: routeCandidates.slice(0, 500),
        routeCandidateCount: routeCandidates.length,
        tableProofs: routeCandidates.filter((item) => item.tableProof)
      };
    };
    const visibleBest = (items) => {
      const visible = items.filter((item) => isEffectivelyVisible(item.node));
      return (visible[0] || items[0] || {}).node || null;
    };
    const findNodes = (predicate) => {
      const items = [];
      walkStage((node, nodePath) => {
        try {
          if (predicate(node, nodePath)) items.push({ node, path: nodePath });
        } catch {}
      });
      return items;
    };
  `;
}

function actionExpression(actionName) {
  const actionLiteral = JSON.stringify(actionName);
  return `(() => {
    ${runtimeHelpers()}
    const actionName = ${actionLiteral};
    const before = collectSnapshot();
    let action = { ok: true, actionName, called: "", beforeScene: before.currentScene && before.currentScene.sceneName || "" };
    try {
      if (actionName === "scan") {
        action.called = "(none)";
      } else if (actionName === "mode-activity") {
        const scene = currentScene();
        if (!scene || typeof scene.modeAtivitySelect !== "function") {
          action = { ok: false, actionName, reason: "Current scene has no modeAtivitySelect()", scene: scene ? nodeSummary(scene, "currentScene") : null };
        } else {
          const result = scene.modeAtivitySelect();
          action.called = "currentScene.modeAtivitySelect()";
          action.result = simpleValue(result);
        }
      } else if (actionName === "activity-next-page") {
        const candidates = findNodes((node) => /ActivityModeView/.test(labelOf(node)) && typeof node.onPageNumChange === "function");
        const targetItem = candidates.find((item) => isEffectivelyVisible(item.node)) || candidates[0];
        if (!targetItem) {
          action = { ok: false, actionName, reason: "No ActivityModeView with onPageNumChange() found" };
        } else {
          action.target = nodeSummary(targetItem.node, targetItem.path);
          const beforePage = { curPage: targetItem.node.curPage, maxPage: targetItem.node.maxPage };
          const result = targetItem.node.onPageNumChange(true);
          action.called = "ActivityModeView.onPageNumChange(true)";
          action.beforePage = beforePage;
          action.afterPage = { curPage: targetItem.node.curPage, maxPage: targetItem.node.maxPage };
          action.result = simpleValue(result);
        }
      } else if (actionName === "enter-general-trial") {
        const scene = currentScene();
        let candidates = findNodes((node) => modeIdOf(node) && typeof node.onEnterMode === "function");
        if (!candidates.length && scene && typeof scene.modeAtivitySelect === "function") {
          try { scene.modeAtivitySelect(); } catch (error) { action.activityError = String(error && error.message || error); }
          candidates = findNodes((node) => modeIdOf(node) && typeof node.onEnterMode === "function");
        }
        if (!candidates.length) {
          const activityItems = findNodes((node) => /ActivityModeView/.test(labelOf(node)) && typeof node.onPageNumChange === "function");
          const activity = (activityItems.find((item) => isEffectivelyVisible(item.node)) || activityItems[0] || {}).node;
          if (activity && Number(activity.curPage) < Number(activity.maxPage)) {
            try { activity.onPageNumChange(true); action.pageAdvance = { called: "ActivityModeView.onPageNumChange(true)", curPage: activity.curPage, maxPage: activity.maxPage }; } catch (error) { action.pageAdvanceError = String(error && error.message || error); }
            candidates = findNodes((node) => modeIdOf(node) && typeof node.onEnterMode === "function");
          }
        }
        const targetItem = candidates.find((item) => isEffectivelyVisible(item.node)) || candidates[0];
        if (!targetItem) {
          action = { ok: false, actionName, reason: "No visible/cached modeId=147 node with onEnterMode() found" };
        } else {
          action.target = nodeSummary(targetItem.node, targetItem.path);
          const result = targetItem.node.onEnterMode();
          action.called = "modeId=147.onEnterMode()";
          action.result = simpleValue(result);
        }
      } else if (actionName === "open-challenge") {
        const candidates = findNodes((node) => {
          const label = labelOf(node);
          return typeof node.onClickChallenge === "function" && /GeneralTrial|Challenge|Bwt/.test(label) && !/GeneralTrialChallengeWin/.test(label);
        });
        const targetItem = candidates.find((item) => isEffectivelyVisible(item.node)) || candidates[0];
        if (!targetItem) {
          action = { ok: false, actionName, reason: "No GeneralTrial challenge card with onClickChallenge() found" };
        } else {
          action.target = nodeSummary(targetItem.node, targetItem.path);
          const result = targetItem.node.onClickChallenge();
          action.called = "GeneralTrial challenge card.onClickChallenge()";
          action.result = simpleValue(result);
        }
      } else if (actionName === "start-challenge") {
        const candidates = findNodes((node) => {
          const label = labelOf(node);
          return typeof node.onClickChallenge === "function" && /GeneralTrialChallengeWin/.test(label);
        });
        const targetItem = candidates.find((item) => isEffectivelyVisible(item.node)) || candidates[0];
        if (!targetItem) {
          action = { ok: false, actionName, reason: "No GeneralTrialChallengeWin with onClickChallenge() found" };
        } else {
          action.target = nodeSummary(targetItem.node, targetItem.path);
          const result = targetItem.node.onClickChallenge();
          action.called = "GeneralTrialChallengeWin.onClickChallenge()";
          action.result = simpleValue(result);
        }
      } else {
        action = { ok: false, actionName, reason: "Unsupported action" };
      }
    } catch (error) {
      action.ok = false;
      action.error = String(error && error.stack || error && error.message || error);
    }
    return { ok: true, actionName, action, before };
  })()`;
}

function snapshotExpression() {
  return `(() => {
    ${runtimeHelpers()}
    return collectSnapshot();
  })()`;
}

function readmeText(actionName, payload) {
  const records = payload.dump?.value?.records || [];
  const finalScene = payload.after?.currentScene || {};
  const tableProofs = payload.after?.tableProofs || [];
  return [
    `# Runtime Battle Entry Sample: ${actionName}`,
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.target?.title || ""} ${payload.target?.url || ""}`,
    `- Action ok: ${!!payload.action?.action?.ok}`,
    `- Action call: ${payload.action?.action?.called || ""}`,
    `- Before scene: ${payload.action?.before?.currentScene?.sceneName || ""}`,
    `- Final scene: ${finalScene.sceneName || finalScene.label || ""}`,
    `- Event records: ${records.length}`,
    `- Table proofs: ${tableProofs.length}`,
    "",
    "This sample uses live Laya runtime objects and the game client's own methods. It does not read hidden opponent hand cards or use screenshots/OCR as evidence.",
    "",
    "## Route Candidates",
    "",
    ...(payload.after?.routeCandidates || []).slice(0, 80).map((item) => {
      const mode = item.mode147 ? ` mode147=${item.mode147.key}` : "";
      const table = item.tableProof ? ` tableSeats=${item.tableProof.seatCount}` : "";
      return `- ${item.path} ${item.label}${mode}${table} visible=${item.effectiveVisible}`;
    }),
    "",
    "## Event Records",
    "",
    ...records.slice(0, 120).map((record) => `- #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`),
    ""
  ].join("\n");
}

async function main() {
  const actionName = process.argv[2] || "scan";
  if (!supportedActions.has(actionName)) throw new Error(`Unsupported battle entry action: ${actionName}`);

  const dir = outputDir(actionName);
  await mkdir(dir, { recursive: true });

  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const action = await evaluateOnSgs(actionExpression(actionName), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await sleep(waitMsFor(actionName));
  const after = await evaluateOnSgs(snapshotExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });

  const payload = {
    ok: true,
    target: action.target,
    actionName,
    install: install.value,
    action: action.value,
    after: after.value,
    dump,
    stop: stop.value
  };
  await writeJson(path.join(dir, "battle-entry-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(actionName, payload), "utf8");

  console.log(JSON.stringify({
    dir,
    action: payload.action?.action || null,
    beforeScene: payload.action?.before?.currentScene || null,
    finalScene: payload.after?.currentScene || null,
    tableProofs: payload.after?.tableProofs || [],
    recordCount: payload.dump?.value?.records?.length || 0,
    routeCandidateCount: payload.after?.routeCandidateCount || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
