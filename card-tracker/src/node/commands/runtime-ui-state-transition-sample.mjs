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
    process.env.SGS_UI_STATE_TRANSITION_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-ui-state-transition-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sampleExpression() {
  const allowDirectEvent = process.env.SGS_UI_STATE_ALLOW_DIRECT_EVENT === "1";
  const allowSelectTab = process.env.SGS_UI_STATE_ALLOW_SELECTTAB === "1";
  return String.raw`(async () => {
    const ALLOW_DIRECT_EVENT = ` + JSON.stringify(allowDirectEvent) + String.raw`;
    const ALLOW_SELECTTAB = ` + JSON.stringify(allowSelectTab) + String.raw`;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const textOf = (node) => {
      try {
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.innerHTML === "string") return node.innerHTML;
        if (typeof node?._innerHTML === "string") return node._innerHTML;
      } catch {}
      return "";
    };
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const effectiveVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth > 0 ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 20);
      const out = { kind: "object", ctor: ctor(value), className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", name: value.name || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "node", depth = 0, seen = new Set(), budget = { count: 0, max: 1200 }) => {
      if (!root || seen.has(root) || depth > 12 || budget.count >= budget.max) return;
      seen.add(root);
      budget.count++;
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        if (budget.count >= budget.max) return;
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childName + "#" + i, depth + 1, seen, budget);
      }
    };
    const refs = () => {
      const stageChildren = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i));
      const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
      const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
      let currentScene = null;
      if (sceneLayer) {
        for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
          const candidate = sceneLayer.getChildAt(i);
          if (effectiveVisible(candidate)) { currentScene = candidate; break; }
        }
      }
      let popup = null, ged = null, windowManager = null, proxy = null, sceneManager = null;
      try { popup = Laya.ClassUtils.getInstance("PopUpWindow"); } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try {
        const handlers = (ged && ged._events && ged._events.HIDE_WINDOW) || [];
        windowManager = (Array.isArray(handlers) ? handlers : [handlers]).map((h) => h && h.caller).find(Boolean) || null;
      } catch {}
      try { proxy = windowManager && windowManager.proxy || null; } catch {}
      try {
        const handlers = (ged && ged._events && ged._events.SWITCH_SCENE) || [];
        sceneManager = (Array.isArray(handlers) ? handlers : [handlers])
          .map((h) => h && h.caller)
          .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
      } catch {}
      return { stageChildren, sceneLayer, windowLayer, currentScene, manager: currentScene && currentScene.manager || null, ged, proxy, windowManager, sceneManager };
    };
    const interestingFields = (node) => {
      const out = {};
      for (const key of own(node)) {
        if (!/(selected|Selected|state|State|index|Index|value|Value|tab|Tab|data|Data|text|Text|btn|Btn|list|List|page|Page|current|Current|visible|Visible|enable|Enable|gray|Gray|fold|Fold)/.test(key)) continue;
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        try { out[key] = simple(node[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= 36) break;
      }
      return out;
    };
    const eventSources = (node) => {
      const out = [];
      const events = node && node._events || {};
      for (const [eventName, raw] of Object.entries(events)) {
        if (!/click|mouse|tap|select|change|touch/i.test(eventName)) continue;
        const handlers = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const handler of handlers.filter(Boolean).slice(0, 8)) {
          const method = handler.method;
          out.push({
            eventName,
            callerLabel: labelOf(handler.caller) || ctor(handler.caller),
            callerCtor: ctor(handler.caller),
            methodName: method && method.name || "",
            source: typeof method === "function" ? String(method).replace(/\s+/g, " ").slice(0, 700) : ""
          });
        }
      }
      return out;
    };
    const sourceRisk = (sources) => {
      const text = sources.map((item) => [item.eventName, item.callerLabel, item.methodName, item.source].join(" ")).join(" ");
      const risks = [];
      if (/buy|Buy|pay|Pay|shop|Shop|充值|购买|刷新|元宝|Recharge|YuanBao/.test(text)) risks.push("purchase");
      if (/Send|send|Req|request|proxy\.L|\.L\(|Client[A-Za-z0-9_]*Req|RogueLikeEventSelectReq/.test(text)) risks.push("send");
      if (/Leave|leave|Quit|quit|Restart|restart|BackBtn|返回|退出|重开/.test(text)) risks.push("leave-or-restart");
      if (/SwitchScene|executeSwitchScene|enterNextScene/.test(text)) risks.push("scene-switch");
      if (/Confirm|confirm|确定|确认/.test(text)) risks.push("confirm");
      return risks;
    };
    const findNodes = () => {
      const r = refs();
      const rightTabs = [];
      const chatTabs = [];
      const rightRoot = r.currentScene?.rightView || r.currentScene;
      const chatRoot = r.currentScene?.chatViewUI || r.currentScene;
      walk(rightRoot, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        const text = textOf(node).replace(/<[^>]+>/g, "");
        const label = labelOf(node);
        if (/SgsTabButton/.test(label) && /^(战役|牌局|房间|好友)$/.test(text)) {
          rightTabs.push({
            node,
            index: rightTabs.length,
            value: node.value ?? node._value ?? node.WholeData?.value ?? node._wholeData?.value ?? null,
            path: "CurrentScene" + nodePath.slice("CurrentScene".length),
            text,
            label,
            fields: interestingFields(node),
            sources: eventSources(node)
          });
        }
      }, "CurrentScene/rightView", 0, new Set(), { count: 0, max: 500 });
      walk(chatRoot, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        const text = textOf(node).replace(/<[^>]+>/g, "");
        const label = labelOf(node);
        if (/hVi/.test(label) && /^(会|私|房)$/.test(text)) {
          chatTabs.push({ node, path: "CurrentScene" + nodePath.slice("CurrentScene".length), text, label, fields: interestingFields(node), sources: eventSources(node) });
        }
      }, "CurrentScene/chatViewUI", 0, new Set(), { count: 0, max: 500 });
      return { refs: r, rightTabs, chatTabs };
    };
    const snapshot = (name) => {
      const found = findNodes();
      const scene = found.refs.currentScene;
      const manager = found.refs.manager;
      const rightTexts = [];
      const chatTexts = [];
      walk(scene?.rightView || scene, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        const text = textOf(node);
        if (!text) return;
        if (rightTexts.length < 80) rightTexts.push({ path: nodePath, label: labelOf(node), text, fields: interestingFields(node) });
      }, "CurrentScene/rightView", 0, new Set(), { count: 0, max: 500 });
      walk(scene?.chatViewUI || scene, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        const text = textOf(node);
        if (!text) return;
        if (chatTexts.length < 80) chatTexts.push({ path: nodePath, label: labelOf(node), text, fields: interestingFields(node) });
      }, "CurrentScene/chatViewUI", 0, new Set(), { count: 0, max: 500 });
      const windows = [];
      walk(found.refs.windowLayer, (node, nodePath) => {
        if (!effectiveVisible(node)) return;
        windows.push({ path: nodePath, label: labelOf(node), text: textOf(node), childCount: node.numChildren || 0, fields: interestingFields(node) });
      }, "WindowLayer");
      return {
        name,
        time: new Date().toISOString(),
        scene: scene ? { label: labelOf(scene), ctor: ctor(scene), className: scene._className_ || "", sceneName: scene.sceneName || scene.SceneName || "", childCount: scene.numChildren || 0 } : null,
        manager: manager ? {
          ctor: ctor(manager),
          isGameOver: manager.isGameOver === true,
          gameRound: manager.gameRound,
          gameTurn: manager.gameTurn,
          currentRoundSeatID: manager.currentRoundSeatID,
          seatCount: Array.isArray(manager.seats) ? manager.seats.length : null
        } : null,
        rightTabs: found.rightTabs.map((item) => ({ path: item.path, index: item.index, value: item.value, text: item.text, label: item.label, risks: sourceRisk(item.sources), fields: interestingFields(item.node) })),
        chatTabs: found.chatTabs.map((item) => ({ path: item.path, text: item.text, label: item.label, risks: sourceRisk(item.sources), fields: interestingFields(item.node) })),
        rightTexts: rightTexts.slice(0, 80),
        chatTexts: chatTexts.slice(0, 80),
        windows: windows.slice(0, 40)
      };
    };
    const wrappers = [];
    const calls = [];
    const wrap = (obj, prop, label, block = false) => {
      try {
        if (!obj || typeof obj[prop] !== "function") return false;
        const original = obj[prop];
        const wrapped = function (...args) {
          calls.push({ time: new Date().toISOString(), label, blocked: block, args: args.slice(0, 6).map((arg) => simple(arg, 1)) });
          if (block) return false;
          return original.apply(this, args);
        };
        Object.defineProperty(obj, prop, { value: wrapped, configurable: true });
        wrappers.push({ obj, prop, original, label });
        return true;
      } catch (error) {
        calls.push({ time: new Date().toISOString(), label, wrapError: String(error && error.message || error) });
        return false;
      }
    };
    const restore = () => {
      for (const item of wrappers.splice(0).reverse()) {
        try { Object.defineProperty(item.obj, item.prop, { value: item.original, configurable: true }); } catch (error) {
          calls.push({ time: new Date().toISOString(), label: item.label, restoreError: String(error && error.message || error) });
        }
      }
    };
    const initialRefs = refs();
    wrap(initialRefs.proxy, "L", "proxy.L", true);
    wrap(initialRefs.sceneManager, "SwitchScene", "SceneManager.SwitchScene", true);
    wrap(initialRefs.sceneManager, "SwitchSceneByModeId", "SceneManager.SwitchSceneByModeId", true);
    wrap(initialRefs.sceneManager, "executeSwitchScene", "SceneManager.executeSwitchScene", true);
    wrap(initialRefs.sceneManager, "enterNextScene", "SceneManager.enterNextScene", true);
    wrap(initialRefs.ged, "event", "GED.event", false);
    const snapshots = [snapshot("initial")];
    const attempts = [];
    const clickName = Laya.Event && Laya.Event.CLICK || "click";
    try {
      const initialSelected = snapshots[0].rightTabs.find((item) => item.fields?._selected === true || item.fields?.selected === true)?.text || "战役";
      const desiredOrder = ["牌局", "房间", "好友", initialSelected].filter((value, index, arr) => value && arr.indexOf(value) === index);
      for (const targetText of desiredOrder) {
        const found = findNodes();
        const target = found.rightTabs.find((item) => item.text === targetText);
        if (!target) {
          attempts.push({ targetText, ok: false, skipped: true, reason: "target not found" });
          continue;
        }
        const risks = sourceRisk(target.sources);
        if (risks.length) {
          attempts.push({ targetText, path: target.path, ok: false, skipped: true, reason: "source risk", risks, sources: target.sources });
          continue;
        }
        const before = snapshot("before:" + targetText);
        let eventResult = null;
        let eventError = "";
        let afterEvent = null;
        let methodResult = null;
        let methodError = "";
        let methodCalled = "";
        if (!ALLOW_DIRECT_EVENT) {
          attempts.push({
            targetText,
            path: target.path,
            index: target.index,
            value: target.value,
            label: target.label,
            ok: false,
            skipped: true,
            reason: "direct event gated by SGS_UI_STATE_ALLOW_DIRECT_EVENT=1",
            risks,
            sources: target.sources,
            beforeSelected: before.rightTabs.filter((item) => item.fields?._selected === true || item.fields?.selected === true).map((item) => item.text),
            afterSelected: before.rightTabs.filter((item) => item.fields?._selected === true || item.fields?.selected === true).map((item) => item.text),
            beforeRightTexts: before.rightTexts.map((item) => item.text).slice(0, 20),
            afterRightTexts: before.rightTexts.map((item) => item.text).slice(0, 20),
            callCountAfterClick: calls.length
          });
          continue;
        }
        try {
          eventResult = target.node.event(clickName, {
            type: clickName,
            target: target.node,
            currentTarget: target.node,
            stopPropagation() {},
            stopImmediatePropagation() {}
          });
        } catch (error) {
          eventError = String(error && error.stack || error && error.message || error);
        }
        await delay(180);
        afterEvent = snapshot("after-event:" + targetText);
        const eventSelected = afterEvent.rightTabs.filter((item) => item.fields?._selected === true || item.fields?.selected === true).map((item) => item.text);
        if (!eventSelected.includes(targetText)) {
          const container = target.node.parent || target.node._parent || null;
          const methodSource = typeof container?.SelectTab === "function" ? String(container.SelectTab) : "";
          const methodRisks = sourceRisk([{ eventName: "method", callerLabel: labelOf(container), methodName: "SelectTab", source: methodSource }]);
          if (!ALLOW_SELECTTAB) {
            methodError = "parent SelectTab exists but active call is gated by SGS_UI_STATE_ALLOW_SELECTTAB=1";
          } else if (!container || typeof container.SelectTab !== "function") {
            methodError = "parent SelectTab method not found";
          } else if (methodRisks.length) {
            methodError = "parent SelectTab method risk: " + methodRisks.join(",");
          } else {
            try {
              methodCalled = "parent.SelectTab(" + target.index + ")";
              methodResult = container.SelectTab(target.index);
            } catch (error) {
              methodError = String(error && error.stack || error && error.message || error);
            }
          }
        }
        await delay(350);
        const after = snapshot("after:" + targetText);
        snapshots.push(before, after);
        const afterSelected = after.rightTabs.filter((item) => item.fields?._selected === true || item.fields?.selected === true).map((item) => item.text);
        attempts.push({
          targetText,
          path: target.path,
          index: target.index,
          value: target.value,
          label: target.label,
          ok: afterSelected.includes(targetText),
          eventName: clickName,
          eventResult,
          eventError,
          eventSelected,
          methodCalled,
          methodResult,
          methodError,
          risks,
          sources: target.sources,
          beforeSelected: before.rightTabs.filter((item) => item.fields?._selected === true || item.fields?.selected === true).map((item) => item.text),
          afterSelected,
          beforeRightTexts: before.rightTexts.map((item) => item.text).slice(0, 20),
          afterRightTexts: after.rightTexts.map((item) => item.text).slice(0, 20),
          callCountAfterClick: calls.length
        });
      }
    } finally {
      restore();
    }
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: { resourceVersion: window.resourceVersion || "", layaVersion: Laya.version || "" },
      wrappersInstalled: wrappers.length,
      attempts,
      calls,
      snapshots,
      finalSnapshot: snapshot("final"),
      safety: {
        purchaseCallsMade: false,
        hiddenOpponentHandRead: false,
        directEventAllowed: ALLOW_DIRECT_EVENT,
        selectTabAllowed: ALLOW_SELECTTAB,
        proxyLBlockedCalls: calls.filter((item) => item.label === "proxy.L" && item.blocked).length,
        sceneSwitchBlockedCalls: calls.filter((item) => /^SceneManager\./.test(item.label) && item.blocked).length,
        note: "Only right-side Rogue battle tabs are targeted. Candidates with send/pay/leave/confirm/scene-switch source risks are skipped; proxy and scene-switch methods are temporarily blocked."
      }
    };
  })()`;
}

