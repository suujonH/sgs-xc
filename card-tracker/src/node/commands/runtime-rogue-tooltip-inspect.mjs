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
    process.env.SGS_ROGUE_TOOLTIP_INSPECT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-rogue-tooltip-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inspectExpression() {
  return String.raw`(() => {
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
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
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      const keys = own(value)
        .filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key))
        .slice(0, 28);
      const out = {
        kind: "object",
        ctor: ctor(value),
        name: value.name || "",
        className: value._className_ || "",
        sceneName: value.sceneName || value.SceneName || "",
        keys
      };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 12)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const textOf = (node) => {
      try {
        if (typeof node?._text === "string") return node._text;
        if (typeof node?.text === "string") return node.text;
        if (typeof node?._innerHTML === "string") return node._innerHTML;
        if (typeof node?.innerHTML === "string") return node.innerHTML;
      } catch {}
      return "";
    };
    const nodeFields = (node) => {
      const out = {};
      for (const key of own(node)) {
        if (!/(ToolTip|toolTip|tooltip|Tip|tip|skill|Skill|general|General|card|Card|data|Data|text|Text|click|Click|event|Event|handler|Handler|state|State|fight|Fight|id|ID|name|Name)/.test(key)) continue;
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        try { out[key] = simple(node[key]); } catch { out[key] = "[throws]"; }
      }
      return out;
    };
    const eventSummary = (node) => {
      const events = node?._events;
      const out = {};
      if (!events || typeof events !== "object") return out;
      for (const key of own(events)) {
        if (!/mouse|click|roll|over|out|tip|resize|removed/i.test(key)) continue;
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            caller: handler.caller ? labelOf(handler.caller) || ctor(handler.caller) : "",
            method: handler.method ? (handler.method.name || String(handler.method).slice(0, 160)) : "",
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg, 1)) : simple(handler.args, 1),
            once: handler.once
          })).slice(0, 12);
        } catch {
          out[key] = "[throws]";
        }
      }
      return out;
    };
    const boundsOf = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        return p ? { x: p.x, y: p.y, width: Number(node.width) || 0, height: Number(node.height) || 0 } : null;
      } catch {
        return null;
      }
    };
    const isInteresting = (node, nodePath) => {
      const fields = nodeFields(node);
      const hay = [
        nodePath,
        labelOf(node),
        textOf(node),
        Object.keys(fields).join(" "),
        JSON.stringify(fields)
      ].join(" ");
      return /RogueFightWindow|RogueSmallMapScene|ChangeSKillWindow|Rogue1v1ChangeSkillWindow|ToolTip|toolTip|GeneralToolTip|tooltip|pWt|aKi|g6i|Vts|Skill|skill|General|general|Tip|tip|mouseover|mouseout|onRollOver/.test(hay);
    };
    const walk = (node, nodePath, out = [], depth = 0, seen = new Set()) => {
      if (!node || depth > 14 || out.length >= 700 || seen.has(node)) return out;
      seen.add(node);
      if (isInteresting(node, nodePath)) {
        out.push({
          path: nodePath,
          label: labelOf(node),
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          sceneName: node.sceneName || node.SceneName || "",
          uiid: node._uiid || "",
          resName: node._resName || "",
          visible: node.visible,
          alpha: node.alpha,
          effectiveVisible: hiddenReasons(node).length === 0,
          hiddenReasons: hiddenReasons(node),
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          globalBounds: boundsOf(node),
          text: textOf(node).slice(0, 300),
          fields: nodeFields(node),
          events: eventSummary(node)
        });
      }
      for (let i = 0; i < (node.numChildren || 0); i++) {
        let child = null;
        try { child = node.getChildAt(i); } catch {}
        const childName = child?.name || child?._className_ || child?.sceneName || ctor(child) || ("#" + i);
        walk(child, nodePath + "/" + childName + "#" + i, out, depth + 1, seen);
      }
      return out;
    };
    const classSources = {};
    for (const [className, methods] of Object.entries({
      RogueFightWindow: ["enterWindow", "createSkillBtn", "showTipHandler", "showGeneralTipHandler", "startbtnClick"],
      ChangeSKillWindow: ["enterWindow", "showSkillPanel", "showTipHandler", "onSelect", "onChange", "forgetChange"],
      Rogue1v1ChangeSkillWindow: ["enterWindow", "showSkillPanel", "showTipHandler", "onSelect", "onChange", "forgetChange"]
    })) {
      const cls = Laya.ClassUtils?.getClass?.(className) || Laya.ClassUtils?._classMap?.[className] || null;
      const proto = cls?.prototype;
      classSources[className] = { classExists: !!cls, functionName: cls?.name || "", methods: {} };
      for (const method of methods) {
        try {
          classSources[className].methods[method] = proto && typeof proto[method] === "function" ? String(proto[method]) : null;
        } catch (error) {
          classSources[className].methods[method] = "[throws " + String(error?.message || error) + "]";
        }
      }
    }
    const children = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, index) => Laya.stage.getChildAt(index));
    const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (hiddenReasons(candidate).length === 0) { currentScene = candidate; break; }
      }
    }
    const windowLayer = children.find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" ")));
    const nodes = [];
    walk(windowLayer, "WindowLayer", nodes);
    walk(currentScene, "CurrentScene", nodes);
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      scene: currentScene ? {
        label: labelOf(currentScene),
        ctor: ctor(currentScene),
        className: currentScene._className_ || "",
        sceneName: currentScene.sceneName || currentScene.SceneName || "",
        childCount: currentScene.numChildren || 0
      } : null,
      windowLayer: windowLayer ? {
        label: labelOf(windowLayer),
        childCount: windowLayer.numChildren || 0,
        effectiveVisible: hiddenReasons(windowLayer).length === 0
      } : null,
      classSources,
      nodes,
      notes: [
        "Read-only inspection. It does not click, confirm, start a fight, use a skill, discard, or buy anything.",
        "Opponent hidden hand arrays are intentionally skipped."
      ]
    };
  })()`;
}

