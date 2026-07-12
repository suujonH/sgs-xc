import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_RIGHT_PANEL_TOGGLE_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-right-panel-toggle-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function snapshotExpression(label) {
  return String.raw`(() => {
    const labelName = ${JSON.stringify(label)};
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const nodeLabel = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = nodeLabel(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const boundsOf = (node) => {
      if (!node) return null;
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        return p ? { x: p.x, y: p.y, width: node.width || 0, height: node.height || 0 } : null;
      } catch {
        return null;
      }
    };
    const eventSummary = (node) => {
      const events = node?._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const eventName of own(events)) {
        if (!/click|mouse|touch/i.test(eventName)) continue;
        const raw = events[eventName];
        const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
        out[eventName] = handlers.filter(Boolean).map((handler) => ({
          caller: nodeLabel(handler.caller),
          callerCtor: ctor(handler.caller),
          method: handler.method?.name || "",
          args: Array.isArray(handler.args) ? handler.args.map((arg) => typeof arg).slice(0, 4) : []
        })).slice(0, 8);
      }
      return out;
    };
    const findScene = () => {
      let out = null;
      const walk = (node, seen = new Set()) => {
        if (!node || out || seen.has(node) || seen.size > 2500) return;
        seen.add(node);
        if (node.sceneName === "RogueLikeGameScene" || node._className_ === "RogueLikeGameScene") {
          out = node;
          return;
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          try { walk(node.getChildAt(i), seen); } catch {}
        }
      };
      walk(Laya.stage);
      return out;
    };
    const visibleWindows = [];
    const walkWindows = (node, nodePath, depth, seen = new Set()) => {
      if (!node || seen.has(node) || seen.size > 2500 || depth > 8) return;
      seen.add(node);
      const label = nodeLabel(node);
      const hidden = hiddenReasons(node);
      if (hidden.length === 0 && /Window|Confirm|ChatPWindow|mWt|WindowLayer/.test(label)) {
        visibleWindows.push({
          path: nodePath,
          label,
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          sceneName: node.sceneName || node.SceneName || "",
          childCount: node.numChildren || 0,
          bounds: boundsOf(node)
        });
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        let child = null;
        try { child = node.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || ctor(child)) || "#" + i;
        walkWindows(child, nodePath + "/" + childName + "#" + i, depth + 1, seen);
      }
    };
    const scene = findScene();
    if (!scene) return { ok: false, label: labelName, reason: "Visible RogueLikeGameScene not found" };
    walkWindows(Laya.stage, "Laya.stage", 0);
    const methodNames = [
      "onRightPanelToggleClick",
      "hideRightPanel",
      "showRightPanel",
      "relayoutForPanelToggle",
      "PauseBtnClickHander",
      "BackBtnClickHandler"
    ];
    return {
      ok: true,
      label: labelName,
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      scene: {
        label: nodeLabel(scene),
        ctor: ctor(scene),
        sceneName: scene.sceneName || scene.SceneName || "",
        className: scene._className_ || "",
        visible: scene.visible,
        hiddenReasons: hiddenReasons(scene),
        childCount: scene.numChildren || 0
      },
      rightPanel: {
        rightViewVisible: scene.rightView?.visible,
        rightViewHiddenReasons: hiddenReasons(scene.rightView),
        chatViewUIVisible: scene.chatViewUI?.visible,
        chatDragSpriteVisible: scene.chatDragSprite?.visible,
        toggleButtonVisible: scene.rightPanelToggleBtn?.visible,
        toggleButtonAlpha: scene.rightPanelToggleBtn?.alpha,
        rightViewBounds: boundsOf(scene.rightView),
        chatViewBounds: boundsOf(scene.chatViewUI),
        toggleButtonBounds: boundsOf(scene.rightPanelToggleBtn),
        toggleButtonEvents: eventSummary(scene.rightPanelToggleBtn)
      },
      topMenu: {
        label: nodeLabel(scene.topMenu),
        visible: scene.topMenu?.visible,
        bounds: boundsOf(scene.topMenu),
        events: eventSummary(scene.topMenu)
      },
      visibleWindows: visibleWindows.slice(0, 80),
      methodSources: Object.fromEntries(methodNames.map((name) => [
        name,
        typeof scene[name] === "function" ? String(scene[name]).slice(0, 1200) : null
      ]))
    };
  })()`;
}

