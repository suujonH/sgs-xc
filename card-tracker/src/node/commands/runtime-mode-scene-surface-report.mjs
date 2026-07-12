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
    process.env.SGS_MODE_SCENE_SURFACE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-mode-scene-surface-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tsv(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  return String(value).replace(/\t|\r?\n/g, " ");
}

function reportExpression() {
  return String.raw`(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
        if (cur.destroyed) out.push(label + ":destroyed");
      }
      return out;
    };
    const effectiveVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const forbiddenKey = (key) => /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(String(key || ""));
    const stringifyValue = (value, depth = 0) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      if (depth > 0) return "[" + (ctor(value) || t) + "]";
      const keys = own(value).filter((key) => !forbiddenKey(key)).slice(0, 10);
      const out = {};
      for (const key of keys) {
        try { out[key] = stringifyValue(value[key], depth + 1); } catch { out[key] = "[throws]"; }
      }
      return { kind: ctor(value) || t, fields: out };
    };
    const categoryOf = (name) => {
      const s = String(name || "");
      if (/(buy|Buy|pay|Pay|recharge|Recharge|money|Money|yuanbao|YuanBao|price|Price|cost|Cost|shop|Shop|gift|Gift|reward|Reward|award|Award|lottery|Lottery|treasure|Treasure|seckill|SecKill|coupon|Coupon|market|Market)/.test(s)) return "purchase-risk";
      if (/(btn|Btn|button|Button|click|Click|touch|Touch|mouse|Mouse|press|Press)/.test(s)) return "button-ui-click";
      if (/(mode|Mode|enter|Enter|switch|Switch|scene|Scene|tab|Tab|page|Page|activity|Activity|select|Select)/.test(s)) return "scene-entry";
      if (/(window|Window|view|View|panel|Panel|layer|Layer|modal|Modal|close|Close|open|Open|show|Show|hide|Hide)/.test(s)) return "window-ui";
      if (/(card|Card|skill|Skill|spell|Spell|zhanfa|ZhanFa|effect|Effect|anim|Anim|motion|Motion|tween|Tween)/.test(s)) return "gameplay-surface";
      if (/(res|Res|skin|Skin|texture|Texture|image|Image|atlas|Atlas|url|Url|graphics|Graphics)/.test(s)) return "resource-drawing";
      if (/(state|State|status|Status|enable|Enable|gray|Gray|open|Open|lock|Lock|visible|Visible)/.test(s)) return "state-visibility";
      if (/(id|ID|index|Index|type|Type|name|Name|text|Text|title|Title|data|Data|vo|VO|config|Config)/.test(s)) return "identity-config";
      return "other";
    };
    const meaningOf = (category) => ({
      "purchase-risk": "购买、付费、抽奖、奖励或商店相关表面；只记录证据，不自动调用。",
      "button-ui-click": "按钮、点击、触摸或鼠标入口，可通过事件绑定/方法名追踪。",
      "scene-entry": "模式/页签/场景切换入口或选择状态。",
      "window-ui": "窗口、面板、层级、显示/隐藏生命周期。",
      "gameplay-surface": "牌、技能、战法、特效或动画表面。",
      "resource-drawing": "皮肤、贴图、资源路径或绘制对象。",
      "state-visibility": "可见性、启用/禁用、开放/锁定、状态字段。",
      "identity-config": "id/type/name/text/data/config，用于映射配置与 UI。",
      "other": "暂未分类字段，需要后续 source/live 交叉验证。"
    })[category] || "";
    const summarizeFields = (obj, limit = 80) => {
      const rows = [];
      for (const key of own(obj).slice(0, 1200)) {
        if (forbiddenKey(key)) continue;
        const category = categoryOf(key);
        if (category === "other" && !/(mode|Mode|btn|Btn|activity|Activity|view|View|window|Window|data|Data|state|State|skin|Skin|text|Text|name|Name|id|ID|type|Type|tab|Tab|page|Page|select|Select|open|Open|close|Close|effect|Effect)/.test(key)) continue;
        let value = null;
        let kind = "";
        try {
          value = obj[key];
          kind = Array.isArray(value) ? "array" : value == null ? String(value) : typeof value === "object" ? (ctor(value) || "object") : typeof value;
        } catch {
          rows.push({ name: key, category, meaning: meaningOf(category), kind: "throws", value: "[throws]" });
          continue;
        }
        rows.push({ name: key, category, meaning: meaningOf(category), kind, value: stringifyValue(value) });
        if (rows.length >= limit) break;
      }
      return rows;
    };
    const methodNames = (obj, limit = 120) => {
      const rows = [];
      const seen = new Set();
      let proto = Object.getPrototypeOf(obj || {});
      while (proto && proto !== Object.prototype && rows.length < limit) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            if (typeof obj[key] !== "function") continue;
          } catch {
            continue;
          }
          const category = categoryOf(key);
          if (category === "other" && !/(enter|Enter|click|Click|open|Open|close|Close|select|Select|switch|Switch|tab|Tab|page|Page|mode|Mode|show|Show|hide|Hide|handler|Handler|update|Update|init|Init|play|Play|effect|Effect|auto|Auto)/.test(key)) continue;
          rows.push({ name: key, category, meaning: meaningOf(category), arity: obj[key].length });
          if (rows.length >= limit) break;
        }
        proto = Object.getPrototypeOf(proto);
      }
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    };
    const eventRows = (obj) => {
      const events = obj && obj._events;
      if (!events || typeof events !== "object") return [];
      const rows = [];
      for (const name of own(events).slice(0, 100)) {
        const handlers = Array.isArray(events[name]) ? events[name] : [events[name]];
        for (const handler of handlers.filter(Boolean).slice(0, 12)) {
          rows.push({
            name,
            category: categoryOf(name),
            caller: handler.caller ? labelOf(handler.caller) : "",
            callerCtor: ctor(handler.caller),
            methodName: handler.method && (handler.method.name || ""),
            once: handler.once === true
          });
        }
      }
      return rows;
    };
    const textureInfo = (node) => {
      const rows = [];
      const add = (field, tex) => {
        if (!tex) return;
        let bitmap = null;
        try { bitmap = tex.bitmap || tex._bitmap || null; } catch {}
        const url = tex.url || tex._url || bitmap && (bitmap.url || bitmap._url) || "";
        const width = tex.width || tex.sourceWidth || 0;
        const height = tex.height || tex.sourceHeight || 0;
        if (url || width || height) rows.push({ field, url, width, height, ctor: ctor(tex), bitmapCtor: ctor(bitmap) });
      };
      try { add("texture", node.texture); } catch {}
      try { add("_texture", node._texture); } catch {}
      try { add("graphics._one.texture", node.graphics && node.graphics._one && node.graphics._one.texture); } catch {}
      try {
        const cmds = node.graphics && node.graphics._cmds;
        if (Array.isArray(cmds)) {
          for (const [index, cmd] of cmds.slice(0, 6).entries()) add("graphics._cmds[" + index + "].texture", cmd && cmd.texture);
        }
      } catch {}
      return rows;
    };
    const buildRegistrationMap = () => {
      const out = new Map();
      const map = Laya && Laya.ClassUtils && Laya.ClassUtils._classMap || {};
      for (const name of own(map)) {
        let fn = null;
        try { fn = map[name]; } catch {}
        if (typeof fn !== "function") continue;
        if (!out.has(fn)) out.set(fn, []);
        out.get(fn).push(name);
      }
      for (const names of out.values()) names.sort();
      return out;
    };
    const registrationMap = buildRegistrationMap();
    const registeredNames = (obj) => (registrationMap.get(obj && obj.constructor) || []).slice(0, 30);
    const nodePathPart = (node, fallback) => node && (node.name || node._className_ || node.sceneName || node.SceneName || ctor(node)) || fallback;
    const walk = (root, visitor, path = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 16) return 0;
      seen.add(root);
      let count = 1;
      visitor(root, path, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        count += walk(child, visitor, path + "/" + nodePathPart(child, "#" + i) + "#" + i, depth + 1, seen);
      }
      return count;
    };
    const stageChildren = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (effectiveVisible(candidate)) { currentScene = candidate; break; }
      }
      if (!currentScene && sceneLayer.numChildren) currentScene = sceneLayer.getChildAt(sceneLayer.numChildren - 1);
    }
    const describeNode = (node, path, depth) => {
      const fields = summarizeFields(node, 90);
      const methods = methodNames(node, 140);
      const events = eventRows(node);
      const textures = textureInfo(node);
      const text = (() => { try { return typeof node.text === "string" ? node.text.slice(0, 200) : ""; } catch { return ""; } })();
      const dataSource = (() => {
        const candidates = [];
        for (const key of ["dataSource", "_dataSource", "modeData", "modeVO", "relateData", "itemData", "activityData", "tabData"]) {
          try {
            if (node[key]) candidates.push({ key, ctor: ctor(node[key]), value: stringifyValue(node[key]) });
          } catch {}
        }
        return candidates;
      })();
      const allNames = [
        labelOf(node),
        node && node.name,
        node && node._className_,
        node && node.sceneName,
        node && node.SceneName,
        ctor(node),
        text,
        ...registeredNames(node)
      ].filter(Boolean).join(" ");
      const categories = {};
      for (const item of [...fields, ...methods, ...events]) categories[item.category || categoryOf(item.name)] = true;
      const purchaseRisk = !!categories["purchase-risk"];
      return {
        path,
        depth,
        label: labelOf(node),
        ctor: ctor(node),
        registeredNames: registeredNames(node),
        name: node && node.name || "",
        className: node && node._className_ || "",
        sceneName: node && (node.sceneName || node.SceneName) || "",
        uiid: node && node._uiid || "",
        resName: node && node._resName || "",
        text,
        visible: node && node.visible,
        alpha: node && node.alpha,
        effectiveVisible: effectiveVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node && node.x,
        y: node && node.y,
        width: node && node.width,
        height: node && node.height,
        mouseEnabled: node && node.mouseEnabled,
        mouseThrough: node && node.mouseThrough,
        childCount: node && node.numChildren || 0,
        fields,
        methods,
        events,
        textures,
        dataSource,
        categories: Object.keys(categories).sort(),
        purchaseRisk,
        allNames
      };
    };
    const nodes = [];
    let visited = 0;
    if (currentScene) {
      visited = walk(currentScene, (node, path, depth) => {
        const label = labelOf(node);
        const fields = own(node).join(" ");
        const methods = methodNames(node, 30).map((m) => m.name).join(" ");
        const text = (() => { try { return typeof node.text === "string" ? node.text : ""; } catch { return ""; } })();
        const interesting = effectiveVisible(node) || /Mode|Activity|Btn|Button|Tab|Page|View|Window|Rogue|GeneralTrial|KanShu|Bless|QiFu|YanJiao|Card|Skill|Effect|Shop/i.test(label + " " + fields + " " + methods + " " + text);
        if (interesting) nodes.push(describeNode(node, path, depth));
      }, "currentScene");
    }
    const windows = [];
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) windows.push(describeNode(windowLayer.getChildAt(i), "WindowLayer#" + i, 1));
    }
    const buttons = nodes.filter((node) =>
      node.effectiveVisible &&
      (/(btn|button)/i.test(node.label + " " + node.name + " " + node.className) ||
        node.methods.some((method) => method.category === "button-ui-click") ||
        node.events.some((event) => event.category === "button-ui-click"))
    );
    const entries = nodes.filter((node) =>
      node.effectiveVisible &&
      (node.methods.some((method) => method.category === "scene-entry") ||
        node.fields.some((field) => field.category === "scene-entry") ||
        /(Mode|Activity|Tab|Page|onEnterMode|modeId|modeData)/i.test(node.allNames))
    );
    const resources = nodes.filter((node) => node.textures.length || node.fields.some((field) => field.category === "resource-drawing"));
    const classMap = Laya && Laya.ClassUtils && Laya.ClassUtils._classMap || {};
    const classUtils = {
      classMapSize: own(classMap).length,
      sampleNames: own(classMap).slice(0, 300)
    };
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        layaVersion: Laya && Laya.version || "",
        resourceVersion: window.resourceVersion || "",
        stage: Laya.stage ? { width: Laya.stage.width, height: Laya.stage.height, childCount: Laya.stage.numChildren } : null
      },
      currentScene: currentScene ? describeNode(currentScene, "currentScene", 0) : null,
      stageChildren: stageChildren.map((node, index) => ({
        index,
        label: labelOf(node),
        ctor: ctor(node),
        childCount: node && node.numChildren || 0,
        visible: node && node.visible,
        effectiveVisible: effectiveVisible(node)
      })),
      visited,
      nodes,
      buttons,
      entries,
      resources,
      windows,
      classUtils,
      counts: {
        nodes: nodes.length,
        buttons: buttons.length,
        entries: entries.length,
        resources: resources.length,
        windows: windows.length,
        purchaseRiskButtons: buttons.filter((node) => node.purchaseRisk).length,
        registeredNodeMatches: nodes.filter((node) => node.registeredNames.length).length
      },
      safety: {
        actionTaken: false,
        purchaseCallsBlockedByDesign: true,
        note: "This report only inspects current ModeScene surfaces. It does not click or call UI/game methods."
      }
    };
  })()`;
}