function readmeText(payload) {
  const attempts = payload.value?.attempts || [];
  const rows = attempts.map((item) =>
    `| ${item.targetText || ""} | ${item.ok ? "yes" : "no"} | ${item.skipped ? "yes" : "no"} | ${(item.afterSelected || []).join(",")} | ${item.reason || ""} |`
  );
  return [
    "# UI State Transition Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.value?.page?.title || ""} ${payload.value?.page?.url || ""}`,
    `- ResourceVersion: ${payload.value?.runtime?.resourceVersion || ""}`,
    `- Laya version: ${payload.value?.runtime?.layaVersion || ""}`,
    `- Attempts: ${attempts.length}`,
    `- Direct event allowed: ${payload.value?.safety?.directEventAllowed === true ? "yes" : "no"}`,
    `- SelectTab active call allowed: ${payload.value?.safety?.selectTabAllowed === true ? "yes" : "no"}`,
    `- Proxy blocked calls: ${payload.value?.safety?.proxyLBlockedCalls ?? ""}`,
    `- Scene-switch blocked calls: ${payload.value?.safety?.sceneSwitchBlockedCalls ?? ""}`,
    "",
    "| Target | Clicked | Skipped | After selected | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Scope",
    "",
    "- Samples local right-side Rogue battle tab transitions only.",
    "- Skips candidates whose handler source contains purchase, send/request, leave/restart, confirm, or scene-switch terms.",
    "- Temporarily blocks `proxy.L` and SceneManager switch methods during the sample, then restores wrappers.",
    "- Direct `node.event(click)` is source-captured but not active-called unless `SGS_UI_STATE_ALLOW_DIRECT_EVENT=1` is set.",
    "- `SelectTab(index)` is source-captured but not active-called unless `SGS_UI_STATE_ALLOW_SELECTTAB=1` is set.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(sampleExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "ui-state-transition-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    attempts: result.value?.attempts?.length || 0,
    clicked: (result.value?.attempts || []).filter((item) => item.ok).length,
    skipped: (result.value?.attempts || []).filter((item) => item.skipped).length,
    proxyLBlockedCalls: result.value?.safety?.proxyLBlockedCalls || 0,
    sceneSwitchBlockedCalls: result.value?.safety?.sceneSwitchBlockedCalls || 0,
    directEventAllowed: result.value?.safety?.directEventAllowed === true,
    selectTabAllowed: result.value?.safety?.selectTabAllowed === true,
    finalSelected: (result.value?.finalSnapshot?.rightTabs || [])
      .filter((item) => item.fields?._selected === true || item.fields?.selected === true)
      .map((item) => item.text)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
