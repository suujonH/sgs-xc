import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, selectSgsTarget, valueFromEvaluation } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-hover-popup-sample.mjs";

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
    process.env.SGS_HOVER_POPUP_PROBE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-hover-popup-probe`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function evaluate(session, expression, timeoutMs = 45000) {
  const evaluated = await session.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs
    },
    timeoutMs + 15000
  );
  return valueFromEvaluation(evaluated);
}

function browserHoverCandidateFinder(limit) {
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
    const effectiveVisible = (node) => hiddenReasons(node).length === 0;
    const canvas = document.querySelector("canvas");
    const rect = canvas?.getBoundingClientRect?.();
    const stageWidth = Number(Laya.stage?.width) || 0;
    const stageHeight = Number(Laya.stage?.height) || 0;
    const toPage = (x, y) => ({
      x: rect.left + x * rect.width / stageWidth,
      y: rect.top + y * rect.height / stageHeight
    });
    const nodeBounds = (node) => {
      try {
        const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
        const width = Number(node.width) || 0;
        const height = Number(node.height) || 0;
        if (!p || width < 6 || height < 6) return null;
        const center = toPage(p.x + width / 2, p.y + height / 2);
        const topLeft = toPage(p.x, p.y);
        const bottomRight = toPage(p.x + width, p.y + height);
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
        if (center.x < rect.left || center.y < rect.top || center.x > rect.right || center.y > rect.bottom) return null;
        return {
          stageX: p.x,
          stageY: p.y,
          width,
          height,
          pageX: center.x,
          pageY: center.y,
          pageLeft: topLeft.x,
          pageTop: topLeft.y,
          pageRight: bottomRight.x,
          pageBottom: bottomRight.y
        };
      } catch {
        return null;
      }
    };
    const safeFields = (node) => {
      const out = {};
      for (const key of own(node)) {
        if (!/(card|Card|skill|Skill|tip|Tip|popup|Popup|pop|Pop|window|Window|desc|Desc|text|Text|name|Name|data|Data|select|Select|over|Over|hover|Hover|btn|Btn|button|Button|boss|Boss)/.test(key)) continue;
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        try {
          const value = node[key];
          const type = typeof value;
          if (value == null || type === "string" || type === "number" || type === "boolean") out[key] = value;
          else if (type === "function") out[key] = `[Function ${value.name || ""}/${value.length}]`;
          else out[key] = `[${ctor(value) || type}]`;
        } catch {
          out[key] = "[throws]";
        }
        if (Object.keys(out).length >= 18) break;
      }
      return out;
    };
    const scoreNode = (summary) => {
      const hay = [
        summary.path,
        summary.label,
        summary.text,
        Object.keys(summary.fields || {}).join(" "),
        Object.values(summary.fields || {}).join(" ")
      ].join(" ");
      let score = 0;
      if (/Skill|skill|Spell|spell/.test(hay)) score += 80;
      if (/Card|card|Poker|poker/.test(hay)) score += 75;
      if (/Tip|tip|Tips|Desc|desc|Popup|PopUp|Window/.test(hay)) score += 55;
      if (/Select|select|Choose|choose/.test(hay)) score += 45;
      if (/Button|button|Btn|btn|start|Start|boss|Boss/.test(hay)) score += 25;
      if (summary.text) score += 20;
      if (/modalBg|Laya\.stage|SceneLayer|WindowLayer$|mWt$|LBi$/.test(hay)) score -= 100;
      if (summary.bounds.width > 600 || summary.bounds.height > 500) score -= 35;
      if (summary.bounds.width < 12 || summary.bounds.height < 12) score -= 15;
      return score;
    };
    const children = [];
    for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
      try { children.push(Laya.stage.getChildAt(i)); } catch {}
    }
    const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
    const windowLayer = children.find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" ")));
    let currentScene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const node = sceneLayer.getChildAt(i);
        if (effectiveVisible(node)) { currentScene = node; break; }
      }
    }
    const candidates = [];
    const seen = new Set();
    const walk = (node, nodePath, depth) => {
      if (!node || depth > 12 || seen.has(node) || candidates.length > 600) return;
      seen.add(node);
      if (effectiveVisible(node)) {
        const bounds = rect && stageWidth && stageHeight ? nodeBounds(node) : null;
        if (bounds) {
          const text = (() => { try { return typeof node.text === "string" ? node.text.slice(0, 120) : ""; } catch { return ""; } })();
          const summary = {
            path: nodePath,
            label: labelOf(node),
            ctor: ctor(node),
            name: node.name || "",
            className: node._className_ || "",
            sceneName: node.sceneName || node.SceneName || "",
            uiid: node._uiid || "",
            resName: node._resName || "",
            text,
            fields: safeFields(node),
            bounds
          };
          const score = scoreNode(summary);
          if (score > 0) candidates.push({ ...summary, score });
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          const childName = child?.name || child?._className_ || child?.sceneName || ctor(child) || ("#" + i);
          walk(child, `${nodePath}/${childName}#${i}`, depth + 1);
        }
      }
    };
    walk(windowLayer, "WindowLayer", 0);
    walk(currentScene, "CurrentScene", 0);
    candidates.sort((a, b) => b.score - a.score || (a.bounds.width * a.bounds.height) - (b.bounds.width * b.bounds.height));
    return {
      time: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      canvas: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      stage: { width: stageWidth, height: stageHeight },
      scene: {
        sceneName: currentScene?.sceneName || currentScene?.SceneName || currentScene?.name || "",
        className: currentScene?._className_ || "",
        ctor: ctor(currentScene)
      },
      windowLayer: windowLayer ? { label: labelOf(windowLayer), childCount: windowLayer.numChildren || 0, effectiveVisible: effectiveVisible(windowLayer) } : null,
      candidates: candidates.slice(0, limit)
    };
}