function nodeRows(report) {
  const header = [
    "path",
    "label",
    "ctor",
    "registeredNames",
    "effectiveVisible",
    "text",
    "categories",
    "purchaseRisk",
    "fieldCount",
    "methodCount",
    "eventCount",
    "textureCount",
    "dataSourceKeys"
  ];
  const rows = [header.join("\t")];
  for (const node of report.nodes || []) {
    rows.push([
      node.path,
      node.label,
      node.ctor,
      node.registeredNames,
      node.effectiveVisible,
      node.text,
      node.categories,
      node.purchaseRisk,
      node.fields?.length || 0,
      node.methods?.length || 0,
      node.events?.length || 0,
      node.textures?.length || 0,
      (node.dataSource || []).map((item) => item.key)
    ].map(tsv).join("\t"));
  }
  return `${rows.join("\n")}\n`;
}

function methodRows(report) {
  const header = ["path", "label", "method", "category", "meaning", "arity", "purchaseRisk"];
  const rows = [header.join("\t")];
  for (const node of report.nodes || []) {
    for (const method of node.methods || []) {
      rows.push([node.path, node.label, method.name, method.category, method.meaning, method.arity, method.category === "purchase-risk"].map(tsv).join("\t"));
    }
  }
  return `${rows.join("\n")}\n`;
}

