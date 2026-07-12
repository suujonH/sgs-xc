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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_PROMPT_AUTOMATION_MONITOR_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-prompt-automation-monitor`)
  );
}

const classHookSpecs = {
  SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "onTouchCard", "onTouchEnsure", "Close"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch", "Close"],
  SkillBiFaWindow: ["enterWindow", "Init", "addHandCard", "onHandCardClicked", "SelectOptEvent", "Close"],
  SkillBiFaRogueWindow: ["enterWindow", "Close"],
  MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "Close"],
  MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "Close"],
  GongXinWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick", "Close"],
  GuZhengSelectCardWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick", "Close"],
  SwapCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  SwapTopCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  SwitchCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PoXiCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PinDianWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PinDianMultiWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PopUpWindowResponser: ["Response"],
  ZhenJunWindowResponser: ["Response"],
  RogueLikeGameScene: ["gameOverHandler", "showGameResultWindow", "addCardsHandler", "UpdateCardByUseSpell"]
};

const instanceHookMethods = [
  "ApplyActivateSpell",
  "ApplyTriggerSpell",
  "ButtonBar_Skill_UpdateCallback",
  "Cancel",
  "CardUI_EndSkill",
  "CardUI_SelectedChanged",
  "CardUI_TouchSkill",
  "DiscardRequest",
  "Discard_Result",
  "EndSelector",
  "OnTouchSkill",
  "PlayCard_Result",
  "SpellTouch_ConfirmResult",
  "onSelectSeat",
  "Seat_SelectedChanged"
];

function installExpression() {
  return String.raw`(() => {
    const CLASS_HOOK_SPECS = ${JSON.stringify(classHookSpecs)};
    const INSTANCE_HOOK_METHODS = ${JSON.stringify(instanceHookMethods)};
    const MAX_RECORDS = Number(${JSON.stringify(process.env.SGS_PROMPT_MONITOR_MAX_RECORDS || "5000")}) || 5000;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth > 0 ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 24);
      const out = {
        kind: "object",
        ctor: ctor(value),
        label: labelOf(value),
        name: value.name || "",
        className: value._className_ || "",
        sceneName: value.sceneName || value.SceneName || "",
        uiid: value._uiid || "",
        keys
      };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 10)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
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
    const findCurrentScene = () => {
      let out = null;
      const walk = (node, seen = new Set()) => {
        if (!node || out || seen.has(node) || seen.size > 3000) return;
        seen.add(node);
        if ((node.sceneName || node._className_) && /TableGameScene|RogueLikeGameScene/.test(String(node.sceneName || node._className_))) {
          out = node;
          return;
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          try { walk(node.getChildAt(i), seen); } catch {}
        }
      };
      try { walk(Laya.stage); } catch {}
      return out;
    };
    const findManagerRefs = () => {
      const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
      const CU = window.Laya && Laya.ClassUtils;
      let popup = null, ged = null, windowManager = null, proxy = null;
      try { popup = CU?.getInstance?.("PopUpWindow") || null; } catch {}
      try { ged = popup?.ged || null; } catch {}
      try { windowManager = toArray(ged?._events?.HIDE_WINDOW)[0]?.caller || null; } catch {}
      try { proxy = windowManager?.proxy || null; } catch {}
      return { CU, popup, ged, windowManager, proxy };
    };
    const sceneState = () => {
      const scene = findCurrentScene();
      const manager = scene?.manager || scene?.Manager || scene?.gameManager || null;
      const selfSeatIndex = manager?.selfSeatIndex ?? manager?.SelfSeatIndex ?? null;
      let selfSeat = null;
      try {
        selfSeat = Array.isArray(manager?.seats) && Number.isInteger(selfSeatIndex) ? manager.seats[selfSeatIndex] : null;
      } catch {}
      return {
        sceneName: scene?.sceneName || scene?.SceneName || "",
        className: scene?._className_ || "",
        ctor: ctor(scene),
        managerCtor: ctor(manager),
        isGameOver: manager?.isGameOver === true || manager?.IsGameOver === true,
        currentRoundSeatID: manager?.currentRoundSeatID ?? null,
        selfSeatIndex,
        selfIsDead: selfSeat?.isDead ?? selfSeat?.IsDead ?? null,
        selfHandCardCount: selfSeat?.handCardCount ?? selfSeat?.HandCardCount ?? null
      };
    };
    const currentPromptSnapshot = () => {
      const scene = findCurrentScene();
      const manager = scene?.manager || scene?.Manager || scene?.gameManager || null;
      const promptNodes = [];
      const windowNodes = [];
      const walk = (node, path, depth, seen = new Set()) => {
        if (!node || seen.has(node) || seen.size > 3000 || depth > 9) return;
        seen.add(node);
        const label = labelOf(node);
        const hidden = hiddenReasons(node);
        if (hidden.length === 0 && /Window|Select|Spell|Skill|BiFa|Military|PinDian|GongXin|GuZheng|Swap|PoXi|GuanXing|QiXing/.test(label)) {
          windowNodes.push({ path, label, ctor: ctor(node), text: typeof node.text === "string" ? node.text : "", childCount: node.numChildren || 0 });
        }
        const methodHits = INSTANCE_HOOK_METHODS.filter((method) => {
          try { return typeof node[method] === "function"; } catch { return false; }
        });
        const text = typeof node.text === "string" ? node.text : "";
        if (hidden.length === 0 && (methodHits.length || /确定|取消|出牌|弃牌|使用|发动|确认|摸牌|选择/.test(text))) {
          promptNodes.push({ path, label, ctor: ctor(node), text, methodHits, childCount: node.numChildren || 0 });
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          const childName = child && (child.name || child._className_ || child.sceneName || ctor(child)) || "#" + i;
          walk(child, path + "/" + childName + "#" + i, depth + 1, seen);
        }
      };
      try { walk(scene, "CurrentScene", 0); } catch {}
      return {
        scene: sceneState(),
        managerFields: manager ? {
          isGameOver: manager.isGameOver,
          currentRoundSeatID: manager.currentRoundSeatID,
          gameRound: manager.gameRound,
          gameTurn: manager.gameTurn,
          cardPileCardCount: manager.cardPileCardCount
        } : null,
        promptNodes: promptNodes.slice(0, 120),
        visiblePromptWindows: windowNodes.slice(0, 80)
      };
    };
    const existing = window.__codexPromptAutomationMonitor;
    if (existing?.installed) return existing.status();
    const refs = findManagerRefs();
    const state = {
      installed: true,
      installedAt: now(),
      records: [],
      wrappers: [],
      errors: [],
      classHooks: [],
      instanceHooks: [],
      sendHooks: [],
      previewOnly: true
    };
    const record = (kind, label, args, extra = {}) => {
      try {
        state.records.push({
          seq: state.records.length,
          time: now(),
          kind,
          label,
          scene: sceneState(),
          args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg)),
          ...extra
        });
        if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
      } catch (error) {
        state.errors.push({ time: now(), at: "record:" + label, error: String(error?.message || error) });
      }
    };
    const wrap = (owner, prop, label, targetType) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexPromptAutomationWrapped) return false;
        const wrapped = function (...args) {
          record("call", label, args, { targetType });
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexPromptAutomationWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, prop, original, label, targetType });
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
        return false;
      }
    };
    for (const [className, methods] of Object.entries(CLASS_HOOK_SPECS)) {
      let cls = null;
      try { cls = refs.CU?.getClass?.(className) || refs.CU?._classMap?.[className] || null; } catch {}
      const installed = [];
      const missing = [];
      for (const method of methods) {
        if (wrap(cls?.prototype, method, className + "." + method, "class-prototype")) installed.push(method);
        else missing.push(method);
      }
      state.classHooks.push({ className, classExists: !!cls, functionName: cls?.name || "", installed, missing });
    }
    const scene = findCurrentScene();
    const seen = new Set();
    const walkInstance = (node, path, depth) => {
      if (!node || seen.has(node) || seen.size > 3000 || depth > 9) return;
      seen.add(node);
      const installed = [];
      for (const method of INSTANCE_HOOK_METHODS) {
        if (wrap(node, method, path + "." + method, "current-instance")) installed.push(method);
      }
      if (installed.length) state.instanceHooks.push({ path, label: labelOf(node), ctor: ctor(node), installed });
      for (let i = 0; i < (node.numChildren || 0); i++) {
        let child = null;
        try { child = node.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || ctor(child)) || "#" + i;
        walkInstance(child, path + "/" + childName + "#" + i, depth + 1);
      }
    };
    walkInstance(scene, "CurrentScene", 0);
    for (const [owner, prop, label] of [
      [refs.ged, "event", "ged.event"],
      [refs.ged, "ShowWindow", "ged.ShowWindow"],
      [refs.ged, "CloseWindow", "ged.CloseWindow"],
      [refs.proxy, "event", "proxy.event"],
      [refs.proxy, "L", "proxy.L"],
      [refs.windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
      [refs.windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
      [refs.windowManager, "CloseWindow", "WindowManager.CloseWindow"],
      [refs.windowManager, "CloseWindowByName", "WindowManager.CloseWindowByName"]
    ]) {
      if (wrap(owner, prop, label, "manager-send-window")) state.sendHooks.push(label);
    }
    const monitor = {
      installed: true,
      status() {
        return {
          installed: true,
          installedAt: state.installedAt,
          previewOnly: state.previewOnly,
          recordCount: state.records.length,
          wrapperCount: state.wrappers.length,
          classHookCount: state.classHooks.reduce((sum, item) => sum + item.installed.length, 0),
          instanceHookCount: state.instanceHooks.reduce((sum, item) => sum + item.installed.length, 0),
          sendHookCount: state.sendHooks.length,
          errors: state.errors.slice(-20),
          scene: sceneState()
        };
      },
      dump() {
        return {
          ok: true,
          status: this.status(),
          classHooks: state.classHooks.slice(),
          instanceHooks: state.instanceHooks.slice(),
          sendHooks: state.sendHooks.slice(),
          records: state.records.slice(),
          errors: state.errors.slice(),
          currentPromptSnapshot: currentPromptSnapshot()
        };
      },
      stop() {
        for (const item of state.wrappers.splice(0).reverse()) {
          try { Object.defineProperty(item.owner, item.prop, { value: item.original, configurable: true }); }
          catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error?.message || error) }); }
        }
        const status = this.status();
        delete window.__codexPromptAutomationMonitor;
        return { ok: true, status };
      }
    };
    window.__codexPromptAutomationMonitor = monitor;
    record("monitor", "install", []);
    return monitor.status();
  })()`;
}

function dumpExpression() {
  return "(() => window.__codexPromptAutomationMonitor ? window.__codexPromptAutomationMonitor.dump() : { ok: false, reason: 'not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexPromptAutomationMonitor ? window.__codexPromptAutomationMonitor.stop() : { ok: true, reason: 'not installed' })()";
}

function readmeText(payload) {
  const status = payload.install?.value || {};
  const dump = payload.dump?.value || {};
  const scene = dump.currentPromptSnapshot?.scene || status.scene || {};
  const sceneStateLine = scene.isGameOver === true
    ? "- In the captured scene `isGameOver=true`, so this run is installation/readiness evidence rather than an active prompt-confirm sample."
    : "- In the captured scene `isGameOver=false`, so this run is non-ended prompt-surface evidence; it still does not perform any prompt-confirm action.";
  return [
    "# Runtime Prompt Automation Monitor",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.target?.title || ""} ${payload.target?.url || ""}`.trim(),
    `- Scene: ${scene.sceneName || ""}; manager=${scene.managerCtor || ""}; isGameOver=${scene.isGameOver}`,
    `- Preview only: ${status.previewOnly === true}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Class hooks: ${status.classHookCount || 0}`,
    `- Current instance hooks: ${status.instanceHookCount || 0}`,
    `- Send/window hooks: ${status.sendHookCount || 0}`,
    `- Records while installed: ${dump.records?.length || 0}`,
    `- Prompt nodes now: ${dump.currentPromptSnapshot?.promptNodes?.length || 0}`,
    `- Visible prompt windows now: ${dump.currentPromptSnapshot?.visiblePromptWindows?.length || 0}`,
    "",
    "## Trigger Conditions",
    "",
    "- Card selection starts at `SelectCardWindow.enterWindow`; auto-selection flows through `autoSelect`, `onTouchCard`, `onTouchEnsure`, `confirmClick`, and `cancelClick`.",
    "- Multi-skill choice starts at `SpellMultiSelectorWindow.enterWindow` and uses `onTouch` for button actions.",
    "- Skill-button automation on the current battle scene is anchored at current instance methods such as `CardUI_TouchSkill`, `SpellTouch_ConfirmResult`, `CardUI_SelectedChanged`, and `EndSelector`.",
    "- Actual outgoing/close effects are correlated through `proxy.L`, `ged.event`, `ged.ShowWindow`, and WindowManager show/update/close hooks.",
    "",
    "## Safety",
    "",
    "- The monitor does not click, confirm, cancel, use a skill, discard, buy, refresh, or read hidden opponent hand fields.",
    sceneStateLine,
    ""
  ].join("\n");
}

