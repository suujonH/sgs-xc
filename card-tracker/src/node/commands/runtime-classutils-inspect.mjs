import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_CLASSUTILS_INSPECT_DIR ||
      path.join(explorationRoot, `${timestampName()}-classutils-inspect`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  return String(value).replace(/\t|\r?\n/g, " ");
}

function classifyName(name) {
  const categories = [];
  const add = (value) => { if (!categories.includes(value)) categories.push(value); };
  if (/Scene$/.test(name)) add("scene");
  if (/GameScene$|TableGameScene|RaidTableGameScene/.test(name)) add("game-scene");
  if (/Window$/.test(name)) add("window");
  if (/View$|UI$|Item$|Panel$|Page$|Tab$|Btn$|Button$/.test(name)) add("ui");
  if (/(Req|Rep|Ntf|Msg|Protocol)$|^(C|S|Gs|Msg|Pub)/.test(name)) add("protocol");
  if (/Manager|Mgr|Controler|Controller/.test(name)) add("manager");
  if (/Skill|Spell|YanJiao|GuanXing|QiMen|ZhuGe|WoLong|BiFa|MilitaryOrders/.test(name)) add("skill");
  if (/Card|Poker|Select|Choose|Discard|Use|Hand|Deck|Pile|Zone|Move/.test(name)) add("card-flow");
  if (/Effect|Animation|Tween|Spine|Movie|Motion|Anim/.test(name)) add("effect");
  if (/Rogue|ShanHe|Shanhetu|Roguo|JiShi/.test(name)) add("rogue");
  if (/Bless|QiFu|Qifu/.test(name)) add("bless-qifu");
  if (/KanShu|Jbp|FaCai|Tree/.test(name)) add("kanshu");
  if (/YanJiao/.test(name)) add("yanjiao");
  if (/GuanXing|Qixing|QiXing/.test(name)) add("guanxing-qixing");
  if (/Laya\.|^laya\./.test(name)) add("laya-core");
  if (!categories.length) add("other");
  return categories;
}