function fieldRows(report) {
  const header = ["path", "label", "field", "category", "kind", "meaning", "value"];
  const rows = [header.join("\t")];
  for (const node of report.nodes || []) {
    for (const field of node.fields || []) {
      rows.push([node.path, node.label, field.name, field.category, field.kind, field.meaning, JSON.stringify(field.value)].map(tsv).join("\t"));
    }
  }
  return `${rows.join("\n")}\n`;
}

function readmeText(report) {
  const lines = [];
  lines.push("# ModeScene Surface Report");
  lines.push("");
  lines.push(`- Captured: ${report.capturedAt || ""}`);
  lines.push(`- Page: ${report.page?.title || ""} ${report.page?.url || ""}`);
  lines.push(`- Current scene: ${report.currentScene?.sceneName || report.currentScene?.label || ""}`);
  lines.push(`- Laya version: ${report.runtime?.layaVersion || ""}`);
  lines.push(`- Resource version: ${report.runtime?.resourceVersion || ""}`);
  lines.push(`- Nodes: ${report.counts?.nodes || 0}`);
  lines.push(`- Buttons: ${report.counts?.buttons || 0}`);
  lines.push(`- Scene/mode entries: ${report.counts?.entries || 0}`);
  lines.push(`- Resource nodes: ${report.counts?.resources || 0}`);
  lines.push(`- Windows: ${report.counts?.windows || 0}`);
  lines.push(`- Purchase-risk buttons: ${report.counts?.purchaseRiskButtons || 0}`);
  lines.push(`- ClassUtils registered names sampled: ${report.classUtils?.classMapSize || 0}`);
  lines.push("");
  lines.push("This report is read-only. It records Laya nodes, fields, methods, and event bindings from the current `ModeScene`; it does not click or call game methods.");
  lines.push("");
  lines.push("## Visible Entries");
  lines.push("");
  for (const node of (report.entries || []).slice(0, 80)) {
    const methods = (node.methods || []).filter((method) => method.category === "scene-entry" || method.category === "button-ui-click").slice(0, 8).map((method) => method.name).join(",");
    const fields = (node.fields || []).filter((field) => field.category === "scene-entry" || field.category === "identity-config").slice(0, 8).map((field) => `${field.name}=${typeof field.value === "object" ? JSON.stringify(field.value).slice(0, 60) : String(field.value)}`).join(", ");
    lines.push(`- ${node.path} ${node.label} text=${node.text || ""} methods=${methods} fields=${fields}`);
  }
  lines.push("");
  lines.push("## Visible Buttons");
  lines.push("");
  for (const node of (report.buttons || []).slice(0, 100)) {
    const risk = node.purchaseRisk ? " purchase-risk" : "";
    const methods = (node.methods || []).filter((method) => method.category === "button-ui-click" || method.category === "purchase-risk").slice(0, 10).map((method) => method.name).join(",");
    lines.push(`- ${node.path} ${node.label}${risk} text=${node.text || ""} methods=${methods}`);
  }
  lines.push("");
  lines.push("## Resource Nodes");
  lines.push("");
  for (const node of (report.resources || []).slice(0, 80)) {
    const textures = (node.textures || []).map((tex) => `${tex.field}:${tex.url || `${tex.width}x${tex.height}`}`).join(", ");
    const fields = (node.fields || []).filter((field) => field.category === "resource-drawing").slice(0, 6).map((field) => `${field.name}=${typeof field.value === "object" ? JSON.stringify(field.value).slice(0, 60) : String(field.value)}`).join(", ");
    lines.push(`- ${node.path} ${node.label} textures=${textures} fields=${fields}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(reportExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const report = result.value || {};
  await writeJson(path.join(dir, "mode-scene-surface.json"), report);
  await writeFile(path.join(dir, "mode-scene-nodes.tsv"), nodeRows(report), "utf8");
  await writeFile(path.join(dir, "mode-scene-methods.tsv"), methodRows(report), "utf8");
  await writeFile(path.join(dir, "mode-scene-fields.tsv"), fieldRows(report), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: report.currentScene ? {
      label: report.currentScene.label,
      sceneName: report.currentScene.sceneName,
      className: report.currentScene.className,
      ctor: report.currentScene.ctor
    } : null,
    counts: report.counts,
    classMapSize: report.classUtils?.classMapSize || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
