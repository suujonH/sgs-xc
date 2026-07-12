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
    process.env.SGS_TABLEGAME_FOCUS_REPORT_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-tablegame-focus-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function focusExpression() {
  return String.raw`(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const textOf = (node) => {
      try {
        if (typeof node.text === "string") return node.text;
        if (typeof node._text === "string") return node._text;
        if (typeof node.innerHTML === "string") return node.innerHTML;
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
    const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const eventNames = (node) => {
      const events = [];
      try {
        const ev = node && node._events;
        if (!ev) return events;
        for (const key of own(ev)) {
          const value = ev[key];
          events.push({
            name: key,
            kind: Array.isArray(value) ? "array" : typeof value,
            count: Array.isArray(value) ? value.length : value ? 1 : 0
          });
        }
      } catch {}
      return events;
    };
    const simple = (value, depth = 0) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) {
        return {
          kind: "array",
          length: value.length,
          sample: depth > 0 ? [] : value.slice(0, 8).map((item) => {
            if (item == null || typeof item !== "object") return item;
            return {
              ctor: ctor(item),
              label: labelOf(item),
              text: textOf(item),
              visible: item.visible,
              effectiveVisible: isVisible(item)
            };
          })
        };
      }
      if (value instanceof Map) return { kind: "map", size: value.size };
      if (value instanceof Set) return { kind: "set", size: value.size };
      if (depth > 0) return { kind: "object", ctor: ctor(value), label: labelOf(value) };
      const keys = own(value).slice(0, 20);
      return {
        kind: "object",
        ctor: ctor(value),
        label: labelOf(value),
        keys
      };
    };
    const fieldSummary = (obj, pattern, limit = 120) => {
      const out = {};
      for (const key of own(obj).slice(0, 1500)) {
        if (/handCards|HandCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const methodNames = (obj, pattern, limit = 120) => {
      const names = [];
      const seen = new Set();
      let proto = Object.getPrototypeOf(obj || {});
      while (proto && proto !== Object.prototype && names.length < limit) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key);
          } catch {}
          if (names.length >= limit) break;
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort();
    };
    const walk = (root, visitor, rootPath = "root", depth = 0, maxDepth = 14, seen = new Set()) => {
      if (!root || seen.has(root) || depth > maxDepth) return;
      seen.add(root);
      visitor(root, rootPath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, rootPath + "/" + label + "#" + i, depth + 1, maxDepth, seen);
      }
    };
    const nodeSummary = (node, nodePath, fieldPattern) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      uiid: node && node._uiid || "",
      resName: node && node._resName || "",
      text: textOf(node),
      visible: node && node.visible,
      effectiveVisible: isVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node && node.x,
      y: node && node.y,
      width: node && node.width,
      height: node && node.height,
      childCount: node && node.numChildren || 0,
      events: eventNames(node),
      fields: fieldSummary(node, fieldPattern || /(skill|Skill|spell|Spell|card|Card|select|Select|auto|Auto|button|Button|btn|Btn|window|Window|state|State|phase|Phase|round|Round|motion|Motion|effect|Effect|visible|Visible|data|Data|id|ID|type|Type|text|Text|skin|Skin|res|Res|ui|UI|list|List|count|Count)/, 140),
      methods: methodNames(node, /(skill|Skill|spell|Spell|card|Card|select|Select|auto|Auto|confirm|Confirm|cancel|Cancel|touch|Touch|click|Click|send|Send|discard|Discard|use|Use|move|Move|window|Window|effect|Effect|show|Show|hide|Hide|state|State|handler|Handler)/, 140)
    });

    const stage = window.Laya && Laya.stage;
    const stageChildren = stage ? Array.from({ length: stage.numChildren }, (_, i) => stage.getChildAt(i)) : [];
    const sceneLayer = stageChildren.find((node) => /LBi|SceneLayer/.test(labelOf(node))) || null;
    const windowLayer = stageChildren.find((node) => /mWt|WindowLayer/.test(labelOf(node))) || null;
    let tableScene = null;
    if (sceneLayer) {
      walk(sceneLayer, (node) => {
        if (!tableScene && /TableGameScene/.test(labelOf(node)) && isVisible(node)) tableScene = node;
      }, "SceneLayer", 0, 4);
    }
    const focus = {
      nbi: [],
      ubt: [],
      pbt: [],
      skillButtons: [],
      fht: [],
      bxt: [],
      stackCards: [],
      pwt: [],
      windows: []
    };
    if (tableScene) {
      walk(tableScene, (node, nodePath) => {
        const label = labelOf(node);
        if (/\bNBi\b/.test(label) || ctor(node) === "NBi") focus.nbi.push(nodeSummary(node, nodePath));
        if (/\buBt\b/.test(label) || ctor(node) === "uBt") focus.ubt.push(nodeSummary(node, nodePath));
        if (/\bpBt\b/.test(label) || ctor(node) === "pBt") focus.pbt.push(nodeSummary(node, nodePath));
        if (/\bfHt\b/.test(label) || ctor(node) === "fHt") focus.fht.push(nodeSummary(node, nodePath));
        if (/\bBxt\b/.test(label) || ctor(node) === "Bxt") focus.bxt.push(nodeSummary(node, nodePath));
        if (/\bpWt\b/.test(label) || ctor(node) === "pWt") focus.pwt.push(nodeSummary(node, nodePath, /(general|General|skin|Skin|card|Card|seat|Seat|state|State|skill|Skill|effect|Effect|id|ID|name|Name|country|Country)/));
        if (/(_6i|SgsTabButton|hVi|dVt)/.test(label) || /洛神|倾国|离开|返回|菜单|查看战绩/.test(textOf(node))) {
          focus.skillButtons.push(nodeSummary(node, nodePath, /(skill|Skill|spell|Spell|text|Text|selected|state|State|button|Button|btn|Btn|enable|Enable|click|Click|data|Data|id|ID|type|Type)/));
        }
        if (/\bT6i\b/.test(label) || /使用|展示|弃置|火攻|闪/.test(textOf(node))) {
          focus.stackCards.push(nodeSummary(node, nodePath, /(card|Card|select|Select|state|State|id|ID|type|Type|text|Text|skin|Skin|data|Data|canBeSelected|from|to)/));
        }
      }, "TableGameScene", 0, 14);
    }
    if (windowLayer) {
      for (let i = 0; i < (windowLayer.numChildren || 0); i++) {
        const win = windowLayer.getChildAt(i);
        if (!win) continue;
        focus.windows.push(nodeSummary(win, "WindowLayer#" + i));
      }
    }
    const manager = tableScene && (tableScene.manager || tableScene._manager || null);
    const seatSummaries = [];
    if (manager && Array.isArray(manager.seats)) {
      for (let i = 0; i < manager.seats.length; i++) {
        const seat = manager.seats[i];
        if (!seat) continue;
        const isSelf = i === manager.selfSeatIndex;
        let general = null;
        try {
          const card = seat.generalCard || seat._generalCard || seat.characterCard || null;
          if (card) {
            general = {
              ctor: ctor(card),
              cardId: card.cardId || card.CardId || card.id || card.ID || null,
              cardName: card.cardName || card.name || card.Name || "",
              specifyName: card.specifyName || card.SpecifyName || ""
            };
          }
        } catch {}
        seatSummaries.push({
          index: i,
          isSelf,
          isDead: seat.isDead === true,
          canViewHandCard: seat.canViewHandCard === true,
          handCardCount: isSelf && Array.isArray(seat.handCards) ? seat.handCards.length : (seat.handCardCount || seat.HandCardCount || 0),
          handShowCount: Array.isArray(seat.handShowCards) ? seat.handShowCards.length : 0,
          watchCount: Array.isArray(seat.watchCards) ? seat.watchCards.length : 0,
          equipCount: Array.isArray(seat.equipCards) ? seat.equipCards.length : 0,
          judgeCount: Array.isArray(seat.judgeCards) ? seat.judgeCards.length : 0,
          general,
          fields: fieldSummary(seat, /(seat|Seat|index|Index|dead|Dead|view|View|show|Show|watch|Watch|equip|Equip|judge|Judge|general|General|state|State|phase|Phase|role|Role|country|Country|name|Name|hp|Hp|HP|sex|Sex|id|ID)/, 80)
        });
      }
    }
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        layaVersion: window.Laya && Laya.version || "",
        stage: stage ? { width: stage.width, height: stage.height, children: stage.numChildren } : null
      },
      table: tableScene ? {
        summary: nodeSummary(tableScene, "TableGameScene", /(scene|Scene|card|Card|motion|Motion|effect|Effect|result|Result|time|Time|right|Right|left|Left|hide|Hide|show|Show|state|State|status|Status|btn|Btn|button|Button|res|Res|skill|Skill)/),
        manager: manager ? {
          ctor: ctor(manager),
          isGameOver: manager.isGameOver === true || manager.IsGameOver === true,
          selfSeatIndex: manager.selfSeatIndex,
          seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
          fields: fieldSummary(manager, /(round|Round|phase|Phase|turn|Turn|seat|Seat|game|Game|state|State|status|Status|current|Current|skill|Skill|card|Card|select|Select|auto|Auto|id|ID|type|Type)/, 100)
        } : null,
        seats: seatSummaries
      } : null,
      focus,
      conclusions: {
        tableLifecycle: "Visible battle scene is an effective-visible TableGameScene under Laya.stage/LBi.",
        cardSkillController: "NBi is the main battle card/skill selector/controller; pBt hosts visible skill button items; uBt owns hand/equip/state-card UI lists and card selection handlers.",
        stackMotion: "Bxt holds stack/motion card UI state; visible T6i/iU children expose public card-action text such as use/show/discard.",
        resultWindow: "GameResultWindow appears under WindowLayer when manager.isGameOver is true; close/back controls are non-purchase but still change scene/window state."
      }
    };
  })()`;
}

