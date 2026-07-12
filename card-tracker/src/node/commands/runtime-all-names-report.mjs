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

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const fullPath = path.join(explorationRoot, entry.name);
    if (await exists(path.join(fullPath, "inventory-full.json"))) dirs.push(fullPath);
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

const methodRoleRules = [
  ["scene-switch", /SwitchScene|executeSwitchScene|enterNextScene|onEnterMode|BackBtnClickHandler|joinBtnClick|ReadyEnter|joinMap/],
  ["window-open-close", /enterWindow|OpenWindow|ShowWindow|ShowGiftWindow|CloseWindow|Close$|Remove$|Hide|Show$|PopUp|Window/],
  ["battle-lifecycle", /StartGame|gameStart|gameOver|showGameResult|leaveGame|tableInfo|enterModePageSuccess|Challenge/],
  ["event-registration", /addEventListener|AddEventListener|removeEventListener|RemoveEventListener|onEnable|onDisable/],
  ["skill-trigger", /GetResponser|OnMsg|Response|MoveCard.*Response|SelectCardCountWhenResponse|AutoUseSkillID|SendMsgIn.*Window/],
  ["card-operation", /Card|Select|Choose|Discard|UseHandCard|UseCard|MoveCard|DealCard|AddCard|RemoveCard|Deck|Pile|Zone/],
  ["auto-operation", /auto|Auto|confirm|Confirm|ensure|Ensure|cancel|Cancel|send|Send|Click|click|Touch|touch/],
  ["hover-popup", /RollOver|RollOut|MouseOver|MouseOut|showOverCard|PopUp|popup|layoutTxt|layoutCard/],
  ["effect-animation", /Effect|effect|Animation|Animate|Tween|Spine|Movie|Motion|addEffect|effectStop|PlayGameEffect/],
  ["resource-drawing", /loadImage|drawTexture|skin|Texture|graphics|Draw|Sprite|Image|Res|Resource/],
  ["rogue", /Rogue|TriggerCurEvent|TriggerEvent|sendGotoFightMsg|sendGotoGambleMsg|RogueLikeDataReq|shopBtnClick/],
  ["purchase-risk", /Buy|buy|Pay|pay|Recharge|Shop|YuanBao|Money|confirmBuy|gotoPay|buyPorpItem/],
  ["kanshu", /KanShu|Jbp|Tree|Peach|TaoZi|trueReqJbpAwd|autoClickAllPeach|onKanShuClick/],
  ["bless-qifu", /Bless|QiFu|Qifu|blessBtnClick|UpdateUpperCanvas|updateSkipAnim/],
  ["yanjiao", /YanJiao|splitCard|sendAutoChooseMoveOpt|showSplitCard/],
  ["qixing-guanxing", /GuanXing|Qixing|QiXing|OutsideCard|MoveCardToZoneResponse|MoveCardFromeZoneResponse/]
];

function classifyMethods(methodNames) {
  const roles = new Set();
  for (const name of methodNames) {
    for (const [role, pattern] of methodRoleRules) {
      if (pattern.test(name)) roles.add(role);
    }
  }
  return Array.from(roles).sort();
}

function fieldMeaning(name) {
  const rules = [
    [/(Handler|handler)$/i, "event/callback handler method"],
    [/^(addEventListener|AddEventListener|removeEventListener|RemoveEventListener)$/i, "event registration/unregistration method"],
    [/^(Status|state|State|status)$/i, "state/status code; inspect source branch or live sample for exact enum values"],
    [/^(Level|grade|Grade)$/i, "level/grade used for reward or progression lookup"],
    [/^(Exp|UpgradeExp)$/i, "experience/progress counters"],
    [/^(SeatID|SeatId|seatId|SrcSeatID|TargetSeatID|SelfSeatIndex|selfSeatIndex|Index)$/i, "seat/player index in battle or protocol"],
    [/^(CardIDs|CardIds|cardIds|cards|Cards|MData)$/i, "card id array or protocol payload"],
    [/^(ToZone|FromZone|Zone|zone)$/i, "card movement zone enum"],
    [/^(MsgID|Type|Protocol)$/i, "protocol/message routing field"],
    [/^(WindowName|windowName|Title|title|Desc|desc|Message|message)$/i, "window/display text or routing label"],
    [/^(visible|alpha|x|y|width|height|mouseEnabled|mouseThrough|zOrder)$/i, "Laya display/layout/input property"],
    [/^(is[A-Z].*|can[A-Z].*|has[A-Z].*|Is[A-Z].*|Can[A-Z].*|Has[A-Z].*)$/, "boolean state/capability flag"],
    [/(Money|YuanBao|Price|Cost|buyItem|needMoney|FreeBlessItemEnough)/i, "currency/purchase/free-branch field; treat as purchase-risk until proven free"],
    [/(Reward|Award|award|reward)/, "reward/award config or runtime result"],
    [/(Event|event)/, "activity/scene/protocol event id or event data"],
    [/(Skill|skill|Spell|spell)/, "skill/spell object, id, or window context"],
    [/((^|[^A-Za-z])Hand|handCard|HandCard|Pile|Deck|deck|Judge|Equip|generalCards|outsideCards)/, "card zone/list; hidden hand restrictions apply"]
  ];
  for (const [pattern, meaning] of rules) {
    if (pattern.test(name)) return meaning;
  }
  return "";
}

