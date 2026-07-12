import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const enumNamePattern = /(?:^|[A-Z_])(Id|ID|Type|Status|State|Zone|Msg|MSG|Protocol|Skill|Card|Record|Enum|Event|Code|Kind|Mode|Opt|OPT|Flag|FLAG|Const|Name)$/;
const focusClassPattern = /YanJiao|QiXing|Qixing|GuanXing|TableGameScene|BlessNewWindow|KanShu|Rogue|SelectCard|SkillSelector|SkillPopUp|GeneralTrial|ModeScene|WindowManager|SceneManager/;

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

async function latestAllSourceContext() {
  const dir = process.env.SGS_RUNTIME_ALL_SOURCE_CONTEXT_DIR || await latestDir("-all-source-context");
  if (!dir) return null;
  return {
    dir,
    indexPath: path.join(dir, "all-source-index.json"),
    chunksDir: path.join(dir, "source-chunks"),
    summaryPath: path.join(dir, "all-source-summary.md")
  };
}

async function latestAllNamesReport() {
  const dir = process.env.SGS_RUNTIME_ALL_NAMES_DIR || await latestDir("-all-names-report");
  if (!dir) return null;
  return {
    dir,
    classesPath: path.join(dir, "all-registered-classes.json"),
    classes: await readJson(path.join(dir, "all-registered-classes.json"))
  };
}