function tsvEscape(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function nodeRows(value) {
  const lines = ["group\tpath\tlabel\ttext\teffectiveVisible\tevents\tfieldKeys\tmethods"];
  for (const [group, items] of Object.entries(value.focus || {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      lines.push([
        group,
        item.path,
        item.label,
        item.text,
        item.effectiveVisible,
        (item.events || []).map((event) => event.name).join("|"),
        Object.keys(item.fields || {}).join("|"),
        (item.methods || []).slice(0, 30).join("|")
      ].map(tsvEscape).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function readmeText(value) {
  const focus = value.focus || {};
  const manager = value.table?.manager || {};
  const lines = [];
  lines.push("# TableGameScene Focus Report");
  lines.push("");
  lines.push(`- Captured: ${value.capturedAt || ""}`);
  lines.push(`- Page: ${value.page?.title || ""} ${value.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${value.runtime?.resourceVersion || ""}; Laya=${value.runtime?.layaVersion || ""}`);
  lines.push(`- TableGameScene visible: ${!!value.table}`);
  lines.push(`- Manager: ${manager.ctor || ""}; isGameOver=${manager.isGameOver}; seats=${manager.seatCount}; selfSeatIndex=${manager.selfSeatIndex}`);
  lines.push(`- Focus counts: NBi=${focus.nbi?.length || 0}; uBt=${focus.ubt?.length || 0}; pBt=${focus.pbt?.length || 0}; skillButtons=${focus.skillButtons?.length || 0}; Bxt=${focus.bxt?.length || 0}; stackCards=${focus.stackCards?.length || 0}; pWt=${focus.pwt?.length || 0}; windows=${focus.windows?.length || 0}`);
  lines.push("");
  lines.push("## Current Mechanism Anchors");
  lines.push("");
  for (const text of Object.values(value.conclusions || {})) lines.push(`- ${text}`);
  lines.push("");
  lines.push("## Visible Skill/Button Texts");
  lines.push("");
  for (const item of (focus.skillButtons || []).filter((item) => item.text).slice(0, 40)) {
    lines.push(`- ${item.path}: ${item.label}; text=${item.text}; events=${(item.events || []).map((event) => event.name).join(",")}`);
  }
  lines.push("");
  lines.push("## Stack/Public Action Texts");
  lines.push("");
  for (const item of (focus.stackCards || []).filter((item) => item.text).slice(0, 40)) {
    lines.push(`- ${item.path}: ${item.label}; text=${item.text}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- This report is read-only and does not click, confirm, buy, leave, or submit.");
  lines.push("- Opponent hidden hand arrays are not expanded; seat summaries include counts and public/authorized fields only.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(focusExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const payload = { ok: true, target: result.target, value: result.value };
  await writeJson(path.join(dir, "tablegame-focus-report.json"), payload);
  await writeFile(path.join(dir, "tablegame-focus-nodes.tsv"), nodeRows(result.value || {}), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    scene: result.value?.table?.summary?.sceneName || result.value?.table?.summary?.label || "",
    isGameOver: result.value?.table?.manager?.isGameOver ?? null,
    seatCount: result.value?.table?.manager?.seatCount ?? null,
    skillButtons: result.value?.focus?.skillButtons?.length || 0,
    stackCards: result.value?.focus?.stackCards?.length || 0,
    windows: result.value?.focus?.windows?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
