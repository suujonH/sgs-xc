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
    process.env.SGS_RUNTIME_EXPLORATION_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-inventory`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildRuntimeExpression() {
  return String.raw`(() => {
    const nowIso = new Date().toISOString();
    const own = (o) => {
      try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; }
    };
    const ctor = (o) => {
      try { return o?.constructor?.name || ""; } catch { return ""; }
    };
    const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
    const simpleValue = (v) => {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (t === "function") return "[Function " + (v.name || "") + "]";
      if (Array.isArray(v)) return "[Array " + v.length + "]";
      if (v instanceof Map) return "[Map " + v.size + "]";
      return "[" + (ctor(v) || t) + "]";
    };
    const hashString = (text) => {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    const descriptorSummary = (o, limit = 260) => own(o).slice(0, limit).map((name) => {
      try {
        const d = Object.getOwnPropertyDescriptor(o, name);
        const item = {
          name,
          kind: d?.get || d?.set ? "accessor" : "value",
          enumerable: !!d?.enumerable,
          configurable: !!d?.configurable
        };
        if (d?.get) item.get = { name: d.get.name || "", sourceLength: String(d.get).length, sourceHash: hashString(String(d.get)) };
        if (d?.set) item.set = { name: d.set.name || "", sourceLength: String(d.set).length, sourceHash: hashString(String(d.set)) };
        if ("value" in d) {
          item.type = typeof d.value;
          item.ctor = ctor(d.value);
          item.value = simpleValue(d.value);
          if (typeof d.value === "function") {
            const source = String(d.value);
            item.fn = {
              name: d.value.name || "",
              arity: d.value.length,
              sourceLength: source.length,
              sourceHash: hashString(source)
            };
          }
        }
        return item;
      } catch (error) {
        return { name, error: String(error?.message || error) };
      }
    });
    const protoChainSummary = (o, depth = 5) => {
      const chain = [];
      let p = o;
      for (let level = 0; level < depth && p; level++, p = Object.getPrototypeOf(p)) {
        chain.push({ level, ctor: ctor(p), descriptors: descriptorSummary(p, 220) });
      }
      return chain;
    };
    const objectSummary = (o, options = {}) => {
      if (!o) return null;
      return {
        ctor: ctor(o),
        ownDescriptors: descriptorSummary(o, options.ownLimit || 220),
        protoChain: protoChainSummary(o, options.depth || 4)
      };
    };
    const handlerSummary = (eventHandlers) => toArray(eventHandlers).map((h, index) => ({
      index,
      handlerCtor: ctor(h),
      callerCtor: ctor(h?.caller),
      methodName: h?.method?.name || "",
      once: !!h?.once,
      callerOwnKeys: own(h?.caller).slice(0, 120),
      callerProtoKeys: h?.caller ? own(Object.getPrototypeOf(h.caller)).slice(0, 160) : []
    }));
    const effectiveVisible = (node) => {
      const blockers = [];
      let cur = node;
      while (cur) {
        if (cur.visible === false || cur._visible === false) blockers.push({ ctor: ctor(cur), name: cur.name || "", sceneName: cur.sceneName || "", reason: "visible=false" });
        if (cur.alpha === 0) blockers.push({ ctor: ctor(cur), name: cur.name || "", sceneName: cur.sceneName || "", reason: "alpha=0" });
        cur = cur.parent || cur._parent || null;
      }
      return { visible: blockers.length === 0, blockers };
    };
    const nodeInfo = (node, pathText, depth) => {
      const eff = effectiveVisible(node);
      return {
        path: pathText,
        depth,
        ctor: ctor(node),
        name: node?.name || "",
        sceneName: node?.sceneName || "",
        SceneName: node?.SceneName || "",
        className: node?._className_ || "",
        uiid: node?._uiid || "",
        resName: node?._resName || "",
        visible: node?.visible,
        alpha: node?.alpha,
        effectiveVisible: eff.visible,
        hiddenReasons: eff.blockers,
        layerOrder: node?.layerOrder,
        x: node?.x,
        y: node?.y,
        width: node?.width,
        height: node?.height,
        mouseEnabled: node?.mouseEnabled,
        childCount: node?._children?.filter(Boolean).length || 0,
        ownKeys: own(node).slice(0, 120),
        protoKeys: own(Object.getPrototypeOf(node)).slice(0, 160)
      };
    };
    const walkStage = (root, maxDepth = 9, maxNodes = 4000) => {
      const nodes = [];
      const visit = (node, pathText, depth) => {
        if (!node || nodes.length >= maxNodes || depth > maxDepth) return;
        const index = nodes.length;
        nodes.push(nodeInfo(node, pathText, depth));
        const children = (node._children || []).filter(Boolean);
        children.forEach((child, childIndex) => {
          const label = child.sceneName || child._className_ || child.name || ctor(child) || "node";
          visit(child, pathText + "/" + label + "#" + childIndex, depth + 1);
        });
        if (nodes[index]) nodes[index].childCountSeen = children.length;
      };
      visit(root, "Laya.stage", 0);
      return { maxDepth, maxNodes, count: nodes.length, truncated: nodes.length >= maxNodes, nodes };
    };

    const L = window.Laya;
    const CU = L?.ClassUtils;
    let popup = null, ged = null, windowManager = null, proxy = null, sceneManager = null;
    try { popup = CU?.getInstance?.("PopUpWindow") || null; } catch (error) {}
    try { ged = popup?.ged || null; } catch (error) {}
    try { windowManager = toArray(ged?._events?.HIDE_WINDOW)[0]?.caller || null; } catch (error) {}
    try { proxy = windowManager?.proxy || null; } catch (error) {}
    try {
      sceneManager = toArray(ged?._events?.SWITCH_SCENE)
        .map((h) => h?.caller)
        .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
    } catch (error) {}
    if (!sceneManager) {
      try {
        sceneManager = windowManager?.constructor?.managerList?.filter(Boolean)
          .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
      } catch (error) {}
    }

    const classMap = CU?._classMap || {};
    const classNames = Object.keys(classMap).sort();
    const gedEventNames = ged?._events ? Object.keys(ged._events).sort() : [];
    const proxyEventNames = proxy?._events ? Object.keys(proxy._events).sort() : [];
    const managerList = windowManager?.constructor?.managerList?.filter(Boolean) || [];
    const currentScene = sceneManager?.CurrentScene || null;

    return {
      ok: true,
      capturedAt: nowIso,
      page: { url: location.href, title: document.title },
      laya: {
        hasLaya: !!L,
        classUtils: objectSummary(CU, { depth: 2 }),
        classMapCount: classNames.length,
        classNames,
        stageSummary: L?.stage ? nodeInfo(L.stage, "Laya.stage", 0) : null,
        stageTree: L?.stage ? walkStage(L.stage) : null
      },
      runtime: {
        popup: objectSummary(popup, { depth: 3 }),
        ged: {
          summary: objectSummary(ged, { depth: 3 }),
          eventCount: gedEventNames.length,
          eventNames: gedEventNames,
          events: Object.fromEntries(gedEventNames.map((name) => [name, handlerSummary(ged._events[name])]))
        },
        windowManager: {
          summary: objectSummary(windowManager, { depth: 4 }),
          managerListCount: managerList.length,
          managers: managerList.map((manager, index) => ({
            index,
            summary: objectSummary(manager, { depth: 3 })
          })),
          windowInstanceDict: (() => {
            try {
              const dict = windowManager?.WindowInstanceDict;
              if (!dict) return null;
              return {
                ctor: ctor(dict),
                size: typeof dict.size === "number" ? dict.size : null,
                keys: typeof dict.keys === "function" ? Array.from(dict.keys()) : []
              };
            } catch (error) {
              return { error: String(error?.message || error) };
            }
          })()
        },
        proxy: {
          summary: objectSummary(proxy, { depth: 3 }),
          eventCount: proxyEventNames.length,
          eventNames: proxyEventNames,
          events: Object.fromEntries(proxyEventNames.map((name) => [name, handlerSummary(proxy._events[name])]))
        },
        sceneManager: {
          locator: "Laya.ClassUtils.getInstance('PopUpWindow').ged._events.SWITCH_SCENE[0].caller",
          summary: objectSummary(sceneManager, { depth: 4 }),
          values: sceneManager ? {
            currentSceneCtor: ctor(currentScene),
            currentSceneName: currentScene?.sceneName || currentScene?.SceneName || currentScene?.name || "",
            currentSceneClassName: currentScene?._className_ || "",
            isGameScene: !!sceneManager.IsGameScene,
            isTableScene: !!sceneManager.IsTableScene,
            lastSceneName: sceneManager.LastSceneName || sceneManager.lastSceneName || "",
            previousSceneName: (() => { try { return sceneManager.PreviousSceneName || ""; } catch { return ""; } })(),
            nextScene: simpleValue(sceneManager.NextScene ?? sceneManager.nextScene)
          } : null
        },
        currentScene: objectSummary(currentScene, { depth: 5 })
      },
      indexes: {
        registeredScenes: classNames.filter((name) => /Scene$/.test(name)),
        registeredWindows: classNames.filter((name) => /Window$/.test(name)),
        registeredProtocols: classNames.filter((name) => /^(C|S|Gs|Msg|Pub)/.test(name)),
        registeredManagers: classNames.filter((name) => /Manager$|Manger$|Controler$/.test(name)),
        stageSceneNodes: (L?.stage ? walkStage(L.stage).nodes : []).filter((node) => node.sceneName || node.SceneName || node.className),
        visibleNodes: (L?.stage ? walkStage(L.stage).nodes : []).filter((node) => node.effectiveVisible)
      }
    };
  })()`;
}

function buildClassDetailsExpression(classNames) {
  const namesLiteral = JSON.stringify(classNames);
  return `(() => {
    const names = ${namesLiteral};
    const own = (o) => {
      try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; }
    };
    const ctor = (o) => {
      try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; }
    };
    const simpleValue = (v) => {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (t === "function") return "[Function " + (v.name || "") + "]";
      if (Array.isArray(v)) return "[Array " + v.length + "]";
      if (v instanceof Map) return "[Map " + v.size + "]";
      return "[" + (ctor(v) || t) + "]";
    };
    const hashString = (text) => {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    const descriptorSummary = (o, limit) => own(o).slice(0, limit).map((name) => {
      try {
        const d = Object.getOwnPropertyDescriptor(o, name);
        const item = {
          name,
          kind: d && (d.get || d.set) ? "accessor" : "value",
          enumerable: !!(d && d.enumerable),
          configurable: !!(d && d.configurable)
        };
        if (d && d.get) item.get = { name: d.get.name || "", sourceLength: String(d.get).length, sourceHash: hashString(String(d.get)) };
        if (d && d.set) item.set = { name: d.set.name || "", sourceLength: String(d.set).length, sourceHash: hashString(String(d.set)) };
        if (d && "value" in d) {
          item.type = typeof d.value;
          item.ctor = ctor(d.value);
          item.value = simpleValue(d.value);
          if (typeof d.value === "function") {
            const source = String(d.value);
            item.fn = { name: d.value.name || "", arity: d.value.length, sourceLength: source.length, sourceHash: hashString(source) };
          }
        }
        return item;
      } catch (error) {
        return { name, error: String(error && error.message || error) };
      }
    });
    const protoChainSummary = (o, depth) => {
      const chain = [];
      let p = o;
      for (let level = 0; level < depth && p; level++, p = Object.getPrototypeOf(p)) {
        chain.push({ level, ctor: ctor(p), descriptors: descriptorSummary(p, 160) });
      }
      return chain;
    };
    const CU = window.Laya && window.Laya.ClassUtils;
    const classMap = CU && CU._classMap || {};
    const classDetails = names.map((name) => {
      const classDef = classMap[name];
      const proto = classDef && classDef.prototype;
      return {
        name,
        exists: !!classDef,
        ctor: ctor(classDef),
        functionName: typeof classDef === "function" ? classDef.name || "" : "",
        staticDescriptors: descriptorSummary(classDef, 80),
        prototypeDescriptors: descriptorSummary(proto, 160),
        prototypeChain: protoChainSummary(proto, 3)
      };
    });
    return { ok: true, count: classDetails.length, classDetails };
  })()`;
}

function summaryMarkdown(payload, paths) {
  const scene = payload.runtime?.sceneManager?.values || {};
  return [
    "# SGS Runtime Inventory",
    "",
    `- Captured: ${payload.capturedAt}`,
    `- Page: ${payload.page?.title || ""} ${payload.page?.url || ""}`,
    `- ClassUtils._classMap: ${payload.laya?.classMapCount || 0} registered names`,
    `- GED events: ${payload.runtime?.ged?.eventCount || 0}`,
    `- Proxy events: ${payload.runtime?.proxy?.eventCount || 0}`,
    `- WindowManager.managerList: ${payload.runtime?.windowManager?.managerListCount || 0}`,
    `- Stage nodes captured: ${payload.laya?.stageTree?.count || 0}`,
    `- Current scene: ${scene.currentSceneName || ""} (${scene.currentSceneClassName || scene.currentSceneCtor || ""})`,
    `- IsGameScene: ${scene.isGameScene}`,
    `- IsTableScene: ${scene.isTableScene}`,
    "",
    "## Files",
    "",
    `- Full inventory: ${paths.full}`,
    `- Class map: ${paths.classMap}`,
    `- Runtime entrypoints: ${paths.entrypoints}`,
    `- Stage tree: ${paths.stageTree}`,
    `- Indexes: ${paths.indexes}`,
    "",
    "## Stable Anchors",
    "",
    "- ClassUtils registered strings are stored separately from minified constructor names.",
    "- SceneManager is located through GED SWITCH_SCENE caller and shape matching.",
    "- WindowManager is located through GED HIDE_WINDOW caller.",
    "- ServerProxy is located through WindowManager.proxy.",
    "- Stage nodes include sceneName, SceneName, _className_, _uiid, _resName, effective visibility, and object shape.",
    ""
  ].join("\n");
}

export async function collectRuntimeInventory() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const { target, value } = await evaluateOnSgs(buildRuntimeExpression(), { timeoutMs: 90000, cdpTimeoutMs: 120000 });
  const classDetailsDir = path.join(dir, "class-details");
  await mkdir(classDetailsDir, { recursive: true });
  const classNames = value.laya?.classNames || [];
  const batchSize = Number(process.env.SGS_RUNTIME_CLASS_BATCH_SIZE || 200);
  const classDetails = [];
  for (let start = 0; start < classNames.length; start += batchSize) {
    const batchIndex = Math.floor(start / batchSize);
    const batchNames = classNames.slice(start, start + batchSize);
    const batch = await evaluateOnSgs(buildClassDetailsExpression(batchNames), { timeoutMs: 90000, cdpTimeoutMs: 120000 });
    const batchValue = batch.value || { classDetails: [] };
    classDetails.push(...(batchValue.classDetails || []));
    await writeJson(path.join(classDetailsDir, `${String(batchIndex).padStart(4, "0")}.json`), {
      capturedAt: value.capturedAt,
      page: value.page,
      batchIndex,
      start,
      count: batchValue.classDetails?.length || 0,
      classDetails: batchValue.classDetails || []
    });
    console.error(`class details ${Math.min(start + batchSize, classNames.length)}/${classNames.length}`);
  }

  const full = path.join(dir, "inventory-full.json");
  const classMap = path.join(dir, "class-map.json");
  const entrypoints = path.join(dir, "runtime-entrypoints.json");
  const stageTree = path.join(dir, "stage-tree.json");
  const indexes = path.join(dir, "indexes.json");
  const readme = path.join(dir, "README.md");

  await writeJson(full, { target, value });
  await writeJson(classMap, {
    capturedAt: value.capturedAt,
    page: value.page,
    classMapCount: value.laya?.classMapCount || 0,
    classNames,
    classDetails
  });
  await writeJson(entrypoints, {
    capturedAt: value.capturedAt,
    page: value.page,
    classUtils: value.laya?.classUtils || null,
    runtime: value.runtime || null
  });
  await writeJson(stageTree, {
    capturedAt: value.capturedAt,
    page: value.page,
    stageSummary: value.laya?.stageSummary || null,
    stageTree: value.laya?.stageTree || null
  });
  await writeJson(indexes, {
    capturedAt: value.capturedAt,
    page: value.page,
    indexes: value.indexes || {}
  });
  await writeFile(readme, summaryMarkdown(value, { full, classMap, entrypoints, stageTree, indexes }), "utf8");

  return {
    ok: true,
    dir,
    target: { id: target.id, title: target.title, url: target.url },
    files: { full, classMap, entrypoints, stageTree, indexes, readme },
    counts: {
      classMap: value.laya?.classMapCount || 0,
      gedEvents: value.runtime?.ged?.eventCount || 0,
      proxyEvents: value.runtime?.proxy?.eventCount || 0,
      managers: value.runtime?.windowManager?.managerListCount || 0,
      stageNodes: value.laya?.stageTree?.count || 0
    },
    currentScene: value.runtime?.sceneManager?.values || null
  };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  collectRuntimeInventory()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message || String(error));
      process.exitCode = 1;
    });
}
