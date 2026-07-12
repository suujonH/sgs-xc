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
    process.env.SGS_SURFACE_MONITOR_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-surface-monitor`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const hookSpecs = {
  BlessNewWindow: ["Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop"],
  BlessNewWindowView: ["Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop", "UpdateButtonUI", "UpdateUpperCanvas", "updateSkipAnim"],
  KanShuWindow: ["updateReqInfo", "onKanShuClick", "autoClickAllPeach", "trueReqJbpAwd", "onShowKanShuEffect", "onShowEvent", "onShowEvent2", "gotoPay", "buyPorpItem"],
  SkillSelectorWindow: ["layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
  SkillPopUpWindow: ["initBg", "layoutTxt"],
  SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "addSelectCardNormalUi", "onTouchCard", "onTouchEnsure"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch"],
  YanJiaoWindow: ["enterWindow", "UpdateWindow", "showWindow", "autoChooseClick", "showSplitCard", "sendAutoChooseMoveOpt", "sendMoveOpt", "confirmBtmClick", "onCardDown", "onStageUp"],
  GuanXing: ["MoveCardToZoneResponse"],
  GuanXingPo: ["GetDefensiveSelectCardContext"],
  GuanXingPoker: ["GetPokerSkillWindowDesc", "IsAllowCardInWindow", "SelectCardCountWhenResponse", "SendMsgInSelectCardWindow"],
  GuanXingRace: ["MoveCardFromeZoneResponse", "MoveCardToZoneResponse", "OutsideCards", "OutsideCnt", "OutsideCardName", "OutsidePopWinTitleByKey", "NeedShowVirtualCard"],
  GuanXingWindow: ["Init", "updateTitle"],
  RogueSmallMapScene: ["TriggerCurEvent", "TriggerEvent", "UpdateRogueData", "sendGotoFightMsg", "sendGotoGambleMsg"],
  RogueFightWindow: ["enterWindow", "startbtnClick", "gotoJishi", "enableEffect", "removeEffect"],
  RogueJiShiWindow: ["enterWindow", "refreshBtnClick", "buyBtnClick", "shopBtnClick"],
  TableGameScene: ["StartGame", "ServerProxy_StartGame", "gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "PlayJudgeAnimation"],
  RogueLikeGameScene: ["StartGame", "ServerProxy_StartGame", "gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "PlayJudgeAnimation", "showSelectGeneral", "showGameResultWindow", "rogueOverGame", "rogueRestartGame"],
  MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "initUI"],
  MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "initUI"],
  SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
  GongXinWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick"],
  GuZhengSelectCardWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick"],
  SwapCardWindow: ["enterWindow", "confirmClick", "cancelClick"],
  SwapTopCardWindow: ["enterWindow", "confirmClick", "cancelClick"],
  SwitchCardWindow: ["enterWindow", "confirmClick", "cancelClick"],
  PoXiCardWindow: ["enterWindow", "confirmClick", "cancelClick"],
  PinDianWindow: ["enterWindow", "confirmClick", "cancelClick"],
  PinDianMultiWindow: ["enterWindow", "confirmClick", "cancelClick"]
};

function installExpression(options) {
  return `(${String.raw`(options) => {
    const specs = options.hookSpecs || {};
    const blockPurchase = options.blockPurchase !== false;
    const maxRecords = options.maxRecords || 5000;
    const purchasePattern = /(confirmBuy|buyPorpItem|gotoPay|OpenPay|\\.O$|BuyShop|BuyItem|Recharge|Pay|YuanBao|refreshBtnClick|buyBtnClick)/i;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth > 0 ? [] : value.slice(0, 5).map((item) => simple(item, depth + 1)) };
      const keys = own(value).slice(0, 24).filter((key) => !/handCards|HandCards|cardsInHand|hidden/i.test(key));
      const out = {
        kind: "object",
        ctor: ctor(value),
        name: value.name || "",
        sceneName: value.sceneName || value.SceneName || "",
        className: value._className_ || "",
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
    const sceneState = () => {
      const L = window.Laya;
      const children = [];
      try {
        for (let i = 0; i < (L?.stage?.numChildren || 0); i++) children.push(L.stage.getChildAt(i));
      } catch {}
      const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      const scene = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
      return {
        sceneName: scene?.sceneName || scene?.SceneName || scene?.name || "",
        className: scene?._className_ || "",
        ctor: ctor(scene)
      };
    };
    const managerRefs = () => {
      const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
      const L = window.Laya;
      const CU = L && L.ClassUtils;
      let popup = null, ged = null, windowManager = null, proxy = null;
      try { popup = CU && CU.getInstance && CU.getInstance("PopUpWindow") || null; } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try { windowManager = toArray(ged && ged._events && ged._events.HIDE_WINDOW)[0]?.caller || null; } catch {}
      try { proxy = windowManager && windowManager.proxy || null; } catch {}
      return { L, CU, popup, ged, windowManager, proxy };
    };
    if (window.__codexSgsSurfaceMonitor?.installed) return window.__codexSgsSurfaceMonitor.status();
    const state = {
      installed: true,
      installedAt: now(),
      records: [],
      wrappers: [],
      errors: [],
      hookSummary: [],
      blockedCount: 0
    };
    const record = (kind, label, args, extra = {}) => {
      try {
        state.records.push({
          seq: state.records.length,
          time: now(),
          kind,
          label,
          scene: sceneState(),
          args: Array.from(args || []).slice(0, 6).map((arg) => simple(arg)),
          ...extra
        });
        if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
      } catch (error) {
        state.errors.push({ time: now(), at: "record:" + label, error: String(error?.message || error) });
      }
    };
    const wrap = (owner, prop, label, block = false) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexSgsSurfaceWrapped) return false;
        const wrapped = function (...args) {
          record(block ? "blocked-call" : "call", label, args);
          if (block) {
            state.blockedCount++;
            return undefined;
          }
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexSgsSurfaceWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, prop, original, label });
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
        return false;
      }
    };
    const refs = managerRefs();
    for (const [className, methods] of Object.entries(specs)) {
      let cls = null;
      try { cls = refs.CU?.getClass?.(className) || refs.CU?._classMap?.[className] || null; } catch {}
      const installed = [];
      const missing = [];
      for (const method of methods) {
        const target = cls?.prototype;
        const label = className + "." + method;
        const shouldBlock = blockPurchase && purchasePattern.test(label);
        if (wrap(target, method, label, shouldBlock)) installed.push({ method, block: shouldBlock });
        else missing.push(method);
      }
      state.hookSummary.push({
        className,
        classExists: !!cls,
        functionName: cls?.name || "",
        installed,
        missing
      });
    }
    for (const [owner, prop, label] of [
      [refs.ged, "event", "GED.event"],
      [refs.ged, "ShowWindow", "GED.ShowWindow"],
      [refs.ged, "CloseWindow", "GED.CloseWindow"],
      [refs.windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
      [refs.windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
      [refs.windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
      [refs.proxy, "L", "proxy.L"],
      [refs.proxy, "event", "proxy.event"]
    ]) {
      wrap(owner, prop, label, blockPurchase && purchasePattern.test(label));
    }
    const monitor = {
      installed: true,
      status() {
        return {
          installed: true,
          installedAt: state.installedAt,
          scene: sceneState(),
          hookClasses: state.hookSummary.length,
          wrapperCount: state.wrappers.length,
          recordCount: state.records.length,
          blockedCount: state.blockedCount,
          errors: state.errors.slice(-20),
          hookSummary: state.hookSummary
        };
      },
      dump() {
        return { ok: true, status: this.status(), records: state.records.slice(), errors: state.errors.slice() };
      },
      stop() {
        for (const item of state.wrappers.splice(0)) {
          try { Object.defineProperty(item.owner, item.prop, { value: item.original, configurable: true }); }
          catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error?.message || error) }); }
        }
        this.installed = false;
        state.installed = false;
        return this.dump();
      }
    };
    window.__codexSgsSurfaceMonitor = monitor;
    record("monitor", "surface-monitor.install", [monitor.status()]);
    return monitor.status();
  }`})(${JSON.stringify(options)})`;
}

function dumpExpression() {
  return "(() => window.__codexSgsSurfaceMonitor ? window.__codexSgsSurfaceMonitor.dump() : { ok: false, error: 'surface monitor is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsSurfaceMonitor ? window.__codexSgsSurfaceMonitor.stop() : { ok: false, error: 'surface monitor is not installed' })()";
}

function readmeText(payload, durationMs) {
  const status = payload.dump?.value?.status || {};
  const installed = (status.hookSummary || []).filter((item) => item.installed?.length);
  const blocked = (payload.dump?.value?.records || []).filter((record) => record.kind === "blocked-call");
  return [
    "# Runtime Live Surface Monitor",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${durationMs}`,
    `- Scene: ${status.scene?.sceneName || ""}`,
    `- Hooked classes: ${installed.length}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Records: ${status.recordCount || 0}`,
    `- Blocked purchase-risk calls: ${blocked.length}`,
    "",
    "This monitor installs reversible prototype wrappers for hover, popup, selection, skill-trigger, QiFu/Bless, KanShu, YanJiao, GuanXing/Qixing, Rogue, and TableGame surfaces. It does not trigger those methods by itself.",
    "",
    "Purchase/payment-like methods are blocked by default while the monitor is installed.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_SURFACE_MONITOR_MS || process.argv[2] || 8000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    hookSpecs,
    blockPurchase: process.env.SGS_SURFACE_MONITOR_BLOCK_PURCHASE !== "0",
    maxRecords: Number(process.env.SGS_SURFACE_MONITOR_MAX_RECORDS || 5000)
  };
  const install = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  await sleep(durationMs);
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = { target: install.target, durationMs, install, dump, stop };
  await writeJson(path.join(dir, "surface-monitor.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload, durationMs), "utf8");
  console.log(JSON.stringify({
    dir,
    durationMs,
    scene: dump.value?.status?.scene || null,
    hookClasses: dump.value?.status?.hookClasses || 0,
    wrappers: dump.value?.status?.wrapperCount || 0,
    records: dump.value?.records?.length || 0,
    blocked: (dump.value?.records || []).filter((record) => record.kind === "blocked-call").length,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
