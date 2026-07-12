import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

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

async function latestDir(suffix, marker) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const fullPath = path.join(explorationRoot, entry.name);
    if (!marker || await exists(path.join(fullPath, marker))) dirs.push(fullPath);
  }
  dirs.sort();
  return dirs.at(-1) || null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_LIVE_FIELD_GAP_REPORT_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-field-gap-report`)
  );
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  return String(value).replace(/\t|\r?\n/g, " ");
}

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function addSet(map, key, value) {
  if (!key || !value) return;
  if (!map[key]) map[key] = new Set();
  map[key].add(value);
}

function fieldRisk(row) {
  if (row.purchaseRisk) return "purchase-risk";
  if (row.matchLevel === "live-only" && row.joinConfidence === "live-only") return "unclassified-live-only";
  if (row.matchLevel === "live-only") return "live-category-only";
  if (row.matchLevel === "field-global") return "field-name-global-only";
  if (row.matchLevel === "owner+field" && !row.sourceMatchCount && !row.semanticMatchCount) return "owner-unresolved";
  return "weak";
}

function isWeak(row) {
  if (row.purchaseRisk) return true;
  if (row.matchLevel === "live-only") return true;
  if (row.matchLevel === "field-global") return true;
  if (row.joinConfidence === "live-only" || row.joinConfidence === "live-category-only") return true;
  return false;
}

function surfacePriority(row) {
  const surfaces = new Set(row.surfaces || []);
  let score = 0;
  if (row.purchaseRisk) score -= 50;
  if (surfaces.has("skill-trigger")) score += 45;
  if (surfaces.has("card-selection-movement")) score += 42;
  if (surfaces.has("auto-play-select-discard")) score += 42;
  if (surfaces.has("button-ui-click")) score += 38;
  if (surfaces.has("scene-window-switch")) score += 35;
  if (surfaces.has("battle-lifecycle")) score += 35;
  if (surfaces.has("effect-animation")) score += 25;
  if (surfaces.has("hover-popup")) score += 25;
  if (surfaces.has("rogue")) score += 20;
  if (row.liveCategory === "skill-spell") score += 30;
  if (row.liveCategory === "card-zone") score += 30;
  if (row.liveCategory === "selection-automation") score += 28;
  if (row.liveCategory === "button-command") score += 24;
  if (row.liveCategory === "event-handler") score += 22;
  if (row.liveCategory === "state-machine") score += 18;
  if (row.liveCategory === "scene-window-ui") score += 16;
  if (row.matchLevel === "live-only") score += 12;
  if (row.joinConfidence === "live-only") score += 8;
  if (/currentScene|manager|RogueLikeGameScene|TableGameScene|Window/i.test(row.ownerPath || "")) score += 12;
  if (/skill|spell|card|select|auto|confirm|button|handler|event|state|phase|turn|window|scene/i.test(row.field || "")) score += 10;
  return score;
}

function summarizeOwner(rows) {
  const byOwner = new Map();
  for (const row of rows) {
    const key = `${row.ownerPath || ""}\t${row.ownerLabel || ""}`;
    if (!byOwner.has(key)) {
      byOwner.set(key, {
        groups: new Set(),
        ownerPath: row.ownerPath || "",
        ownerLabel: row.ownerLabel || "",
        registeredNames: new Set(row.registeredNames || []),
        totalWeakRows: 0,
        purchaseRiskRows: 0,
        riskCounts: {},
        categoryCounts: {},
        surfaceCounts: {},
        fields: [],
        priority: 0
      });
    }
    const item = byOwner.get(key);
    for (const group of splitList(row.group)) item.groups.add(group);
    for (const name of row.registeredNames || []) item.registeredNames.add(name);
    item.totalWeakRows += 1;
    if (row.purchaseRisk) item.purchaseRiskRows += 1;
    addCount(item.riskCounts, fieldRisk(row));
    addCount(item.categoryCounts, row.liveCategory || "unknown");
    for (const surface of row.surfaces || []) addCount(item.surfaceCounts, surface);
    item.fields.push(row);
    item.priority += surfacePriority(row);
  }
  return Array.from(byOwner.values())
    .map((item) => ({
      ...item,
      group: Array.from(item.groups).sort().join("|"),
      groups: Array.from(item.groups).sort(),
      registeredNames: Array.from(item.registeredNames).sort(),
      topFields: item.fields
        .sort((a, b) => surfacePriority(b) - surfacePriority(a) || a.field.localeCompare(b.field))
        .slice(0, 18)
        .map((row) => ({
          field: row.field,
          risk: fieldRisk(row),
          liveCategory: row.liveCategory,
          liveKind: row.liveKind,
          liveValue: row.liveValue,
          surfaces: row.surfaces || [],
          confidence: row.joinConfidence,
          matchLevel: row.matchLevel
        }))
    }))
    .sort((a, b) => b.priority - a.priority || b.totalWeakRows - a.totalWeakRows || a.ownerPath.localeCompare(b.ownerPath));
}

function summarizeSurfaces(rows) {
  const surfaces = {};
  for (const row of rows) {
    const rowSurfaces = row.surfaces?.length ? row.surfaces : ["(none)"];
    for (const surface of rowSurfaces) {
      if (!surfaces[surface]) {
        surfaces[surface] = {
          surface,
          weakRows: 0,
          purchaseRiskRows: 0,
          riskCounts: {},
          categories: {},
          owners: {},
          fields: {}
        };
      }
      const item = surfaces[surface];
      item.weakRows += 1;
      if (row.purchaseRisk) item.purchaseRiskRows += 1;
      addCount(item.riskCounts, fieldRisk(row));
      addCount(item.categories, row.liveCategory || "unknown");
      addCount(item.owners, `${row.ownerPath || ""} (${row.ownerLabel || ""})`);
      addSet(item.fields, row.field, row.ownerPath || "");
    }
  }
  return Object.values(surfaces)
    .map((item) => ({
      surface: item.surface,
      weakRows: item.weakRows,
      purchaseRiskRows: item.purchaseRiskRows,
      riskCounts: item.riskCounts,
      categoryCounts: item.categories,
      topOwners: Object.entries(item.owners).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([owner, count]) => ({ owner, count })),
      topFields: Object.entries(item.fields)
        .map(([field, owners]) => ({ field, ownerCount: owners.size }))
        .sort((a, b) => b.ownerCount - a.ownerCount || a.field.localeCompare(b.field))
        .slice(0, 18)
    }))
    .sort((a, b) => b.weakRows - a.weakRows || a.surface.localeCompare(b.surface));
}

function buildWorklist(rows, limit = 2000) {
  return [...rows]
    .sort((a, b) => surfacePriority(b) - surfacePriority(a) || a.ownerPath.localeCompare(b.ownerPath) || a.field.localeCompare(b.field))
    .slice(0, limit)
    .map((row) => ({
      priority: surfacePriority(row),
      risk: fieldRisk(row),
      group: row.group,
      ownerPath: row.ownerPath,
      ownerLabel: row.ownerLabel,
      registeredNames: row.registeredNames || [],
      field: row.field,
      liveCategory: row.liveCategory,
      liveKind: row.liveKind,
      liveValue: row.liveValue,
      confidence: row.joinConfidence,
      matchLevel: row.matchLevel,
      joinedMeaning: row.joinedMeaning,
      surfaces: row.surfaces || [],
      sourceClasses: row.sourceClasses || [],
      sourceMethods: row.sourceMethods || [],
      operations: row.operations || [],
      roles: row.roles || []
    }));
}

function mergeList(existing, incoming, key) {
  existing[key] = unique([...(existing[key] || []), ...(incoming[key] || [])]);
}

function dedupeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = [
      row.ownerPath || "",
      row.ownerLabel || "",
      row.field || "",
      row.liveKind || "",
      row.liveValue || "",
      row.joinConfidence || "",
      row.matchLevel || ""
    ].join("\t");
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...row,
        groups: unique([row.group].filter(Boolean)),
        registeredNames: unique(row.registeredNames || []),
        surfaces: unique(row.surfaces || []),
        sourceClasses: unique(row.sourceClasses || []),
        sourceMethods: unique(row.sourceMethods || []),
        operations: unique(row.operations || []),
        roles: unique(row.roles || []),
        duplicateRows: 1
      });
      continue;
    }
    const existing = byKey.get(key);
    existing.duplicateRows += 1;
    existing.groups = unique([...existing.groups, row.group].filter(Boolean));
    existing.group = existing.groups.join("|");
    mergeList(existing, row, "registeredNames");
    mergeList(existing, row, "surfaces");
    mergeList(existing, row, "sourceClasses");
    mergeList(existing, row, "sourceMethods");
    mergeList(existing, row, "operations");
    mergeList(existing, row, "roles");
    existing.purchaseRisk ||= row.purchaseRisk;
    existing.sourceMatchCount = Math.max(existing.sourceMatchCount || 0, row.sourceMatchCount || 0);
    existing.semanticMatchCount = Math.max(existing.semanticMatchCount || 0, row.semanticMatchCount || 0);
    existing.triggerMatchCount = Math.max(existing.triggerMatchCount || 0, row.triggerMatchCount || 0);
  }
  return Array.from(byKey.values());
}

function buildMarkdown(data, outDir) {
  const summary = data.summary;
  const lines = [];
  lines.push("# Live Field Gap Report");
  lines.push("");
  lines.push(`- Generated: ${data.generatedAt}`);
  lines.push(`- Source join: ${data.sourceJoinPath}`);
  lines.push(`- Scene: ${summary.scene || ""}`);
  lines.push(`- Total live rows: ${summary.totalRows}`);
  lines.push(`- Raw weak/unresolved rows: ${summary.rawWeakRows}`);
  lines.push(`- Deduped weak/unresolved rows: ${summary.weakRows}`);
  lines.push(`- Purchase-risk weak rows: ${summary.purchaseRiskRows}`);
  lines.push("");
  lines.push("## Weak Row Risk Counts");
  lines.push("");
  for (const [risk, count] of Object.entries(summary.riskCounts)) {
    lines.push(`- ${risk}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Surfaces");
  lines.push("");
  lines.push("| Surface | Weak rows | Purchase-risk | Top owners |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const item of data.surfaceSummary.slice(0, 16)) {
    lines.push(`| ${item.surface} | ${item.weakRows} | ${item.purchaseRiskRows} | ${item.topOwners.slice(0, 4).map((owner) => `${owner.owner}: ${owner.count}`).join("<br>")} |`);
  }
  lines.push("");
  lines.push("## Top Owners To Revisit");
  lines.push("");
  lines.push("| Priority | Weak rows | Owner | Labels | Top fields |");
  lines.push("| ---: | ---: | --- | --- | --- |");
  for (const owner of data.ownerSummary.slice(0, 35)) {
    lines.push(`| ${owner.priority} | ${owner.totalWeakRows} | \`${owner.ownerPath}\` | ${[owner.ownerLabel, ...owner.registeredNames].filter(Boolean).map((value) => `\`${value}\``).join(", ")} | ${owner.topFields.slice(0, 8).map((field) => `\`${field.field}\`/${field.risk}`).join("<br>")} |`);
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push("- `unclassified-live-only` means the field had no source/semantic match and no useful name category; these are the best candidates for focused CDP inspection.");
  lines.push("- `live-category-only` means the field name suggests a surface such as card/skill/button/state, but the owner/source branch is still not known.");
  lines.push("- `field-name-global-only` means the field name appears in source elsewhere, but not yet on the live owner; avoid assuming the source meaning until an owner-specific sample exists.");
  lines.push("- Purchase-risk rows stay evidence-only and must not be called without explicit permission.");
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push(`- ${path.join(outDir, "live-field-gap-report.json")}`);
  lines.push(`- ${path.join(outDir, "unresolved-field-worklist.tsv")}`);
  lines.push(`- ${path.join(outDir, "owner-gap-summary.tsv")}`);
  lines.push(`- ${path.join(outDir, "surface-gap-summary.tsv")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const joinDir = process.env.SGS_LIVE_FIELD_SOURCE_JOIN_DIR ||
    await latestDir("-live-field-source-join", "live-field-source-join.json");
  if (!joinDir) throw new Error("No live-field-source-join output found.");
  const joinPath = path.join(joinDir, "live-field-source-join.json");
  const source = await readJson(joinPath);
  const rows = source.joinedRows || [];
  const rawWeakRows = rows.filter(isWeak).map((row) => ({
    ...row,
    registeredNames: splitList(row.registeredNames),
    surfaces: splitList(row.surfaces),
    sourceClasses: splitList(row.sourceClasses),
    sourceMethods: splitList(row.sourceMethods),
    operations: splitList(row.operations),
    roles: splitList(row.roles)
  }));
  const weakRows = dedupeRows(rawWeakRows);
  const riskCounts = {};
  for (const row of weakRows) addCount(riskCounts, fieldRisk(row));

  const report = {
    generatedAt: new Date().toISOString(),
    sourceJoinDir: joinDir,
    sourceJoinPath: joinPath,
    summary: {
      scene: source.summary?.scene || "",
      totalRows: rows.length,
      rawWeakRows: rawWeakRows.length,
      weakRows: weakRows.length,
      purchaseRiskRows: weakRows.filter((row) => row.purchaseRisk).length,
      riskCounts: Object.fromEntries(Object.entries(riskCounts).sort((a, b) => a[0].localeCompare(b[0])))
    },
    surfaceSummary: summarizeSurfaces(weakRows),
    ownerSummary: summarizeOwner(weakRows),
    worklist: buildWorklist(weakRows)
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "live-field-gap-report.json"), report);

  const workHeader = [
    "priority",
    "risk",
    "group",
    "ownerPath",
    "ownerLabel",
    "registeredNames",
    "field",
    "liveCategory",
    "liveKind",
    "liveValue",
    "confidence",
    "matchLevel",
    "joinedMeaning",
    "surfaces",
    "sourceClasses",
    "sourceMethods",
    "operations",
    "roles"
  ];
  const workLines = [workHeader.join("\t")];
  for (const row of report.worklist) {
    workLines.push(workHeader.map((key) => tsvEscape(row[key])).join("\t"));
  }
  await writeFile(path.join(outDir, "unresolved-field-worklist.tsv"), `${workLines.join("\n")}\n`, "utf8");

  const ownerHeader = [
    "priority",
    "group",
    "ownerPath",
    "ownerLabel",
    "registeredNames",
    "totalWeakRows",
    "purchaseRiskRows",
    "riskCounts",
    "categoryCounts",
    "surfaceCounts",
    "topFields"
  ];
  const ownerLines = [ownerHeader.join("\t")];
  for (const owner of report.ownerSummary) {
    ownerLines.push([
      owner.priority,
      owner.group,
      owner.ownerPath,
      owner.ownerLabel,
      tsvEscape(owner.registeredNames),
      owner.totalWeakRows,
      owner.purchaseRiskRows,
      tsvEscape(Object.entries(owner.riskCounts).map(([key, value]) => `${key}:${value}`)),
      tsvEscape(Object.entries(owner.categoryCounts).map(([key, value]) => `${key}:${value}`)),
      tsvEscape(Object.entries(owner.surfaceCounts).map(([key, value]) => `${key}:${value}`)),
      tsvEscape(owner.topFields.map((field) => `${field.field}/${field.risk}/${field.liveKind}=${field.liveValue}`))
    ].join("\t"));
  }
  await writeFile(path.join(outDir, "owner-gap-summary.tsv"), `${ownerLines.join("\n")}\n`, "utf8");

  const surfaceHeader = ["surface", "weakRows", "purchaseRiskRows", "riskCounts", "categoryCounts", "topOwners", "topFields"];
  const surfaceLines = [surfaceHeader.join("\t")];
  for (const surface of report.surfaceSummary) {
    surfaceLines.push([
      surface.surface,
      surface.weakRows,
      surface.purchaseRiskRows,
      tsvEscape(Object.entries(surface.riskCounts).map(([key, value]) => `${key}:${value}`)),
      tsvEscape(Object.entries(surface.categoryCounts).map(([key, value]) => `${key}:${value}`)),
      tsvEscape(surface.topOwners.map((owner) => `${owner.owner}:${owner.count}`)),
      tsvEscape(surface.topFields.map((field) => `${field.field}:${field.ownerCount}`))
    ].join("\t"));
  }
  await writeFile(path.join(outDir, "surface-gap-summary.tsv"), `${surfaceLines.join("\n")}\n`, "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(report, outDir), "utf8");

  console.log(JSON.stringify({
    outDir,
    sourceJoinDir: joinDir,
    totalRows: report.summary.totalRows,
    weakRows: report.summary.weakRows,
    purchaseRiskRows: report.summary.purchaseRiskRows,
    riskCounts: report.summary.riskCounts,
    topSurfaces: report.surfaceSummary.slice(0, 8).map((item) => `${item.surface}:${item.weakRows}`),
    topOwners: report.ownerSummary.slice(0, 8).map((item) => `${item.ownerPath}:${item.totalWeakRows}`)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
