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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
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

async function latestJson(suffix, filename) {
  const dir = await latestDir(suffix, filename);
  if (!dir) return null;
  const filePath = path.join(dir, filename);
  const value = await readJsonIfExists(filePath);
  if (!value) return null;
  value.__path = filePath;
  value.__dir = dir;
  return value;
}

function outputDir() {
  return path.resolve(
    process.env.SGS_FIELD_SEMANTIC_INDEX_DIR ||
      path.join(explorationRoot, `${timestampName()}-field-semantic-index-report`)
  );
}

function cleanCell(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}

async function readTsv(filePath) {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map(cleanCell);
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row = {};
    for (let index = 0; index < header.length; index += 1) row[header[index]] = cleanCell(values[index]);
    return row;
  });
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function writeTsv(rows, header) {
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== "").map(String);
  return String(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value != null && value !== "").map(String)));
}

function addSet(target, key, values) {
  if (!target[key]) target[key] = new Set();
  for (const value of splitList(values)) target[key].add(value);
}

function addOne(target, key, value) {
  if (value == null || value === "") return;
  if (!target[key]) target[key] = new Set();
  target[key].add(String(value));
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topCounts(rows, keyFn, limit = 12) {
  return Object.entries(countBy(rows, keyFn))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function asBool(value) {
  return value === true || value === "true" || value === "1";
}

function confidenceRank(value) {
  return {
    "high-live-source": 70,
    "medium-live-source": 60,
    "medium-live-joined": 50,
    "source-context": 45,
    "source-inherited": 42,
    "live-only": 30,
    "source-ref-only": 28,
    "live-category-only": 22,
    "unknown-private": 8,
    weak: 5,
    "": 0
  }[value || ""] ?? 0;
}

function pickBetterText(current, incoming) {
  const a = String(current || "");
  const b = String(incoming || "");
  if (!b) return a;
  if (!a) return b;
  if (/unknown|needs|unclassified/i.test(a) && !/unknown|needs|unclassified/i.test(b)) return b;
  if (b.length > a.length && b.length < 600) return b;
  return a;
}

function normalizeFieldRef(ref) {
  const text = String(ref || "")
    .replace(/^field:/, "")
    .replace(/^this\./, "")
    .trim();
  if (!text || /^(Laya|Math|Array|Object|String|Number|Boolean|Date|JSON)\b/.test(text)) return [];
  const parts = text.split(".").filter(Boolean);
  const out = [text];
  if (parts.length > 1) out.push(parts[0]);
  return unique(out);
}

function fieldKey(className, field) {
  return `${className || ""}\t${field || ""}`;
}

function ensureField(index, className, field) {
  const key = fieldKey(className, field);
  if (!index.has(key)) {
    index.set(key, {
      className,
      functionName: "",
      field,
      sourceRows: 0,
      semanticOwnerRows: 0,
      sourceMeaning: "",
      sourceConfidence: "",
      enhancedConfidence: "",
      exactValueType: "",
      exactValueText: "",
      sourceRisk: false,
      purchaseRisk: false,
      liveRows: 0,
      handlerRows: 0,
      triggerRows: 0,
      triageRows: 0,
      needsLive: false,
      permissionGated: false
    });
  }
  return index.get(key);
}

function finalEvidence(row) {
  if (row.sourceBranchMeaning) return "source-branch-meaning";
  if (row.genericMeaning) return "generic-runtime-field";
  const sourceKnown = row.sourceMeaning && !/unknown-private|needs source|needs live/i.test(row.sourceMeaning);
  const hasSource = row.sourceRows > 0 || row.semanticOwnerRows > 0;
  const hasLive = row.liveRows > 0;
  const hasHandler = row.handlerRows > 0;
  const hasTrigger = row.triggerRows > 0;
  if (hasLive && hasHandler && hasTrigger && hasSource) return "live-handler-trigger-source";
  if (hasLive && hasTrigger && hasSource) return "live-trigger-source";
  if (hasLive && hasHandler && hasSource) return "live-handler-source";
  if (hasLive && hasSource) return "live-source";
  if (hasLive && row.triageRows > 0 && !row.needsLive && !row.permissionGated) return "live-triaged";
  if (hasHandler && hasTrigger && hasSource) return "handler-trigger-source";
  if (hasTrigger && hasSource) return "trigger-source";
  if (sourceKnown) return "source-meaning";
  if (hasSource) return "source-unknown";
  if (hasLive) return "live-only";
  return "weak";
}

function remainingFor(row) {
  if (row.sourceBranchMeaning) return "";
  if (row.genericMeaning) return "";
  if (row.permissionGated) return "permission-gated-live-action";
  if (row.needsLive) return "needs-targeted-live-transition";
  if (finalEvidence(row) === "source-unknown") return "source-visible-but-private-or-generic";
  if (finalEvidence(row) === "live-only") return "live-value-without-source-owner";
  return "";
}

function inferFinalMeaning(row) {
  if (row.sourceBranchMeaning) return row.sourceBranchMeaning;
  if (row.genericMeaning) return row.genericMeaning;
  if (row.liveMeaning && !/unclassified|unknown/i.test(row.liveMeaning)) return row.liveMeaning;
  if (row.handlerMeaning && !/unclassified|unknown/i.test(row.handlerMeaning)) return row.handlerMeaning;
  if (row.triageMeaning && !/unclassified|unknown/i.test(row.triageMeaning)) return row.triageMeaning;
  if (row.sourceMeaning) return row.sourceMeaning;
  const text = `${row.field} ${row.methods || ""} ${row.triggerMethods || ""}`;
  if (/card|hand|discard|equip|pile|zone|move/i.test(text)) return "card, card-zone, or card-movement field";
  if (/skill|spell|respon|zhanfa/i.test(text)) return "skill, spell, or responser field";
  if (/select|choose|auto|confirm|cancel|touch|click/i.test(text)) return "selection, auto-operation, or click/confirm field";
  if (/effect|anim|tween|motion/i.test(text)) return "effect or animation lifecycle field";
  if (/window|scene|visible|layer|modal/i.test(text)) return "scene/window/display-state field";
  if (/skin|texture|res|url|image|graphics/i.test(text)) return "resource drawing or texture field";
  return "meaning still requires more owner-specific evidence";
}

function sourceBranchFieldMeaning(row) {
  const field = String(row.field || "");
  const className = String(row.className || "");
  const key = `${className}.${field}`;
  const exact = {
    "ActivityExchangeSelectWindow._oneSelectId": "Backs ActivityExchangeSelectWindow.oneSelectId; lazily chooses the single recommended exchange id from data.AllExchangeIds, sorted by item ownership/update flags/tone type, and oneBtnClick applies it to selectId.",
    "ChunLao3._needNum": "Backs ChunLao3.needNum; server spell data t.Datas[0] updates it, and ActiveTip/AskTip/CardCountMin/CardCountMax use it as the required card/target count for ChunLao3 responses.",
    "ClientGuildMyGuildRep._job": "Backs ClientGuildMyGuildRep.job; decoded from the guild response payload and setter also updates cTt.Self.GuildJob.",
    "Hero1v1BanGeneralWindow._allHero1v1GeneralDic": "Cached Hero1v1 general dictionary built from TableSetting.AnchorPoolList through tv.I().GetHero1v1Dic(...); destroyed and nulled on window Remove().",
    "SelectNewPaiWeiGeneralWindow._onTedianWaitDone": "Timer callback for New Paiwei general-window feature/tag wait animation; _startTedianWait schedules it, callback clears tedianWaiting and advances the wait/tween loop.",
    "WuGuMushroomWindow._maxXLength": "WuGuMushroomWindow card-layout maximum columns per row; layoutBeforAdapter uses it for modulo row/column placement and vertical spacing.",
    "WuGuMushroomWindow._posY": "WuGuMushroomWindow cached original y coordinate; LayoutUI stores it once and offsets the window upward when the game button bar is visible.",
    "WuGuMushroomWindow._txtOptMsg": "WuGuMushroomWindow HTMLDivElement option/message text node; enterWindow creates it, disables mouse interaction, adds it to the window, and layoutTimer positions it near the countdown timer.",
    "ZhenFengRace._optArr": "Backs ZhenFengRace.optArr; lazily splits the first semicolon segment of useTip by '|' and feeds ZhenFengRaceWindow option strings.",
    "ZhenFengRace._winStr": "Backs ZhenFengRace.winStr; lazily stores the third semicolon segment of useTip and formats active-use prompt text from currently held race skill names.",
    "ZuoXingRace._srcSeat": "Backs ZuoXingRace.srcSeat; lazily resolves the first DATA_ZUOXING target seat via fKt.GetSeat(...), then ActiveTip/Activated use that source seat's HtmlName/MaxHp/IsDead state."
  };
  return exact[key] || "";
}

function genericFieldMeaning(row) {
  const field = String(row.field || "");
  const className = String(row.className || "");
  const evidence = `${field} ${className} ${row.sourceMeaning || ""} ${row.liveMeaning || ""} ${row.handlerMeaning || ""} ${row.triageMeaning || ""}`;
  const layaLike = /^(?:Laya|laya\.|runtime:|\$|Sgs|Bless|Rogue|Game|Table|Skill|Select|YanJiao|KanShu|Mode|Activity|General|Button|Label|Text|Image|Sprite|Window)/.test(className);
  const layaCore = /^(?:Laya|laya\.)/.test(className);
  const htmlNode = /^(?:#text|a|div|font|img|link|p|span)$/i.test(className);
  const generatedUiOwner = layaLike || htmlNode || /(?:Btn|Button|Tab|Item|UI|View|Window|Panel|List|Box|Cell|Icon|Label|Text|Image|Sprite|Scene|Layer|Dialog|Render|Bar)$/i.test(className);
  const animationOwner = /(?:Animation|Skeleton|Effect|Ani|Clip|Tween|effectSprite|stateEffectSprite|RogueLikeGameScene|runtime:cVt|runtime:nWi)/i.test(className);
  const safeNonPermission = !asBool(row.permissionGated);

  if (className === "runtime:Y5i" && !asBool(row.needsLive) && safeNonPermission) {
    const seatFields = {
      abolishData: "Live-anchored Y5i seat/player field: numeric abolish/disabled-state payload attached to the seat.",
      attackDistance: "Live-anchored Y5i seat/player field: current attack distance modifier for this seat.",
      attackRange: "Live-anchored Y5i seat/player field: current attack range value for this seat.",
      basicSortArr: "Live-anchored Y5i seat/player field: basic-card ordering array used when arranging visible/authorized card UI.",
      canUseCardOperateType: "Live-anchored Y5i seat/player field: allowed card-operation type state for current use/select prompts.",
      currentCardSelector: "Live-anchored Y5i seat/player field: active card selector object for the current card-use/discard/select flow.",
      currentHp: "Live-anchored Y5i seat/player field: current HP value.",
      currentHpUpdate: "Live-anchored Y5i seat/player field: dirty/update flag for current HP display or sync.",
      defensiveDistance: "Live-anchored Y5i seat/player field: current defensive distance modifier for this seat.",
      disableCardType: "Live-anchored Y5i seat/player field: disabled card-type restrictions used by card selectors and operation checks.",
      disabledCardFlower: "Live-anchored Y5i seat/player field: disabled suit/flower restrictions used by card selectors and operation checks.",
      discardIgnoreCards: "Live-anchored Y5i seat/player field: card ids ignored by discard/count checks for the active skill or prompt.",
      discardSelector: "Live-anchored Y5i seat/player field: active discard selector for card discard automation/validation.",
      faceUpList: "Live-anchored Y5i seat/player field: face-up/public display state list attached to the seat.",
      figure: "Live-anchored Y5i seat/player field: seat faction/figure code used by skills, avatar display, and public identity state.",
      figureGuess: "Live-anchored Y5i seat/player field: guessed faction/figure code for uncertain identity modes.",
      firstRound: "Live-anchored Y5i seat/player field: first-round state flag/value for this seat.",
      fixedViewId: "Live-anchored Y5i seat/player field: fixed view id used by seat/avatar/general presentation.",
      gender: "Live-anchored Y5i seat/player field: gender code for the current seat general/player presentation.",
      grade: "Live-anchored Y5i seat/player field: grade/level code for the current seat general/player presentation.",
      handCards: "Live-anchored Y5i seat/player field: hand-card array for the seat; only self or explicitly revealed/authorized hands may be used as known-card facts.",
      inGameTipsVo: "Live-anchored Y5i seat/player field: in-game tips payload associated with this seat.",
      isCreator: "Live-anchored Y5i seat/player field: room creator/owner flag.",
      isCurrentTarget: "Live-anchored Y5i seat/player field: whether this seat is the current operation target.",
      isForceFigure: "Live-anchored Y5i seat/player field: forced faction/figure flag.",
      IsGameStart: "Live-anchored Y5i seat/player field: whether game-start state is active for this seat.",
      isGenral1Draw: "Live-anchored Y5i seat/player field: first general draw/reveal state flag.",
      isGenral2Draw: "Live-anchored Y5i seat/player field: second general draw/reveal state flag.",
      isTarget: "Live-anchored Y5i seat/player field: target-state flag for current operation/skill resolution.",
      jinNangSortArr: "Live-anchored Y5i seat/player field: trick-card ordering array used when arranging visible/authorized card UI.",
      maxHp: "Live-anchored Y5i seat/player field: maximum HP value.",
      maxTime: "Live-anchored Y5i seat/player field: maximum/reserved operation timer value.",
      newBieTipsCardIds: "Live-anchored Y5i seat/player field: card ids used by new-player tip/guide prompts.",
      pileCards: "Live-anchored Y5i seat/player field: pile/private-zone card array attached to the seat; only public or authorized contents may be treated as known cards.",
      questioned: "Live-anchored Y5i seat/player field: question/queried state flag.",
      aiTGTime: "Live-anchored Y5i seat/player field: AI/auto-trusteeship timing value.",
      grantValue: "Live-anchored Y5i seat/player field: numeric granted/support value stored on the seat.",
      isAskingTao: "Live-anchored Y5i seat/player field: whether this seat is in the ask-for-Tao response state.",
      isOutOfRound: "Live-anchored Y5i seat/player field: whether this seat is operating outside its own round.",
      isReset: "Live-anchored Y5i seat/player field: reset-state flag for the seat/player state.",
      lastSurrenderTime: "Live-anchored Y5i seat/player field: last surrender timestamp/cooldown value.",
      quickChatCardTag: "Live-anchored Y5i seat/player field: card-related quick-chat tag/state."
    };
    if (seatFields[field]) return seatFields[field];
  }

  if (safeNonPermission && generatedUiOwner && /^_(?:refreshChanged|scheduledInnerHtmlRefreshVersion|repaintState)$/.test(field)) {
    return "Laya text/HTML/render dirty-state field used to schedule or coalesce repaint/innerHTML refresh work.";
  }
  if (safeNonPermission && generatedUiOwner && /^(?:overflow|_startX|_startY)$/.test(field)) {
    return "Laya text/input/HTML layout field for clipping/scroll overflow mode or rendered text start offset.";
  }
  if (safeNonPermission && generatedUiOwner && /^(?:isFullScreenWindow|isGamingWindow|isHideWindow|isUpdateWindowAfterInit|reclaimResDone)$/.test(field)) {
    return "Generated game window lifecycle flag for fullscreen/game-window/hide/update-after-init state or resource-reclaim completion.";
  }
  if (safeNonPermission && /^BlessTabBtn$/.test(className) && /^(?:isParentTab|isSubTab|subLabelDownTitle|subLabelDownTitleY|textFieldOffsety)$/.test(field)) {
    return "Bless/QiFu tab-button layout field for parent/sub-tab state, sub-label title display, or text y-offset.";
  }
  if (safeNonPermission && className === "runtime:wHt" && /^(?:arrowDonwState|arrowUpState|resDownName|resUpName|resSizeX|resSizeY|showState)$/.test(field)) {
    return "Curve/scroll panel arrow-resource field for up/down arrow state, resource names, resource size, or visibility state.";
  }
  if (safeNonPermission && className === "runtime:KHt" && /^(?:confirmWin|coverSprite|currentGuidePriority|currentGuideType|forceGuideCallBack|fullMaskUI|marqueeUITween|marqueeUITween2|notforceGuideCallBack|notNextforceGuideUI|showLastPid)$/.test(field)) {
    return "Guide/mask manager field for confirm window, cover/full mask, guide type/priority, callbacks, marquee tweens, or last shown page id.";
  }
  if (safeNonPermission && /^(?:runtime:cVt|runtime:nWi|runtime:oBt|runtime:HHt|RogueLikeGameScene)$/.test(className) && /^(?:_curOriginalData|_drawOrderIndex|_indexControl|_lastAniClipIndex|_lastUpdateAniClipIndex|_skinIndex|animteMode|effectUrl|AutoStart|nameOrIndex|needAddSceneTemp|scdMotionComplete|waitInAnimateTime|bgEffectType|effectClearBg|effectPath|gameBgPivot|isWideBg|lastEffect|wideSize|animation|bHideWhenComplete|currentUrl|faceData|faceWidth|sprAnim)$/.test(field)) {
    return "Effect/animation runtime field for source data, draw order, playback index/control, skin/effect URL, add-to-scene behavior, completion, background effect, or face animation display state.";
  }
  if (safeNonPermission && /^(?:effectCtrl|effectSprite|figureEffectCountry|huiEffect|hurtShakeTween|killEffectDict|liefengEffect|skinRoundEffectList|qualityEffect|isShowQualityEffect|needHideEffect|officerIconUrl|lastResponseMsg|addResUI|resNames)$/.test(field)) {
    return "Game UI effect/resource field for effect controller/sprite, skin/quality effects, effect visibility, officer/resource URL, response text/resource, or preload resource list.";
  }

  const exact = {
    "$_GID": "Laya runtime object id for a DisplayObject/EventDispatcher instance.",
    "_className_": "Registered class name stored on a game/Laya instance; useful for stable runtime identification.",
    "className": "Registered class name or protocol/model class label.",
    "sceneName": "Scene identity string used by the game scene manager.",
    "SceneName": "Alternate scene identity string used by some scene/window objects.",
    "name": "Display node name; often empty for anonymous/minified runtime nodes and used mainly for lookup/debugging.",
    "_uiid": "Laya UI instance id generated for a runtime UI component.",
    "_children": "Display-list child array for a Laya node.",
    "_parent": "Parent display node in the Laya display tree.",
    "_events": "Laya EventDispatcher listener table keyed by event name.",
    "_graphics": "Laya Graphics command container for drawn textures, shapes, and cached draw commands.",
    "_style": "Laya display style object containing transform, alpha, scroll, and other render style state.",
    "_cacheStyle": "Laya cache/render style object for cacheAs, filters, masks, and cache invalidation state.",
    "_boundStyle": "Laya bounds/cache metadata used for display object measurement.",
    "_bits": "Laya internal bit flags for display/render state.",
    "_renderType": "Laya internal render-type bitmask indicating what the renderer must draw for this node.",
    "_repaint": "Laya repaint/dirty flag used to schedule redraw.",
    "_tfChanged": "Laya transform-changed flag.",
    "_visible": "Internal Laya visibility flag backing visible/effective visibility.",
    "visible": "Public visibility flag on a display node; effective visibility also depends on parent visibility.",
    "_rVisible": "Relative/layout visibility flag used by generated UI relation logic.",
    "alpha": "Display opacity value; zero can make a node effectively invisible.",
    "_mouseState": "Laya mouse interaction state for hover/down/up tracking.",
    "buttonMode": "Laya input flag that makes a display node behave like a clickable button.",
    "mouseEnabled": "Laya input flag controlling whether this node can receive mouse/touch events.",
    "mouseThrough": "Laya input flag allowing mouse/touch events to pass through this node.",
    "_texture": "Texture currently attached to this display/image node, or null when the node draws through graphics/children.",
    "texture": "Texture currently attached to this display/image node.",
    "_skin": "Logical skin resource path for a Laya UI image/button component.",
    "skin": "Logical skin resource path for a Laya UI image/button component.",
    "_skinLoaded": "Laya UI flag indicating whether the current skin resource has finished loading.",
    "_bg": "Background graphics or background skin holder for a UI component.",
    "skins": "Skin resource list for multi-state UI controls such as buttons, clips, tabs, or selectors.",
    "textureList": "Texture list cached by a clip/image sequence style UI component.",
    "_source": "Loaded image/texture source backing an Image-like component.",
    "source": "Loaded image/texture source backing an Image-like component.",
    "_x": "Local x position of a display node.",
    "_y": "Local y position of a display node.",
    "x": "Local x position of a display node.",
    "y": "Local y position of a display node.",
    "_width": "Measured or explicitly set display width.",
    "_height": "Measured or explicitly set display height.",
    "width": "Measured or explicitly set display width.",
    "height": "Measured or explicitly set display height.",
    "_rWidth": "Generated UI relation width constraint/state.",
    "_rHeight": "Generated UI relation height constraint/state.",
    "_rScaleX": "Generated UI relation scale-x constraint/state.",
    "_rScaleY": "Generated UI relation scale-y constraint/state.",
    "isSetWidth": "Generated UI flag indicating an explicit width has been assigned.",
    "isSetHeight": "Generated UI flag indicating an explicit height has been assigned.",
    "IsRelateOtherX": "Generated UI relation flag for x-position dependency on another node.",
    "IsRelateOtherY": "Generated UI relation flag for y-position dependency on another node.",
    "TweenPos": "Generated UI tween position/progress helper used by relation/tween layouts.",
    "_text": "Text content currently stored on a Laya text/label node.",
    "text": "Text content currently stored on a Laya text/label node.",
    "_textWidth": "Measured text width for a Laya text/label node.",
    "_textHeight": "Measured text height for a Laya text/label node.",
    "_lineWidths": "Measured per-line widths for a multi-line Laya text node.",
    "tipMaxWidth": "Tooltip/text layout maximum width used before wrapping or popup sizing.",
    "toolTipCheckMode": "Tooltip display/check mode used by the UI tooltip helper.",
    "topText": "Flag or state indicating the text is drawn in the top layer/style of the component.",
    "_prompt": "Placeholder/prompt text for an input-like UI component.",
    "_promptColor": "Placeholder/prompt text color for an input-like UI component.",
    "_edgeFadeMask": "Visual mask node/options used for edge-fade text or scroll effects.",
    "_edgeFadeOptions": "Edge-fade visual options for clipped text/scroll content.",
    "_selected": "Selection flag on a UI item or selectable display node.",
    "_selectedIndex": "Selected index for tab/list/stack/select controls.",
    "_selectedColor": "Text or background color used when a UI item is selected.",
    "selectedIndex": "Selected index for tab/list/stack/select controls.",
    "selected": "Selection flag on a UI item or selectable display node.",
    "invalidateSortFlag": "Dirty flag indicating a list or container order/layout needs to be sorted again."
  };

  if (exact[field] && (layaLike || htmlNode)) return exact[field];
  if (exact[field] && generatedUiOwner && field.startsWith("_")) return exact[field];
  if (/^__gets__$/.test(field)) return "Generated getter registry for property accessors on this class.";
  if (/^__sets__$/.test(field)) return "Generated setter registry for property accessors on this class.";
  if (htmlNode && /^_(?:children|style|x|y|width|height|url|text|textWidth|textHeight)$/.test(field)) {
    return "Laya HTML parser node field for DOM-like child/style/layout/text or image URL state.";
  }
  if (htmlNode && /^_(?:tex|onload|loader|boundsRec|htmlBounds|cuttingStyle|recList)$/.test(field)) {
    return "Laya HTML parser node field for loaded texture, load handler, loader, bounds cache, clipping style, or rectangle cache.";
  }
  if (/^_widget$/.test(field) && generatedUiOwner) return "Laya Widget layout component attached to a node for anchor/edge constraints.";
  if (/^_resName$/.test(field) && generatedUiOwner) return "Resource name associated with this generated view/window/component.";
  if (/^_wholeData$/.test(field) && generatedUiOwner) return "Full data payload bound to a generated UI item.";
  if (/^_url$/.test(field) && generatedUiOwner) return "Resource URL/path held by an image, animation, loader, or HTML image object.";
  if (/^_bitmap$/.test(field) && generatedUiOwner) return "Bitmap/texture backing object used by an image, clip, or rendered text component.";
  if (/^_filter$/.test(field) && generatedUiOwner) return "Display filter or filter-list state attached to this node.";
  if (/^_tf$/.test(field) && generatedUiOwner) return "Laya transform matrix/cache object for this display node.";
  if (/^_mG$/.test(field) && generatedUiOwner) return "Graphics or mask graphics helper used by this display node.";
  if (/^_camera$/.test(field) && generatedUiOwner) return "Camera reference used by the stage/scene render path.";
  if (/^layerOrder$/.test(field) && generatedUiOwner) return "Layer ordering value used to sort display or render layers.";
  if (/^_innerHtmlRefreshVersion$/.test(field) && generatedUiOwner) return "HTML/text refresh version counter used to invalidate cached innerHtml layout.";
  if (generatedUiOwner && /^_(?:enabled|layoutChanged|sizeChanged|centerX|centerY|left|right|top|bottom|autoSize|labelPadding|padding|anchorX|anchorY|scaleX|scaleY|pivotX|pivotY|rotation|transform|align|space|value|bar|content|group|offset|target|items|autoAlign|preventLayoutWidthWriteBack)$/.test(field)) {
    return "Generated Laya UI/display field for enablement, layout invalidation, anchors, transform, label padding, grouping, content, or bound target state.";
  }
  if (layaCore && /^_(?:loop|padding|PADDING|transform|target|items|offset|group|anchorX|anchorY|autoSize|labelPadding)$/.test(field)) {
    return "Laya component private field for playback loop, padding, transform, target binding, item list, offset/grouping, anchors, or auto-size state.";
  }

  if (layaCore) {
    if (/Stage/.test(className) && /^_(?:3dUI|alignH|alignV|canvasTransform|changeCanvasSize|curUIBase|frameRate|frameRateNative|frameStartTime|fullScreenChanged|globalRepaintGet|globalRepaintSet|isFocused|isVisibility|mouseMoveTime|onmouseMove|previousOrientation|requestFullscreen|safariOffsetY|scaleMode|screenMode)$/.test(field)) {
      return "Laya Stage field for canvas scaling/alignment, frame timing, fullscreen/orientation state, visibility/focus, repaint hooks, or mouse-move bookkeeping.";
    }
    if (/Node/.test(className) && /^_(?:activeChangeScripts|components|extUIChild|onAdded|onDisplay|onUnDisplay|onParentChange|onParentResize)$/.test(field)) {
      return "Laya Node lifecycle/component field for active-change scripts, attached components, generated UI children, display/parent callbacks, or parent resize handling.";
    }
    if (/Scene/.test(className) && /^_timer$/.test(field)) {
      return "Laya Scene timer reference used for scene-scoped delayed and frame callbacks.";
    }
    if (/Sprite/.test(className) && /^_zOrder$/.test(field)) {
      return "Laya Sprite z-order field used to sort children in the display list.";
    }
    if (/AutoBitmap/.test(className) && /^_(?:isChanged|one|sp|oldW|oldH)$/.test(field)) {
      return "Laya AutoBitmap field for dirty state, one-draw command, owner sprite, or previous size used by nine-slice redraw.";
    }
    if (/AdvImage/.test(className) && /^_(?:http|lunboTime|resquestTime)$/.test(field)) {
      return "Laya AdvImage field for remote image loading, carousel interval, or request timestamp.";
    }
    if (/BitmapFont/.test(className) && /^_(?:complete|onLoaded|path)$/.test(field)) {
      return "Laya BitmapFont field for load completion, load callback, or bitmap-font resource path.";
    }
    if (/HTML|Html/.test(className) && /^_(?:tex|onload|loader|boundsRec|htmlBounds|cuttingStyle|recList)$/.test(field)) {
      return "Laya HTML element/parser private field for loaded texture, load handler, loader, bounds cache, clipping style, or rectangle cache.";
    }
    if (/HTMLDivElement/.test(className) && /^_(?:element|htmlDivRepaint|innerHTML|onMouseClick|updateGraphicWork)$/.test(field)) {
      return "Laya HTMLDivElement field for parsed element tree, innerHTML source, repaint scheduling, click handling, or graphics rebuild work.";
    }
    if (/HTMLParse/.test(className) && /^_htmlClassMapShort$/.test(field)) {
      return "Laya HTML parser class-map cache for short tag names.";
    }
    if (/HTMLStyle/.test(className) && /^_(?:CSSTOVALUE|extendStyle|inheritProps|parseCSSRegExp)$/.test(field)) {
      return "Laya HTMLStyle field for CSS value conversion, inherited properties, style extension, or CSS parsing regex.";
    }
    if (/Layout/.test(className) && /^_will$/.test(field)) {
      return "Laya HTML layout pending-work flag used while arranging parsed inline/block content.";
    }
    if (/List|Panel/.test(className) && /^_elasticEnabled$/.test(field)) {
      return "Laya scroll container flag indicating elastic scrolling is enabled.";
    }
    if (/Panel/.test(className) && /^_scrollChanged$/.test(field)) {
      return "Laya Panel dirty flag indicating scroll content or scrollbar state must be refreshed.";
    }
    if (/List/.test(className) && /^_(?:array|cellChanged|cellOffset|createdLine|isMoved|isVertical|preLen|repeatX2|repeatY2|spaceX|spaceY|startIndex)$/.test(field)) {
      return "Laya List field for backing data array, cell invalidation, virtualized cell offsets, scroll direction/move state, repeat layout, spacing, or start index.";
    }
    if (/ScrollBar/.test(className) && /^_(?:lastPoint|mouseWheelDelta|mouseWheelEnable|thumbPercent|touchScrollEnable|scrollChanged)$/.test(field)) {
      return "Laya ScrollBar field for drag position, mouse-wheel/touch scroll settings, thumb size, or scroll dirty state.";
    }
    if (/TextArea/.test(className) && /^_(?:hScrollBar|vScrollBar)$/.test(field)) {
      return "Laya TextArea horizontal/vertical scrollbar reference.";
    }
    if (/TextInput/.test(className) && /^_onEnter$/.test(field)) {
      return "Laya TextInput enter-key handler used by input editing flow.";
    }
    if (/Tree/.test(className) && /^_(?:list|spaceBottom|spaceLeft)$/.test(field)) {
      return "Laya Tree field for its backing List component and tree indentation/spacing.";
    }
    if (/UIComponent/.test(className) && /^_(?:disabled|gray|tag)$/.test(field)) {
      return "Laya UIComponent state field for disabled/gray visual state or user tag payload.";
    }
    if (/Slider/.test(className) && /^_(?:allowClickBack|globalSacle|max|maxMove|min|tick|tx|ty)$/.test(field)) {
      return "Laya Slider field for click-back behavior, coordinate scaling, min/max value, movement range, tick step, or drag origin.";
    }
    if (/UIGroup/.test(className) && /^_(?:direction|labelAlign|labelBold|labelChanged|labelSize|labelStroke|valueArr|setIndexHandler)$/.test(field)) {
      return "Laya UIGroup field for grouped item values, direction, label style/dirty state, or selected-index handler wiring.";
    }
    if (/View$/.test(className) && /^_watchMap$/.test(field)) {
      return "Laya View watch-map field used by generated data-binding watchers.";
    }
    if (/ViewStack/.test(className) && /^_setIndexHandler$/.test(field)) {
      return "Laya ViewStack selected-index handler used to switch displayed child views.";
    }
    if (/Widget/.test(className) && /^_(?:onAdded|onParentResize)$/.test(field)) {
      return "Laya Widget lifecycle handler for owner attachment or parent resize layout updates.";
    }
    if (/WXOpenDataViewer/.test(className) && /^_(?:onLoop|postMsg)$/.test(field)) {
      return "Laya WXOpenDataViewer field for its frame loop callback or open-data postMessage payload.";
    }
    if (/ColorPicker/.test(className) && /^_panelChanged$/.test(field)) {
      return "Laya ColorPicker dirty flag indicating the picker panel must be rebuilt or refreshed.";
    }
    if (/Box|DialogManager/.test(className) && /^_onResize$/.test(field)) {
      return "Laya resize callback used to relayout a box or dialog manager after stage/container size changes.";
    }
    if (/Dialog/.test(className) && /^_(?:dragArea|onClick|param)$/.test(field)) {
      return "Laya Dialog field for draggable area, click-close/button handler, or open/close parameter payload.";
    }
    if (/Skeleton$/.test(className) && /^_(?:aniClipIndex|aniMode|aniPath|aniSectionDic|bindBoneBoneSlotDic|boneList|boneMatrixArray|boneSlotArray|boneSlotDic|clipIndex|complete|currAniIndex|drawOrder|drawOrderIndex|eventIndex|ikArr|index|indexControl|lastAniClipIndex|lastTime|lastUpdateAniClipIndex|loadAniMode|onAniSoundStoped|onLoaded|onPause|onPlay|onStop|parseComplete|parseFail|pathDic|pause|playAudio|rootBone|soundChannelArr|templet|tfArr|total|update|yReverseMatrix)$/.test(field)) {
      return "Laya Skeleton animation runtime field for clip selection, bone/slot data, draw order, events, audio, parse/load state, or per-frame update state.";
    }
    if (/SpineSkeleton/.test(className) && /^_(?:duration|playEnd|playStart|playbackRate)$/.test(field)) {
      return "Laya SpineSkeleton playback field for animation duration, segment start/end, or playback speed.";
    }
    if (/Animation|AnimationBase|FrameAnimation|EffectAnimation/.test(className) && /^_(?:aniKeys|count|controlNode|frameLoop|frameRateChanged|frames|index|interval|isPlaying|isReverse|labels|resumePlay|url|source|actionData|animationData|targetDic|tweenDic|usedFrames)$/.test(field)) {
      return "Laya animation runtime field for frame count/index, labels, interval, playback state, URL/source, or effect key/tween data.";
    }
    if (/EffectAnimation/.test(className) && /^_(?:onOtherBegin|onPlayAction|playEvent)$/.test(field)) {
      return "Laya EffectAnimation playback event/action callback field for timeline action execution.";
    }
    if (/SoundNode/.test(className) && /^_playEvents$/.test(field)) {
      return "Laya SoundNode playback event list used by animation/audio timelines.";
    }
    if (/SoundNode/.test(className) && /^_(?:channel|stopEvents|tar)$/.test(field)) {
      return "Laya SoundNode field for active audio channel, stop-event list, or timeline target.";
    }
    if (/Clip|FontClip/.test(className) && /^_(?:autoPlay|bitmap|clipChanged|clipHeight|clipWidth|clipX|clipY|index|interval|isPlaying|onClipLoaded|onDisplay|sheet|sources|align|sizeChanged|spaceX|spaceY|toIndex|value|direction|indexMap|valueArr|wordsH|wordsW)$/.test(field)) {
      return "Laya Clip/FontClip field for sprite-sheet slicing, selected frame/index, bitmap source, layout, or displayed value.";
    }
    if (/AdvImage/.test(className) && /^_playIndex$/.test(field)) {
      return "Laya AdvImage playback index for rotating or animated image sources.";
    }
    if (/ComboBox|List|UIGroup|LayoutBox|HBox|VBox|Panel|ScrollBar|Slider|Tab|RadioGroup|ViewStack/.test(className) && /^_(?:align|bar|bottom|cells|cellSize|changeHandler|checkElastic|clickOnly|content|elasticBackTime|elasticDistance|hScrollBar|hide|index|isElastic|isOpen|isCustomList|itemChanged|itemHeight|itemRender|itemSize|labels|lastOffset|layoutChanged|left|list|listChanged|listHeight|offsets|onStageMouseWheel|repeatX|repeatY|right|scrollBar|scrollSize|selectHandler|selectedIndex|space|top|value|vScrollBar|visibleNum)$/.test(field)) {
      return "Laya list/layout/scroll/select component field for content container, scroll bars, selected index/value, item renderer/list data, layout spacing, or elastic scroll state.";
    }
    if (/Slider/.test(className) && /^_progress$/.test(field)) {
      return "Laya Slider progress child/control used to render the current value track.";
    }
    if (/Input|Text/.test(className) && /^_(?:charSize|content|editable|focus|lines|maxChars|multiline|onBlur|onFocus|onInput|onKeyDown|onUnDisplay|restrictPattern|startX|startY|syncInputTransform|clipPoint|isChanged|prompt|promptColor|valign|words)$/.test(field)) {
      return "Laya text/input editing or clipping field for content, focus/editability, selection drag start, prompt, or text clip point.";
    }
    if (/Image|Button/.test(className) && /^_(?:bitmap|btnLabel|clickHandler|labelAlign|labelBold|labelColors|labelFont|labelPadding|labelSize|labelStroke|labelStrokeColor|labelVAlign|stateChanged|stateNum|sources)$/.test(field)) {
      return "Laya image/button skin, bitmap, label-style, state, or click-handler field.";
    }
    if (/Collider|Joint|RigidBody/.test(className) && /^_(?:shape|joint|points|def|density|friction|isSensor|restitution|dampingRatio|frequency|enableMotor|motorSpeed|enableLimit|length|maxLength|minLength|lowerAngle|upperAngle|lowerTranslation|upperTranslation|maxForce|maxMotorForce|maxMotorTorque|maxTorque|body|bodyA|bodyB|anchor|otherAnchor|selfBody|otherBody|allowRotation|allowSleep|angularDamping|angularVelocity|bullet|gravityScale|linearDamping|linearVelocity|sysPhysicToNode|type|enabled)$/.test(field)) {
      return "Laya physics collider/joint field for Box2D shape, joint, anchors, motor/limit options, body references, or enabled state.";
    }
    if (/MotorJoint/.test(className) && /^_(?:angularOffset|correctionFactor|linearOffset)$/.test(field)) {
      return "Laya MotorJoint field for angular/linear offset or correction factor in the Box2D motor-joint constraint.";
    }
    if (/CircleCollider/.test(className) && /^_radius$/.test(field)) {
      return "Laya CircleCollider radius used to build/update the Box2D circle shape.";
    }
    if (/GearJoint/.test(className) && /^_ratio$/.test(field)) {
      return "Laya GearJoint ratio used by the Box2D gear-joint constraint.";
    }
    if (/Physics/.test(className) && /^_(?:emptyBody|eventList|I|update|worldRoot)$/.test(field)) {
      return "Laya Physics singleton field for the Box2D world, empty body, event queue, update loop, or world root.";
    }
    if (/Particle2D/.test(className) && /^_(?:canvasTemplate|emitter|matrix4|particleTemplate)$/.test(field)) {
      return "Laya Particle2D field for canvas/template rendering, emitter state, transform matrix, or particle template.";
    }
    if (/ScaleBox/.test(className) && /^_(?:oldW|oldH)$/.test(field)) {
      return "Laya ScaleBox previous width/height cache used to detect resize and rescale child content.";
    }
    if (/ColorFilterSetter/.test(className) && /^_(?:red|green|blue|alpha|brightness|contrast|hue|saturation)$/.test(field)) {
      return "Laya ColorFilterSetter color or color-adjustment value used to update a color filter matrix.";
    }
    if (/BlurFilterSetter/.test(className) && /^_strength$/.test(field)) {
      return "Laya BlurFilterSetter blur strength value used to update a blur filter.";
    }
    if (/GlowFilterSetter/.test(className) && /^_(?:blur|offX|offY)$/.test(field)) {
      return "Laya GlowFilterSetter glow blur or x/y offset value used to update a glow filter.";
    }
    if (/TipManager/.test(className) && /^_(?:defaultTipHandler|onStageMouseDown|onStageMouseMove|onStageShowTip|showDefaultTip|showTip|tipBox)$/.test(field)) {
      return "Laya TipManager field for stage mouse tracking, show-tip event handling, default tooltip rendering, or the tooltip box node.";
    }
    if (/Scene|Stage|Sprite|Node|Box|View|Dialog|Component/.test(className) && /^_(?:enabled|layoutChanged|sizeChanged|widget|content|value|centerX|centerY|left|right|top|bottom|autoSize|bar|camera)$/.test(field)) {
      return "Laya scene/component layout, enablement, sizing, anchor, content, or render-camera field.";
    }
  }

  if (/^(?:tweenDura|tweenUpdate|decideTween|decideTweenComplete|decideTweenPos|decideTweenUpdate|countTweenComplete|countTweenUpdate)$/.test(field)) {
    return "Game UI animation/tween helper field for duration, update callback, progress position, or completion callback.";
  }
  if (/^(?:hasAnimateIn|hasAnimateOut|isInAnimateIn|isInAnimateOut|animateInDuration|animateOutDuration|replayAnimateInDuration|replayAnimateOutDuration|animateInTweenPos|animateOutTweenPos)$/.test(field)) {
    return "Scene/window transition animation field for in/out capability, active state, duration, or tween progress.";
  }
  if (animationOwner && /^_(?:aniClipIndex|aniMode|clipIndex|currAniIndex|eventIndex|skinName|index)$/.test(field)) {
    return "Animation/effect instance field for current clip/index, animation mode, event cursor, skin name, or frame index.";
  }
  if (animationOwner && /^(?:autoDestroy|autoReleaseRes|AutoStart|resAutoReleaseList|autoAddRelease|nameOrIndex|poolName|needHideEffect)$/.test(field)) {
    return "Game effect wrapper field for auto-start, auto-destroy, resource release, object-pool name, effect name/index, or effect visibility.";
  }
  if (/^SgsKeyframe$/.test(className) && /^_(?:inTangent|outTangent|time)$/.test(field)) {
    return "SGS animation keyframe field for key time or in/out tangent curve values.";
  }
  if (generatedUiOwner && /^_soundRes$/.test(field)) {
    return "Generated UI sound resource field used for button/tab interaction audio.";
  }
  if (generatedUiOwner && /^_profilePath$/.test(field)) {
    return "Generated UI profile/resource path field used by the component skin or profile display.";
  }
  if (generatedUiOwner && /labelPadding$/i.test(field)) {
    return "Generated UI label padding field used to position text inside a button/tab component.";
  }
  if (/^(?:_onMouseDown|_onMouseMove|_onMouseUp|_onRollOut|onMouse|onClick)$/.test(field) && layaLike) {
    return "Cached mouse/click handler reference used by Laya UI event wiring.";
  }
  if (/^(?:sourceData|relateData)$/.test(field)) {
    return "UI data-binding payload attached to a node; the field role is generic, while the payload content remains owner-specific.";
  }
  if (/^(?:_r[A-Z]|isSet[A-Z]|IsRelate|Tween)/.test(field) && layaLike) {
    return "Generated UI relation/layout field used by Laya exported views.";
  }
  if (/texture|skin|graphics|render|cache|mask|image|source/i.test(field) && /resource|texture|draw|image|graphics|Laya|laya/i.test(evidence)) {
    return "Resource drawing, texture, or render-cache field on a Laya display/UI node.";
  }
  if (/^(?:_x|_y|x|y|_width|_height|width|height|_rWidth|_rHeight)$/.test(field) && layaLike) {
    return "Display layout coordinate or size field.";
  }
  if (/text|prompt|lineWidth|tipMaxWidth|toolTip|font|color/i.test(field) && /Text|Label|Input|Button|Sgs|runtime|Laya|laya/.test(evidence)) {
    return "Text, label, prompt, tooltip, or text-style field on a UI node.";
  }
  if (/selected|selectIndex|selectedIndex|invalidateSort/i.test(field) && /List|Tab|Button|UIGroup|runtime|Laya|laya|select/i.test(evidence)) {
    return "Selection/index state for a list, tab, button group, or selectable UI node.";
  }
  return "";
}

function classNamesForFunction(ctorToClasses, functionName) {
  return unique(ctorToClasses.get(functionName) || []);
}

function classNamesForLiveRow(ctorToClasses, row) {
  const names = unique([
    ...(row.registeredNames || []),
    ...splitList(row.registeredNames),
    ...classNamesForFunction(ctorToClasses, row.ownerCtor),
    ...classNamesForFunction(ctorToClasses, row.ownerLabel)
  ]);
  if (names.length) return names.slice(0, 12);
  const fallback = row.ownerCtor || row.ownerLabel || "runtime-owner";
  return [`runtime:${fallback}`];
}

async function loadInputs() {
  const semanticDir = await latestDir("-semantic-inheritance-report", "field-owner-context.tsv");
  const classUtilsDir = await latestDir("-classutils-inspect", "classutils-entries.tsv");
  const triggerDir = await latestDir("-trigger-monitoring-report", "trigger-monitoring-index.tsv");
  const liveSemantics = await latestJson("-live-field-semantics-report", "live-field-semantics-report.json");
  const triageDir = await latestDir("-live-field-gap-triage-report", "field-gap-triage.tsv");
  const handlerDir = await latestDir("-rogue-handler-field-join-report", "event-field-join.tsv");

  if (!semanticDir) throw new Error("Missing semantic-inheritance field-owner-context.tsv.");
  if (!classUtilsDir) throw new Error("Missing classutils-entries.tsv.");
  if (!triggerDir) throw new Error("Missing trigger-monitoring-index.tsv.");

  return {
    semanticDir,
    semanticFieldPath: path.join(semanticDir, "field-owner-context.tsv"),
    classUtilsDir,
    classUtilsPath: path.join(classUtilsDir, "classutils-entries.tsv"),
    triggerDir,
    triggerPath: path.join(triggerDir, "trigger-monitoring-index.tsv"),
    liveSemantics,
    triageDir,
    triagePath: triageDir ? path.join(triageDir, "field-gap-triage.tsv") : "",
    handlerDir,
    handlerPath: handlerDir ? path.join(handlerDir, "event-field-join.tsv") : ""
  };
}

function buildCtorMap(classRows, semanticRows) {
  const map = new Map();
  const add = (functionName, className) => {
    if (!functionName || !className) return;
    if (!map.has(functionName)) map.set(functionName, new Set());
    map.get(functionName).add(className);
  };
  for (const row of classRows) add(row.functionName, row.registeredName);
  for (const row of semanticRows) {
    add(row.functionName, row.className);
    for (const ctor of splitList(row.ownerCtors)) add(ctor, row.className);
  }
  return new Map(Array.from(map, ([key, value]) => [key, Array.from(value)]));
}

function addSemanticRows(index, rows) {
  for (const source of rows) {
    const className = source.className || "";
    const field = source.fieldName || source.field || "";
    if (!className || !field) continue;
    const row = ensureField(index, className, field);
    row.functionName ||= source.functionName || "";
    row.semanticOwnerRows += 1;
    row.sourceRows += 1;
    row.sourceRisk ||= asBool(source.risk);
    row.purchaseRisk ||= asBool(source.risk) && /buy|pay|money|refresh|shop|purchase/i.test(`${field} ${source.methods} ${source.eventBindings}`);
    row.sourceMeaning = pickBetterText(row.sourceMeaning, source.meaning);
    if (confidenceRank(source.sourceConfidence) > confidenceRank(row.sourceConfidence)) row.sourceConfidence = source.sourceConfidence;
    if (confidenceRank(source.enhancedConfidence) > confidenceRank(row.enhancedConfidence)) row.enhancedConfidence = source.enhancedConfidence;
    row.exactValueType ||= source.exactValueType || "";
    row.exactValueText ||= source.exactValueText || "";
    addSet(row, "categoriesSet", source.categories);
    addSet(row, "registeredAliasesSet", source.ownerRegisteredNames);
    addSet(row, "ownerStatusesSet", source.ownerStatus);
    addSet(row, "operationsSet", source.operations);
    addSet(row, "methodsSet", source.methods);
    addSet(row, "rolesSet", source.roles);
    addSet(row, "protocolFieldsSet", source.protocolFields);
    addSet(row, "eventBindingsSet", source.eventBindings);
  }
}

function addTriggerRows(index, rows) {
  for (const trigger of rows) {
    const className = trigger.className || "";
    if (!className) continue;
    const evidenceParts = [
      ...splitList(trigger.evidence),
      ...splitList(trigger.protocolFields),
      ...splitList(trigger.eventBindings)
    ];
    const fields = unique(evidenceParts.flatMap(normalizeFieldRef))
      .filter((field) => index.has(fieldKey(className, field)));
    for (const field of fields) {
      const row = ensureField(index, className, field);
      row.functionName ||= trigger.functionName || "";
      row.triggerRows += 1;
      row.purchaseRisk ||= asBool(trigger.purchaseRisk);
      addSet(row, "triggerMethodsSet", trigger.method);
      addSet(row, "surfacesSet", trigger.surfaces);
      addSet(row, "triggerRolesSet", trigger.roles);
      addSet(row, "categoriesSet", trigger.categories);
      addSet(row, "triggerEvidenceSet", trigger.evidence);
    }
  }
}

function addLiveRows(index, ctorToClasses, liveReport) {
  const ownerPathToClasses = new Map();
  for (const live of liveReport?.rows || []) {
    const classes = classNamesForLiveRow(ctorToClasses, live);
    ownerPathToClasses.set(live.ownerPath, unique([...(ownerPathToClasses.get(live.ownerPath) || []), ...classes]));
    for (const className of classes) {
      const row = ensureField(index, className, live.field);
      row.liveRows += 1;
      row.purchaseRisk ||= !!live.purchaseRisk;
      row.liveMeaning = pickBetterText(row.liveMeaning, live.inferredMeaning || live.joinedMeaning);
      if (confidenceRank(live.confidence) > confidenceRank(row.liveConfidence)) row.liveConfidence = live.confidence;
      addSet(row, "liveOwnersSet", live.ownerPath);
      addSet(row, "liveKindsSet", live.liveKind);
      addSet(row, "liveCategoriesSet", live.liveCategory);
      addSet(row, "surfacesSet", live.surfaces);
      addSet(row, "rolesSet", live.methodRoles);
      addSet(row, "methodsSet", live.methodNames);
      addSet(row, "eventNamesSet", live.eventNames);
    }
  }
  return ownerPathToClasses;
}

function addTriageRows(index, ctorToClasses, ownerPathToClasses, rows) {
  for (const triage of rows) {
    const classes = unique([
      ...(ownerPathToClasses.get(triage.ownerPath) || []),
      ...classNamesForFunction(ctorToClasses, triage.ownerLabel),
      ...splitList(triage.registeredNames)
    ]);
    const targetClasses = classes.length ? classes : [`runtime:${triage.ownerLabel || "owner"}`];
    for (const className of targetClasses) {
      const row = ensureField(index, className, triage.field);
      row.triageRows += 1;
      row.needsLive ||= asBool(triage.requiresLiveSample);
      row.permissionGated ||= asBool(triage.permissionGated);
      row.purchaseRisk ||= triage.risk === "purchase-risk";
      row.triageMeaning = pickBetterText(row.triageMeaning, triage.inferredMeaning || triage.joinedMeaning);
      addSet(row, "triageBucketsSet", triage.bucket);
      addSet(row, "triageActionsSet", triage.action);
      addSet(row, "surfacesSet", triage.surfaces);
      addSet(row, "sourceMethodsSet", triage.sourceMethods);
      addSet(row, "liveCategoriesSet", triage.liveCategory);
    }
  }
}

function addHandlerRows(index, ctorToClasses, ownerPathToClasses, rows) {
  for (const handler of rows) {
    const labelParts = splitList(String(handler.nodeLabel || "").replaceAll(":", "|"));
    const classes = unique([
      ...(ownerPathToClasses.get(handler.ownerPath) || []),
      ...labelParts.flatMap((part) => classNamesForFunction(ctorToClasses, part))
    ]);
    const targetClasses = classes.length ? classes : [`runtime:${labelParts[0] || "handler-owner"}`];
    for (const className of targetClasses) {
      const row = ensureField(index, className, handler.field);
      row.handlerRows += 1;
      row.handlerMeaning = pickBetterText(row.handlerMeaning, handler.suggestedMeaning);
      if (confidenceRank(handler.semanticConfidence) > confidenceRank(row.liveConfidence)) row.liveConfidence = handler.semanticConfidence;
      addSet(row, "handlerNodesSet", handler.nodePath);
      addSet(row, "handlerMethodsSet", handler.handlerMethods);
      addSet(row, "eventNamesSet", handler.eventNames);
      addSet(row, "liveKindsSet", handler.fieldKind);
      addSet(row, "triageBucketsSet", handler.triageBuckets);
      addSet(row, "evidenceLevelsSet", handler.evidenceLevel);
    }
  }
}

function finalizeRows(index) {
  const out = [];
  for (const row of index.values()) {
    row.categories = unique(row.categoriesSet ? Array.from(row.categoriesSet) : []);
    row.registeredAliases = unique(row.registeredAliasesSet ? Array.from(row.registeredAliasesSet) : []);
    row.ownerStatuses = unique(row.ownerStatusesSet ? Array.from(row.ownerStatusesSet) : []);
    row.operations = unique(row.operationsSet ? Array.from(row.operationsSet) : []);
    row.methods = unique(row.methodsSet ? Array.from(row.methodsSet) : []);
    row.roles = unique([
      ...(row.rolesSet ? Array.from(row.rolesSet) : []),
      ...(row.triggerRolesSet ? Array.from(row.triggerRolesSet) : [])
    ]);
    row.protocolFields = unique(row.protocolFieldsSet ? Array.from(row.protocolFieldsSet) : []);
    row.eventBindings = unique(row.eventBindingsSet ? Array.from(row.eventBindingsSet) : []);
    row.surfaces = unique(row.surfacesSet ? Array.from(row.surfacesSet) : []);
    row.triggerMethods = unique(row.triggerMethodsSet ? Array.from(row.triggerMethodsSet) : []);
    row.liveOwners = unique(row.liveOwnersSet ? Array.from(row.liveOwnersSet) : []);
    row.liveKinds = unique(row.liveKindsSet ? Array.from(row.liveKindsSet) : []);
    row.liveCategories = unique(row.liveCategoriesSet ? Array.from(row.liveCategoriesSet) : []);
    row.eventNames = unique(row.eventNamesSet ? Array.from(row.eventNamesSet) : []);
    row.handlerNodes = unique(row.handlerNodesSet ? Array.from(row.handlerNodesSet) : []);
    row.handlerMethods = unique(row.handlerMethodsSet ? Array.from(row.handlerMethodsSet) : []);
    row.triageBuckets = unique(row.triageBucketsSet ? Array.from(row.triageBucketsSet) : []);
    row.triageActions = unique(row.triageActionsSet ? Array.from(row.triageActionsSet) : []);
    row.sourceMethods = unique(row.sourceMethodsSet ? Array.from(row.sourceMethodsSet) : []);
    row.evidenceLevels = unique(row.evidenceLevelsSet ? Array.from(row.evidenceLevelsSet) : []);
    row.sourceBranchMeaning = sourceBranchFieldMeaning(row);
    row.genericMeaning = genericFieldMeaning(row);
    if (row.sourceBranchMeaning) {
      row.needsLive = false;
      row.permissionGated = false;
    }
    if (row.genericMeaning) {
      row.needsLive = false;
      row.permissionGated = false;
    }
    row.fieldEvidence = finalEvidence(row);
    row.finalMeaning = inferFinalMeaning(row);
    row.remaining = remainingFor(row);
    out.push(row);
  }
  out.sort((a, b) =>
    confidenceRank(b.liveConfidence) - confidenceRank(a.liveConfidence) ||
    b.liveRows - a.liveRows ||
    b.handlerRows - a.handlerRows ||
    b.triggerRows - a.triggerRows ||
    a.className.localeCompare(b.className) ||
    a.field.localeCompare(b.field)
  );
  return out;
}

function classSummaryRows(rows) {
  const byClass = new Map();
  for (const row of rows) {
    if (!byClass.has(row.className)) {
      byClass.set(row.className, {
        className: row.className,
        functionName: row.functionName,
        fieldCount: 0,
        sourceRows: 0,
        sourceKnownFields: 0,
        unknownPrivateFields: 0,
        liveFields: 0,
        handlerFields: 0,
        triggerFields: 0,
        needsLiveFields: 0,
        permissionGatedFields: 0,
        purchaseRiskFields: 0,
        categoriesSet: new Set(),
        surfacesSet: new Set(),
        rolesSet: new Set()
      });
    }
    const item = byClass.get(row.className);
    item.functionName ||= row.functionName;
    item.fieldCount += 1;
    item.sourceRows += row.sourceRows;
    if (row.sourceBranchMeaning || row.genericMeaning || (row.sourceMeaning && !/unknown-private|needs/i.test(row.sourceMeaning))) item.sourceKnownFields += 1;
    if (!row.sourceBranchMeaning && !row.genericMeaning && (/unknown-private/i.test(row.sourceConfidence) || /unknown-private/i.test(row.enhancedConfidence) || /unknown-private/i.test(row.sourceMeaning))) item.unknownPrivateFields += 1;
    if (row.liveRows) item.liveFields += 1;
    if (row.handlerRows) item.handlerFields += 1;
    if (row.triggerRows) item.triggerFields += 1;
    if (row.needsLive || row.remaining) item.needsLiveFields += 1;
    if (row.permissionGated) item.permissionGatedFields += 1;
    if (row.purchaseRisk) item.purchaseRiskFields += 1;
    for (const value of row.categories) item.categoriesSet.add(value);
    for (const value of row.surfaces) item.surfacesSet.add(value);
    for (const value of row.roles) item.rolesSet.add(value);
  }
  return Array.from(byClass.values())
    .map((row) => ({
      ...row,
      categories: Array.from(row.categoriesSet),
      surfaces: Array.from(row.surfacesSet),
      roles: Array.from(row.rolesSet),
      remainingFields: row.needsLiveFields + row.unknownPrivateFields
    }))
    .sort((a, b) => b.remainingFields - a.remainingFields || b.fieldCount - a.fieldCount || a.className.localeCompare(b.className));
}

function unresolvedRows(rows) {
  return rows
    .filter((row) =>
      row.needsLive ||
      row.permissionGated ||
      row.remaining ||
      row.fieldEvidence === "source-unknown" ||
      row.fieldEvidence === "live-only"
    )
    .sort((a, b) =>
      Number(b.permissionGated) - Number(a.permissionGated) ||
      Number(b.needsLive) - Number(a.needsLive) ||
      b.handlerRows - a.handlerRows ||
      b.triggerRows - a.triggerRows ||
      b.liveRows - a.liveRows ||
      a.className.localeCompare(b.className)
    );
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Field Semantic Index Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Field index rows: ${report.summary.fieldIndexRows}`);
  lines.push(`- Class summary rows: ${report.summary.classSummaryRows}`);
  lines.push(`- Source semantic owner rows: ${report.summary.semanticOwnerRows}`);
  lines.push(`- Trigger field references: ${report.summary.triggerFieldRefs}`);
  lines.push(`- Live semantic rows: ${report.summary.liveSemanticRows}`);
  lines.push(`- Handler field rows: ${report.summary.handlerFieldRows}`);
  lines.push(`- Triage rows: ${report.summary.triageRows}`);
  lines.push("");
  lines.push("## Evidence Counts");
  lines.push("");
  for (const [key, count] of Object.entries(report.summary.fieldEvidenceCounts)) lines.push(`- ${key}: ${count}`);
  lines.push("");
  lines.push("## Remaining Counts");
  lines.push("");
  lines.push(`- Needs targeted live transition: ${report.summary.needsLiveRows}`);
  lines.push(`- Permission gated: ${report.summary.permissionGatedRows}`);
  lines.push(`- Purchase risk: ${report.summary.purchaseRiskRows}`);
  lines.push("");
  lines.push("## Top Surfaces");
  lines.push("");
  for (const item of report.summary.topSurfaces) lines.push(`- ${item.key}: ${item.count}`);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- `field-semantic-index.tsv`: merged `className + field` index with source/live/handler/trigger/triage evidence.");
  lines.push("- `class-field-coverage.tsv`: per-class field coverage summary.");
  lines.push("- `unresolved-field-priority.tsv`: fields still needing targeted live transition proof or permission.");
  lines.push("- `field-semantic-index-report.json`: summary, inputs, and counts.");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is a report-only merge. It does not connect to CDP, click UI, trigger methods, send protocols, or read hidden opponent hand fields.");
  lines.push("- Live rows are mapped back from minified constructors to registered names through the saved ClassUtils/function-name evidence.");
  lines.push("- Rows marked `permission-gated-live-action` remain intentionally unresolved without explicit permission.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inputs = await loadInputs();
  const semanticRows = await readTsv(inputs.semanticFieldPath);
  const classRows = await readTsv(inputs.classUtilsPath);
  const triggerRows = await readTsv(inputs.triggerPath);
  const triageRows = inputs.triagePath ? await readTsv(inputs.triagePath) : [];
  const handlerRows = inputs.handlerPath ? await readTsv(inputs.handlerPath) : [];
  const liveReport = inputs.liveSemantics || { rows: [], summary: {} };

  const ctorToClasses = buildCtorMap(classRows, semanticRows);
  const index = new Map();
  addSemanticRows(index, semanticRows);
  addTriggerRows(index, triggerRows);
  const ownerPathToClasses = addLiveRows(index, ctorToClasses, liveReport);
  addTriageRows(index, ctorToClasses, ownerPathToClasses, triageRows);
  addHandlerRows(index, ctorToClasses, ownerPathToClasses, handlerRows);

  const rows = finalizeRows(index);
  const classRowsOut = classSummaryRows(rows);
  const unresolved = unresolvedRows(rows);
  const header = [
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "finalMeaning",
    "sourceBranchMeaning",
    "genericMeaning",
    "sourceMeaning",
    "sourceConfidence",
    "enhancedConfidence",
    "liveConfidence",
    "categories",
    "registeredAliases",
    "surfaces",
    "roles",
    "operations",
    "methods",
    "triggerMethods",
    "handlerMethods",
    "eventNames",
    "liveOwners",
    "liveKinds",
    "liveCategories",
    "triageBuckets",
    "triageActions",
    "sourceRows",
    "semanticOwnerRows",
    "triggerRows",
    "liveRows",
    "handlerRows",
    "triageRows",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "remaining",
    "exactValueType",
    "exactValueText"
  ];
  const classHeader = [
    "className",
    "functionName",
    "fieldCount",
    "sourceRows",
    "sourceKnownFields",
    "unknownPrivateFields",
    "liveFields",
    "handlerFields",
    "triggerFields",
    "needsLiveFields",
    "permissionGatedFields",
    "purchaseRiskFields",
    "remainingFields",
    "categories",
    "surfaces",
    "roles"
  ];
  const unresolvedHeader = [
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "remaining",
    "finalMeaning",
    "sourceBranchMeaning",
    "genericMeaning",
    "surfaces",
    "roles",
    "triggerMethods",
    "handlerMethods",
    "liveOwners",
    "triageBuckets",
    "triageActions",
    "needsLive",
    "permissionGated",
    "purchaseRisk"
  ];

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      semanticFieldPath: inputs.semanticFieldPath,
      classUtilsPath: inputs.classUtilsPath,
      triggerPath: inputs.triggerPath,
      liveSemanticsPath: inputs.liveSemantics?.__path || "",
      triagePath: inputs.triagePath,
      handlerPath: inputs.handlerPath
    },
    summary: {
      fieldIndexRows: rows.length,
      classSummaryRows: classRowsOut.length,
      semanticOwnerRows: semanticRows.length,
      triggerRows: triggerRows.length,
      triggerFieldRefs: rows.reduce((sum, row) => sum + row.triggerRows, 0),
      liveSemanticRows: liveReport.rows?.length || 0,
      liveMappedRows: rows.reduce((sum, row) => sum + row.liveRows, 0),
      handlerFieldRows: handlerRows.length,
      handlerMappedRows: rows.reduce((sum, row) => sum + row.handlerRows, 0),
      triageRows: triageRows.length,
      triageMappedRows: rows.reduce((sum, row) => sum + row.triageRows, 0),
      needsLiveRows: rows.filter((row) => row.needsLive || row.remaining === "needs-targeted-live-transition").length,
      permissionGatedRows: rows.filter((row) => row.permissionGated).length,
      purchaseRiskRows: rows.filter((row) => row.purchaseRisk).length,
      fieldEvidenceCounts: countBy(rows, (row) => row.fieldEvidence),
      topSurfaces: topCounts(rows.flatMap((row) => row.surfaces.map((surface) => ({ surface }))), (row) => row.surface),
      topCategories: topCounts(rows.flatMap((row) => row.categories.map((category) => ({ category }))), (row) => row.category),
      unresolvedRows: unresolved.length
    },
    files: {
      fieldIndexTsv: path.join(outDir, "field-semantic-index.tsv"),
      classCoverageTsv: path.join(outDir, "class-field-coverage.tsv"),
      unresolvedTsv: path.join(outDir, "unresolved-field-priority.tsv"),
      markdown: path.join(outDir, "README.md"),
      json: path.join(outDir, "field-semantic-index-report.json")
    }
  };

  await writeFile(report.files.fieldIndexTsv, writeTsv(rows, header), "utf8");
  await writeFile(report.files.classCoverageTsv, writeTsv(classRowsOut, classHeader), "utf8");
  await writeFile(report.files.unresolvedTsv, writeTsv(unresolved, unresolvedHeader), "utf8");
  await writeFile(report.files.markdown, buildMarkdown(report), "utf8");
  await writeFile(report.files.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outDir,
    ...report.summary,
    files: report.files
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
