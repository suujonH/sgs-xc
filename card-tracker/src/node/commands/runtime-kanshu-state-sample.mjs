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
    process.env.SGS_KANSHU_STATE_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-kanshu-state-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sampleExpression(options) {
  return `(${String.raw`async (options) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const actions = [];
    const guardHits = [];
    const restores = [];
    const G = (name) => {
      try {
        if (window[name]) return window[name];
        return Function("return typeof " + name + " !== 'undefined' ? " + name + " : undefined")();
      } catch {
        return window[name];
      }
    };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const childrenOf = (node) => {
      if (!node) return [];
      if (Array.isArray(node._children)) return node._children;
      if (Array.isArray(node._childs)) return node._childs;
      if (Array.isArray(node.children)) return node.children;
      if (typeof node.numChildren === "number" && typeof node.getChildAt === "function") {
        const out = [];
        for (let i = 0; i < node.numChildren; i++) {
          try { out.push(node.getChildAt(i)); } catch {}
        }
        return out;
      }
      return [];
    };
    const ownVisible = (node) =>
      !!node &&
      node.visible !== false &&
      Number(node.alpha == null ? 1 : node.alpha) !== 0 &&
      Number(node.scaleX == null ? 1 : node.scaleX) !== 0 &&
      Number(node.scaleY == null ? 1 : node.scaleY) !== 0 &&
      !node.destroyed;
    const effectiveVisible = (node) => {
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        if (!ownVisible(cur)) return false;
      }
      return true;
    };
    const traverse = (root, visit, limit = 60000) => {
      const stack = [root];
      const seen = new Set();
      let count = 0;
      while (stack.length && count < limit) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        count++;
        visit(node);
        const children = childrenOf(node);
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      return count;
    };
    const labelOf = (node) => String(node?.sceneName || node?._className_ || node?.name || "").slice(0, 120);
    const pathOf = (node) => {
      const parts = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        if (cur === window.Laya?.stage) {
          parts.unshift("Laya.stage");
          break;
        }
        const parent = cur.parent || cur._parent || null;
        const index = parent ? childrenOf(parent).indexOf(cur) : -1;
        parts.unshift((labelOf(cur) || ctor(cur) || "Object") + "#" + index);
      }
      return parts.join("/");
    };
    const simpleFields = (obj, keys) => {
      const out = {};
      for (const key of keys) {
        try {
          const value = obj?.[key];
          if (value == null || ["string", "number", "boolean"].includes(typeof value)) out[key] = value ?? null;
          else if (Array.isArray(value)) out[key] = "[Array " + value.length + "]";
          else out[key] = "[" + (ctor(value) || typeof value) + "]";
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const nodeSummary = (node) => node ? {
      path: pathOf(node),
      label: labelOf(node),
      ctor: ctor(node),
      name: node.name || "",
      className: node._className_ || "",
      sceneName: node.sceneName || node.SceneName || "",
      visible: node.visible,
      alpha: node.alpha,
      effectiveVisible: effectiveVisible(node),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      childCount: node.numChildren || 0,
      keyFields: simpleFields(node, ["canclick", "canClose", "openItemNums", "jbpUserData", "jbpawardVo", "JbpYbItemArr"])
    } : null;
    const stageScene = () => {
      const children = childrenOf(window.Laya?.stage);
      const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      const current = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
      return current ? nodeSummary(current) : null;
    };
    const findNode = (predicate) => {
      let found = null;
      traverse(window.Laya?.stage, (node) => {
        if (!found && predicate(node)) found = node;
      });
      return found;
    };
    const findKanShuWindow = () => findNode((node) =>
      (effectiveVisible(node) || node?.__codexHiddenKanShu) &&
      (labelOf(node) === "KanShuWindow" || ctor(node) === "wXi") &&
      typeof node.updateReqInfo === "function"
    );
    const findKanShuEntryView = () => findNode((node) =>
      effectiveVisible(node) &&
      (labelOf(node) === "xZt" || ctor(node) === "xZt" || typeof node.tryKanshu === "function")
    );
    const guardMethod = (owner, name, label) => {
      if (!owner || typeof owner[name] !== "function") return;
      const original = owner[name];
      owner[name] = function (...args) {
        const hit = { label, args: args.map((arg) => String(arg).slice(0, 80)) };
        guardHits.push(hit);
        throw new Error("Blocked guarded KanShu/payment call: " + label);
      };
      restores.push(() => { owner[name] = original; });
    };
    const installGlobalGuards = () => {
      try { guardMethod(G("ITt")?.I?.(), "O", "ITt.I().O"); } catch {}
      try { guardMethod(G("EKt"), "OpenPay", "EKt.OpenPay"); } catch {}
    };
    const installWindowGuards = (win) => {
      guardMethod(win, "buyPorpItem", "KanShuWindow.buyPorpItem");
      guardMethod(win, "gotoPay", "KanShuWindow.gotoPay");
    };
    const stateOf = (win, source = "window") => {
      const user = win?.jbpUserData || null;
      const award = win?.jbpawardVo || (user && G("RD")?.I?.().GetAwardByGrade?.(user.Level)) || null;
      const buyItem = award?.buyItem || 0;
      let goodsCount = null;
      let freeBlessItemEnough = null;
      try {
        const goods = buyItem ? G("HFt")?.I?.().GetGoodsByBaseID?.(buyItem) : null;
        goodsCount = goods?.Count ?? goods?.count ?? goods?.Num ?? goods?.num ?? null;
      } catch {}
      try { freeBlessItemEnough = !!G("hYt")?.I?.().FreeBlessItemEnough; } catch {}
      return {
        source,
        node: nodeSummary(win),
        status: user?.Status ?? null,
        level: user?.Level ?? null,
        exp: user?.Exp ?? null,
        upgradeExp: user?.UpgradeExp ?? null,
        allCoin: user?.AllCoinNum ?? null,
        hasTriggerEvent: !!user?.HasTriggerEvent,
        eventId: user?.EventId ?? null,
        eventRewards: user?.EventRewards ? "[present]" : null,
        award: award ? {
          grade: award.grade ?? null,
          name: award.name ?? null,
          needMoney: award.needMoney ?? null,
          buyItem,
          rewardRange: award.RewardRangeShow ?? null,
          prompt: String(award.prompt || "").replace(/<[^>]*>/g, "")
        } : null,
        buyItem,
        goodsCount,
        freeBlessItemEnough,
        peachCount: Array.isArray(win?.JbpYbItemArr) ? win.JbpYbItemArr.length : 0,
        unopenedPeachCount: Array.isArray(win?.JbpYbItemArr)
          ? win.JbpYbItemArr.filter((item) => item && !item.HasOpen).length
          : 0,
        openItemNums: win?.openItemNums ?? null,
        canclick: win?.canclick ?? null,
        canClose: win?.canClose ?? null
      };
    };
    const directState = () => {
      const mgr = G("VFt")?.I?.();
      const user = mgr?.JbpUserData || null;
      if (!user) return { source: "manager", status: null, reason: "VFt.I().JbpUserData not loaded" };
      const pseudo = { jbpUserData: user, jbpawardVo: G("RD")?.I?.().GetAwardByGrade?.(user.Level) };
      return stateOf(pseudo, "manager");
    };
    const createHiddenKanShuWindow = async () => {
      const Klass = window.Laya?.ClassUtils?.getClass?.("KanShuWindow");
      if (!Klass) return null;
      const win = new Klass();
      win.name = "KanShuWindow";
      win.__codexHiddenKanShu = true;
      win.visible = false;
      win.alpha = 0;
      win.mouseEnabled = false;
      win.x = -100000;
      win.y = -100000;
      installWindowGuards(win);
      window.Laya?.stage?.addChild?.(win);
      if (typeof win.Init === "function") {
        actions.push({ step: "hidden.Init" });
        win.Init();
      }
      if (typeof win.addEventListener === "function") {
        actions.push({ step: "hidden.addEventListener" });
        try { win.addEventListener(); } catch (error) { actions.push({ step: "hidden.addEventListener.error", error: String(error?.message || error) }); }
      }
      win.visible = false;
      win.alpha = 0;
      win.mouseEnabled = false;
      win.x = -100000;
      win.y = -100000;
      await sleep(500);
      return win;
    };
    const cleanupHiddenKanShuWindow = (win) => {
      if (!win?.__codexHiddenKanShu) return false;
      actions.push({ step: "hidden.cleanup" });
      try { win.removeEventListener?.(); } catch {}
      try { win.Close?.(); } catch {}
      try { win.removeSelf?.(); } catch {}
      try { win.destroy?.(true); } catch {}
      return true;
    };

    installGlobalGuards();
    const before = {
      scene: stageScene(),
      directState: directState(),
      entryView: nodeSummary(findKanShuEntryView()),
      existingWindow: nodeSummary(findKanShuWindow())
    };
    let win = findKanShuWindow();
    let createdHidden = false;
    let openedVisible = false;
    let openError = null;
    try {
      if (!win && options.mode === "hidden") {
        actions.push({ step: "create-hidden-window" });
        win = await createHiddenKanShuWindow();
        createdHidden = !!win;
      } else if (!win && options.mode === "visible-entry") {
        const entry = findKanShuEntryView();
        if (entry && typeof entry.tryKanshu === "function") {
          actions.push({ step: "entry.tryKanshu", node: nodeSummary(entry) });
          entry.tryKanshu();
          openedVisible = true;
          await sleep(1200);
          win = findKanShuWindow();
        }
      }
      if (win) installWindowGuards(win);
    } catch (error) {
      openError = String(error?.message || error);
    }
    const sampledState = win ? stateOf(win, createdHidden ? "hidden-window" : "visible-window") : null;
    const cleanedHidden = cleanupHiddenKanShuWindow(win);
    while (restores.length) {
      try { restores.pop()(); } catch {}
    }
    return {
      ok: !!sampledState && !guardHits.length,
      mode: options.mode,
      openedVisible,
      createdHidden,
      cleanedHidden,
      openError,
      guardHits,
      actions,
      before,
      sampledState,
      after: {
        scene: stageScene(),
        remainingWindow: nodeSummary(findKanShuWindow())
      },
      safety: {
        didNotCall: ["onKanShuClick", "autoClickAllPeach", "trueReqJbpAwd", "buyPorpItem", "gotoPay"],
        guarded: ["KanShuWindow.buyPorpItem", "KanShuWindow.gotoPay", "ITt.I().O", "EKt.OpenPay"]
      }
    };
  }`})(${JSON.stringify(options)})`;
}

function readmeText(payload) {
  return [
    "# KanShu State Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.target?.title || ""} ${payload.target?.url || ""}`,
    `- Mode: ${payload.value?.mode || ""}`,
    `- OK: ${!!payload.value?.ok}`,
    `- Created hidden window: ${!!payload.value?.createdHidden}`,
    `- Cleaned hidden window: ${!!payload.value?.cleanedHidden}`,
    `- Guard hits: ${payload.value?.guardHits?.length || 0}`,
    `- Status: ${payload.value?.sampledState?.status ?? "(null)"}`,
    `- Level: ${payload.value?.sampledState?.level ?? "(null)"}`,
    `- Peach count: ${payload.value?.sampledState?.peachCount ?? "(null)"}`,
    "",
    "This command samples KanShu state only. It does not call `onKanShuClick`, `autoClickAllPeach`, `trueReqJbpAwd`, `buyPorpItem`, or `gotoPay`.",
    ""
  ].join("\n");
}

async function main() {
  const mode = process.argv.includes("--visible-entry")
    ? "visible-entry"
    : process.argv.includes("--hidden")
      ? "hidden"
      : "none";
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(sampleExpression({ mode }), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  await writeJson(path.join(dir, "kanshu-state-sample.json"), result);
  await writeFile(path.join(dir, "README.md"), readmeText(result), "utf8");
  console.log(JSON.stringify({
    dir,
    ok: !!result.value?.ok,
    mode,
    createdHidden: !!result.value?.createdHidden,
    cleanedHidden: !!result.value?.cleanedHidden,
    guardHits: result.value?.guardHits?.length || 0,
    status: result.value?.sampledState?.status ?? null,
    level: result.value?.sampledState?.level ?? null,
    scene: result.value?.after?.scene?.sceneName || result.value?.before?.scene?.sceneName || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
