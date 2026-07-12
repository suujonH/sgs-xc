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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir(actionName) {
  return path.resolve(
    process.env.SGS_RUNTIME_ACTION_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-${actionName}-sample`)
  );
}

function stageSummaryExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const nodes = [];
    const effective = (node) => {
      const hidden = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        if (cur.visible === false || cur._visible === false) hidden.push((cur.name || cur._className_ || ctor(cur)) + ":visible=false");
        if (cur.alpha === 0) hidden.push((cur.name || cur._className_ || ctor(cur)) + ":alpha=0");
      }
      return hidden;
    };
    const walk = (node, path, depth) => {
      if (!node || depth > 6 || nodes.length > 900) return;
      const label = [node.name, node._className_, node.sceneName, node.SceneName, ctor(node)].filter(Boolean).join(":");
      if (/Window|Bless|Rogue|GeneralTrial|TableGameScene|NewPaiWei|YanJiao|GuanXing/.test(label)) {
        nodes.push({
          path,
          label,
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          sceneName: node.sceneName || node.SceneName || "",
          visible: node.visible,
          alpha: node.alpha,
          hiddenReasons: effective(node),
          x: node.x, y: node.y, width: node.width, height: node.height,
          childCount: node.numChildren || 0,
          closeLikeMethods: own(Object.getPrototypeOf(node)).filter((key) => typeof node[key] === "function" && /Close|Remove|Back|Hide|close/i.test(key)).slice(0, 40)
        });
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        const child = node.getChildAt(i);
        walk(child, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
      }
    };
    walk(Laya.stage, "Laya.stage", 0);
    const sceneLayer = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
      .find((node) => /LBi|SceneLayer/.test([node.name, ctor(node)].join(" ")));
    const currentScene = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      currentScene: currentScene ? {
        ctor: ctor(currentScene),
        name: currentScene.name || "",
        sceneName: currentScene.sceneName || currentScene.SceneName || "",
        className: currentScene._className_ || "",
        visible: currentScene.visible,
        childCount: currentScene.numChildren || 0
      } : null,
      nodes
    };
  })()`;
}

function closeBlessExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    let target = null;
    let targetPath = "";
    const walk = (node, path, depth) => {
      if (!node || target || depth > 7) return;
      const label = [node.name, node._className_, node.sceneName, node.SceneName, ctor(node)].filter(Boolean).join(":");
      if (/BlessNewWindowView|BlessNewWindow/.test(label) && typeof node.Close === "function") {
        target = node;
        targetPath = path;
        return;
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        const child = node.getChildAt(i);
        walk(child, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
      }
    };
    walk(Laya.stage, "Laya.stage", 0);
    if (!target) return { ok: false, action: "close-bless", reason: "Bless window not found" };
    const before = {
      path: targetPath,
      ctor: ctor(target),
      name: target.name || "",
      className: target._className_ || "",
      visible: target.visible,
      parentCtor: ctor(target.parent),
      parentChildren: target.parent?.numChildren || 0
    };
    target.Close();
    return {
      ok: true,
      action: "close-bless",
      called: "target.Close()",
      before,
      afterImmediate: {
        destroyed: target.destroyed,
        visible: target.visible,
        parentCtor: ctor(target.parent),
        parentChildren: target.parent?.numChildren || 0
      }
    };
  })()`;
}

function closeRogueChangeExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
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
    let target = null;
    let targetPath = "";
    const walk = (node, path, depth) => {
      if (!node || target || depth > 8) return;
      const label = labelOf(node);
      if (/RogueComChangeWindow/.test(label) && hiddenReasons(node).length === 0 && typeof node.Close === "function") {
        target = node;
        targetPath = path;
        return;
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        const child = node.getChildAt(i);
        walk(child, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
      }
    };
    walk(Laya.stage, "Laya.stage", 0);
    if (!target) return { ok: false, action: "close-rogue-change", reason: "Visible RogueComChangeWindow not found" };
    const before = {
      path: targetPath,
      label: labelOf(target),
      ctor: ctor(target),
      name: target.name || "",
      className: target._className_ || "",
      visible: target.visible,
      isFightWindow: !!target.isFightWindow,
      isCheckShopData: !!target.isCheckShopData,
      isGamingWindow: !!target.isGamingWindow,
      childCount: target.numChildren || 0,
      parentCtor: ctor(target.parent),
      parentChildren: target.parent?.numChildren || 0
    };
    target.Close();
    return {
      ok: true,
      action: "close-rogue-change",
      called: "RogueComChangeWindow.Close()",
      before,
      afterImmediate: {
        destroyed: target.destroyed,
        visible: target.visible,
        parentCtor: ctor(target.parent),
        parentChildren: target.parent?.numChildren || 0
      },
      note: "This closes the visible RogueComChangeWindow only; it does not call ShowNext() or any purchase path."
    };
  })()`;
}

function closeRogueZhanJiExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
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
    let target = null;
    let targetPath = "";
    const walk = (node, path, depth) => {
      if (!node || target || depth > 8) return;
      const label = labelOf(node);
      if (/RogueZhanJiWindow/.test(label) && hiddenReasons(node).length === 0 && typeof node.Close === "function") {
        target = node;
        targetPath = path;
        return;
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        const child = node.getChildAt(i);
        walk(child, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
      }
    };
    walk(Laya.stage, "Laya.stage", 0);
    if (!target) return { ok: false, action: "close-rogue-zhanji", reason: "Visible RogueZhanJiWindow not found" };
    const before = {
      path: targetPath,
      label: labelOf(target),
      ctor: ctor(target),
      name: target.name || "",
      className: target._className_ || "",
      visible: target.visible,
      isFightWindow: !!target.isFightWindow,
      isCheckShopData: !!target.isCheckShopData,
      isGamingWindow: !!target.isGamingWindow,
      childCount: target.numChildren || 0,
      parentCtor: ctor(target.parent),
      parentChildren: target.parent?.numChildren || 0
    };
    target.Close();
    return {
      ok: true,
      action: "close-rogue-zhanji",
      called: "RogueZhanJiWindow.Close()",
      before,
      afterImmediate: {
        destroyed: target.destroyed,
        visible: target.visible,
        parentCtor: ctor(target.parent),
        parentChildren: target.parent?.numChildren || 0
      },
      note: "This closes the visible RogueZhanJiWindow only; it does not click rewards, continue, confirm, buy, refresh, or pay."
    };
  })()`;
}

function currentBackExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const sceneLayer = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
      .find((node) => /LBi|SceneLayer/.test([node.name, ctor(node)].join(" ")));
    const target = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
    if (!target || typeof target.BackBtnClickHandler !== "function") {
      return { ok: false, action: "current-back", reason: "Current scene has no BackBtnClickHandler" };
    }
    const before = {
      ctor: ctor(target),
      name: target.name || "",
      sceneName: target.sceneName || target.SceneName || "",
      className: target._className_ || "",
      visible: target.visible,
      isMatching: !!target.isMatching,
      matchSuccess: !!target.matchSuccess
    };
    const result = target.BackBtnClickHandler();
    return {
      ok: true,
      action: "current-back",
      called: "currentScene.BackBtnClickHandler()",
      before,
      result
    };
  })()`;
}

function sceneEnterNextExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
    let sceneManager = null;
    try {
      const popup = Laya.ClassUtils.getInstance("PopUpWindow");
      const ged = popup && popup.ged;
      sceneManager = toArray(ged && ged._events && ged._events.SWITCH_SCENE)
        .map((h) => h && h.caller)
        .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
    } catch {}
    if (!sceneManager || typeof sceneManager.enterNextScene !== "function") {
      return { ok: false, action: "scene-enter-next", reason: "SceneManager.enterNextScene not found" };
    }
    const before = {
      ctor: ctor(sceneManager),
      currentCreateScene: sceneManager.currentCreateScene || "",
      lastSceneName: sceneManager.lastSceneName || "",
      nextScene: sceneManager.nextScene ? {
        ctor: ctor(sceneManager.nextScene),
        name: sceneManager.nextScene.name || "",
        sceneName: sceneManager.nextScene.sceneName || sceneManager.nextScene.SceneName || "",
        className: sceneManager.nextScene._className_ || ""
      } : null,
      isOutCompele: !!sceneManager.isOutCompele,
      isSceneResCompele: !!sceneManager.isSceneResCompele,
      isInScene: !!sceneManager.isInScene
    };
    sceneManager.enterNextScene();
    return {
      ok: true,
      action: "scene-enter-next",
      called: "SceneManager.enterNextScene()",
      before,
      afterImmediate: {
        currentCreateScene: sceneManager.currentCreateScene || "",
        nextScene: sceneManager.nextScene ? "[" + ctor(sceneManager.nextScene) + "]" : null,
        isInScene: !!sceneManager.isInScene
      }
    };
  })()`;
}

function switchModeSceneExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
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
    const isVisible = (node) => hiddenReasons(node).length === 0;
    const walk = (root, visitor, path = "Laya.stage", depth = 0) => {
      if (!root || depth > 10) return;
      visitor(root, path);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        const child = root.getChildAt(i);
        walk(child, visitor, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
      }
    };
    const stageChildren = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node.name, ctor(node)].join(" ")));
    const currentScene = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
    const resultOrConfirm = [];
    walk(Laya.stage, (node, nodePath) => {
      const label = labelOf(node);
      if (isVisible(node) && /GameResultWindow|PWt|ConfirmWindow/.test(label)) resultOrConfirm.push({ path: nodePath, label });
    });
    const manager = currentScene && currentScene.manager || null;
    const popup = Laya.ClassUtils.getInstance("PopUpWindow");
    const ged = popup && popup.ged;
    const sceneManager = toArray(ged && ged._events && ged._events.SWITCH_SCENE)
      .map((handler) => handler && handler.caller)
      .find((candidate) => candidate && typeof candidate.SwitchScene === "function");
    const before = {
      currentScene: currentScene ? {
        ctor: ctor(currentScene),
        sceneName: currentScene.sceneName || currentScene.SceneName || "",
        className: currentScene._className_ || "",
        label: labelOf(currentScene)
      } : null,
      manager: manager ? {
        isGameOver: !!manager.isGameOver,
        hasGameOverData: !!manager.gameOverData
      } : null,
      resultOrConfirm
    };
    if (!currentScene || !/TableGameScene/.test(labelOf(currentScene))) {
      return { ok: false, action: "switch-mode-scene", reason: "Current scene is not TableGameScene", before };
    }
    if (!manager || !manager.isGameOver) {
      return { ok: false, action: "switch-mode-scene", reason: "TableGameScene is not marked game-over", before };
    }
    if (resultOrConfirm.length) {
      return { ok: false, action: "switch-mode-scene", reason: "Visible result/confirm window still present", before };
    }
    if (!sceneManager) {
      return { ok: false, action: "switch-mode-scene", reason: "SceneManager.SwitchScene not found", before };
    }
    sceneManager.SwitchScene("ModeScene");
    return {
      ok: true,
      action: "switch-mode-scene",
      called: "SceneManager.SwitchScene(\"ModeScene\")",
      before,
      note: "Local runtime scene switch after ended TableGameScene; this is not a decodeClientMsgLeaveTableRep server-ack sample."
    };
  })()`;
}

function completeSceneAnimateOutExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const popup = Laya.ClassUtils.getInstance("PopUpWindow");
    const ged = popup && popup.ged;
    const sceneManager = toArray(ged && ged._events && ged._events.SWITCH_SCENE)
      .map((handler) => handler && handler.caller)
      .find((candidate) => candidate && typeof candidate.enterNextScene === "function");
    const lastScene = sceneManager && sceneManager.lastScene;
    const nextScene = sceneManager && sceneManager.nextScene;
    const before = sceneManager ? {
      currentCreateScene: sceneManager.currentCreateScene,
      isOutCompele: sceneManager.isOutCompele,
      isSceneResCompele: sceneManager.isSceneResCompele,
      lastScene: lastScene ? {
        label: labelOf(lastScene),
        sceneName: lastScene.sceneName || lastScene.SceneName || "",
        className: lastScene._className_ || "",
        isInAnimateOut: !!lastScene.isInAnimateOut,
        animateOutTweenPos: lastScene.animateOutTweenPos,
        managerIsGameOver: !!(lastScene.manager && lastScene.manager.isGameOver)
      } : null,
      nextScene: nextScene ? {
        label: labelOf(nextScene),
        sceneName: nextScene.sceneName || nextScene.SceneName || "",
        className: nextScene._className_ || "",
        parent: ctor(nextScene.parent)
      } : null
    } : null;
    if (!sceneManager || !lastScene || !nextScene) {
      return { ok: false, action: "complete-scene-animate-out", reason: "SceneManager transition is not pending", before };
    }
    if (!/TableGameScene/.test(labelOf(lastScene)) || !(lastScene.manager && lastScene.manager.isGameOver)) {
      return { ok: false, action: "complete-scene-animate-out", reason: "Last scene is not ended TableGameScene", before };
    }
    if (!/ModeScene/.test(labelOf(nextScene))) {
      return { ok: false, action: "complete-scene-animate-out", reason: "Next scene is not ModeScene", before };
    }
    if (!lastScene.isInAnimateOut || typeof lastScene.onAnimateOutComplete !== "function") {
      return { ok: false, action: "complete-scene-animate-out", reason: "Last scene is not in animate-out or has no completion handler", before };
    }
    lastScene.onAnimateOutComplete();
    return {
      ok: true,
      action: "complete-scene-animate-out",
      called: "lastScene.onAnimateOutComplete()",
      before,
      note: "Completes a stuck local scene animate-out so SceneManager can enter the already-created next ModeScene."
    };
  })()`;
}

function readmeText(actionName, payload) {
  const records = payload.dump?.value?.records || [];
  const action = payload.action || {};
  const safeNote = actionName === "close-bless"
    ? "For `close-bless`, it only calls the visible Bless window's own `Close()` method."
    : actionName === "close-rogue-change"
      ? "For `close-rogue-change`, it only calls the visible `RogueComChangeWindow.Close()` method and does not call `ShowNext()`."
      : actionName === "close-rogue-zhanji"
        ? "For `close-rogue-zhanji`, it only calls the visible `RogueZhanJiWindow.Close()` method."
    : actionName === "current-back"
      ? "For `current-back`, it only calls the current visible scene's own `BackBtnClickHandler()` method."
      : actionName === "scene-enter-next"
        ? "For `scene-enter-next`, it only calls `SceneManager.enterNextScene()` after the runtime has already prepared `nextScene`."
        : actionName === "switch-mode-scene"
          ? "For `switch-mode-scene`, it only calls `SceneManager.SwitchScene(\"ModeScene\")` after proving the current `TableGameScene` is already game-over and no result/confirm window is visible."
          : "For `complete-scene-animate-out`, it only calls the old scene's own `onAnimateOutComplete()` when the runtime is already stuck in a pending `TableGameScene -> ModeScene` transition.";
  return [
    `# Runtime Safe Action Sample: ${actionName}`,
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.target?.title || ""} ${payload.target?.url || ""}`,
    `- Action ok: ${!!action.ok}`,
    `- Action call: ${action.called || ""}`,
    `- Event records: ${records.length}`,
    `- Final scene: ${payload.dump?.value?.status?.scene?.sceneName || ""}`,
    "",
    `This sample intentionally avoids purchase/draw/shop/confirm operations. ${safeNote}`,
    "",
    "## Record Kinds",
    "",
    ...records.slice(0, 80).map((record) => `- #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`),
    ""
  ].join("\n");
}

async function main() {
  const actionName = process.argv[2] || "close-bless";
  if (!["close-bless", "close-rogue-change", "close-rogue-zhanji", "current-back", "scene-enter-next", "switch-mode-scene", "complete-scene-animate-out"].includes(actionName)) throw new Error(`Unsupported safe action: ${actionName}`);
  const dir = outputDir(actionName);
  await mkdir(dir, { recursive: true });

  const before = await evaluateOnSgs(stageSummaryExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const actionExpression = actionName === "close-bless"
    ? closeBlessExpression()
    : actionName === "close-rogue-change"
      ? closeRogueChangeExpression()
    : actionName === "close-rogue-zhanji"
      ? closeRogueZhanJiExpression()
    : actionName === "current-back"
      ? currentBackExpression()
      : actionName === "scene-enter-next"
        ? sceneEnterNextExpression()
        : actionName === "switch-mode-scene"
          ? switchModeSceneExpression()
          : completeSceneAnimateOutExpression();
  const action = await evaluateOnSgs(actionExpression, { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  await sleep(Number(process.env.SGS_RUNTIME_ACTION_WAIT_MS || (actionName === "switch-mode-scene" ? 3500 : actionName === "complete-scene-animate-out" ? 2200 : actionName === "current-back" ? 2200 : 1200)));
  const after = await evaluateOnSgs(stageSummaryExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });

  const payload = {
    ok: true,
    target: action.target,
    actionName,
    before: before.value,
    install: install.value,
    action: action.value,
    after: after.value,
    dump,
    stop: stop.value
  };
  await writeJson(path.join(dir, "safe-action-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(actionName, payload), "utf8");

  console.log(JSON.stringify({
    dir,
    action: action.value,
    recordCount: dump.value?.records?.length || 0,
    finalScene: dump.value?.status?.scene || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