function toggleExpression(label) {
  return String.raw`(() => {
    const labelName = ${JSON.stringify(label)};
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const nodeLabel = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const findScene = () => {
      let out = null;
      const walk = (node, seen = new Set()) => {
        if (!node || out || seen.has(node) || seen.size > 2500) return;
        seen.add(node);
        if (node.sceneName === "RogueLikeGameScene" || node._className_ === "RogueLikeGameScene") {
          out = node;
          return;
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          try { walk(node.getChildAt(i), seen); } catch {}
        }
      };
      walk(Laya.stage);
      return out;
    };
    const scene = findScene();
    if (!scene) return { ok: false, label: labelName, reason: "Visible RogueLikeGameScene not found" };
    if (typeof scene.onRightPanelToggleClick !== "function") {
      return { ok: false, label: labelName, reason: "scene.onRightPanelToggleClick is not a function", scene: nodeLabel(scene) };
    }
    const before = {
      scene: nodeLabel(scene),
      rightViewVisible: scene.rightView?.visible,
      chatViewUIVisible: scene.chatViewUI?.visible,
      chatDragSpriteVisible: scene.chatDragSprite?.visible,
      toggleButtonVisible: scene.rightPanelToggleBtn?.visible,
      toggleButtonAlpha: scene.rightPanelToggleBtn?.alpha
    };
    const result = scene.onRightPanelToggleClick();
    const after = {
      scene: nodeLabel(scene),
      rightViewVisible: scene.rightView?.visible,
      chatViewUIVisible: scene.chatViewUI?.visible,
      chatDragSpriteVisible: scene.chatDragSprite?.visible,
      toggleButtonVisible: scene.rightPanelToggleBtn?.visible,
      toggleButtonAlpha: scene.rightPanelToggleBtn?.alpha
    };
    return {
      ok: true,
      label: labelName,
      called: "currentScene.onRightPanelToggleClick()",
      result,
      before,
      after,
      changed: before.rightViewVisible !== after.rightViewVisible ||
        before.chatViewUIVisible !== after.chatViewUIVisible ||
        before.chatDragSpriteVisible !== after.chatDragSpriteVisible
    };
  })()`;
}

function readmeText(payload) {
  const initial = payload.snapshots?.initial?.rightPanel || {};
  const hidden = payload.snapshots?.afterFirstToggle?.rightPanel || {};
  const restored = payload.snapshots?.afterSecondToggle?.rightPanel || {};
  return [
    "# Runtime Right Panel Toggle Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.target?.title || ""} ${payload.target?.url || ""}`.trim(),
    `- Initial scene: ${payload.snapshots?.initial?.scene?.sceneName || ""}`,
    `- First toggle ok: ${payload.actions?.first?.ok === true}`,
    `- Second toggle ok: ${payload.actions?.second?.ok === true}`,
    `- Final restored: ${payload.judgement?.finalRestored === true}`,
    "",
    "## State",
    "",
    `- Initial rightView.visible: ${initial.rightViewVisible}`,
    `- After first toggle rightView.visible: ${hidden.rightViewVisible}`,
    `- After second toggle rightView.visible: ${restored.rightViewVisible}`,
    "",
    "## Safety Notes",
    "",
    "- This sample calls only `currentScene.onRightPanelToggleClick()`.",
    "- `PauseBtnClickHander()` and `BackBtnClickHandler()` are recorded as source snippets only and are not called.",
    "- The second toggle restores the panel to the initial visible state.",
    ""
  ].join("\n");
}

function panelState(snapshot) {
  return {
    rightViewVisible: snapshot?.rightPanel?.rightViewVisible,
    chatViewUIVisible: snapshot?.rightPanel?.chatViewUIVisible,
    chatDragSpriteVisible: snapshot?.rightPanel?.chatDragSpriteVisible
  };
}

function samePanelState(left, right) {
  const a = panelState(left);
  const b = panelState(right);
  return a.rightViewVisible === b.rightViewVisible &&
    a.chatViewUIVisible === b.chatViewUIVisible &&
    a.chatDragSpriteVisible === b.chatDragSpriteVisible;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const targetSnapshot = await evaluateOnSgs("(() => ({ url: location.href, title: document.title }))()");
  const initial = await evaluateOnSgs(snapshotExpression("initial"), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const first = await evaluateOnSgs(toggleExpression("first-toggle"), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  await sleep(Number(process.env.SGS_RIGHT_PANEL_TOGGLE_WAIT_MS || 500));
  const afterFirstToggle = await evaluateOnSgs(snapshotExpression("after-first-toggle"), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const second = await evaluateOnSgs(toggleExpression("second-toggle"), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  await sleep(Number(process.env.SGS_RIGHT_PANEL_TOGGLE_WAIT_MS || 500));
  const afterSecondToggle = await evaluateOnSgs(snapshotExpression("after-second-toggle"), { timeoutMs: 30000, cdpTimeoutMs: 45000 });

  const payload = {
    ok: initial.value?.ok === true && first.value?.ok === true && afterFirstToggle.value?.ok === true && second.value?.ok === true && afterSecondToggle.value?.ok === true,
    target: targetSnapshot.value,
    snapshots: {
      initial: initial.value,
      afterFirstToggle: afterFirstToggle.value,
      afterSecondToggle: afterSecondToggle.value
    },
    actions: {
      first: first.value,
      second: second.value
    },
    judgement: {
      firstChanged: first.value?.changed === true,
      secondChanged: second.value?.changed === true,
      finalRestored: samePanelState(initial.value, afterSecondToggle.value),
      usesPurchaseOrLeave: false,
      calledMethods: [
        first.value?.called,
        second.value?.called
      ].filter(Boolean)
    }
  };

  await writeJson(path.join(dir, "right-panel-toggle-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({ ok: payload.ok, dir, judgement: payload.judgement }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
