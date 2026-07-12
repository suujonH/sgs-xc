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
    process.env.SGS_YANJIAO_LIST_WATCH_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-yanjiao-list-watch`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function browserYanJiaoListWatchInstaller(options) {
    const now = () => new Date().toISOString();
    const maxRecords = options.maxRecords || 600;
    const previewOnly = options.previewOnly !== false;
    const keepListAfterClose = options.keepListAfterClose === true;
    const listName = "__codex_yanjiao_candidate_list__";
    const ctor = (obj) => { try { return obj?.constructor?.name || ""; } catch { return ""; } };
    const own = (obj) => { try { return Object.getOwnPropertyNames(obj || {}).sort(); } catch { return []; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
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
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || depth > 14 || seen.has(root)) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child?.name || child?._className_ || child?.sceneName || child?.SceneName || ctor(child) || ("#" + i);
        walk(child, visitor, `${nodePath}/${childName}#${i}`, depth + 1, seen);
      }
    };
    const stageChildren = () => {
      const out = [];
      for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
        try { out.push(Laya.stage.getChildAt(i)); } catch {}
      }
      return out;
    };
    const sceneState = () => {
      const layer = stageChildren().find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      let scene = null;
      if (layer) {
        for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
          const candidate = layer.getChildAt(i);
          if (effectiveVisible(candidate)) { scene = candidate; break; }
        }
      }
      return {
        sceneName: scene?.sceneName || scene?.SceneName || scene?.name || "",
        className: scene?._className_ || "",
        ctor: ctor(scene)
      };
    };
    const sum = (list) => (list || []).reduce((total, value) => total + Number(value || 0), 0);
    const cardText = (cards) => (cards || []).join("+") || "-";
    const getListRoot = (win) => {
      try {
        for (let i = 0; i < (win.numChildren || 0); i++) {
          const child = win.getChildAt(i);
          if (child?.name === listName) return child;
        }
      } catch {}
      return null;
    };
    const removeList = (win) => {
      const existing = getListRoot(win);
      if (!existing) return false;
      try {
        existing.removeSelf();
        existing.destroy(true);
        return true;
      } catch {
        return false;
      }
    };
    const publicWindowState = (win) => {
      const splitRows = Array.isArray(win?.splitCardArr) ? win.splitCardArr : [];
      return {
        label: labelOf(win),
        visible: win?.visible,
        effectiveVisible: effectiveVisible(win),
        isSelf: win?.isSelf === true,
        width: win?.width,
        height: win?.height,
        msg: win?.msg ? {
          SeatID: win.msg.SeatID,
          SrcSeatID: win.msg.SrcSeatID,
          ParamsLength: Array.isArray(win.msg.Params) ? win.msg.Params.length : null,
          Timeout: win.msg.Timeout,
          Spell: win.msg.Spell
        } : null,
        paramsCards: (win?.paramsCards || []).map((card) => ({ id: card.id, number: card.number })).slice(0, 16),
        splitCount: splitRows.length,
        splitPreview: splitRows.slice(0, 10).map((row, index) => ({
          index,
          a: row?.[0] || [],
          b: row?.[1] || [],
          sumA: sum(row?.[0]),
          sumB: sum(row?.[1])
        })),
        chooseMax: win?.chooseMax ?? null,
        chooseIndex: win?.chooseIndex ?? null,
        splitCardIdsA: Array.isArray(win?.splitCardIdsA) ? win.splitCardIdsA.slice(0, 16) : [],
        splitCardIdsB: Array.isArray(win?.splitCardIdsB) ? win.splitCardIdsB.slice(0, 16) : [],
        remainCards: Array.isArray(win?.remainCards) ? win.remainCards.slice(0, 16) : [],
        queues: (win?.cardQueues || []).map((queue) => (queue || []).length),
        listPresent: !!getListRoot(win)
      };
    };
    const nodeSummary = (node, nodePath) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node?.name || "",
      className: node?._className_ || "",
      sceneName: node?.sceneName || node?.SceneName || "",
      visible: node?.visible,
      effectiveVisible: effectiveVisible(node),
      hiddenReasons: hiddenReasons(node),
      width: node?.width,
      height: node?.height,
      childCount: node?.numChildren || 0
    });
    const findYanJiaoWindows = () => {
      const out = [];
      walk(Laya.stage, (node, nodePath) => {
        const hay = [nodePath, labelOf(node), node?.name, node?._className_, node?.sceneName, ctor(node)].filter(Boolean).join(" ");
        if (/YanJiaoWindow/i.test(hay) || node?.msg && Array.isArray(node?.splitCardArr) && /showSplitCard|sendAutoChooseMoveOpt/.test(own(Object.getPrototypeOf(node)).join(" "))) {
          out.push({ node, path: nodePath });
        }
      });
      return out;
    };
    const makeText = (text, x, y, width, color = "#F4E6B0", size = 14) => {
      const label = new Laya.Text();
      label.text = String(text);
      label.color = color;
      label.fontSize = size;
      label.width = width;
      label.height = Math.max(20, size + 8);
      label.wordWrap = true;
      label.x = x;
      label.y = y;
      return label;
    };
    const renderList = (win, reason) => {
      if (!win || win.destroyed) return { ok: false, reason: "missing-window" };
      if (typeof win.genSplitCard === "function" && win.msg?.Params?.length && (!win.splitCardArr || !win.chooseMax)) {
        try { win.genSplitCard(); } catch (error) { state.errors.push({ time: now(), at: "genSplitCard:" + reason, error: String(error?.message || error) }); }
      }
      removeList(win);
      const splitRows = Array.isArray(win.splitCardArr) ? win.splitCardArr : [];
      if (!splitRows.length) return { ok: false, reason: "no-split-rows", state: publicWindowState(win) };
      const visibleRows = splitRows.slice(0, 12);
      const width = 166;
      const rowHeight = 38;
      const height = 38 + visibleRows.length * rowHeight;
      const root = new Laya.Sprite();
      root.name = listName;
      root.mouseEnabled = true;
      root.zOrder = 2147483000;
      root.x = Math.max(8, Number(win.width || 681) - width - 10);
      root.y = 78;
      try { root.graphics.drawRect(0, 0, width, height, "rgba(23, 18, 10, 0.82)", "#C2B880", 1); } catch {}
      root.addChild(makeText(`YanJiao ${splitRows.length}`, 8, 6, width - 16, "#FFE2A0", 15));
      for (let index = 0; index < visibleRows.length; index++) {
        const row = visibleRows[index];
        const a = row?.[0] || [];
        const b = row?.[1] || [];
        const y = 34 + index * rowHeight;
        const rowNode = new Laya.Sprite();
        rowNode.name = `__codex_yanjiao_candidate_${index}`;
        rowNode.mouseEnabled = true;
        rowNode.x = 6;
        rowNode.y = y;
        rowNode.width = width - 12;
        rowNode.height = rowHeight - 4;
        rowNode.__codexYanjiaoIndex = index;
        try { rowNode.graphics.drawRect(0, 0, rowNode.width, rowNode.height, "rgba(54, 40, 18, 0.88)", "#7A725C", 1); } catch {}
        rowNode.addChild(makeText(`${index + 1}. ${cardText(a)} = ${sum(a)}`, 6, 1, rowNode.width - 12, "#F4E6B0", 12));
        rowNode.addChild(makeText(`   ${cardText(b)} = ${sum(b)}`, 6, 18, rowNode.width - 12, "#D7C894", 12));
        rowNode.on(Laya.Event.CLICK, rowNode, () => {
          record("candidate-click", { reason: "row-click", index, before: publicWindowState(win) });
          try {
            win.showSplitCard(index);
            win.layoutCardUIs(true);
            if (!previewOnly && typeof win.sendAutoChooseMoveOpt === "function") win.sendAutoChooseMoveOpt();
            renderList(win, "row-click");
          } catch (error) {
            state.errors.push({ time: now(), at: "candidate-click", error: String(error?.message || error) });
          }
          record("candidate-click-after", { index, previewOnly, after: publicWindowState(win) });
        });
        root.addChild(rowNode);
      }
      win.addChild(root);
      record("render-list", { reason, rowCount: splitRows.length, visibleRows: visibleRows.length, state: publicWindowState(win) });
      return { ok: true, rowCount: splitRows.length, visibleRows: visibleRows.length, state: publicWindowState(win) };
    };
    const snapshot = (label) => {
      const windows = findYanJiaoWindows();
      return {
        label,
        time: now(),
        scene: sceneState(),
        windows: windows.map((item) => ({
          summary: nodeSummary(item.node, item.path),
          state: publicWindowState(item.node)
        })).slice(0, 20)
      };
    };
    const state = window.__codexSgsYanJiaoListWatch?.state || {
      installedAt: now(),
      records: [],
      wrappers: [],
      errors: [],
      hookSummary: []
    };
    const record = (kind, payload = {}) => {
      state.records.push({ seq: state.records.length, time: now(), kind, scene: sceneState(), ...payload });
      if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
    };
    if (window.__codexSgsYanJiaoListWatch?.installed) {
      return window.__codexSgsYanJiaoListWatch.status();
    }
    const wrap = (owner, method, after) => {
      try {
        if (!owner || typeof owner[method] !== "function") return { method, installed: false, reason: "missing" };
        const original = owner[method];
        if (original.__codexYanJiaoListWrapped) return { method, installed: false, reason: "already-wrapped" };
        const wrapped = function (...args) {
          record("method", { method, argsLength: args.length, before: publicWindowState(this) });
          let result;
          try {
            result = original.apply(this, args);
          } finally {
            try { after?.(this, method, args); } catch (error) { state.errors.push({ time: now(), at: "after:" + method, error: String(error?.message || error) }); }
          }
          record("method-after", { method, after: publicWindowState(this) });
          return result;
        };
        Object.defineProperty(wrapped, "__codexYanJiaoListWrapped", { value: true });
        Object.defineProperty(owner, method, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, method, original });
        return { method, installed: true };
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + method, error: String(error?.message || error) });
        return { method, installed: false, reason: String(error?.message || error) };
      }
    };
    const cls = Laya.ClassUtils?.getClass?.("YanJiaoWindow") || Laya.ClassUtils?._classMap?.YanJiaoWindow || null;
    const proto = cls?.prototype || null;
    const renderAfter = (win, method) => renderList(win, method);
    const cleanupAfter = (win, method) => {
      if (keepListAfterClose) return;
      const removed = removeList(win);
      record("cleanup-list", { reason: method, removed });
    };
    const methods = [
      ["enterWindow", renderAfter],
      ["showWindow", renderAfter],
      ["genSplitCard", renderAfter],
      ["layoutCardUIs", renderAfter],
      ["showSplitCard", renderAfter],
      ["updateAutoChooseSatate", renderAfter],
      ["UpdateWindow", renderAfter],
      ["Close", cleanupAfter],
      ["sendMoveOpt", null],
      ["sendAutoChooseMoveOpt", null],
      ["confirmBtmClick", null],
      ["cancelBtnClick", null]
    ];
    state.hookSummary = methods.map(([method, after]) => wrap(proto, method, after));
    const monitor = {
      installed: true,
      state,
      status() {
        const current = snapshot("status");
        return {
          installed: true,
          installedAt: state.installedAt,
          classExists: !!cls,
          functionName: cls?.name || "",
          wrapperCount: state.wrappers.length,
          hookSummary: state.hookSummary,
          recordCount: state.records.length,
          renderRecords: state.records.filter((item) => item.kind === "render-list").length,
          candidateClicks: state.records.filter((item) => item.kind === "candidate-click").length,
          sendRecords: state.records.filter((item) => /^method/.test(item.kind) && /send|confirm|cancel/i.test(item.method || "")).length,
          previewOnly,
          current,
          errors: state.errors.slice(-20)
        };
      },
      snapshot,
      renderVisible() {
        const rendered = [];
        for (const item of findYanJiaoWindows()) rendered.push(renderList(item.node, "manual-renderVisible"));
        return { ok: true, rendered, snapshot: snapshot("renderVisible") };
      },
      dump() {
        return { ok: true, status: this.status(), records: state.records.slice(), errors: state.errors.slice() };
      },
      stop() {
        for (const item of findYanJiaoWindows()) removeList(item.node);
        for (const item of state.wrappers.splice(0)) {
          try { Object.defineProperty(item.owner, item.method, { value: item.original, configurable: true }); } catch (error) { state.errors.push({ time: now(), at: "restore:" + item.method, error: String(error?.message || error) }); }
        }
        this.installed = false;
        return this.dump();
      }
    };
    window.__codexSgsYanJiaoListWatch = monitor;
    record("install", { status: monitor.status() });
    return monitor.status();
}

