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
    process.env.SGS_CURRENT_SCENE_INSPECT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-current-scene-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectionExpression() {
  return String.raw`(() => {
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
    const simple = (value, depth = 0) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      if (depth > 0) return "[" + (ctor(value) || t) + "]";
      return "[" + (ctor(value) || t) + "]";
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj).slice(0, 1000)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key], 0); } catch { out[key] = "[throws]"; }
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
          try {
            if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key);
          } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort();
    };
    const walk = (root, visitor, maxDepth = 12, maxNodes = 12000) => {
      const seen = new Set();
      let count = 0;
      const inner = (node, nodePath, depth) => {
        if (!node || seen.has(node) || depth > maxDepth || count >= maxNodes) return;
        seen.add(node);
        count++;
        visitor(node, nodePath, depth);
        for (let i = 0; i < (node.numChildren || 0); i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          inner(child, nodePath + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1);
        }
      };
      inner(root, "Laya.stage", 0);
      return count;
    };
    const nodeSummary = (node, nodePath) => {
      const text = (() => { try { return typeof node.text === "string" ? node.text.slice(0, 160) : ""; } catch { return ""; } })();
      const html = (() => { try { return typeof node.innerHTML === "string" ? node.innerHTML.slice(0, 200) : ""; } catch { return ""; } })();
      const dataSource = (() => {
        try {
          const d = node.dataSource || node._dataSource || node.modeData || node.modeVO || node.relateData || null;
          if (!d) return null;
          return {
            ctor: ctor(d),
            fields: safeFields(d, /(id|ID|mode|Mode|group|Group|section|Section|type|Type|name|Name|title|Title|desc|Desc|open|Open|activity|Activity|season|Season|chapter|Chapter|event|Event|state|State|status|Status)/, 80)
          };
        } catch {
          return null;
        }
      })();
      const summary = {
        path: nodePath,
        label: labelOf(node),
        ctor: ctor(node),
        name: node && node.name || "",
        className: node && node._className_ || "",
        sceneName: node && (node.sceneName || node.SceneName) || "",
        uiid: node && node._uiid || "",
        resName: node && node._resName || "",
        visible: node && node.visible,
        alpha: node && node.alpha,
        effectiveVisible: isVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node && node.x,
        y: node && node.y,
        width: node && node.width,
        height: node && node.height,
        childCount: node && node.numChildren || 0,
        text,
        html,
        fields: safeFields(node, /(id|ID|mode|Mode|group|Group|section|Section|activity|Activity|rogue|Rogue|kan|Kan|shu|Shu|bless|Bless|qifu|QiFu|shop|Shop|btn|Btn|button|Button|click|Click|tab|Tab|page|Page|view|View|window|Window|name|Name|text|Text|title|Title|data|Data|state|State|status|Status|open|Open|select|Select|card|Card|skill|Skill|effect|Effect)/, 70),
        keyMethods: methodNames(node, /(enter|Enter|click|Click|touch|Touch|open|Open|close|Close|select|Select|switch|Switch|page|Page|tab|Tab|mode|Mode|rogue|Rogue|kan|Kan|shu|Shu|bless|Bless|shop|Shop|card|Card|skill|Skill|effect|Effect|window|Window|confirm|Confirm|auto|Auto|handler|Handler)/).slice(0, 100),
        dataSource
      };
      if (!summary.text) delete summary.text;
      if (!summary.html) delete summary.html;
      if (!summary.dataSource) delete summary.dataSource;
      return summary;
    };
    const stageChildren = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i));
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" "))) || null;
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (isVisible(candidate)) { currentScene = candidate; break; }
      }
      if (!currentScene && sceneLayer.numChildren) currentScene = sceneLayer.getChildAt(sceneLayer.numChildren - 1);
    }
    const visibleNodes = [];
    const hiddenNodes = [];
    const modeCandidates = [];
    const windowNodes = [];
    const visitedCount = walk(Laya.stage, (node, nodePath) => {
      const label = labelOf(node);
      const fields = safeFields(node, /(mode|Mode|group|Group|section|Section|activity|Activity|rogue|Rogue|kan|Kan|shu|Shu|bless|Bless|shop|Shop|btn|Btn|button|Button|page|Page|view|View|window|Window|name|Name|text|Text|data|Data|select|Select|card|Card|skill|Skill|effect|Effect)/, 30);
      const methods = methodNames(node, /(enter|Enter|click|Click|open|Open|select|Select|mode|Mode|rogue|Rogue|kan|Kan|shu|Shu|bless|Bless|shop|Shop|card|Card|skill|Skill|effect|Effect|window|Window|auto|Auto)/);
      const text = (() => { try { return typeof node.text === "string" ? node.text : ""; } catch { return ""; } })();
      const interesting = /ModeScene|Rogue|KanShu|Bless|QiFu|Window|Activity|Mode|Select|Card|Skill|Effect|Button|Btn|Tab|Page|View|PWt|GeneralTrial|YanJiao/i.test(label)
        || Object.keys(fields).length
        || methods.length
        || text;
      if (!interesting) return;
      const item = nodeSummary(node, nodePath);
      if (item.effectiveVisible) visibleNodes.push(item);
      else hiddenNodes.push(item);
      const modeLike = /Mode|mode|Activity|activity|Rogue|rogue|GeneralTrial|NCt|ModeItem|onEnterMode|enterMode/.test(label + " " + Object.keys(fields).join(" ") + " " + methods.join(" "));
      if (modeLike) modeCandidates.push(item);
      if (/Window/.test(label)) windowNodes.push(item);
    });
    const windows = [];
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) {
        windows.push(nodeSummary(windowLayer.getChildAt(i), "WindowLayer#" + i));
      }
    }
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      stage: {
        width: Laya.stage && Laya.stage.width,
        height: Laya.stage && Laya.stage.height,
        childCount: Laya.stage && Laya.stage.numChildren,
        childLabels: stageChildren.map((node, index) => ({ index, label: labelOf(node), childCount: node && node.numChildren || 0, visible: node && node.visible })),
        visitedCount
      },
      currentScene: currentScene ? nodeSummary(currentScene, "currentScene") : null,
      windows,
      visibleNodes: visibleNodes.slice(0, 500),
      hiddenNodes: hiddenNodes.slice(0, 220),
      modeCandidates: modeCandidates.slice(0, 260),
      windowNodes: windowNodes.slice(0, 160),
      notes: [
        "Live UI is from Laya.stage, not DOM/OCR.",
        "Opponent hidden hand arrays are intentionally not read.",
        "This generic scan is for entry/window/mode discovery and may need a focused follow-up script for actions."
      ]
    };
  })()`;
}

