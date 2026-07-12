import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const focusNames = [
  "YanJiao",
  "YanJiaoWindow",
  "GuanXing",
  "GuanXingPo",
  "GuanXingPoker",
  "GuanXingRace",
  "GuanXingWindow",
  "QiMenBaZhen",
  "WoLongZhuGeLiang",
  "RogueSmallMapScene",
  "RogueLikeGameScene",
  "RogueFightWindow",
  "RogueJiShiWindow",
  "KanShuWindow",
  "BlessNewWindow",
  "BlessNewWindowView",
  "BlessNewShopWindow",
  "TableGameScene",
  "GeneralTrialScene",
  "GeneralTrialChallengeWin",
  "ModeScene",
  "NewPaiWeiScene",
  "SelectCardWindow",
  "SelectCardByMaxWindow",
  "SelectCardByTypeWindow",
  "SelectCardCountWindow",
  "SelectBaseGeneralWindow",
  "SpellMultiSelectorWindow",
  "SpellWxMultiSelectorWindow",
  "SkillSelectorWindow",
  "SkillPopUpWindow",
  "SkillBiFaWindow",
  "SkillBiFaRogueWindow",
  "MilitaryOrdersSelectWindow",
  "MilitaryOrdersExecutionWindow",
  "GongXinWindow",
  "GuZhengSelectCardWindow",
  "SwapCardWindow",
  "SwapTopCardWindow",
  "SwitchCardWindow",
  "SelectTurnCardWindow",
  "PoXiCardWindow",
  "PinDianWindow",
  "PinDianMultiWindow"
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestInventoryDir() {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith("-inventory")) continue;
    const fullPath = path.join(explorationRoot, entry.name);
    if (await exists(path.join(fullPath, "inventory-full.json"))) candidates.push(fullPath);
  }
  candidates.sort();
  if (!candidates.length) throw new Error(`No inventory directory found under ${explorationRoot}`);
  return candidates.at(-1);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fnDescriptors(descriptors = []) {
  return descriptors.filter((item) => item.type === "function").map((item) => ({
    name: item.name,
    fnName: item.fn?.name || "",
    arity: item.fn?.arity,
    sourceLength: item.fn?.sourceLength,
    sourceHash: item.fn?.sourceHash
  }));
}

function classifyName(name) {
  const groups = [];
  if (/Scene$/.test(name)) groups.push("scene");
  if (/Window$/.test(name)) groups.push("window");
  if (/(Req|Rep|Ntf)$/.test(name)) groups.push("protocol");
  if (/Manager|Mgr/.test(name)) groups.push("manager");
  if (/Skill|Spell|YanJiao|GuanXing|QiMen|ZhuGe|WoLong/.test(name)) groups.push("skill");
  if (/Rogue|ShanHe|Shanhetu|山河/.test(name)) groups.push("rogue");
  if (/Card|Select|Choose|Discard|Use/.test(name)) groups.push("card-flow");
  if (/Effect|Animation|Tween|Spine|Movie/.test(name)) groups.push("effect");
  return groups.length ? groups : ["other"];
}