function installExpression(options) {
  return `(${browserYanJiaoListWatchInstaller.toString()})(${JSON.stringify(options)})`;
}

function dumpExpression() {
  return "(() => window.__codexSgsYanJiaoListWatch ? window.__codexSgsYanJiaoListWatch.dump() : { ok: false, error: 'not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsYanJiaoListWatch ? window.__codexSgsYanJiaoListWatch.stop() : { ok: false, error: 'not installed' })()";
}

function readmeText(payload, durationMs) {
  const status = payload.dump?.value?.status || {};
  const current = status.current || {};
  return [
    "# YanJiao Right-Side List Watch",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${durationMs}`,
    `- Scene: ${current.scene?.sceneName || current.scene?.className || ""}`,
    `- Class exists: ${status.classExists === true}`,
    `- Function name: ${status.functionName || ""}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Current YanJiao windows: ${current.windows?.length || 0}`,
    `- Render records: ${status.renderRecords || 0}`,
    `- Candidate clicks: ${status.candidateClicks || 0}`,
    `- Send records observed: ${status.sendRecords || 0}`,
    `- Preview only: ${status.previewOnly !== false}`,
    "",
    "This watcher implements the requested YanJiao right-side candidate list as a Laya child named `__codex_yanjiao_candidate_list__`. Row clicks call `showSplitCard(index)` and `layoutCardUIs(true)` only; they do not submit unless `previewOnly` is explicitly disabled.",
    "",
    "If no `YanJiaoWindow` is visible, this run proves that the registered class exists and the watcher can be installed. A live YanJiao prompt is still required to prove coordinates and click behavior inside the real window.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_YANJIAO_LIST_WATCH_MS || process.argv[2] || 3000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    maxRecords: Number(process.env.SGS_YANJIAO_LIST_MAX_RECORDS || 600),
    previewOnly: process.env.SGS_YANJIAO_LIST_PREVIEW_ONLY !== "0",
    keepListAfterClose: process.env.SGS_YANJIAO_LIST_KEEP_AFTER_CLOSE === "1"
  };
  const install = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  await sleep(durationMs);
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const stop = process.env.SGS_YANJIAO_LIST_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = { target: install.target, durationMs, install, dump, stop };
  await writeJson(path.join(dir, "yanjiao-list-watch.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload, durationMs), "utf8");
  console.log(JSON.stringify({
    dir,
    durationMs,
    scene: dump.value?.status?.current?.scene || null,
    classExists: dump.value?.status?.classExists === true,
    wrappers: dump.value?.status?.wrapperCount || 0,
    windows: dump.value?.status?.current?.windows?.length || 0,
    renderRecords: dump.value?.status?.renderRecords || 0,
    candidateClicks: dump.value?.status?.candidateClicks || 0,
    sendRecords: dump.value?.status?.sendRecords || 0,
    errors: dump.value?.errors?.length || 0,
    keptInstalled: process.env.SGS_YANJIAO_LIST_KEEP_INSTALLED === "1"
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