function categoryCounts(rows) {
  const counts = {};
  for (const row of rows) {
    for (const category of row.categories || []) counts[category] = (counts[category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function buildMarkdown(data, outDir) {
  const lines = [];
  const classMap = data.classMap || {};
  const summary = data.summary || {};
  lines.push("# Laya ClassUtils Inspect");
  lines.push("");
  lines.push(`- Generated: ${data.generatedAt}`);
  lines.push(`- Page: ${data.pageTitle || ""} ${data.pageUrl || ""}`.trim());
  lines.push(`- Laya version: ${data.layaVersion || ""}`);
  lines.push(`- ClassUtils own keys: ${(data.classUtilsKeys || []).length}`);
  lines.push(`- ClassUtils._classMap entries: ${summary.classMapCount || 0}`);
  lines.push(`- Function entries: ${summary.functionEntryCount || 0}`);
  lines.push(`- Alias groups: ${summary.aliasGroupCount || 0}`);
  lines.push(`- Entries with aliases: ${summary.aliasEntryCount || 0}`);
  lines.push(`- Entries with prototype methods: ${summary.entriesWithPrototypeMethods || 0}`);
  lines.push(`- Entries with static fields: ${summary.entriesWithStaticFields || 0}`);
  lines.push("");
  lines.push("## ClassUtils Object");
  lines.push("");
  lines.push("| Key | Kind | Value |");
  lines.push("| --- | --- | --- |");
  for (const key of data.classUtilsKeys || []) {
    lines.push(`| \`${key.key}\` | ${key.kind || ""} | ${String(key.value || "").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## Category Counts");
  lines.push("");
  for (const [category, count] of Object.entries(summary.categoryCounts || {})) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("");
  lines.push("## Stable Retrieval Notes");
  lines.push("");
  lines.push("- Prefer `Laya.ClassUtils._classMap[registeredName]` or `Laya.ClassUtils.getClass(registeredName)` over minified constructor names.");
  lines.push("- `constructor.name` can change after minification; the registered string plus prototype method names/arity/source hashes is the stable anchor recorded here.");
  lines.push("- Alias groups show multiple registered strings mapped to the same function object in this runtime.");
  lines.push("- Re-run this report after a resource/version change; compare `classutils-entries.tsv` by registered name first, then by method signature hashes.");
  lines.push("");
  lines.push("## Largest Alias Groups");
  lines.push("");
  lines.push("| Count | Function | Registered names |");
  lines.push("| ---: | --- | --- |");
  for (const group of (classMap.aliasGroups || []).slice(0, 40)) {
    lines.push(`| ${group.names.length} | \`${group.functionName || ""}\` | ${group.names.map((name) => `\`${name}\``).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push(`- ${path.join(outDir, "classutils-inspect.json")}`);
  lines.push(`- ${path.join(outDir, "classutils-entries.tsv")}`);
  lines.push(`- ${path.join(outDir, "classutils-alias-groups.tsv")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function runtimeHelpersSource() {
  return String.raw`(() => {
    return {
      own: (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } },
      kindOf: (value) => {
        if (value == null) return String(value);
        if (Array.isArray(value)) return "array";
        if (value instanceof Map) return "map";
        if (value instanceof Set) return "set";
        return typeof value === "object" ? ((value.constructor && value.constructor.name) || "object") : typeof value;
      },
      fnv1a: (text) => {
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, "0");
      }
    };
  })()`;
}

function metadataExpression() {
  return String.raw`(() => {
    const helpers = ` + runtimeHelpersSource() + String.raw`;
    const own = helpers.own;
    const kindOf = helpers.kindOf;
    const fnv1a = helpers.fnv1a;
    const fnInfo = (fn) => {
      if (typeof fn !== "function") return null;
      let source = "";
      try { source = Function.prototype.toString.call(fn); } catch {}
      return {
        name: fn.name || "",
        arity: fn.length,
        sourceLength: source.length,
        sourceHash: source ? fnv1a(source) : "",
        native: /\[native code\]/.test(source)
      };
    };
    const valueSummary = (value) => {
      const kind = kindOf(value);
      if (value == null || kind === "string" || kind === "number" || kind === "boolean") return String(value);
      if (kind === "function") {
        const info = fnInfo(value);
        return "[Function " + (info.name || "anonymous") + " arity=" + info.arity + " hash=" + info.sourceHash + "]";
      }
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + kind + " keys=" + own(value).slice(0, 12).join(",") + "]";
    };
    const descriptorRows = (obj) => {
      const out = [];
      const descriptors = Object.getOwnPropertyDescriptors(obj || {});
      for (const name of Object.keys(descriptors).sort()) {
        const d = descriptors[name];
        let valueKind = "";
        let valueText = "";
        let fn = null;
        if ("value" in d) {
          valueKind = kindOf(d.value);
          valueText = valueSummary(d.value);
          fn = fnInfo(d.value);
        } else {
          valueKind = "accessor";
          valueText = [d.get ? "get" : "", d.set ? "set" : ""].filter(Boolean).join("/");
        }
        out.push({
          name,
          kind: valueKind,
          value: valueText,
          enumerable: !!d.enumerable,
          configurable: !!d.configurable,
          writable: !!d.writable,
          fn
        });
      }
      return out;
    };
    const classUtils = Laya && Laya.ClassUtils;
    const classMap = classUtils && classUtils._classMap || {};
    const names = own(classMap);
    const fnToIndex = new Map();
    const aliasGroups = [];
    for (const name of names) {
      let value = null;
      try { value = classMap[name]; } catch {}
      if (typeof value !== "function") continue;
      if (!fnToIndex.has(value)) {
        fnToIndex.set(value, aliasGroups.length);
        aliasGroups.push({ functionName: value.name || "", names: [], hash: fnInfo(value)?.sourceHash || "" });
      }
      aliasGroups[fnToIndex.get(value)].names.push(name);
    }
    for (const group of aliasGroups) group.names.sort();
    aliasGroups.sort((a, b) => b.names.length - a.names.length || a.names[0].localeCompare(b.names[0]));
    return {
      generatedAt: new Date().toISOString(),
      pageTitle: document.title,
      pageUrl: location.href,
      layaVersion: Laya && (Laya.version || Laya.Laya && Laya.Laya.version) || "",
      classUtilsKeys: descriptorRows(classUtils).map((row) => ({
        key: row.name,
        kind: row.kind,
        value: row.value,
        enumerable: row.enumerable,
        configurable: row.configurable,
        writable: row.writable
      })),
      classMap: {
        names,
        aliasGroups,
        entries: []
      }
    };
  })()`;
}

function entryBatchExpression(names) {
  return `(() => {
    const selectedNames = ${JSON.stringify(names)};
    const helpers = ${runtimeHelpersSource()};
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const kindOf = helpers.kindOf;
    const fnv1a = helpers.fnv1a;
    const fnInfo = (fn) => {
      if (typeof fn !== "function") return null;
      let source = "";
      try { source = Function.prototype.toString.call(fn); } catch {}
      return {
        name: fn.name || "",
        arity: fn.length,
        sourceLength: source.length,
        sourceHash: source ? fnv1a(source) : "",
        native: /\[native code\]/.test(source)
      };
    };
    const valueSummary = (value) => {
      const kind = kindOf(value);
      if (value == null || kind === "string" || kind === "number" || kind === "boolean") return String(value);
      if (kind === "function") {
        const info = fnInfo(value);
        return "[Function " + (info.name || "anonymous") + " arity=" + info.arity + " hash=" + info.sourceHash + "]";
      }
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + kind + " keys=" + own(value).slice(0, 12).join(",") + "]";
    };
    const descriptorRows = (obj) => {
      const out = [];
      const descriptors = Object.getOwnPropertyDescriptors(obj || {});
      for (const name of Object.keys(descriptors).sort()) {
        const d = descriptors[name];
        let value = undefined;
        let valueKind = "";
        let valueText = "";
        let fn = null;
        if ("value" in d) {
          value = d.value;
          valueKind = kindOf(value);
          valueText = valueSummary(value);
          fn = fnInfo(value);
        } else {
          valueKind = "accessor";
          valueText = [
            d.get ? "get" : "",
            d.set ? "set" : ""
          ].filter(Boolean).join("/");
        }
        out.push({
          name,
          kind: valueKind,
          value: valueText,
          enumerable: !!d.enumerable,
          configurable: !!d.configurable,
          writable: !!d.writable,
          fn
        });
      }
      return out;
    };
    const prototypeChain = (fn) => {
      const out = [];
      let proto = fn && fn.prototype;
      const seen = new Set();
      while (proto && !seen.has(proto) && proto !== Object.prototype) {
        seen.add(proto);
        const ctor = proto.constructor;
        out.push({
          ctorName: ctor && ctor.name || "",
          methodNames: descriptorRows(proto).filter((row) => row.kind === "function").map((row) => row.name),
          accessorNames: descriptorRows(proto).filter((row) => row.kind === "accessor").map((row) => row.name),
          fieldNames: descriptorRows(proto).filter((row) => row.kind !== "function" && row.kind !== "accessor").map((row) => row.name)
        });
        proto = Object.getPrototypeOf(proto);
      }
      return out;
    };
    const classMap = Laya && Laya.ClassUtils && Laya.ClassUtils._classMap || {};
    const entries = [];
    const fnToIndex = new Map();
    for (const name of own(classMap)) {
      let value = null;
      try { value = classMap[name]; } catch {}
      const isFn = typeof value === "function";
      if (isFn && !fnToIndex.has(value)) {
        fnToIndex.set(value, fnToIndex.size);
      }
    }
    for (const name of selectedNames) {
      let value = null;
      try { value = classMap[name]; } catch {}
      const isFn = typeof value === "function";
      const protoRows = isFn ? descriptorRows(value.prototype) : [];
      const staticRows = isFn ? descriptorRows(value) : [];
      const ownMethods = protoRows.filter((row) => row.kind === "function").map((row) => ({
        name: row.name,
        arity: row.fn && row.fn.arity,
        hash: row.fn && row.fn.sourceHash,
        sourceLength: row.fn && row.fn.sourceLength,
        native: row.fn && row.fn.native
      }));
      const staticMethods = staticRows.filter((row) => row.kind === "function").map((row) => ({
        name: row.name,
        arity: row.fn && row.fn.arity,
        hash: row.fn && row.fn.sourceHash,
        sourceLength: row.fn && row.fn.sourceLength,
        native: row.fn && row.fn.native
      }));
      const protoFields = protoRows.filter((row) => row.kind !== "function" && row.kind !== "accessor").map((row) => row.name);
      const staticFields = staticRows
        .filter((row) => row.kind !== "function" && row.kind !== "accessor" && !["length", "name", "prototype"].includes(row.name))
        .map((row) => ({ name: row.name, kind: row.kind, value: row.value }));
      const accessors = protoRows.filter((row) => row.kind === "accessor").map((row) => row.name);
      entries.push({
        registeredName: name,
        valueKind: kindOf(value),
        functionName: isFn ? (value.name || "") : "",
        functionHash: isFn ? (fnInfo(value).sourceHash || "") : "",
        functionSourceLength: isFn ? (fnInfo(value).sourceLength || 0) : 0,
        aliasGroupIndex: isFn ? fnToIndex.get(value) : -1,
        ownMethodCount: ownMethods.length,
        staticMethodCount: staticMethods.length,
        prototypeFieldCount: protoFields.length,
        staticFieldCount: staticFields.length,
        accessorCount: accessors.length,
        ownMethods,
        staticMethods,
        prototypeFields: protoFields,
        staticFields,
        accessors,
        prototypeChain: isFn ? prototypeChain(value) : []
      });
    }
    entries.sort((a, b) => a.registeredName.localeCompare(b.registeredName));
    return entries;
  })()`;
}

async function main() {
  const { value: data } = await evaluateOnSgs(metadataExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const names = data.classMap?.names || [];
  const batchSize = Number.parseInt(process.env.SGS_CLASSUTILS_BATCH_SIZE || "120", 10);
  const entries = [];
  for (let offset = 0; offset < names.length; offset += batchSize) {
    const batch = names.slice(offset, offset + batchSize);
    const { value: batchEntries } = await evaluateOnSgs(entryBatchExpression(batch), { timeoutMs: 60000, cdpTimeoutMs: 90000 });
    entries.push(...(batchEntries || []));
    if ((offset / batchSize) % 10 === 0) {
      console.error(`classutils batch ${Math.min(offset + batch.length, names.length)}/${names.length}`);
    }
  }
  const classifiedEntries = entries.map((row) => ({
    ...row,
    categories: classifyName(row.registeredName)
  }));
  const aliasGroups = data.classMap?.aliasGroups || [];
  data.classMap.entries = classifiedEntries;
  data.summary = {
    classMapCount: classifiedEntries.length,
    functionEntryCount: classifiedEntries.filter((row) => row.valueKind === "function").length,
    aliasGroupCount: aliasGroups.length,
    aliasEntryCount: aliasGroups.reduce((sum, group) => sum + Math.max(0, group.names.length - 1), 0),
    entriesWithPrototypeMethods: classifiedEntries.filter((row) => row.ownMethodCount > 0).length,
    entriesWithStaticFields: classifiedEntries.filter((row) => row.staticFieldCount > 0).length,
    categoryCounts: categoryCounts(classifiedEntries)
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "classutils-inspect.json"), data);

  const entryHeader = [
    "registeredName",
    "valueKind",
    "functionName",
    "functionHash",
    "functionSourceLength",
    "aliasGroupIndex",
    "categories",
    "ownMethodCount",
    "staticMethodCount",
    "prototypeFieldCount",
    "staticFieldCount",
    "accessorCount",
    "ownMethods",
    "staticMethods",
    "prototypeFields",
    "staticFields",
    "accessors",
    "prototypeChain"
  ];
  const entryLines = [entryHeader.join("\t")];
  for (const row of classifiedEntries) {
    entryLines.push(entryHeader.map((key) => {
      if (key === "ownMethods") return tsvEscape(row.ownMethods.map((item) => `${item.name}/${item.arity}/${item.hash}`));
      if (key === "staticMethods") return tsvEscape(row.staticMethods.map((item) => `${item.name}/${item.arity}/${item.hash}`));
      if (key === "staticFields") return tsvEscape(row.staticFields.map((item) => `${item.name}:${item.kind}=${item.value}`));
      if (key === "prototypeChain") return tsvEscape(row.prototypeChain.map((item) => `${item.ctorName}{${item.methodNames.length}}`));
      return tsvEscape(row[key]);
    }).join("\t"));
  }
  await writeFile(path.join(outDir, "classutils-entries.tsv"), `${entryLines.join("\n")}\n`, "utf8");

  const aliasHeader = ["count", "functionName", "hash", "registeredNames"];
  const aliasLines = [aliasHeader.join("\t")];
  for (const group of aliasGroups) {
    aliasLines.push([
      group.names.length,
      tsvEscape(group.functionName),
      tsvEscape(group.hash),
      tsvEscape(group.names)
    ].join("\t"));
  }
  await writeFile(path.join(outDir, "classutils-alias-groups.tsv"), `${aliasLines.join("\n")}\n`, "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(data, outDir), "utf8");

  console.log(JSON.stringify({
    outDir,
    classMapCount: data.summary.classMapCount,
    functionEntryCount: data.summary.functionEntryCount,
    classUtilsKeys: data.classUtilsKeys.length,
    aliasGroups: data.summary.aliasGroupCount,
    entriesWithAliases: data.summary.aliasEntryCount,
    categories: data.summary.categoryCounts
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