function candidateExpression(limit) {
  return `(${browserHoverCandidateFinder.toString()})(${JSON.stringify(limit)})`;
}

function readmeText(payload) {
  const live = payload.dump?.value?.status || {};
  const lines = [];
  lines.push("# Runtime Hover / Popup Probe");
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Scene: ${payload.candidates?.scene?.sceneName || ""}`);
  lines.push(`- Candidate count: ${payload.candidates?.candidates?.length || 0}`);
  lines.push(`- Moved count: ${payload.moves?.length || 0}`);
  lines.push(`- Method records: ${live.methodRecords || 0}`);
  lines.push(`- Mouse records: ${live.mouseRecords || 0}`);
  lines.push(`- Laya event records: ${live.eventRecords || 0}`);
  lines.push(`- Total records: ${live.recordCount || 0}`);
  lines.push("");
  lines.push("This probe only sends CDP `Input.dispatchMouseEvent` with `type=mouseMoved`. It does not click, press, confirm, discard, use skills, or buy anything.");
  lines.push("");
  lines.push("## Moved Targets");
  lines.push("");
  for (const move of payload.moves || []) {
    lines.push(`- ${move.index}. score=${move.score} page=(${move.pageX.toFixed(1)}, ${move.pageY.toFixed(1)}) ${move.label} ${move.path} text=${move.text || ""}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const candidateLimit = Number(process.env.SGS_HOVER_PROBE_CANDIDATES || 24);
  const moveLimit = Number(process.env.SGS_HOVER_PROBE_MOVES || 10);
  const settleMs = Number(process.env.SGS_HOVER_PROBE_SETTLE_MS || 550);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });

  const target = await selectSgsTarget();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    await session.send("Runtime.enable");
    await session.send("Page.bringToFront").catch(() => {});
    const installOptions = {
      maxRecords: Number(process.env.SGS_HOVER_POPUP_MAX_RECORDS || 5000),
      mouseIntervalMs: Number(process.env.SGS_HOVER_POPUP_MOUSE_INTERVAL_MS || 120),
      recordAllMouse: true
    };
    const install = await evaluate(session, installExpression(installOptions));
    const candidates = await evaluate(session, candidateExpression(candidateLimit));
    const moves = [];
    const selected = (candidates.candidates || []).slice(0, moveLimit);
    for (let index = 0; index < selected.length; index++) {
      const item = selected[index];
      const x = Number(item.bounds.pageX);
      const y = Number(item.bounds.pageY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" }, 10000);
      moves.push({
        index,
        score: item.score,
        pageX: x,
        pageY: y,
        label: item.label,
        path: item.path,
        text: item.text || "",
        bounds: item.bounds
      });
      await sleep(settleMs);
    }
    const dump = await evaluate(session, dumpExpression());
    const stop = process.env.SGS_HOVER_PROBE_KEEP_INSTALLED === "1"
      ? { skipped: true }
      : await evaluate(session, stopExpression());
    const payload = { target, install, candidates, moves, dump: { value: dump }, stop };
    await writeJson(path.join(dir, "hover-popup-probe.json"), payload);
    await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
    console.log(JSON.stringify({
      dir,
      scene: candidates.scene,
      candidates: candidates.candidates?.length || 0,
      moves: moves.length,
      methodRecords: dump.status?.methodRecords || 0,
      mouseRecords: dump.status?.mouseRecords || 0,
      eventRecords: dump.status?.eventRecords || 0,
      records: dump.records?.length || 0,
      errors: dump.errors?.length || 0
    }, null, 2));
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