function descriptorNames(descriptors, predicate = () => true) {
  return (descriptors || []).filter(predicate).map((item) => item.name).filter(Boolean).sort();
}

function functionDescriptors(descriptors) {
  return (descriptors || []).filter((item) => item.fn).sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeClass(detail) {
  const ownMethods = functionDescriptors(detail.prototypeDescriptors);
  const staticMethods = functionDescriptors(detail.staticDescriptors);
  const accessors = descriptorNames(detail.prototypeDescriptors, (item) => item.kind === "accessor");
  const ownFields = descriptorNames(detail.prototypeDescriptors, (item) => !item.fn && item.kind !== "accessor" && item.name !== "constructor");
  const staticFields = descriptorNames(detail.staticDescriptors, (item) => !item.fn && item.kind !== "accessor" && item.name !== "prototype" && item.name !== "name" && item.name !== "length");
  const inheritedMethods = [];
  for (const link of (detail.prototypeChain || []).slice(1)) {
    for (const method of functionDescriptors(link.descriptors)) {
      inheritedMethods.push(`${link.ctor}.${method.name}`);
    }
  }
  const allMethodNames = [
    ...ownMethods.map((item) => item.name),
    ...staticMethods.map((item) => item.name),
    ...inheritedMethods.map((item) => item.split(".").slice(1).join("."))
  ];
  const categories = classifyName(detail.name);
  const methodRoles = classifyMethods(allMethodNames);
  return {
    name: detail.name,
    exists: !!detail.exists,
    functionName: detail.functionName || "",
    ctor: detail.ctor || "",
    categories,
    methodRoles,
    ownMethodCount: ownMethods.length,
    staticMethodCount: staticMethods.length,
    inheritedMethodCount: inheritedMethods.length,
    ownFieldCount: ownFields.length,
    staticFieldCount: staticFields.length,
    accessorCount: accessors.length,
    ownMethods: ownMethods.map((item) => ({
      name: item.name,
      arity: item.fn?.arity,
      hash: item.fn?.sourceHash,
      length: item.fn?.sourceLength,
      roles: classifyMethods([item.name])
    })),
    staticMethods: staticMethods.map((item) => ({
      name: item.name,
      arity: item.fn?.arity,
      hash: item.fn?.sourceHash,
      length: item.fn?.sourceLength,
      roles: classifyMethods([item.name])
    })),
    inheritedMethods: inheritedMethods.slice(0, 260),
    ownFields,
    staticFields,
    accessors,
    triggerMethods: allMethodNames.filter((name) => classifyMethods([name]).length).sort()
  };
}

async function loadClassRows(inventoryDir) {
  const detailsDir = path.join(inventoryDir, "class-details");
  const files = (await readdir(detailsDir)).filter((name) => name.endsWith(".json")).sort();
  const rows = [];
  for (const file of files) {
    const batch = await readJson(path.join(detailsDir, file));
    for (const detail of batch.classDetails || []) {
      rows.push(summarizeClass(detail));
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function buildRoleIndex(rows) {
  const index = {};
  for (const row of rows) {
    for (const category of row.categories) {
      index[`category:${category}`] ||= [];
      index[`category:${category}`].push(row.name);
    }
    for (const role of row.methodRoles) {
      index[`role:${role}`] ||= [];
      index[`role:${role}`].push(row.name);
    }
  }
  for (const key of Object.keys(index)) index[key].sort();
  return index;
}

function buildMethodIndex(rows) {
  const out = {};
  for (const row of rows) {
    for (const method of row.ownMethods) {
      const roles = method.roles.length ? method.roles : ["unclassified"];
      for (const role of roles) {
        out[role] ||= [];
        out[role].push({
          className: row.name,
          functionName: row.functionName,
          method: method.name,
          arity: method.arity,
          hash: method.hash,
          sourceLength: method.length,
          classCategories: row.categories
        });
      }
    }
  }
  for (const key of Object.keys(out)) out[key].sort((a, b) => (a.className + "." + a.method).localeCompare(b.className + "." + b.method));
  return out;
}

function buildEventRows(entrypoints) {
  const rows = [];
  const add = (kind, events) => {
    for (const [eventName, handlers] of Object.entries(events || {})) {
      for (const handler of handlers || []) {
        rows.push({
          kind,
          eventName,
          handlerIndex: handler.index,
          handlerCtor: handler.handlerCtor || "",
          callerCtor: handler.callerCtor || "",
          methodName: handler.methodName || "",
          once: !!handler.once,
          callerOwnKeys: handler.callerOwnKeys || [],
          callerProtoKeys: handler.callerProtoKeys || [],
          roles: classifyMethods([eventName, handler.methodName || "", ...(handler.callerProtoKeys || [])])
        });
      }
      if (!handlers?.length) rows.push({ kind, eventName, roles: classifyMethods([eventName]) });
    }
  };
  add("GED", entrypoints?.runtime?.ged?.events);
  add("proxy", entrypoints?.runtime?.proxy?.events);
  rows.sort((a, b) => `${a.kind}:${a.eventName}:${a.methodName}`.localeCompare(`${b.kind}:${b.eventName}:${b.methodName}`));
  return rows;
}

function buildFieldGlossary(rows, eventRows) {
  const fieldNames = new Map();
  const add = (name, source) => {
    if (!name) return;
    const entry = fieldNames.get(name) || { name, meaning: fieldMeaning(name), sources: [] };
    if (entry.sources.length < 30) entry.sources.push(source);
    fieldNames.set(name, entry);
  };
  for (const row of rows) {
    for (const field of [...row.ownFields, ...row.staticFields, ...row.accessors]) add(field, row.name);
  }
  for (const row of eventRows) {
    for (const key of [...(row.callerOwnKeys || []), ...(row.callerProtoKeys || [])]) add(key, `${row.kind}:${row.eventName}`);
  }
  return Array.from(fieldNames.values())
    .filter((item) => item.meaning)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function writeRowsTsv(rows) {
  const header = [
    "name",
    "functionName",
    "categories",
    "methodRoles",
    "ownMethodCount",
    "staticMethodCount",
    "inheritedMethodCount",
    "ownFieldCount",
    "staticFieldCount",
    "accessorCount",
    "triggerMethods",
    "ownFields",
    "staticFields",
    "accessors"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(header.map((key) => tsvEscape(row[key])).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function writeEventRowsTsv(rows) {
  const header = ["kind", "eventName", "handlerIndex", "handlerCtor", "callerCtor", "methodName", "once", "roles", "callerOwnKeys", "callerProtoKeys"];
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvEscape(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function buildMarkdown({ rows, roleIndex, methodIndex, eventRows, inventoryDir, entrypoints }) {
  const lines = [];
  const categoryKeys = Object.keys(roleIndex).filter((key) => key.startsWith("category:")).sort();
  const roleKeys = Object.keys(roleIndex).filter((key) => key.startsWith("role:")).sort();
  lines.push("# Runtime All Names Report");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Source inventory: ${inventoryDir}`);
  lines.push(`- Page: ${entrypoints?.page?.title || ""} ${entrypoints?.page?.url || ""}`);
  lines.push(`- Registered class rows: ${rows.length}`);
  lines.push(`- GED events: ${entrypoints?.runtime?.ged?.eventCount || 0}`);
  lines.push(`- Proxy events: ${entrypoints?.runtime?.proxy?.eventCount || 0}`);
  lines.push("");
  lines.push("## Category Counts");
  lines.push("");
  for (const key of categoryKeys) {
    lines.push(`- ${key.replace("category:", "")}: ${roleIndex[key].length}`);
  }
  lines.push("");
  lines.push("## Method Role Counts");
  lines.push("");
  for (const key of roleKeys) {
    lines.push(`- ${key.replace("role:", "")}: ${roleIndex[key].length} classes, ${(methodIndex[key.replace("role:", "")] || []).length} own methods`);
  }
  lines.push("");
  lines.push("## Primary Entrypoint Groups");
  lines.push("");
  const important = [
    "scene",
    "game-scene",
    "window",
    "protocol",
    "rogue",
    "kanshu",
    "bless-qifu",
    "yanjiao",
    "guanxing-qixing",
    "card-flow",
    "effect"
  ];
  for (const category of important) {
    const names = roleIndex[`category:${category}`] || [];
    lines.push(`### ${category}`);
    lines.push("");
    lines.push(names.slice(0, 220).map((name) => `\`${name}\``).join(", ") || "(none)");
    if (names.length > 220) lines.push(`\n\n... ${names.length - 220} more in all-registered-classes.json`);
    lines.push("");
  }
  lines.push("## Trigger Method Interpretation");
  lines.push("");
  lines.push("- `scene-switch`: scene/mode transition methods such as `SwitchScene`, `onEnterMode`, `joinBtnClick`, `BackBtnClickHandler`.");
  lines.push("- `window-open-close`: window lifecycle and window-manager methods such as `enterWindow`, `Close`, `ShowWindow`.");
  lines.push("- `skill-trigger`: responder/protocol methods such as `GetResponser`, `OnMsg*`, `MoveCard*Response`, `SelectCardCountWhenResponse`.");
  lines.push("- `card-operation`: methods that manipulate/select/use/discard/move card UI or card protocol zones.");
  lines.push("- `auto-operation`: click/touch/confirm/send/auto helpers; these are candidate surfaces only and still require prompt-specific live proof.");
  lines.push("- `purchase-risk`: any buy/pay/recharge/shop method. These must be avoided unless explicitly allowed.");
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- `all-registered-classes.json`: every registered class row with method, field, category, and role arrays.");
  lines.push("- `all-registered-classes.tsv`: spreadsheet-friendly version of the full class list.");
  lines.push("- `method-role-index.json`: own prototype methods grouped by inferred implementation role.");
  lines.push("- `event-handler-index.json` / `.tsv`: GED and proxy event names with caller/method evidence.");
  lines.push("- `field-meaning-glossary.json` / `.md`: field names whose meaning can be inferred from stable naming patterns and sample context.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildFieldGlossaryMarkdown(glossary) {
  const lines = [];
  lines.push("# Field Meaning Glossary");
  lines.push("");
  lines.push("This file is an inferred index, not a replacement for live samples. Exact enum values still require source branch or protocol evidence.");
  lines.push("");
  lines.push("| Field | Inferred Meaning | Example Sources |");
  lines.push("| --- | --- | --- |");
  for (const row of glossary) {
    lines.push(`| \`${row.name.replaceAll("|", "\\|")}\` | ${row.meaning.replaceAll("|", "\\|")} | ${row.sources.slice(0, 8).join(", ").replaceAll("|", "\\|")} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inventoryDir = process.env.SGS_RUNTIME_INVENTORY_DIR || await latestDir("-inventory");
  if (!inventoryDir) throw new Error(`No inventory directory under ${explorationRoot}`);
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_ALL_NAMES_DIR ||
      path.join(explorationRoot, `${timestampName()}-all-names-report`)
  );
  await mkdir(outDir, { recursive: true });

  const rows = await loadClassRows(inventoryDir);
  const entrypoints = await readJson(path.join(inventoryDir, "runtime-entrypoints.json"));
  const roleIndex = buildRoleIndex(rows);
  const methodIndex = buildMethodIndex(rows);
  const eventRows = buildEventRows(entrypoints);
  const fieldGlossary = buildFieldGlossary(rows, eventRows);

  await writeJson(path.join(outDir, "all-registered-classes.json"), rows);
  await writeFile(path.join(outDir, "all-registered-classes.tsv"), writeRowsTsv(rows), "utf8");
  await writeJson(path.join(outDir, "class-role-index.json"), roleIndex);
  await writeJson(path.join(outDir, "method-role-index.json"), methodIndex);
  await writeJson(path.join(outDir, "event-handler-index.json"), eventRows);
  await writeFile(path.join(outDir, "event-handler-index.tsv"), writeEventRowsTsv(eventRows), "utf8");
  await writeJson(path.join(outDir, "field-meaning-glossary.json"), fieldGlossary);
  await writeFile(path.join(outDir, "field-meaning-glossary.md"), buildFieldGlossaryMarkdown(fieldGlossary), "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown({ rows, roleIndex, methodIndex, eventRows, inventoryDir, entrypoints }), "utf8");

  console.log(JSON.stringify({
    outDir,
    inventoryDir,
    classes: rows.length,
    categories: Object.fromEntries(Object.entries(roleIndex).filter(([key]) => key.startsWith("category:")).map(([key, value]) => [key.slice("category:".length), value.length])),
    roleCounts: Object.fromEntries(Object.entries(roleIndex).filter(([key]) => key.startsWith("role:")).map(([key, value]) => [key.slice("role:".length), value.length])),
    gedEvents: entrypoints?.runtime?.ged?.eventCount || 0,
    proxyEvents: entrypoints?.runtime?.proxy?.eventCount || 0,
    fieldGlossary: fieldGlossary.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