function readmeText(value) {
  const lines = [];
  lines.push("# Current Scene Runtime Inspection");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Page: ${value.page?.title || ""} ${value.page?.url || ""}`);
  lines.push(`- Current scene: ${value.currentScene?.sceneName || value.currentScene?.label || ""}`);
  lines.push(`- Visible interesting nodes: ${value.visibleNodes?.length || 0}`);
  lines.push(`- Mode candidates: ${value.modeCandidates?.length || 0}`);
  lines.push(`- Windows: ${value.windows?.length || 0}`);
  lines.push("");
  lines.push("## Visible Mode/Entry Candidates");
  lines.push("");
  for (const node of (value.modeCandidates || []).filter((node) => node.effectiveVisible).slice(0, 120)) {
    const fields = Object.entries(node.fields || {}).slice(0, 10).map(([key, val]) => `${key}=${String(val)}`).join(", ");
    lines.push(`- ${node.path} ${node.label} text=${node.text || ""} methods=${node.keyMethods.slice(0, 8).join(",")} fields=${fields}`);
  }
  lines.push("");
  lines.push("## Visible Windows");
  lines.push("");
  for (const node of value.windows || []) {
    lines.push(`- ${node.path} ${node.label} methods=${node.keyMethods.slice(0, 8).join(",")}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectionExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await writeJson(path.join(dir, "current-scene-inspection.json"), result.value);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value), "utf8");
  console.log(JSON.stringify({
    dir,
    scene: result.value.currentScene,
    visibleNodes: result.value.visibleNodes?.length || 0,
    modeCandidates: result.value.modeCandidates?.length || 0,
    windows: result.value.windows?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