function compactField(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (typeof value === "object" && value.kind === "function") return `function ${value.name || ""}/${value.arity}`;
  if (typeof value === "object" && value.kind) return `${value.kind}:${value.ctor || value.length || ""}`;
  return String(value);
}

function readmeText(payload) {
  const data = payload.value;
  const sources = data.classSources?.RogueFightWindow?.methods || {};
  const tooltipNodes = (data.nodes || []).filter((node) => {
    const fields = node.fields || {};
    return fields.toolTip || fields.ToolTip || fields.GeneralToolTip || fields.generalToolTip;
  });
  const eventNodes = (data.nodes || []).filter((node) => Object.keys(node.events || {}).length);
  const lines = [];
  lines.push("# Rogue Tooltip / Skill Inspect");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Page: ${data.page?.title || ""} ${data.page?.url || ""}`);
  lines.push(`- Scene: ${data.scene?.sceneName || data.scene?.className || ""}`);
  lines.push(`- Window layer children: ${data.windowLayer?.childCount ?? ""}`);
  lines.push(`- Inspected nodes: ${data.nodes?.length || 0}`);
  lines.push(`- Nodes with tooltip fields: ${tooltipNodes.length}`);
  lines.push("");
  lines.push("This is a read-only runtime inspection. It records current Laya fields, event bindings, and method sources without clicking or confirming anything.");
  lines.push("");
  lines.push("## RogueFightWindow Method Sources");
  lines.push("");
  for (const name of ["createSkillBtn", "showTipHandler", "showGeneralTipHandler", "startbtnClick"]) {
    const source = sources[name] || "";
    lines.push(`- ${name}: ${source.slice(0, 600).replace(/\s+/g, " ")}${source.length > 600 ? "..." : ""}`);
  }
  lines.push("");
  lines.push("## Tooltip Nodes");
  lines.push("");
  for (const node of tooltipNodes.slice(0, 80)) {
    const fields = node.fields || {};
    lines.push([
      `- ${node.path}`,
      node.label,
      `text=${node.text || ""}`,
      `toolTip=${compactField(fields.toolTip || fields.ToolTip)}`,
      `generalToolTip=${compactField(fields.GeneralToolTip || fields.generalToolTip)}`,
      `events=${Object.keys(node.events || {}).join(",")}`
    ].join(" | "));
  }
  lines.push("");
  lines.push("## Event Nodes");
  lines.push("");
  for (const node of eventNodes.slice(0, 60)) {
    lines.push(`- ${node.path} | ${node.label} | text=${node.text || ""} | events=${Object.keys(node.events || {}).join(",")}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(inspectExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = { ok: true, target: result.target, value: result.value };
  await writeJson(path.join(dir, "rogue-tooltip-inspect.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  const tooltipNodes = (result.value.nodes || []).filter((node) => {
    const fields = node.fields || {};
    return fields.toolTip || fields.ToolTip || fields.GeneralToolTip || fields.generalToolTip;
  });
  console.log(JSON.stringify({
    dir,
    scene: result.value.scene,
    classSources: Object.fromEntries(Object.entries(result.value.classSources || {}).map(([name, value]) => [name, {
      classExists: value.classExists,
      functionName: value.functionName,
      methodCount: Object.values(value.methods || {}).filter(Boolean).length
    }])),
    inspectedNodes: result.value.nodes?.length || 0,
    tooltipNodes: tooltipNodes.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
