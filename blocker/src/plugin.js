// ==SgsPlugin==
// @id           sgs.blocker
// @name         SGS Blocker
// @version      0.2.0
// @description  Reversibly blocks verified advertisement, effect-resource, and item-popup paths.
// @permissions  core.plugin-config,core.events,browser.public-method-hook,laya.stage-scan,laya.public-node-inspect,runtime.window-events
// @updateMode   default
// ==/SgsPlugin==

(() => {
  "use strict";

  const placeholders = {
    json: "data:application/json,{}",
    png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADklEQVR4AWNgGAWgEAAAAQgAAfZFpq0AAAAASUVORK5CYII=",
    skeleton: "data:basic;base64,EwBMQVlBQU5JTUFUSU9OOjEuNy4wBgBEcmFnb24OAHJvb3QKYm9uZQpwbGF5AfwAAAAAAQAAAAIAq6omQgIAAP//AgAAAAAAAAIAq6omQgEAAH9DAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAf0MAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAAAAAAEAAAACAgAAAAAAAgCrqiZCAQAAfkMAAIA/AAAAAAAAAAAAAIA/AACAPwAAgD8AAAAAAAAAAAAAAAABAAB/QwAAgD8AAAAAAAAAAAAAgD8AAIA/AACAPwAAAAAAAAAACAAIAAEAAAAcAHBsYWNlaG9sZGVyLnBuZwpwbGFjZWhvbGRlcgoAAIA/AACAPwAAgEAAAIBAAADAfwAAwH8AAMB/AADAfwEAAgAAAAAAAAACAAQAcm9vdAkAdW5kZWZpbmVkAADAfwAABABib25lBAByb290AADAfwAACAAQAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAgL8AAIC/AAAAAAAAAAAAAAAAAAABAAEAAAAAAQAAAAEAAAAAAAEABABib25lBABib25lBABudWxsAAAeAApib25lCnBsYWNlaG9sZGVyCnBsYWNlaG9sZGVyCgEBAQAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgEAAAIBAAAAAAAAAAAAAAAAAAAAAAA=="
  };

  function effectReplacement(originUrl) {
    let path = "";
    try {
      path = new URL(String(originUrl), location.href).pathname;
    } catch {
      return originUrl;
    }
    if (path.endsWith("placeholder.png")) return placeholders.png;
    if (path.endsWith(".json") && path.includes("res/assets/animate/game/neweffect/EFF_NanManRuQing")) return placeholders.json;
    if (!path.endsWith(".sk")) return originUrl;
    if (["EF_Plot_tiesuo", "Plot_tiesuolianhuan", "EFF_jiu", "EFF_hejiu"].some((value) => path.includes(value))) return originUrl;
    if (path.includes("/res/runtime/pc/AvatarShow/FullScreenShow/")) return placeholders.skeleton;
    if (["FX_", "xuanhujishi", "xinglinchunman", "miaoshouhuichun"].some((value) => path.includes(`res/assets/animate/game/effect/${value}`))) return placeholders.skeleton;
    if (["OL_PaiJu_", "Plot_", "EF_Plot_", "Eff_", "EFF_", "EF_", "EF_Basic_Sha_01"].some((value) => path.includes(`res/assets/animate/game/neweffect/${value}`))) return placeholders.skeleton;
    if (path.includes("res/assets/animate/game/neweffect/SkillEffect/")) return placeholders.skeleton;
    if (["nianshou", "gushe", "hongtu", "ziruo/FX_jiangwan_xiaqi"].some((value) => path.includes(`res/assets/animate/game/skill/${value}`))) return placeholders.skeleton;
    if (["skillEffect", "skinEffectNew"].some((value) => path.includes(`res/assets/animate/${value}`))) return placeholders.skeleton;
    return originUrl;
  }

  SgsFramework.plugins.define({
    id: "sgs.blocker",
    manifest: {
      name: "SGS Blocker",
      version: "0.2.0",
      description: "Reversibly blocks verified advertisement, effect-resource, and item-popup paths.",
      permissions: [
        "core.plugin-config",
        "core.events",
        "browser.public-method-hook",
        "laya.stage-scan",
        "laya.public-node-inspect",
        "runtime.window-events"
      ]
    },
    defaults: {
      ads: true,
      effects: false,
      items: false
    },
    settings: [
      {
        id: "blocking",
        name: "屏蔽项目",
        items: [
          { key: "ads", name: "屏蔽广告", type: "toggle", onChange: "apply" },
          { key: "effects", name: "屏蔽特效", type: "toggle", onChange: "apply" },
          { key: "items", name: "屏蔽道具弹窗", type: "toggle", onChange: "apply" }
        ]
      }
    ],
    actions: {
      apply(context) {
        context.blocker?.apply?.();
      },
      onReset(context) {
        context.blocker?.apply?.();
      },
      status(context) {
        return context.blocker?.status?.() || null;
      }
    },
    install(context) {
      const hookedOwners = new WeakMap();
      let hookCount = 0;

      function config(name) {
        return context.config.get(name, false) === true;
      }

      function labels(node, info = {}) {
        return [info.className, info.sceneName, info.name, node?._className_, node?.sceneName, node?.name, node?.constructor?.name]
          .filter(Boolean)
          .join(" ");
      }

      function registeredClass(name) {
        const classMap = context.laya.getLaya()?.ClassUtils?._classMap || {};
        const key = Object.keys(classMap).find((item) => item === name || item.endsWith(`/${name}`) || item.endsWith(`.${name}`));
        return key ? classMap[key] : null;
      }

      function ownHook(owner, methodName, handler, label) {
        if (!owner || typeof owner[methodName] !== "function") return false;
        if (!hookedOwners.has(owner)) hookedOwners.set(owner, new Set());
        const methods = hookedOwners.get(owner);
        if (methods.has(methodName)) return false;
        const cancel = context.hooks.wrapMethod(owner, methodName, handler, { label });
        methods.add(methodName);
        hookCount += 1;
        context.addDisposer(() => {
          cancel();
          methods.delete(methodName);
          hookCount -= 1;
        }, label);
        return true;
      }

      function installNetworkHook() {
        ownHook(XMLHttpRequest?.prototype, "open", ({ args, callOriginal }) => {
          if (!config("effects") || args.length < 2) return callOriginal();
          const nextArgs = args.slice();
          nextArgs[1] = effectReplacement(nextArgs[1]);
          return callOriginal(nextArgs);
        }, "blocker:xhr-open");
      }

      function effectHandler({ callOriginal, thisArg }) {
        if (!config("effects") || thisArg?.nameOrIndex !== "play") return callOriginal();
        const effectUrl = String(thisArg?.effectUrl || "");
        if (effectUrl.includes("Plot_tiesuolianhuan")) {
          return thisArg.event?.(context.laya.getLaya()?.Event?.STOPPED);
        }
        if (effectUrl.includes("FX_SHT_SLCX")) {
          return thisArg?._parent?.currentBossCityItem?.ShowBossIcon?.();
        }
        return callOriginal();
      }

      function installClassHooks() {
        const modeClass = registeredClass("ModeScene");
        ownHook(modeClass?.prototype, "showAdView", ({ callOriginal }) => config("ads") ? undefined : callOriginal(), "blocker:mode-ad-view");

        const tianShuClass = registeredClass("TianShuWindow");
        ownHook(tianShuClass?.prototype, "updateWinUI", ({ args, callOriginal, thisArg }) => {
          if (config("items") && Number(args[0]?.type) === 6) return thisArg?.Close?.();
          return callOriginal();
        }, "blocker:tianshu-item-popup");

        const classMap = context.laya.getLaya()?.ClassUtils?._classMap || {};
        for (const value of Object.values(classMap)) {
          if (typeof value?.prototype?.playEffect === "function") {
            ownHook(value.prototype, "playEffect", effectHandler, "blocker:registered-play-effect");
          }
        }
      }

      function installSceneHooks() {
        const stage = context.laya.getStage();
        if (!stage) return;
        for (const entry of context.laya.walk(stage, { includeHidden: true, maxDepth: 14 })) {
          const node = entry.node;
          const label = labels(node, entry.info);
          if (/(^|\s)ModeScene(\s|$)/.test(label)) {
            if (config("ads")) node.hideAdView?.();
            const leftViewPrototype = node.leftView ? Object.getPrototypeOf(node.leftView) : null;
            ownHook(leftViewPrototype, "getBtnRes", ({ callOriginal }) => {
              const result = callOriginal();
              if (!config("ads") || !Array.isArray(result)) return result;
              return result
                .filter((item) => Number(item?.type) !== 0x27cb)
                .sort((left, right) => Number(!!right?.zhutiIcon) - Number(!!left?.zhutiIcon));
            }, "blocker:mode-ad-button");
          }
          if (typeof node?.playEffect === "function" && ("effectUrl" in node || /Effect/i.test(label))) {
            ownHook(Object.getPrototypeOf(node), "playEffect", effectHandler, "blocker:stage-play-effect");
          }
        }
      }

      function closeMatchingWindow(payload) {
        const node = payload?.node;
        if (!node) return;
        const name = labels(node, payload.info);
        if (config("ads") && /(^|\s)AdPushWindow(\s|$)/.test(name)) {
          let closed = false;
          for (const view of Array.isArray(node.curViewList) ? node.curViewList : []) {
            if (typeof view?.closeClicker === "function") {
              view.closeClicker();
              closed = true;
            }
          }
          if (!closed) node.Close?.();
        }
        if (config("items") && /(^|\s)(GetPropSpecialWindow|GeneralOpenResultWindow|SkinOpenResultWindowNew|OldbackOneClickDrawAwdWin)(\s|$)/.test(name)) {
          node.Close?.();
        }
      }

      function installHooks() {
        installNetworkHook();
        installClassHooks();
        installSceneHooks();
      }

      function apply() {
        installHooks();
        const stage = context.laya.getStage();
        if (!stage) return;
        for (const entry of context.laya.walk(stage, { includeHidden: true, maxDepth: 14 })) {
          closeMatchingWindow({ node: entry.node, info: entry.info });
        }
      }

      const removeWindowOpen = context.events.on("window:open", closeMatchingWindow);
      context.addDisposer(removeWindowOpen, "blocker:window-open");
      const cancelScan = context.timers.setInterval(installHooks, 500, "blocker-hook-scan");
      context.addDisposer(cancelScan, "blocker:hook-scan");
      context.blocker = {
        apply,
        status() {
          return {
            hookCount,
            ads: config("ads"),
            effects: config("effects"),
            items: config("items")
          };
        }
      };
      apply();
      return () => {
        context.blocker = null;
      };
    }
  });
})();
