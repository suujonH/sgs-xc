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

function outputDir(actionName) {
  return path.resolve(
    process.env.SGS_BATTLE_END_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-${actionName}-battle-end`)
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
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
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
    const simple = (value) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      return "[" + (ctor(value) || t) + "]";
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj)) {
        if (/handCards|watchCards|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const methodNames = (obj, pattern) => {
      const names = [];
      let proto = Object.getPrototypeOf(obj || {});
      const seen = new Set();
      while (proto && proto !== Object.prototype) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try { if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key); } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort();
    };
    const walk = (root, visitor, maxDepth = 12) => {
      const seen = new Set();
      const inner = (node, nodePath, depth) => {
        if (!node || seen.has(node) || depth > maxDepth) return;
        seen.add(node);
        visitor(node, nodePath, depth);
        for (let i = 0; i < (node.numChildren || 0); i++) {
          const child = node.getChildAt(i);
          inner(child, nodePath + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
        }
      };
      inner(root, "Laya.stage", 0);
    };
    const confirmDetails = (node) => {
      const data = node && node.confirmData || null;
      if (!data) return null;
      return {
        title: data.title || "",
        content: data.content || "",
        clickClose: data.clickClose,
        canClose: data.canClose,
        buttons: (data.buttonArr || []).map((button, index) => ({
          index,
          label: button && button.label || "",
          isCancel: !!(button && button.isCancel),
          btnStyle: button && button.btnStyle,
          callBackName: button && button.callBack && button.callBack.name || "",
          callBackSource: button && button.callBack ? String(button.callBack).replace(/\s+/g, " ").slice(0, 240) : "",
          thisObject: button && button.thisObject ? labelOf(button.thisObject) || ctor(button.thisObject) : ""
        }))
      };
    };
    const summary = (node, nodePath) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      visible: node && node.visible,
      alpha: node && node.alpha,
      effectiveVisible: isVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node && node.x,
      y: node && node.y,
      width: node && node.width,
      height: node && node.height,
      childCount: node && node.numChildren || 0,
      fields: safeFields(node, /(game|Game|result|Result|over|Over|close|Close|leave|Leave|quit|Quit|modal|Modal|share|Share|count|Count|is[A-Z]|can[A-Z]|name|Name|data|Data)/, 80),
      keyMethods: methodNames(node, /(close|Close|remove|Remove|leave|Leave|quit|Quit|back|Back|result|Result|goto|Goto|click|Click|modal|Modal|share|Share|gameOver|GameOver)/).slice(0, 80),
      confirmDetails: confirmDetails(node)
    });
    const findNodes = (pattern) => {
      const out = [];
      walk(Laya.stage, (node, nodePath) => {
        if (pattern.test(labelOf(node))) out.push({ node, path: nodePath });
      });
      return out;
    };
    const currentScene = () => {
      let scene = null;
      const layer = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
        .find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" ")));
      if (layer) {
        for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
          const candidate = layer.getChildAt(i);
          if (isVisible(candidate)) { scene = candidate; break; }
        }
        if (!scene && layer.numChildren) scene = layer.getChildAt(layer.numChildren - 1);
      }
      return scene;
    };
    const collect = () => {
      const scene = currentScene();
      const resultWindows = findNodes(/GameResultWindow/).map((item) => summary(item.node, item.path));
      const confirmWindows = findNodes(/Confirm|PWt|Prompt|ResultWindow/).map((item) => summary(item.node, item.path));
      const sceneSummary = scene ? summary(scene, "currentScene") : null;
      const manager = scene && scene.manager || null;
      return {
        time: new Date().toISOString(),
        page: { url: location.href, title: document.title },
        currentScene: sceneSummary,
        manager: manager ? {
          ctor: ctor(manager),
          isGameOver: !!manager.isGameOver,
          gameRound: manager.gameRound,
          gameTurn: manager.gameTurn,
          currentRoundSeatID: manager.currentRoundSeatID,
          selfSeatIndex: manager.selfSeatIndex,
          hasSeats: Array.isArray(manager.seats),
          seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
          hasGameOverData: !!manager.gameOverData
        } : null,
        resultWindows,
        confirmWindows,
        stageChildren: Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => {
          const node = Laya.stage.getChildAt(i);
          return { index: i, label: labelOf(node), childCount: node && node.numChildren || 0, visible: node && node.visible, alpha: node && node.alpha };
        })
      };
    };
  `;
}

function actionExpression(actionName) {
  return `(() => {
    ${helpers()}
    const before = collect();
    let action = { ok: true, actionName: ${JSON.stringify(actionName)}, called: "(none)" };
    if (${JSON.stringify(actionName)} === "close-game-result") {
      const candidates = findNodes(/GameResultWindow/).filter((item) => isVisible(item.node) && typeof item.node.Close === "function");
      const target = candidates[0];
      if (!target) {
        action = { ok: false, actionName: "close-game-result", reason: "No visible GameResultWindow with Close() found" };
      } else {
        action.target = summary(target.node, target.path);
        target.node.Close();
        action.called = "GameResultWindow.Close()";
      }
    }
    if (${JSON.stringify(actionName)} === "confirm-leave") {
      const candidates = findNodes(/PWt|ConfirmWindow/).filter((item) => {
        const node = item.node;
        const data = node && node.confirmData;
        const first = data && data.buttonArr && data.buttonArr[0];
        const content = data && String(data.content || "");
        const title = data && String(data.title || "");
        return isVisible(node)
          && data
          && /退出|离开|Quit/.test(title + " " + content)
          && /离开房间|退出游戏|牌局结果|Quit|离开/.test(content + " " + title)
          && first
          && first.label === "确定"
          && first.callBack
          && first.callBack.name === "leaveGameHandler"
          && first.thisObject
          && typeof node.btnClickHandler === "function";
      });
      const target = candidates[0];
      if (!target) {
        action = { ok: false, actionName: "confirm-leave", reason: "No safe visible leave ConfirmWindow found" };
      } else {
        const button = target.node.btnList && target.node.btnList[0];
        action.target = summary(target.node, target.path);
        action.button = button ? summary(button, target.path + "/btnList#0") : null;
        target.node.btnClickHandler({ currentTarget: button || { label: "确定" } });
        action.called = "ConfirmWindow.btnClickHandler({ currentTarget: 确定按钮 })";
      }
    }
    return { before, action };
  })()`;
}

function snapshotExpression() {
  return `(() => { ${helpers()} return collect(); })()`;
}

function readmeText(payload) {
  const lines = [];
  const before = payload.action?.before || {};
  const after = payload.after || {};
  const records = payload.dump?.value?.records || [];
  lines.push(`# Battle End Sample: ${payload.actionName}`);
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Action ok: ${!!payload.action?.action?.ok}`);
  lines.push(`- Action call: ${payload.action?.action?.called || ""}`);
  lines.push(`- Before scene: ${before.currentScene?.sceneName || before.currentScene?.label || ""}`);
  lines.push(`- Before isGameOver: ${before.manager?.isGameOver}`);
  lines.push(`- Before result windows: ${before.resultWindows?.length || 0}`);
  lines.push(`- After scene: ${after.currentScene?.sceneName || after.currentScene?.label || ""}`);
  lines.push(`- After isGameOver: ${after.manager?.isGameOver}`);
  lines.push(`- After result windows: ${after.resultWindows?.length || 0}`);
  lines.push(`- Event records: ${records.length}`);
  lines.push("");
  lines.push("This sample is for end-of-battle overlay cleanup. It uses only visible end-of-battle windows and their own game methods.");
  lines.push("");
  lines.push("## Events");
  lines.push("");
  for (const record of records.slice(0, 120)) {
    lines.push(`- #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const actionName = process.argv[2] || "scan";
  if (!["scan", "close-game-result", "confirm-leave"].includes(actionName)) throw new Error(`Unsupported battle-end action: ${actionName}`);
  const dir = outputDir(actionName);
  await mkdir(dir, { recursive: true });

  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const action = await evaluateOnSgs(actionExpression(actionName), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await sleep(Number(process.env.SGS_BATTLE_END_WAIT_MS || (actionName === "confirm-leave" ? 5000 : actionName === "close-game-result" ? 1500 : 400)));
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
  await writeJson(path.join(dir, "battle-end-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");

  console.log(JSON.stringify({
    dir,
    action: payload.action?.action,
    before: payload.action?.before,
    after: payload.after,
    recordCount: payload.dump?.value?.records?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