function tsvEscape(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function hookTargetsTsv(dump) {
  const lines = ["targetType\tclassName\tfunctionName\tpath\tmethod\tinstalled\tmissing\tlabel"];
  for (const item of dump.classHooks || []) {
    lines.push([
      "class-prototype",
      item.className,
      item.functionName,
      "",
      (item.installed || []).join(","),
      (item.installed || []).length,
      (item.missing || []).join(","),
      ""
    ].map(tsvEscape).join("\t"));
  }
  for (const item of dump.instanceHooks || []) {
    lines.push([
      "current-instance",
      "",
      item.ctor,
      item.path,
      (item.installed || []).join(","),
      (item.installed || []).length,
      "",
      item.label
    ].map(tsvEscape).join("\t"));
  }
  for (const label of dump.sendHooks || []) {
    lines.push(["manager-send-window", "", "", "", "", 1, "", label].map(tsvEscape).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function promptReadinessTsv(dump) {
  const snapshot = dump.currentPromptSnapshot || {};
  const lines = ["kind\tpath\tlabel\tctor\ttext\tmethods\tchildCount"];
  for (const item of snapshot.promptNodes || []) {
    lines.push(["prompt-node", item.path, item.label, item.ctor, item.text, (item.methodHits || []).join(","), item.childCount].map(tsvEscape).join("\t"));
  }
  for (const item of snapshot.visiblePromptWindows || []) {
    lines.push(["visible-window", item.path, item.label, item.ctor, item.text, "", item.childCount].map(tsvEscape).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  await evaluateOnSgs(stopExpression()).catch(() => null);
  const target = await evaluateOnSgs("(() => ({ title: document.title, url: location.href }))()");
  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  await sleep(Number(process.env.SGS_PROMPT_MONITOR_WAIT_MS || 1500));
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const stop = process.env.SGS_PROMPT_MONITOR_KEEP_INSTALLED === "1"
    ? { value: { ok: true, skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const payload = {
    ok: install.value?.installed === true && dump.value?.ok === true && stop.value?.ok === true,
    target: target.value,
    install,
    dump,
    stop,
    summary: {
      scene: dump.value?.currentPromptSnapshot?.scene?.sceneName || install.value?.scene?.sceneName || "",
      isGameOver: dump.value?.currentPromptSnapshot?.scene?.isGameOver ?? install.value?.scene?.isGameOver,
      wrapperCount: install.value?.wrapperCount || 0,
      classHookCount: install.value?.classHookCount || 0,
      instanceHookCount: install.value?.instanceHookCount || 0,
      sendHookCount: install.value?.sendHookCount || 0,
      records: dump.value?.records?.length || 0,
      promptNodes: dump.value?.currentPromptSnapshot?.promptNodes?.length || 0,
      visiblePromptWindows: dump.value?.currentPromptSnapshot?.visiblePromptWindows?.length || 0,
      restoredWrappers: stop.value?.status?.wrapperCount || 0,
      stopSkipped: stop.value?.skipped === true
    }
  };
  await writeJson(path.join(dir, "prompt-automation-monitor.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  await writeFile(path.join(dir, "hook-targets.tsv"), hookTargetsTsv(dump.value || {}), "utf8");
  await writeFile(path.join(dir, "prompt-readiness.tsv"), promptReadinessTsv(dump.value || {}), "utf8");
  console.log(JSON.stringify({ ok: payload.ok, dir, summary: payload.summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