async function buildClassIndex(inventoryDir, outDir) {
  const detailsDir = path.join(inventoryDir, "class-details");
  const files = (await readdir(detailsDir)).filter((name) => name.endsWith(".json")).sort();
  const rows = [];
  for (const file of files) {
    const batch = await readJson(path.join(detailsDir, file));
    for (const detail of batch.classDetails || []) {
      const protoFns = fnDescriptors(detail.prototypeDescriptors);
      const staticFns = fnDescriptors(detail.staticDescriptors);
      const inheritedFns = [];
      for (const level of detail.prototypeChain || []) {
        if (level.level === 0) continue;
        inheritedFns.push(...fnDescriptors(level.descriptors).map((fn) => ({ ...fn, level: level.level, ctor: level.ctor })));
      }
      rows.push({
        name: detail.name,
        exists: !!detail.exists,
        functionName: detail.functionName || "",
        ctor: detail.ctor || "",
        groups: classifyName(detail.name),
        protoMethodCount: protoFns.length,
        staticMethodCount: staticFns.length,
        inheritedMethodCount: inheritedFns.length,
        protoMethods: protoFns,
        staticMethods: staticFns,
        inheritedMethods: inheritedFns.slice(0, 240)
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const tsvLines = [
    [
      "registeredName",
      "functionName",
      "groups",
      "protoMethodCount",
      "staticMethodCount",
      "inheritedMethodCount",
      "protoMethods",
      "staticMethods"
    ].join("\t")
  ];
  for (const row of rows) {
    tsvLines.push([
      row.name,
      row.functionName,
      row.groups.join(","),
      row.protoMethodCount,
      row.staticMethodCount,
      row.inheritedMethodCount,
      row.protoMethods.map((m) => `${m.name}:${m.sourceHash || ""}`).join(";"),
      row.staticMethods.map((m) => `${m.name}:${m.sourceHash || ""}`).join(";")
    ].join("\t"));
  }

  await writeJson(path.join(outDir, "all-registered-class-index.json"), rows);
  await writeFile(path.join(outDir, "all-registered-class-index.tsv"), `${tsvLines.join("\n")}\n`, "utf8");

  const counts = rows.reduce((acc, row) => {
    for (const group of row.groups) acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});

  return { rows, counts };
}

function buildLiveExpression(names) {
  return `(() => {
    const names = ${JSON.stringify(names)};
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const safeRead = (o, k, fallback = "") => { try { return o?.[k] ?? fallback; } catch { return fallback; } };
    const protoMethodNames = (o) => own(o).filter((name) => {
      try {
        const d = Object.getOwnPropertyDescriptor(o, name);
        return typeof d?.value === "function";
      } catch {
        return false;
      }
    });
    const hashString = (text) => {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    const sourceOf = (fn) => {
      if (typeof fn !== "function") return null;
      const source = Function.prototype.toString.call(fn);
      return { name: fn.name || "", arity: fn.length, sourceLength: source.length, sourceHash: hashString(source), source };
    };
    const descSources = (o) => own(o).map((name) => {
      try {
        const d = Object.getOwnPropertyDescriptor(o, name);
        const item = { name, kind: d?.get || d?.set ? "accessor" : "value" };
        if (d?.get) item.get = sourceOf(d.get);
        if (d?.set) item.set = sourceOf(d.set);
        if ("value" in d) {
          item.type = typeof d.value;
          item.ctor = ctor(d.value);
          if (typeof d.value === "function") item.fn = sourceOf(d.value);
        }
        return item;
      } catch (error) {
        return { name, error: String(error?.message || error) };
      }
    });
    const classDump = (registeredName, cls) => {
      const reverseNames = Object.entries(Laya.ClassUtils?._classMap || {})
        .filter(([, value]) => value === cls)
        .map(([name]) => name)
        .sort();
      const chain = [];
      let p = cls?.prototype || null;
      for (let level = 0; level < 8 && p; level++, p = Object.getPrototypeOf(p)) {
        chain.push({ level, ctor: ctor(p), descriptors: descSources(p) });
      }
      return {
        registeredName,
        exists: !!cls,
        functionName: cls?.name || "",
        reverseNames,
        constructorSource: sourceOf(cls),
        staticDescriptors: descSources(cls),
        prototypeChain: chain
      };
    };
    const nodeSummary = (node, path, depth) => {
      if (!node) return null;
      return {
        path, depth,
        ctor: ctor(node),
        name: safeRead(node, "name", ""),
        sceneName: safeRead(node, "sceneName", "") || safeRead(node, "SceneName", ""),
        className: safeRead(node, "_className_", ""),
        uiid: safeRead(node, "_uiid", ""),
        resName: safeRead(node, "_resName", ""),
        visible: safeRead(node, "visible", false),
        alpha: safeRead(node, "alpha", null),
        x: safeRead(node, "x", null), y: safeRead(node, "y", null), width: safeRead(node, "width", null), height: safeRead(node, "height", null),
        childCount: safeRead(node, "numChildren", 0),
        ownKeys: own(node).slice(0, 120),
        protoMethods: protoMethodNames(Object.getPrototypeOf(node)).slice(0, 160)
      };
    };
    const stageNodes = [];
    const walk = (node, path, depth) => {
      if (!node || stageNodes.length >= 900 || depth > 8) return;
      stageNodes.push(nodeSummary(node, path, depth));
      for (let i = 0; i < (node.numChildren || 0); i++) {
        const child = node.getChildAt(i);
        const label = child?.sceneName || child?._className_ || child?.name || ctor(child) || ("#" + i);
        walk(child, path + "/" + label + "#" + i, depth + 1);
      }
    };
    walk(Laya.stage, "Laya.stage", 0);
    const classMap = Laya.ClassUtils?._classMap || {};
    return {
      capturedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        layaVersion: Laya.version || "",
        classMapCount: Object.keys(classMap).length,
        scene: (() => {
          const sceneLayer = Array.from({ length: Laya.stage?.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
            .find((node) => /LBi|SceneLayer/.test([node.name, ctor(node)].join(" ")));
          const current = sceneLayer && sceneLayer.numChildren ? sceneLayer.getChildAt(sceneLayer.numChildren - 1) : null;
          return nodeSummary(current, "currentScene", 0);
        })(),
        stageNodes
      },
      classes: names.map((name) => classDump(name, classMap[name])).filter((item) => item.exists),
      missingNames: names.filter((name) => !classMap[name])
    };
  })()`;
}

function summarizeSourceDump(dump) {
  const lines = [];
  lines.push("# Focused Runtime Source Dump");
  lines.push("");
  lines.push(`- Captured: ${dump.capturedAt}`);
  lines.push(`- Page: ${dump.page?.title || ""} ${dump.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${dump.runtime?.resourceVersion || ""}`);
  lines.push(`- Laya: ${dump.runtime?.layaVersion || ""}`);
  lines.push(`- ClassMap count: ${dump.runtime?.classMapCount || 0}`);
  lines.push(`- Current scene: ${dump.runtime?.scene?.sceneName || dump.runtime?.scene?.className || dump.runtime?.scene?.ctor || ""}`);
  lines.push(`- Dumped classes: ${dump.classes.length}`);
  lines.push(`- Missing requested names: ${dump.missingNames.length ? dump.missingNames.join(", ") : "(none)"}`);
  lines.push("");
  for (const item of dump.classes) {
    lines.push(`## ${item.registeredName}`);
    lines.push("");
    lines.push(`- functionName: ${item.functionName}`);
    lines.push(`- reverse registered names: ${item.reverseNames.join(", ") || "(none)"}`);
    lines.push(`- constructor hash: ${item.constructorSource?.sourceHash || ""}, length=${item.constructorSource?.sourceLength || 0}`);
    const ownProto = item.prototypeChain[0]?.descriptors || [];
    const methods = ownProto
      .filter((d) => d.fn)
      .map((d) => `${d.name}:${d.fn.sourceHash}:${d.fn.sourceLength}`);
    lines.push(`- own prototype methods (${methods.length}): ${methods.join(", ") || "(none)"}`);
    const inherited = item.prototypeChain.slice(1).map((level) => ({
      level: level.level,
      ctor: level.ctor,
      methodCount: level.descriptors.filter((d) => d.fn).length
    }));
    lines.push(`- inherited levels: ${inherited.map((level) => `${level.level}:${level.ctor}:${level.methodCount}`).join(", ") || "(none)"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inventoryDir = path.resolve(process.env.SGS_RUNTIME_INVENTORY_DIR || await latestInventoryDir());
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_FOLLOWUP_DIR ||
      path.join(explorationRoot, `${timestampName()}-followup-report`)
  );
  await mkdir(outDir, { recursive: true });

  const index = await buildClassIndex(inventoryDir, outDir);
  const { target, value: sourceDump } = await evaluateOnSgs(buildLiveExpression(focusNames), {
    timeoutMs: 90000,
    cdpTimeoutMs: 120000
  });

  await writeJson(path.join(outDir, "focused-source-dump.json"), { target, value: sourceDump });
  await writeFile(path.join(outDir, "focused-source-dump.md"), summarizeSourceDump(sourceDump), "utf8");

  const readme = [
    "# Runtime Follow-up Report",
    "",
    `- Inventory source: ${inventoryDir}`,
    `- Page: ${target.title} ${target.url}`,
    `- Class index rows: ${index.rows.length}`,
    `- Group counts: ${Object.entries(index.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "## Files",
    "",
    `- all-registered-class-index.json: full searchable registered-name/method/hash index`,
    `- all-registered-class-index.tsv: spreadsheet-friendly registered-name/method/hash index`,
    `- focused-source-dump.json: live Function.toString source for target classes and current stage summary`,
    `- focused-source-dump.md: human summary of focused source dump`,
    "",
    "## Notes",
    "",
    "- Registered names are the stable primary key; minified function names are evidence, not anchors.",
    "- Full method source is dumped only for focused classes because all 5527 classes would be too large for routine live pulls.",
    "- Source hashes allow comparing the same registered class after a new obfuscation pass.",
    ""
  ].join("\n");
  await writeFile(path.join(outDir, "README.md"), readme, "utf8");

  console.log(JSON.stringify({
    outDir,
    inventoryDir,
    classIndexRows: index.rows.length,
    groupCounts: index.counts,
    sourceClasses: sourceDump.classes.length,
    missingNames: sourceDump.missingNames,
    currentScene: sourceDump.runtime?.scene?.sceneName || sourceDump.runtime?.scene?.className || sourceDump.runtime?.scene?.ctor || ""
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