async function loadChunkClasses(chunksDir) {
  const files = (await readdir(chunksDir)).filter((name) => name.endsWith(".json")).sort();
  const classes = [];
  for (const file of files) {
    const filePath = path.join(chunksDir, file);
    const value = await readJson(filePath);
    for (const cls of value.classes || []) classes.push({ ...cls, __chunkFile: filePath });
  }
  return { files, classes };
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(";").replace(/\r?\n/g, " ").replace(/\t/g, " ");
  if (value && typeof value === "object") return JSON.stringify(value).replace(/\r?\n/g, " ").replace(/\t/g, " ");
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function escapeCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

function primitiveDescriptorValue(descriptor) {
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
  if (descriptor.value === null) return { type: "null", value: null, text: "null" };
  if (["string", "number", "boolean"].includes(descriptor.type)) {
    return { type: descriptor.type, value: descriptor.value, text: JSON.stringify(descriptor.value) };
  }
  return null;
}

function descriptorKind(descriptor) {
  if (descriptor.fn) return "method";
  if (descriptor.get || descriptor.set) return "accessor";
  return "value";
}

function buildFunctionNameMap(indexClasses, chunkClasses) {
  const out = new Map();
  const add = (functionName, registeredName) => {
    if (!functionName || !registeredName) return;
    if (!out.has(functionName)) out.set(functionName, new Set());
    out.get(functionName).add(registeredName);
  };
  for (const cls of indexClasses || []) {
    add(cls.functionName, cls.className);
    for (const reverseName of cls.reverseNames || []) add(cls.functionName, reverseName);
  }
  for (const cls of chunkClasses || []) {
    add(cls.functionName, cls.registeredName);
    for (const reverseName of cls.reverseNames || []) add(cls.functionName, reverseName);
  }
  return out;
}

function registeredNamesFor(functionNameMap, ctor) {
  return Array.from(functionNameMap.get(ctor) || []).sort();
}

function inheritedMethodOwners(allNameClass) {
  const owners = [];
  for (const item of allNameClass?.inheritedMethods || []) {
    const text = typeof item === "string" ? item : item?.name || "";
    const dot = text.indexOf(".");
    if (dot > 0) owners.push(text.slice(0, dot));
  }
  return Array.from(new Set(owners)).sort();
}

function buildDescriptorRows(chunkClass, functionNameMap) {
  const rows = [];
  for (const descriptor of chunkClass.staticDescriptors || []) {
    if (["prototype", "length", "name"].includes(descriptor.name)) continue;
    const primitive = primitiveDescriptorValue(descriptor);
    rows.push({
      className: chunkClass.registeredName,
      functionName: chunkClass.functionName,
      member: descriptor.name,
      ownerLevel: "static",
      ownerCtor: chunkClass.functionName,
      ownerRegisteredNames: registeredNamesFor(functionNameMap, chunkClass.functionName),
      descriptorKind: descriptorKind(descriptor),
      valueType: primitive?.type || descriptor.type || "",
      valueText: primitive ? primitive.text : "",
      exactPrimitive: !!primitive,
      enumerable: descriptor.enumerable === true,
      source: "static-descriptor"
    });
  }
  for (const chainItem of chunkClass.prototypeChain || []) {
    const level = Number(chainItem.level || 0);
    for (const descriptor of chainItem.descriptors || []) {
      if (descriptor.name === "constructor") continue;
      rows.push({
        className: chunkClass.registeredName,
        functionName: chunkClass.functionName,
        member: descriptor.name,
        ownerLevel: level,
        ownerCtor: chainItem.ctor || "",
        ownerRegisteredNames: registeredNamesFor(functionNameMap, chainItem.ctor),
        descriptorKind: descriptorKind(descriptor),
        valueType: descriptor.type || "",
        valueText: "",
        exactPrimitive: false,
        enumerable: descriptor.enumerable === true,
        source: level === 0 ? "own-prototype-descriptor" : "inherited-prototype-descriptor"
      });
    }
  }
  return rows;
}

function classLooksEnumish(className, exactPrimitiveCount, staticDescriptorCount) {
  return exactPrimitiveCount >= 80 || (exactPrimitiveCount >= 8 && (enumNamePattern.test(className) || /Id|ID|Type|Status|Zone|Msg|Protocol|Skill|Card|Record|Enum|Event|Mode|Opt|Flag/.test(className))) || staticDescriptorCount >= 200;
}

function summarizeClass(indexClass, chunkClass, descriptorRows, allNameClass) {
  const chain = (chunkClass?.prototypeChain || []).map((item) => ({
    level: Number(item.level || 0),
    ctor: item.ctor || "",
    descriptorCount: item.descriptors?.length || 0
  }));
  const inheritedOwners = inheritedMethodOwners(allNameClass);
  const exactPrimitiveCount = descriptorRows.filter((row) => row.exactPrimitive).length;
  const staticDescriptorCount = descriptorRows.filter((row) => row.ownerLevel === "static").length;
  const inheritedDescriptorCount = descriptorRows.filter((row) => typeof row.ownerLevel === "number" && row.ownerLevel > 0).length;
  const ownDescriptorCount = descriptorRows.filter((row) => row.ownerLevel === 0).length;
  const sourceOnlyFieldCount = (indexClass.fieldRows || []).filter((field) => !descriptorRows.some((row) => row.member === field.name)).length;
  const unknownPrivateCount = (indexClass.fieldRows || []).filter((field) => field.confidence === "unknown-private").length;
  const riskFieldCount = (indexClass.fieldRows || []).filter((field) => field.risk === true || /hidden|handCards|watchCards|cardsInHand/i.test(`${field.name} ${field.meaning}`)).length;
  const roleSet = new Set((indexClass.methodContexts || []).flatMap((method) => method.roles || []));
  return {
    className: indexClass.className,
    functionName: indexClass.functionName,
    categories: indexClass.categories || [],
    reverseNames: indexClass.reverseNames || [],
    chain,
    baseCtors: Array.from(new Set([
      ...chain.filter((item) => item.level > 0).map((item) => item.ctor),
      ...inheritedOwners
    ].filter(Boolean))).sort(),
    inheritedMethodOwners: inheritedOwners,
    inheritedMethodCount: allNameClass?.inheritedMethodCount || inheritedOwners.length,
    ownDescriptorCount,
    inheritedDescriptorCount,
    staticDescriptorCount,
    exactPrimitiveCount,
    enumLike: classLooksEnumish(indexClass.className, exactPrimitiveCount, staticDescriptorCount),
    fieldCount: indexClass.counts?.fields || indexClass.fieldRows?.length || 0,
    sourceOnlyFieldCount,
    unknownPrivateCount,
    riskFieldCount,
    methodCount: indexClass.counts?.methods || indexClass.methodContexts?.length || 0,
    eventBindingCount: indexClass.counts?.eventBindings || indexClass.eventBindings?.length || 0,
    roles: Array.from(roleSet).sort()
  };
}

function buildFieldOwnerRows(indexClass, descriptorRowsByMember, enumValueByMember) {
  const rows = [];
  for (const field of indexClass.fieldRows || []) {
    const descriptors = descriptorRowsByMember.get(field.name) || [];
    const exact = enumValueByMember.get(field.name);
    const inherited = descriptors.filter((descriptor) => typeof descriptor.ownerLevel === "number" && descriptor.ownerLevel > 0);
    const own = descriptors.filter((descriptor) => descriptor.ownerLevel === 0);
    const statics = descriptors.filter((descriptor) => descriptor.ownerLevel === "static");
    let ownerStatus = "source-only";
    if (exact) ownerStatus = "exact-static-constant";
    else if (statics.length) ownerStatus = "static-descriptor";
    else if (own.length) ownerStatus = "own-prototype-descriptor";
    else if (inherited.length) ownerStatus = "inherited-prototype-descriptor";
    rows.push({
      className: indexClass.className,
      functionName: indexClass.functionName,
      categories: indexClass.categories || [],
      fieldName: field.name,
      ownerStatus,
      descriptorSources: descriptors.map((descriptor) => `${descriptor.source}:${descriptor.ownerCtor}:${descriptor.member}`),
      ownerCtors: Array.from(new Set(descriptors.map((descriptor) => descriptor.ownerCtor).filter(Boolean))).sort(),
      ownerRegisteredNames: Array.from(new Set(descriptors.flatMap((descriptor) => descriptor.ownerRegisteredNames || []))).sort(),
      exactValueType: exact?.valueType || "",
      exactValueText: exact?.valueText || "",
      sourceConfidence: field.confidence || "",
      enhancedConfidence: exact ? "exact-static-constant" : ownerStatus === "inherited-prototype-descriptor" ? "inherited-descriptor" : field.confidence || "source-context",
      meaning: exact ? `static constant / enum value from runtime descriptor: ${indexClass.className}.${field.name} = ${exact.valueText}` : field.meaning || "",
      risk: field.risk === true || /hidden|handCards|watchCards|cardsInHand/i.test(`${field.name} ${field.meaning}`),
      operationsText: field.operationsText || "",
      methods: field.methodNames || [],
      roles: field.roles || [],
      protocolFields: field.protocolFields || [],
      eventBindings: field.eventBindings || [],
      snippets: field.snippets || []
    });
  }
  return rows;
}

function buildEnumValueRows(classSummary, descriptorRows) {
  if (!classSummary.enumLike) return [];
  return descriptorRows
    .filter((row) => row.exactPrimitive)
    .map((row) => ({
      className: row.className,
      functionName: row.functionName,
      constantName: row.member,
      valueType: row.valueType,
      valueText: row.valueText,
      ownerCtor: row.ownerCtor,
      enumerable: row.enumerable,
      source: row.source,
      reverseNames: classSummary.reverseNames,
      categories: classSummary.categories
    }));
}

function buildClassInheritanceTsv(rows) {
  const header = [
    "className",
    "functionName",
    "categories",
    "reverseNames",
    "baseCtors",
    "inheritedMethodOwners",
    "prototypeChain",
    "ownDescriptorCount",
    "inheritedDescriptorCount",
    "staticDescriptorCount",
    "exactPrimitiveCount",
    "enumLike",
    "inheritedMethodCount",
    "fieldCount",
    "sourceOnlyFieldCount",
    "unknownPrivateCount",
    "riskFieldCount",
    "methodCount",
    "eventBindingCount",
    "roles"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push([
      row.className,
      row.functionName,
      row.categories,
      row.reverseNames,
      row.baseCtors,
      row.inheritedMethodOwners,
      row.chain.map((item) => `${item.level}:${item.ctor}:${item.descriptorCount}`).join(";"),
      row.ownDescriptorCount,
      row.inheritedDescriptorCount,
      row.staticDescriptorCount,
      row.exactPrimitiveCount,
      row.enumLike,
      row.inheritedMethodCount,
      row.fieldCount,
      row.sourceOnlyFieldCount,
      row.unknownPrivateCount,
      row.riskFieldCount,
      row.methodCount,
      row.eventBindingCount,
      row.roles
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildEnumValuesTsv(rows) {
  const header = ["className", "functionName", "constantName", "valueType", "valueText", "ownerCtor", "enumerable", "source", "categories", "reverseNames"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push([row.className, row.functionName, row.constantName, row.valueType, row.valueText, row.ownerCtor, row.enumerable, row.source, row.categories, row.reverseNames].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildFieldOwnerTsv(rows) {
  const header = [
    "className",
    "functionName",
    "categories",
    "fieldName",
    "ownerStatus",
    "descriptorSources",
    "ownerCtors",
    "ownerRegisteredNames",
    "exactValueType",
    "exactValueText",
    "sourceConfidence",
    "enhancedConfidence",
    "meaning",
    "risk",
    "operations",
    "methods",
    "roles",
    "protocolFields",
    "eventBindings",
    "snippets"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push([
      row.className,
      row.functionName,
      row.categories,
      row.fieldName,
      row.ownerStatus,
      row.descriptorSources,
      row.ownerCtors,
      row.ownerRegisteredNames,
      row.exactValueType,
      row.exactValueText,
      row.sourceConfidence,
      row.enhancedConfidence,
      row.meaning,
      row.risk,
      row.operationsText,
      row.methods,
      row.roles,
      row.protocolFields,
      row.eventBindings,
      row.snippets
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function countBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return Array.from(out.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function topRows(rows, scoreFn, limit) {
  return [...rows].sort((a, b) => scoreFn(b) - scoreFn(a) || String(a.className).localeCompare(String(b.className))).slice(0, limit);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Semantic Inheritance Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- All-source context: ${report.inputs.allSourceContext}`);
  lines.push(`- Source chunks: ${report.inputs.sourceChunks}`);
  lines.push(`- All-names inventory: ${report.inputs.allNamesReport}`);
  lines.push(`- Classes: ${report.summary.classCount}`);
  lines.push(`- Prototype-chain rows from chunks: max depth=${report.summary.maxPrototypeDepth}; inherited method owners from all-names: ${report.summary.classesWithInheritedOwners} classes / ${report.summary.inheritedMethodRefs} method refs.`);
  lines.push(`- Exact enum/static constants: ${report.summary.exactEnumValues} values across ${report.summary.enumClassCount} enum-like classes.`);
  lines.push(`- Field owner rows: ${report.summary.fieldOwnerRows}; exact-value fields=${report.summary.exactValueFieldRows}; inherited descriptor fields=${report.summary.inheritedDescriptorFieldRows}; source-only fields=${report.summary.sourceOnlyFieldRows}.`);
  lines.push("");
  lines.push("## What This Proves");
  lines.push("");
  lines.push("- Stable class identity still comes from `Laya.ClassUtils._classMap[registeredName]`; minified function names are only secondary labels.");
  lines.push("- Static/enum values are taken from saved live runtime descriptors in the full source chunks, so rows such as `ProtocolId.ACT_CLIENT_GENERAL_CHECKIN_DATA_RESP = 200071` are exact for that capture.");
  lines.push("- Inherited method ownership is taken from the full all-names inventory, which records inherited owner prefixes such as `Oqi.cardRollOut`; source chunks provide exact own/static source and descriptor values.");
  lines.push("- Field rows remain source evidence, not permission to read hidden state. Hidden hand-card risks stay marked for live/protocol proof.");
  lines.push("");
  lines.push("## Output Files");
  lines.push("");
  lines.push(`- Class inheritance TSV: ${report.outputs.classInheritanceTsv}`);
  lines.push(`- Enum values TSV: ${report.outputs.enumValuesTsv}`);
  lines.push(`- Field owner TSV: ${report.outputs.fieldOwnerTsv}`);
  lines.push(`- JSON summary: ${report.outputs.json}`);
  lines.push("");
  lines.push("## Top Enum-Like Classes");
  lines.push("");
  lines.push("| Class | Function | Exact Values | Categories | Sample Values |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const row of report.topEnumClasses) {
    lines.push(`| \`${escapeCell(row.className)}\` | \`${escapeCell(row.functionName)}\` | ${row.exactPrimitiveCount} | ${escapeCell(row.categories.join(","))} | ${escapeCell(row.sampleValues.join("; "))} |`);
  }
  lines.push("");
  lines.push("## Common Base Constructors");
  lines.push("");
  lines.push("| Base Ctor | Class Count | Registered Names |");
  lines.push("| --- | ---: | --- |");
  for (const row of report.topBaseCtors) {
    lines.push(`| \`${escapeCell(row.ctor)}\` | ${row.count} | ${escapeCell(row.registeredNames.join(";"))} |`);
  }
  lines.push("");
  lines.push("## Focus Classes");
  lines.push("");
  lines.push("| Class | Own Chain | Inherited Owners | Exact Values | Fields | Source-only | Unknown Private | Risk | Roles |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of report.focusClasses) {
    lines.push(`| \`${escapeCell(row.className)}\` | ${escapeCell(row.chain.map((item) => `${item.level}:${item.ctor}`).join(" > "))} | ${escapeCell(row.inheritedMethodOwners.join(";"))} | ${row.exactPrimitiveCount} | ${row.fieldCount} | ${row.sourceOnlyFieldCount} | ${row.unknownPrivateCount} | ${row.riskFieldCount} | ${escapeCell(row.roles.join(","))} |`);
  }
  lines.push("");
  lines.push("## Highest Remaining Field-Risk Classes");
  lines.push("");
  lines.push("| Class | Function | Source-only | Unknown Private | Risk | Fields | Roles |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of report.highRiskClasses) {
    lines.push(`| \`${escapeCell(row.className)}\` | \`${escapeCell(row.functionName)}\` | ${row.sourceOnlyFieldCount} | ${row.unknownPrivateCount} | ${row.riskFieldCount} | ${row.fieldCount} | ${escapeCell(row.roles.join(","))} |`);
  }
  lines.push("");
  lines.push("## Remaining Limits");
  lines.push("");
  lines.push("- Exact enum values and inherited method owner prefixes are source-proven for the saved capture.");
  lines.push("- Live-only runtime state meanings still require CDP samples in the target scene/window.");
  lines.push("- Active automation still requires prompt-specific live proof before sending clicks, confirms, card choices, or skill responses.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const source = await latestAllSourceContext();
  if (!source) throw new Error("No all-source context report found.");
  const allNames = await latestAllNamesReport();

  const index = await readJson(source.indexPath);
  const { files: chunkFiles, classes: chunkClasses } = await loadChunkClasses(source.chunksDir);
  const chunkByName = new Map(chunkClasses.map((cls) => [cls.registeredName, cls]));
  const allNameByName = new Map((allNames?.classes || []).map((cls) => [cls.name, cls]));
  const functionNameMap = buildFunctionNameMap(index.classes || [], chunkClasses);

  const classRows = [];
  const enumRows = [];
  const fieldOwnerRows = [];

  for (const indexClass of index.classes || []) {
    const chunkClass = chunkByName.get(indexClass.className);
    const allNameClass = allNameByName.get(indexClass.className);
    const descriptorRows = chunkClass ? buildDescriptorRows(chunkClass, functionNameMap) : [];
    const descriptorRowsByMember = new Map();
    const enumValueByMember = new Map();
    for (const descriptor of descriptorRows) {
      if (!descriptorRowsByMember.has(descriptor.member)) descriptorRowsByMember.set(descriptor.member, []);
      descriptorRowsByMember.get(descriptor.member).push(descriptor);
      if (descriptor.exactPrimitive) enumValueByMember.set(descriptor.member, descriptor);
    }
    const summary = summarizeClass(indexClass, chunkClass, descriptorRows, allNameClass);
    classRows.push(summary);
    enumRows.push(...buildEnumValueRows(summary, descriptorRows));
    fieldOwnerRows.push(...buildFieldOwnerRows(indexClass, descriptorRowsByMember, enumValueByMember));
  }

  const baseCtorCounts = countBy(classRows.flatMap((row) => row.baseCtors.map((ctor) => ({ ctor }))), (row) => row.ctor);
  const topBaseCtors = baseCtorCounts.slice(0, 30).map(([ctor, count]) => ({ ctor, count, registeredNames: registeredNamesFor(functionNameMap, ctor).slice(0, 12) }));
  const enumRowsByClass = new Map();
  for (const row of enumRows) {
    if (!enumRowsByClass.has(row.className)) enumRowsByClass.set(row.className, []);
    enumRowsByClass.get(row.className).push(row);
  }
  const topEnumClasses = topRows(classRows.filter((row) => row.enumLike), (row) => row.exactPrimitiveCount, 30).map((row) => ({
    ...row,
    sampleValues: (enumRowsByClass.get(row.className) || []).slice(0, 8).map((item) => `${item.constantName}=${item.valueText}`)
  }));
  const focusClasses = classRows.filter((row) => focusClassPattern.test(row.className)).sort((a, b) => a.className.localeCompare(b.className));
  const highRiskClasses = topRows(classRows.filter((row) => row.sourceOnlyFieldCount || row.unknownPrivateCount || row.riskFieldCount), (row) => row.sourceOnlyFieldCount + row.unknownPrivateCount * 4 + row.riskFieldCount * 8, 40);

  const outDir = path.resolve(
    process.env.SGS_RUNTIME_SEMANTIC_INHERITANCE_DIR ||
      path.join(explorationRoot, `${timestampName()}-semantic-inheritance-report`)
  );
  await mkdir(outDir, { recursive: true });

  const outputs = {
    json: path.join(outDir, "semantic-inheritance-report.json"),
    markdown: path.join(outDir, "semantic-inheritance-report.md"),
    classInheritanceTsv: path.join(outDir, "class-inheritance.tsv"),
    enumValuesTsv: path.join(outDir, "enum-values.tsv"),
    fieldOwnerTsv: path.join(outDir, "field-owner-context.tsv")
  };
  const summary = {
    classCount: classRows.length,
    chunkCount: chunkFiles.length,
    classesWithBase: classRows.filter((row) => row.baseCtors.length).length,
    classesWithInheritedOwners: classRows.filter((row) => row.inheritedMethodOwners.length).length,
    inheritedMethodRefs: classRows.reduce((sum, row) => sum + (row.inheritedMethodCount || 0), 0),
    maxPrototypeDepth: Math.max(0, ...classRows.map((row) => row.chain.length)),
    enumClassCount: classRows.filter((row) => row.enumLike).length,
    exactEnumValues: enumRows.length,
    fieldOwnerRows: fieldOwnerRows.length,
    exactValueFieldRows: fieldOwnerRows.filter((row) => row.ownerStatus === "exact-static-constant").length,
    inheritedDescriptorFieldRows: fieldOwnerRows.filter((row) => row.ownerStatus === "inherited-prototype-descriptor").length,
    sourceOnlyFieldRows: fieldOwnerRows.filter((row) => row.ownerStatus === "source-only").length,
    unknownPrivateFieldRows: fieldOwnerRows.filter((row) => row.sourceConfidence === "unknown-private").length,
    riskFieldRows: fieldOwnerRows.filter((row) => row.risk).length
  };
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      allSourceContext: source.dir,
      allSourceIndex: source.indexPath,
      sourceChunks: source.chunksDir,
      allNamesReport: allNames?.dir || "",
      allNamesClasses: allNames?.classesPath || "",
      chunkFiles: chunkFiles.length
    },
    outputs,
    summary,
    topEnumClasses,
    topBaseCtors,
    focusClasses,
    highRiskClasses
  };

  await writeFile(outputs.classInheritanceTsv, buildClassInheritanceTsv(classRows), "utf8");
  await writeFile(outputs.enumValuesTsv, buildEnumValuesTsv(enumRows), "utf8");
  await writeFile(outputs.fieldOwnerTsv, buildFieldOwnerTsv(fieldOwnerRows), "utf8");
  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.markdown, buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Semantic Inheritance Report",
    "",
    `- Markdown: ${outputs.markdown}`,
    `- JSON: ${outputs.json}`,
    `- Class inheritance TSV: ${outputs.classInheritanceTsv}`,
    `- Enum values TSV: ${outputs.enumValuesTsv}`,
    `- Field owner TSV: ${outputs.fieldOwnerTsv}`,
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    summary,
    allSourceContext: source.dir,
    outputs
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
