import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";
import { dumpExpression, installExpression, stopExpression } from "./runtime-event-monitor.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir(actionName) {
  return path.resolve(
    process.env.SGS_ROGUE_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-${actionName}-rogue-sample`)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function helpers() {
  return String.raw`
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
    const simple = (value) => {
      const t = typeof value;
      if (value == null || t === "string" || t === "number" || t === "boolean") return value;
      if (t === "function") return "[Function " + (value.name || "") + "]";
      if (Array.isArray(value)) return "[Array " + value.length + "]";
      if (value instanceof Map) return "[Map " + value.size + "]";
      if (value instanceof Set) return "[Set " + value.size + "]";
      return "[" + (ctor(value) || t) + "]";
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj).slice(0, 1000)) {
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
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
          try { if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key); } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort();
    };
    const methodSources = (obj, names, limit = 4000) => {
      const out = {};
      if (!obj) return out;
      for (const name of names) {
        try {
          if (typeof obj[name] === "function") out[name] = String(obj[name]).slice(0, limit);
        } catch (error) {
          out[name] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const key of own(events).slice(0, 40)) {
        try {
          const handlers = Array.isArray(events[key]) ? events[key] : [events[key]];
          out[key] = handlers.filter(Boolean).map((handler) => ({
            ctor: ctor(handler),
            caller: handler.caller ? "[" + ctor(handler.caller) + "]" : null,
            method: handler.method && (handler.method.name || String(handler.method).slice(0, 160)),
            args: Array.isArray(handler.args) ? handler.args.map(simple).slice(0, 8) : simple(handler.args),
            once: handler.once
          })).slice(0, 20);
        } catch (error) {
          out[key] = "[throws " + String(error && error.message || error) + "]";
        }
      }
      return out;
    };
    const walk = (root, visitor, path = "Laya.stage", depth = 0, maxDepth = 14) => {
      if (!root || depth > maxDepth) return;
      visitor(root, path, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        walk(child, visitor, path + "/" + (child && (child.name || child._className_ || child.sceneName || ctor(child)) || ("#" + i)) + "#" + i, depth + 1, maxDepth);
      }
    };
    const summary = (node, nodePath) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      visible: node && node.visible,
      alpha: node && node.alpha,
      effectiveVisible: isVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node && node.x,
      y: node && node.y,
      width: node && node.width,
      height: node && node.height,
      childCount: node && node.numChildren || 0,
      fields: safeFields(node, /(rogue|Rogue|pve|Pve|chapter|Chapter|city|City|event|Event|shop|Shop|fight|Fight|gamble|Gamble|map|Map|mode|Mode|id|ID|data|Data|state|State|status|Status|btn|Btn|button|Button|select|Select|reward|Reward|skill|Skill|effect|Effect|name|Name|text|Text)/, 80),
      keyMethods: methodNames(node, /(rogue|Rogue|pve|Pve|chapter|Chapter|city|City|event|Event|shop|Shop|fight|Fight|gamble|Gamble|map|Map|mode|Mode|trigger|Trigger|goto|Goto|send|Send|click|Click|select|Select|reward|Reward|skill|Skill|effect|Effect|window|Window|enter|Enter|start|Start|handler|Handler)/).slice(0, 100)
    });
    const currentScene = () => {
      const layer = Array.from({ length: Laya.stage && Laya.stage.numChildren || 0 }, (_, i) => Laya.stage.getChildAt(i))
        .find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].filter(Boolean).join(" ")));
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = layer.getChildAt(i);
        if (isVisible(candidate)) return candidate;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const findRogueEntry = () => {
      const out = [];
      walk(Laya.stage, (node, nodePath) => {
        if (node && node.modeId === 151 && typeof node.onEnterMode === "function") {
          out.push({ node, path: nodePath });
        }
      });
      return out.find((item) => isVisible(item.node)) || out[0] || null;
    };
    const shopGoods = (shopData) => {
      if (!shopData || typeof shopData.getGoodsListByType !== "function") return null;
      const out = {};
      for (const type of [2, 3, 4, 5]) {
        try {
          out[type] = (shopData.getGoodsListByType(type) || []).map((item) => ({
            goodId: item.goodId,
            goodType: item.goodType,
            IsBuyed: item.IsBuyed,
            Money: item.Money,
            fields: safeFields(item, /(good|Good|type|Type|buy|Buy|money|Money|item|Item|name|Name|desc|Desc|skill|Skill|card|Card|id|ID)/, 40)
          })).slice(0, 80);
        } catch (error) {
          out[type] = { error: String(error && error.message || error) };
        }
      }
      return out;
    };
    const plainFields = (obj, limit = 120) => {
      const out = {};
      if (!obj) return out;
      for (const key of own(obj).slice(0, limit)) {
        if (/handCards|HandCards|watchCards|WatchCards|hidden/i.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
      }
      return out;
    };
    const chapterDetails = (pveMgr) => {
      const chapter = pveMgr && (pveMgr.ChapterData || pveMgr.chapterData || pveMgr.AllDatas?.chapterData || pveMgr.allDatas?.chapterData) || null;
      if (!chapter) return null;
      return {
        ctor: ctor(chapter),
        fields: safeFields(chapter, /(cur|Cur|location|Location|chapter|Chapter|event|Event|day|Day|city|City|select|Select|line|Line|boss|Boss|shop|Shop|fight|Fight|id|ID|data|Data)/, 180),
        curEventData: chapter.curEventData ? plainFields(chapter.curEventData, 120) : null,
        locations: Array.isArray(chapter.locations)
          ? chapter.locations.slice(0, 120).map((item) => ({ ctor: ctor(item), fields: plainFields(item, 100) }))
          : simple(chapter.locations)
      };
    };
    const cityDetails = (scene) => {
      const cityView = scene && scene.cityView;
      if (!cityView) return null;
      const cityItems = [];
      walk(cityView, (node, nodePath) => {
        if (node && (node.name === "RogueCityItemUI" || /fjt|Ejt/.test(ctor(node)))) {
          cityItems.push({
            path: nodePath,
            ctor: ctor(node),
            name: node.name || "",
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            mouseState: node._mouseState,
            fields: safeFields(node, /(rogue|Rogue|event|Event|city|City|data|Data|select|Select|name|Name|type|Type|id|ID|story|Story|fight|Fight|shop|Shop|gamble|Gamble|raid|Raid)/, 140),
            data: node.data ? plainFields(node.data, 120) : null,
            methods: methodNames(node, /(City|city|Event|event|Select|select|Click|click|Item|item|Map|map|Story|story)/).slice(0, 80),
            methodSources: methodSources(node, [
              "OnClickCity",
              "UpdateEvent",
              "ShowCityStory",
              "HasCityStory",
              "getCityAwardRes",
              "tryPlayRogueEventVideo",
              "SetCityFlag"
            ], 2600)
          });
        }
      }, "currentScene.cityView", 0, 8);
      return {
        cityView: summary(cityView, "currentScene.cityView"),
        fields: safeFields(cityView, /(city|City|location|Location|random|Random|raid|Raid|item|Item|data|Data|chapter|Chapter)/, 120),
        methods: methodNames(cityView, /(City|city|Event|event|Select|select|Click|click|Item|item|Map|map)/).slice(0, 120),
        cityItems
      };
    };
    const smallMapDetails = (scene) => {
      if (!scene || !/RogueSmallMapScene/.test(labelOf(scene))) return null;
      return {
        sceneFields: safeFields(scene, /(Pve|city|City|Chapter|Data|start|Start|match|Match|event|Event|shop|Shop|fight|Fight|skill|Skill|zhan|Zhan|raid|Raid|select|Select)/, 160),
        methods: methodNames(scene, /(Trigger|trigger|send|Send|fight|Fight|shop|Shop|gamble|Gamble|skill|Skill|start|Start|match|Match|event|Event|city|City|Update|update|raid|Raid|select|Select)/).slice(0, 200),
        methodSources: methodSources(scene, [
          "createChildren",
          "TriggerCurEvent",
          "TriggerEvent",
          "sendGotoFightMsg",
          "sendGotoGambleMsg",
          "startMatchHandler",
          "startMatchHandlerCheck",
          "UpdateRogueData",
          "UpdateChapterData",
          "UpdateGeneralData",
          "updateZhanFaItemTrigger",
          "creatStartBtn",
          "showRandomCityStory"
        ], 4200),
        startBtn: scene.startBtn ? {
          summary: summary(scene.startBtn, "currentScene.startBtn"),
          events: eventSummary(scene.startBtn),
          fields: safeFields(scene.startBtn, /(label|Label|skin|Skin|state|State|data|Data|name|Name|text|Text|click|Click|btn|Btn|visible|Visible|disabled|Disabled|gray|Gray)/, 80)
        } : null
      };
    };
    const bigMapDetails = (scene) => {
      if (!scene || !/RogueLikeBigMapScene/.test(labelOf(scene))) return null;
      const buttons = {};
      for (const key of ["startBtn", "invadeBtn"]) {
        const btn = scene[key];
        if (btn) {
          buttons[key] = {
            summary: summary(btn, "currentScene." + key),
            events: eventSummary(btn),
            fields: safeFields(btn, /(label|Label|skin|Skin|state|State|data|Data|name|Name|text|Text|click|Click|btn|Btn|visible|Visible|disabled|Disabled|gray|Gray)/, 80)
          };
        }
      }
      return {
        sceneFields: safeFields(scene, /(season|Season|chapter|Chapter|state|State|status|Status|preview|Preview|auto|Auto|open|Open|select|Select|data|Data|btn|Btn|event|Event|fight|Fight|join|Join|start|Start|map|Map|mode|Mode)/, 140),
        methods: methodNames(scene, /(ReadyEnter|ContinueEnter|joinBtnClick|joinMap|StartGame|ServerProxy_StartGame|TriggerCurEvent|TriggerEvent|UpdateBtnStatus|invadeBtnClick|updateInvadeBtn|EndBuyReJoin|checkEnterTips|updateSelectGeneralWindow)/),
        methodSources: methodSources(scene, [
          "ReadyEnter",
          "ContinueEnter",
          "joinBtnClick",
          "joinMap",
          "StartGame",
          "ServerProxy_StartGame",
          "TriggerCurEvent",
          "TriggerEvent",
          "UpdateBtnStatus",
          "invadeBtnClick",
          "updateInvadeBtn",
          "EndBuyReJoin",
          "checkEnterTips",
          "updateSelectGeneralWindow"
        ]),
        buttons
      };
    };
    const collect = () => {
      const scene = currentScene();
      const rogueNodes = [];
      const windows = [];
      walk(Laya.stage, (node, nodePath) => {
        const label = labelOf(node);
        if (/Rogue|Pve|JiShi|Bless|KanShu|Window/.test(label) || /Rogue|Pve|Shop|Trigger|Fight|Gamble/.test(methodNames(node).join(" "))) {
          const item = summary(node, nodePath);
          if (/Window/.test(label)) windows.push(item);
          rogueNodes.push(item);
        }
      });
      const pveMgr = scene && (scene.PveMgr || scene.pveMgr || scene.PveManager || scene.pveManager) || null;
      const shopData = pveMgr && (pveMgr.ShopData || pveMgr.shopData || pveMgr.AllDatas?.shopData || pveMgr.allDatas?.shopData) || null;
      const entry = findRogueEntry();
      return {
        time: new Date().toISOString(),
        page: { url: location.href, title: document.title },
        currentScene: scene ? summary(scene, "currentScene") : null,
        rogueEntry: entry ? {
          node: summary(entry.node, entry.path),
          data: entry.node.data ? {
            ctor: ctor(entry.node.data),
            fields: safeFields(entry.node.data, /(Model|mode|Mode|section|Section|Desc|desc|open|Open|rule|Rule|key|Key|tips|Tips|related|Related|resource|Resource)/, 80)
          } : null,
          isRogue: typeof entry.node.IsRogueMode === "function" ? entry.node.IsRogueMode() : null
        } : null,
        pveMgr: pveMgr ? {
          ctor: ctor(pveMgr),
          fields: safeFields(pveMgr, /(Money|Chapter|chapter|Current|current|Shop|shop|Event|event|Fight|fight|Gamble|gamble|Season|season|Difficulty|difficulty|Hero|hero|General|general|Skill|skill|Map|map|City|city|Data|data)/, 120),
          methods: methodNames(pveMgr, /(Rogue|rogue|Shop|shop|Fight|fight|Gamble|gamble|Event|event|Chapter|chapter|Reward|reward|Skill|skill|Data|data|Req|req|Send|send)/).slice(0, 120),
          chapterDetails: chapterDetails(pveMgr),
          shopGoods: shopGoods(shopData)
        } : null,
        cityView: scene && scene.cityView ? summary(scene.cityView, "currentScene.cityView") : null,
        cityDetails: cityDetails(scene),
        smallMap: smallMapDetails(scene),
        bigMap: bigMapDetails(scene),
        rogueNodes: rogueNodes.slice(0, 240),
        windows,
        notes: [
          "This script does not buy shop goods or click purchase/paid paths.",
          "Shop data, when present, is read through PveMgr.ShopData.getGoodsListByType only."
        ]
      };
    };
  `;
}

function actionExpression(actionName) {
  return `(() => {
    ${helpers()}
    const before = collect();
    let action = { ok: true, actionName: ${JSON.stringify(actionName)}, called: "(none)" };
    if (${JSON.stringify(actionName)} === "enter-mode") {
      const entry = findRogueEntry();
      if (!entry) {
        action = { ok: false, actionName: "enter-mode", reason: "No modeId=151 rogue entry found" };
      } else if (typeof entry.node.onEnterMode !== "function") {
        action = { ok: false, actionName: "enter-mode", reason: "Rogue entry has no onEnterMode()" };
      } else {
        action.target = before.rogueEntry;
        entry.node.onEnterMode();
        action.called = "NCt(modeId=151).onEnterMode()";
      }
    } else if (${JSON.stringify(actionName)} === "bigmap-join") {
      const scene = currentScene();
      if (!scene || !/RogueLikeBigMapScene/.test(labelOf(scene))) {
        action = { ok: false, actionName: "bigmap-join", reason: "Current scene is not RogueLikeBigMapScene" };
      } else if (!scene.startBtn || !isVisible(scene.startBtn)) {
        action = { ok: false, actionName: "bigmap-join", reason: "BigMap startBtn is not effectively visible" };
      } else if (typeof scene.joinBtnClick !== "function") {
        action = { ok: false, actionName: "bigmap-join", reason: "RogueLikeBigMapScene.joinBtnClick() not found" };
      } else {
        scene.joinBtnClick();
        action.called = "RogueLikeBigMapScene.joinBtnClick()";
        action.note = "Main BigMap entry path; this can open confirm/select/difficulty windows or switch to RogueSmallMapScene. It does not call purchase methods.";
      }
    } else if (${JSON.stringify(actionName)} === "bigmap-confirm-warning") {
      const candidates = [];
      walk(Laya.stage, (node, nodePath) => {
        const data = node && node.confirmData;
        if (!data || !isVisible(node) || typeof node.btnClickHandler !== "function") return;
        const content = String(data.content || "");
        const buttons = data.buttonArr || [];
        const okIndex = buttons.findIndex((button) => {
          const source = button && button.callBack ? String(button.callBack) : "";
          return button && button.label === "确定" && !button.isCancel && button.thisObject && /ReadyEnter/.test(source);
        });
        if (okIndex < 0) return;
        if (!/初始战法数量较少|继续挑战/.test(content)) return;
        candidates.push({ node, nodePath, okIndex });
      }, "Laya.stage", 0, 8);
      const target = candidates[0];
      if (!target) {
        action = { ok: false, actionName: "bigmap-confirm-warning", reason: "No visible Rogue initial-zhanfa confirm with ReadyEnter callback found" };
      } else {
        const data = target.node.confirmData;
        const button = target.node.btnList && target.node.btnList[target.okIndex] || null;
        action.target = {
          path: target.nodePath,
          confirm: summary(target.node, target.nodePath),
          content: data && data.content || "",
          buttons: (data && data.buttonArr || []).map((button, index) => ({
            index,
            label: button && button.label || "",
            isCancel: !!(button && button.isCancel),
            thisObject: button && button.thisObject ? labelOf(button.thisObject) : "",
            callBackSource: button && button.callBack ? String(button.callBack).slice(0, 360) : ""
          })),
          okButton: button ? summary(button, target.nodePath + ".btnList#" + target.okIndex) : null
        };
        target.node.btnClickHandler({ currentTarget: button || { label: "确定" } });
        action.called = "ConfirmWindow.btnClickHandler({ currentTarget: 确定按钮 })";
        action.note = "Only confirms the visible RogueLikeBigMapScene initial-zhanfa warning whose OK callback is ReadyEnter().";
      }
    } else if (${JSON.stringify(actionName)} === "select-general-confirm") {
      const windows = [];
      walk(Laya.stage, (node, nodePath) => {
        if (!node || !isVisible(node)) return;
        if (!/RogueSelectGeneralWindow/.test(labelOf(node))) return;
        if (typeof node.onClickGeneralCard !== "function" && typeof node.sureBtnClick !== "function") return;
        windows.push({ node, nodePath });
      }, "Laya.stage", 0, 10);
      const target = windows[0];
      if (!target) {
        action = { ok: false, actionName: "select-general-confirm", reason: "No visible RogueSelectGeneralWindow with selectable methods found" };
      } else {
        const win = target.node;
        const cards = Array.isArray(win.generalUis) ? win.generalUis : [];
        const card = cards.find((item) => item && isVisible(item) && item.canSelect !== false && item.GeneralID && !item.disabled && item.gray !== true) || cards.find((item) => item && item.GeneralID);
        if (!card) {
          action = {
            ok: false,
            actionName: "select-general-confirm",
            reason: "No selectable general card found on RogueSelectGeneralWindow",
            target: {
              window: summary(win, target.nodePath),
              generalUiCount: cards.length,
              cards: cards.map((item, index) => item ? {
                index,
                label: labelOf(item),
                visible: item.visible,
                canSelect: item.canSelect,
                selected: item.selected,
                generalId: item.GeneralID,
                cardId: item.CardID,
                fields: safeFields(item, /(general|General|card|Card|select|Select|can|Can|id|ID|data|Data|name|Name)/, 40)
              } : null)
            }
          };
        } else {
          action.target = {
            window: summary(win, target.nodePath),
            seasonId: win.seasonId,
            diffId: win.diffId,
            beforeCurSelect: win.curSelectGeneralCard ? {
              label: labelOf(win.curSelectGeneralCard),
              generalId: win.curSelectGeneralCard.GeneralID,
              cardId: win.curSelectGeneralCard.CardID,
              selected: win.curSelectGeneralCard.selected
            } : null,
            selectedCard: {
              label: labelOf(card),
              generalId: card.GeneralID,
              cardId: card.CardID,
              canSelect: card.canSelect,
              canShowSureBtn: card.canShowSureBtn,
              selected: card.selected,
              fields: safeFields(card, /(general|General|card|Card|select|Select|can|Can|id|ID|data|Data|name|Name)/, 80)
            },
            sureBtn: win.sureBtn ? summary(win.sureBtn, target.nodePath + ".sureBtn") : null,
            methodSources: {
              onClickGeneralCard: typeof win.onClickGeneralCard === "function" ? String(win.onClickGeneralCard).slice(0, 900) : null,
              sureBtnClick: typeof win.sureBtnClick === "function" ? String(win.sureBtnClick).slice(0, 900) : null
            }
          };
          win.onClickGeneralCard(card);
          action.afterSelect = {
            curGeneralId: win.curSelectGeneralCard && win.curSelectGeneralCard.GeneralID,
            curCardId: win.curSelectGeneralCard && win.curSelectGeneralCard.CardID,
            sureBtnEnabled: win.sureBtn && win.sureBtn.enabled
          };
          win.sureBtnClick();
          action.called = "RogueSelectGeneralWindow.onClickGeneralCard(first selectable) -> sureBtnClick()";
          action.note = "Selects a visible selectable general card and confirms through ClientRogueLikeGeneralPoolSelectReq; it does not call change-general or buy methods.";
        }
      }
    } else if (${JSON.stringify(actionName)} === "request-shop-data") {
      const scene = currentScene();
      const pveMgr = scene && (scene.PveMgr || scene.pveMgr || scene.PveManager || scene.pveManager) || null;
      if (!scene || !/RogueSmallMapScene/.test(labelOf(scene))) {
        action = { ok: false, actionName: "request-shop-data", reason: "Current scene is not RogueSmallMapScene" };
      } else if (!pveMgr || typeof pveMgr.RogueLikeDataReq !== "function") {
        action = { ok: false, actionName: "request-shop-data", reason: "PveMgr.RogueLikeDataReq not found" };
      } else {
        pveMgr.RogueLikeDataReq(16);
        action.called = "RogueSmallMapScene.PveMgr.RogueLikeDataReq(16)";
        action.note = "Requests rogue data mark 16 for shop data; this does not buy goods.";
      }
    } else if (${JSON.stringify(actionName)} === "smallmap-click-first-city") {
      const scene = currentScene();
      const cityView = scene && scene.cityView;
      const candidates = [];
      if (cityView) {
        walk(cityView, (node, nodePath) => {
          if (node && node.name === "RogueCityItemUI" && node.data && node._mouseState !== 0 && typeof node.OnClickCity === "function" && isVisible(node)) {
            candidates.push({ node, nodePath });
          }
        }, "currentScene.cityView", 0, 8);
      }
      if (!scene || !/RogueSmallMapScene/.test(labelOf(scene))) {
        action = { ok: false, actionName: "smallmap-click-first-city", reason: "Current scene is not RogueSmallMapScene" };
      } else if (!candidates.length) {
        action = { ok: false, actionName: "smallmap-click-first-city", reason: "No visible clickable RogueCityItemUI with data found" };
      } else {
        const candidate = candidates[0];
        action.target = {
          path: candidate.nodePath,
          rogueEventId: candidate.node.rogueEventId,
          rogueEventType: candidate.node.rogueEventType,
          data: candidate.node.data ? plainFields(candidate.node.data, 80) : null,
          x: candidate.node.x,
          y: candidate.node.y
        };
        candidate.node.OnClickCity(null);
        action.called = "RogueCityItemUI.OnClickCity(null)";
        action.note = "Clicks the first visible selectable rogue city item. This can select a branch or open an event/fight window, but does not buy goods.";
      }
    }
    return { before, action };
  })()`;
}

function snapshotExpression() {
  return `(() => { ${helpers()} return collect(); })()`;
}

function readmeText(payload) {
  const before = payload.action?.before || {};
  const after = payload.after || {};
  const records = payload.dump?.value?.records || [];
  const lines = [];
  lines.push(`# Rogue Runtime Sample: ${payload.actionName}`);
  lines.push("");
  lines.push(`- Captured: ${new Date().toISOString()}`);
  lines.push(`- Action ok: ${!!payload.action?.action?.ok}`);
  lines.push(`- Action call: ${payload.action?.action?.called || ""}`);
  lines.push(`- Before scene: ${before.currentScene?.sceneName || before.currentScene?.label || ""}`);
  lines.push(`- After scene: ${after.currentScene?.sceneName || after.currentScene?.label || ""}`);
  lines.push(`- Rogue entry: ${before.rogueEntry?.data?.fields?.ModelDesc || before.rogueEntry?.data?.fields?.sectionDesc || before.rogueEntry?.node?.fields?.modeId || ""}`);
  lines.push(`- PveMgr after: ${after.pveMgr ? after.pveMgr.ctor : "(none)"}`);
  lines.push(`- Event records: ${records.length}`);
  lines.push("");
  lines.push("No purchase methods are called by this sample.");
  lines.push("");
  lines.push("## Events");
  lines.push("");
  for (const record of records.slice(0, 100)) {
    lines.push(`- #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const actionName = process.argv[2] || "scan";
  if (!["scan", "enter-mode", "bigmap-join", "bigmap-confirm-warning", "select-general-confirm", "request-shop-data", "smallmap-click-first-city"].includes(actionName)) throw new Error(`Unsupported rogue action: ${actionName}`);
  const dir = outputDir(actionName);
  await mkdir(dir, { recursive: true });

  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const action = await evaluateOnSgs(actionExpression(actionName), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  await sleep(Number(process.env.SGS_ROGUE_WAIT_MS || (actionName === "enter-mode" || actionName === "bigmap-join" || actionName === "request-shop-data" || actionName === "smallmap-click-first-city" ? 5000 : actionName === "bigmap-confirm-warning" || actionName === "select-general-confirm" ? 7000 : 500)));
  const after = await evaluateOnSgs(snapshotExpression(), { timeoutMs: 30000, cdpTimeoutMs: 60000 });
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });

  const payload = {
    ok: true,
    target: action.target,
    actionName,
    install: install.value,
    action: action.value,
    after: after.value,
    dump,
    stop: stop.value
  };
  await writeJson(path.join(dir, "rogue-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    dir,
    action: payload.action?.action,
    beforeScene: payload.action?.before?.currentScene?.sceneName || null,
    afterScene: payload.after?.currentScene?.sceneName || null,
    rogueEntry: payload.action?.before?.rogueEntry?.data?.fields || null,
    pveMgr: payload.after?.pveMgr ? payload.after.pveMgr.ctor : null,
    recordCount: payload.dump?.value?.records?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
