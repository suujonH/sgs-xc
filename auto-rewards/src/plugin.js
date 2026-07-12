// ==SgsPlugin==
// @id           sgs.auto-rewards
// @name         SGS AutoRewards
// @version      0.1.0
// @description  Automatically claims configured daily rewards at server-day rollover and plugin startup.
// @permissions  core.plugin-config,laya.stage-ready,laya.public-node-inspect,game.privilege-reward-request,game.free-draw-request,game.guild-free-drum-request,game.officer-reward-request,game.sign-reward-request,game.tree-reward-request
// @updateMode   default
// ==/SgsPlugin==

(() => {
  "use strict";

  const cardRewardDefinition = {
    action: "claimCardRewards",
    cards: [
      {
        id: "month",
        name: "month-card",
        className: "ZhiGouMonthCardView",
        cardType: 3,
        configField: "monthCfg",
        cumulative: true
      },
      {
        id: "week",
        name: "week-card",
        className: "NewWeekCardView",
        cardType: 2,
        configField: "weekCfg",
        cumulative: false
      }
    ],
    requestTimeoutMs: 5000
  };

  const freeGeneralDrawDefinition = {
    action: "claimFreeGeneralDrawRewards",
    className: "GeneralOpenWindow",
    requestClassName: "ClientGeneralDrawCardReq",
    requestTimeoutMs: 5000
  };

  const freeBlessDrawDefinition = {
    action: "claimFreeBlessDrawRewards",
    className: "BlessNewWindowView",
    requestTimeoutMs: 5000
  };

  const freeGuildDrumDefinition = {
    action: "useFreeGuildDrums",
    className: "GuildDrumWindow",
    freeDrumId: 1,
    freeDrumName: "常山战鼓",
    requestTimeoutMs: 5000
  };

  const officerRewardDefinition = {
    action: "claimOfficerSalaryRewards",
    className: "OfficerWindow",
    requestTimeoutMs: 5000
  };

  const signRewardDefinition = {
    action: "claimSignRewards",
    className: "DailySignNewView",
    requestTimeoutMs: 5000
  };

  const treeRewardDefinition = {
    action: "claimTreeRewards",
    className: "KanShuWindow",
    requestTimeoutMs: 15000
  };

  function labelParts(node, info = {}) {
    return [
      info.className,
      info.sceneName,
      info.name,
      node?._className_,
      node?.sceneName,
      node?.name,
      node?.constructor?.name
    ].filter(Boolean).map(String);
  }

  function summary(node, info = {}) {
    return {
      className: String(info.className || node?._className_ || node?.constructor?.name || ""),
      sceneName: String(info.sceneName || node?.sceneName || ""),
      name: String(info.name || node?.name || ""),
      path: String(info.path || "")
    };
  }

  function visibleEntries(context) {
    const stage = context.laya.getStage();
    return stage ? context.laya.walk(stage, { maxDepth: 14 }) : [];
  }

  function currentScene(entries) {
    const scenes = entries.filter(({ node, info }) => String(info.sceneName || node?.sceneName || "").endsWith("Scene"));
    return scenes.length ? summary(scenes[scenes.length - 1].node, scenes[scenes.length - 1].info) : null;
  }

  function failure(definition, status, reason, entries = []) {
    return {
      ok: false,
      action: definition.action,
      status,
      modeId: definition.modeId,
      reason,
      currentScene: currentScene(entries)
    };
  }

  function registeredClass(context, className) {
    const Laya = context.laya.getLaya();
    const classMap = Laya?.ClassUtils?._classMap || {};
    if (classMap[className]) return classMap[className];
    return Object.entries(classMap).find(([key]) =>
      key.endsWith(`/${className}`) || key.endsWith(`.${className}`)
    )?.[1] || null;
  }

  function captureEventRegistrations(context, register) {
    const Laya = context.laya.getLaya();
    const eventPrototype = Laya?.EventDispatcher?.prototype;
    const originalOn = eventPrototype?.on;
    if (!eventPrototype || typeof originalOn !== "function") return [];
    const captures = [];
    eventPrototype.on = function captureAutomationEmitter(type, caller, listener, args) {
      captures.push({ emitter: this, type, caller, listener });
      return originalOn.call(this, type, caller, listener, args);
    };
    try {
      register();
    } finally {
      eventPrototype.on = originalOn;
    }
    return captures;
  }

  function destroyDetached(context, node) {
    if (!node) return;
    const Sprite = context.laya.getLaya()?.Sprite;
    if (typeof Sprite?.prototype?.destroy === "function") {
      Sprite.prototype.destroy.call(node, true);
      return;
    }
    node.destroy?.(true);
  }

  function captureManagerFromClass(context, className, requiredMethods) {
    const RuntimeClass = registeredClass(context, className);
    if (!RuntimeClass) return { manager: null, registrations: [], instance: null };
    const instance = new RuntimeClass();
    let registrations = [];
    try {
      registrations = captureEventRegistrations(context, () => instance.addEventListener?.());
      const managerEntry = registrations.find(({ emitter }) =>
        requiredMethods.every((method) => typeof emitter?.[method] === "function")
      );
      return { manager: managerEntry?.emitter || null, registrations, instance };
    } catch (error) {
      try {
        instance.removeEventListener?.();
      } catch {
        // Best-effort cleanup for a detached runtime view.
      }
      try {
        destroyDetached(context, instance);
      } catch {
        // Best-effort cleanup for a detached runtime view.
      }
      throw error;
    }
  }

  function releaseCapturedClass(context, captured, label) {
    try {
      captured?.instance?.removeEventListener?.();
    } catch (error) {
      context.logger.warn(`${label} listener cleanup failed`, error);
    }
    try {
      destroyDetached(context, captured?.instance);
    } catch (error) {
      context.logger.warn(`${label} detached instance cleanup failed`, error);
    }
  }

  function captureBlessManager(context) {
    const BlessView = registeredClass(context, freeBlessDrawDefinition.className);
    if (!BlessView || typeof BlessView.prototype?.addEventListener !== "function") {
      return { manager: null, refreshEvent: null };
    }
    const fakeView = Object.create(BlessView.prototype);
    fakeView.contentSprite = { on() {}, off() {} };
    let registrations = [];
    try {
      registrations = captureEventRegistrations(context, () => fakeView.addEventListener());
    } finally {
      try {
        fakeView.removeEventListener?.();
      } catch {
        // The fake view exists only to reveal its registered singleton managers.
      }
    }
    const managerEntry = registrations.find(({ emitter }) =>
      typeof emitter?.CanFreeBless === "function" &&
      typeof emitter?.sendQifuDrawReq === "function" &&
      typeof emitter?.SendAllListReq === "function"
    );
    const refreshEntry = registrations.find(({ emitter, listener }) =>
      emitter === managerEntry?.emitter && listener === fakeView.UpdateAllUI
    );
    return {
      manager: managerEntry?.emitter || null,
      refreshEvent: refreshEntry?.type || null
    };
  }

  function delay(context, lifecycle, ms, label) {
    return new Promise((resolve) => {
      let cancelTimer = () => {};
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        lifecycle.waitCancels.delete(cancelWait);
        cancelTimer();
        resolve();
      };
      const cancelWait = () => finish();
      lifecycle.waitCancels.add(cancelWait);
      cancelTimer = context.timers.setTimeout(finish, ms, label);
    });
  }

  function cardUiEntries(context) {
    const classNames = new Set([
      "WelfareWindow",
      "PriMonthCardView",
      "ZhiGouMonthCardView",
      "NewWeekCardView"
    ]);
    return visibleEntries(context).filter(({ node, info }) =>
      labelParts(node, info).some((label) => classNames.has(label))
    );
  }

  function initializeCardView(context, view) {
    const Laya = context.laya.getLaya();
    const eventPrototype = Laya?.EventDispatcher?.prototype;
    const originalOn = eventPrototype?.on;
    if (!eventPrototype || typeof originalOn !== "function" || typeof view?.Init !== "function") {
      return { manager: null, dataEvent: null, dailyEvent: null };
    }

    let manager = null;
    let dataEvent = null;
    let dailyEvent = null;
    const wrappedOn = function wrappedCardEvent(type, caller, listener, args) {
      if (caller === view && listener === view.updateAllInfo) {
        manager = this;
        dataEvent = type;
      }
      if (caller === view && listener === view.updateDailyTaskById) {
        manager ||= this;
        dailyEvent = type;
      }
      return originalOn.call(this, type, caller, listener, args);
    };
    eventPrototype.on = wrappedOn;
    try {
      view.Init();
    } finally {
      eventPrototype.on = originalOn;
    }
    return { manager, dataEvent, dailyEvent };
  }

  function requestAndWaitForEvent(
    context,
    lifecycle,
    manager,
    eventType,
    request,
    label,
    timeoutMs = cardRewardDefinition.requestTimeoutMs
  ) {
    if (!lifecycle.active) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const caller = {};
      let cancelTimeout = () => {};
      let settled = false;
      const finish = (observed) => {
        if (settled) return;
        settled = true;
        lifecycle.waitCancels.delete(cancelWait);
        cancelTimeout();
        manager.off(eventType, caller, onUpdate);
        resolve(observed);
      };
      const cancelWait = () => finish(false);
      const onUpdate = () => finish(true);
      lifecycle.waitCancels.add(cancelWait);
      manager.on(eventType, caller, onUpdate);
      cancelTimeout = context.timers.setTimeout(
        () => finish(false),
        timeoutMs,
        label
      );
      try {
        request();
      } catch (error) {
        settled = true;
        lifecycle.waitCancels.delete(cancelWait);
        cancelTimeout();
        manager.off(eventType, caller, onUpdate);
        reject(error);
      }
    });
  }

  async function waitForCondition(context, lifecycle, predicate, timeoutMs, label) {
    const expiresAt = Date.now() + timeoutMs;
    while (lifecycle.active && Date.now() < expiresAt) {
      if (predicate()) return true;
      await delay(context, lifecycle, 100, label);
    }
    return lifecycle.active && Boolean(predicate());
  }

  function cardSnapshot(view, manager, cardDefinition) {
    const card = manager?.GetCardDataByType?.(cardDefinition.cardType) || view?.cardData;
    const rewardConfig = view?.[cardDefinition.configField];
    return card ? {
      type: Number(card.type) || null,
      active: Boolean(card.bActive),
      dailyRewardAvailable: Boolean(card.bReward),
      silverRewardAvailable: Boolean(rewardConfig?.IsItemCanReward),
      rewardDays: Number(card.rewardDays) || 0,
      totalDays: Number(card.days) || 0,
      leftDays: typeof card.LeftDays === "function" ? Number(card.LeftDays()) : null,
      cumulativeDays: typeof card.AddDays === "function" ? Number(card.AddDays()) : 0
    } : null;
  }

  function cardMilestones(view) {
    const card = view?.cardData;
    const claimed = Array.from(card?.AddAwardsHasAwardList?.() || []);
    const claimable = Array.from(card?.AddAwardsCanAwardList?.() || []);
    const count = Math.max(claimed.length, claimable.length, view?.addItemList?.length || 0);
    const results = [];
    for (let index = 0; index < count; index += 1) {
      const item = view?.addItemList?.[index];
      const dayText = String(view?.addTxtList?.[index]?.text || "");
      results.push({
        index,
        day: Number(dayText.replace(/\D/g, "")) || null,
        rewardName: String(item?.baseData?.name || item?.BaseData?.name || ""),
        rewardCount: Number(item?.propCount) || 0,
        claimed: Boolean(claimed[index]),
        claimable: Boolean(claimable[index])
      });
    }
    return results;
  }

  async function claimCardMilestones(context, lifecycle, view, manager, dataEvent) {
    const results = [];
    const initialCount = cardMilestones(view).length;
    for (let index = 0; index < initialCount; index += 1) {
      const before = cardMilestones(view)[index] || { index };
      if (!lifecycle.active) {
        results.push({ ...before, status: "inactive" });
        continue;
      }
      if (before.claimed) {
        results.push({ ...before, status: "already-claimed" });
        continue;
      }
      if (!before.claimable) {
        results.push({ ...before, status: "not-eligible" });
        continue;
      }
      try {
        const observed = await requestAndWaitForEvent(
          context,
          lifecycle,
          manager,
          dataEvent,
          () => view.addItemClick(index),
          `auto-rewards-month-card-milestone-${index}`
        );
        view.updateContent?.();
        const after = cardMilestones(view)[index] || before;
        const confirmed = after.claimed && !after.claimable;
        results.push({
          ...after,
          status: confirmed ? "claimed" : observed ? "request-unconfirmed" : "request-timeout"
        });
      } catch (error) {
        results.push({
          ...before,
          status: "error",
          reason: String(error?.message || error)
        });
      }
    }
    return results;
  }

  async function claimCardDailyReward(
    context,
    lifecycle,
    view,
    manager,
    dataEvent,
    cardDefinition,
    trigger,
    before
  ) {
    if (!before.active) return { status: "card-inactive" };
    const forceRequest = trigger === "day-rollover";
    if (!forceRequest && !before.dailyRewardAvailable) {
      return { rewardDay: before.rewardDays, status: "already-claimed" };
    }
    const observed = await requestAndWaitForEvent(
      context,
      lifecycle,
      manager,
      dataEvent,
      () => manager.SendClientPrivilegeRewardReq(before.rewardDays, cardDefinition.cardType),
      `auto-rewards-${cardDefinition.name}-daily`
    );
    view.updateContent?.();
    view.updateStatus?.();
    const after = cardSnapshot(view, manager, cardDefinition);
    const confirmed = Boolean(after && !after.dailyRewardAvailable &&
      (before.dailyRewardAvailable || after.rewardDays !== before.rewardDays));
    return {
      rewardDay: before.rewardDays,
      forced: forceRequest,
      observed,
      status: confirmed
        ? "claimed"
        : forceRequest ? "requested" : observed ? "request-unconfirmed" : "request-timeout"
    };
  }

  async function claimCardSilverReward(
    context,
    lifecycle,
    view,
    manager,
    dailyEvent,
    cardDefinition,
    trigger,
    before
  ) {
    if (!before.active) return { status: "card-inactive" };
    const forceRequest = trigger === "day-rollover";
    if (!forceRequest && !before.silverRewardAvailable) return { status: "already-claimed" };
    const observed = await requestAndWaitForEvent(
      context,
      lifecycle,
      manager,
      dailyEvent,
      () => manager.PrivilegeCardDaliyRewardReq(cardDefinition.cardType),
      `auto-rewards-${cardDefinition.name}-silver`
    );
    view.updateRewardTask?.();
    const after = cardSnapshot(view, manager, cardDefinition);
    const confirmed = Boolean(after && before.silverRewardAvailable && !after.silverRewardAvailable);
    return {
      forced: forceRequest,
      observed,
      status: confirmed
        ? "claimed"
        : forceRequest ? "requested" : observed ? "request-unconfirmed" : "request-timeout"
    };
  }

  async function claimOneCard(context, lifecycle, cardDefinition, trigger) {
    let view = null;
    try {
      const CardView = registeredClass(context, cardDefinition.className);
      if (!CardView) {
        return failure(cardRewardDefinition, "runtime-unavailable", `Registered ${cardDefinition.className} is unavailable.`);
      }
      view = new CardView();
      const { manager, dataEvent, dailyEvent } = initializeCardView(context, view);
      if (!manager || !dataEvent || !dailyEvent ||
          typeof manager.SendClientPrivilegeDataReq !== "function" ||
          typeof manager.SendClientPrivilegeRewardReq !== "function" ||
          typeof manager.PrivilegeCardDaliyRewardReq !== "function") {
        return failure(cardRewardDefinition, "runtime-unavailable", `${cardDefinition.name} reward interfaces are unavailable.`);
      }

      const refreshed = await requestAndWaitForEvent(
        context,
        lifecycle,
        manager,
        dataEvent,
        () => manager.SendClientPrivilegeDataReq(),
        `auto-rewards-${cardDefinition.name}-refresh`
      );
      view.updateContent?.();
      view.updateStatus?.();
      view.updateRewardTask?.();
      const before = cardSnapshot(view, manager, cardDefinition);
      if (!before || before.type !== cardDefinition.cardType) {
        return {
          ok: true,
          action: cardRewardDefinition.action,
          card: cardDefinition.id,
          status: "card-inactive",
          refreshed
        };
      }
      if (!before.active) {
        return {
          ok: true,
          action: cardRewardDefinition.action,
          card: cardDefinition.id,
          status: "card-inactive",
          refreshed,
          cardBefore: before
        };
      }

      const dailyReward = await claimCardDailyReward(
        context,
        lifecycle,
        view,
        manager,
        dataEvent,
        cardDefinition,
        trigger,
        before
      );
      const silverReward = await claimCardSilverReward(
        context,
        lifecycle,
        view,
        manager,
        dailyEvent,
        cardDefinition,
        trigger,
        cardSnapshot(view, manager, cardDefinition) || before
      );
      const cumulativeRewards = cardDefinition.cumulative
        ? await claimCardMilestones(context, lifecycle, view, manager, dataEvent)
        : [];
      const after = cardSnapshot(view, manager, cardDefinition);
      const allRewards = [dailyReward, silverReward, ...cumulativeRewards];
      const failed = allRewards.filter((item) =>
        ["error", "inactive", "request-timeout", "request-unconfirmed"].includes(item.status)
      );
      const requested = allRewards.filter((item) => ["claimed", "requested"].includes(item.status));
      return {
        ok: failed.length === 0,
        action: cardRewardDefinition.action,
        card: cardDefinition.id,
        status: failed.length ? "partial" : requested.length ? "claimed-or-requested" : "nothing-claimable",
        refreshed,
        cardBefore: before,
        cardAfter: after,
        dailyReward,
        silverReward,
        cumulativeRewards
      };
    } catch (error) {
      return failure(cardRewardDefinition, "runtime-error", String(error?.message || error));
    } finally {
      try {
        view?.removeEventListener?.();
      } catch (error) {
        context.logger.warn(`detached ${cardDefinition.className} listener cleanup failed`, error);
      }
      try {
        destroyDetached(context, view);
      } catch (error) {
        context.logger.warn(`detached ${cardDefinition.className} cleanup failed`, error);
      }
    }
  }

  async function claimCardRewards(context, lifecycle, trigger) {
    const beforeEntries = cardUiEntries(context);
    const cards = [];
    for (const cardDefinition of cardRewardDefinition.cards) {
      if (!lifecycle.active) break;
      cards.push(await claimOneCard(context, lifecycle, cardDefinition, trigger));
    }
    const afterEntries = cardUiEntries(context);
    const beforeNodes = new Set(beforeEntries.map((entry) => entry.node));
    const failed = cards.filter((card) => !card.ok);
    return {
      ok: failed.length === 0,
      action: cardRewardDefinition.action,
      status: failed.length ? "partial" : cards.some((card) => card.status === "claimed-or-requested")
        ? "claimed-or-requested"
        : "nothing-claimable",
      trigger,
      cards,
      cardUi: {
        before: beforeEntries.map(({ node, info }) => summary(node, info)),
        after: afterEntries.map(({ node, info }) => summary(node, info)),
        opened: afterEntries.filter((entry) => !beforeNodes.has(entry.node)).map(({ node, info }) => summary(node, info))
      }
    };
  }

  function generalDrawSnapshot(manager, freeView) {
    const lastFreeTime = Number(manager?.FreeOpenGeneralPackTime) || 0;
    const managerCanFree = lastFreeTime === 0 || Boolean(manager?.CanFreeOpenGeneral?.());
    return {
      freeDropId: Number(freeView?.CommonVO?.freeGeneralDropId) || 0,
      lastFreeTime,
      managerCanFree,
      freeLabelVisible: Boolean(freeView?.freeTxt?.visible),
      freeButtonEnabled: freeView?.freeBtn?.enabled !== false,
      requestBusy: Boolean(manager?.reservePool?.Value)
    };
  }

  async function claimFreeGeneralDrawRewards(context, lifecycle) {
    const definition = freeGeneralDrawDefinition;
    const GeneralWindow = registeredClass(context, definition.className);
    const DrawRequest = registeredClass(context, definition.requestClassName);
    let detachedWindow = null;
    let freeView = null;
    try {
      if (!GeneralWindow || !DrawRequest || Number(DrawRequest.Free_MianFei_Draw) <= 0) {
        return failure(definition, "runtime-unavailable", "Free general-draw interfaces are unavailable.");
      }
      detachedWindow = new GeneralWindow();
      detachedWindow.selectSp = { visible: true };
      const registrations = captureEventRegistrations(context, () => detachedWindow.onTabClick(0));
      freeView = detachedWindow.newView;
      const managerEntry = registrations.find(({ emitter }) =>
        typeof emitter?.CanFreeOpenGeneral === "function" &&
        typeof emitter?.SendClientUseGeneralDrawCardReq === "function"
      );
      const manager = managerEntry?.emitter;
      const updateEvent = registrations.find(({ emitter, caller, listener }) =>
        emitter === manager && caller === freeView && listener === freeView?.updateFreePack
      )?.type;
      if (!manager || !updateEvent || !freeView) {
        return failure(definition, "runtime-unavailable", "Free general-draw manager could not be resolved.");
      }

      const before = generalDrawSnapshot(manager, freeView);
      const confirmedFree = before.freeDropId > 0 && before.managerCanFree &&
        before.freeLabelVisible && before.freeButtonEnabled;
      if (!confirmedFree) {
        return {
          ok: true,
          action: definition.action,
          status: "nothing-claimable",
          drawType: Number(DrawRequest.Free_MianFei_Draw),
          before,
          after: before
        };
      }
      if (before.requestBusy) {
        return {
          ok: false,
          action: definition.action,
          status: "request-busy",
          reason: "The general-draw manager is already processing another request.",
          before
        };
      }

      const observed = await requestAndWaitForEvent(
        context,
        lifecycle,
        manager,
        updateEvent,
        () => manager.SendClientUseGeneralDrawCardReq(
          before.freeDropId,
          Number(DrawRequest.Free_MianFei_Draw)
        ),
        "auto-rewards-free-general-draw",
        definition.requestTimeoutMs
      );
      const after = generalDrawSnapshot(manager, freeView);
      const confirmed = observed && !after.managerCanFree && after.lastFreeTime !== before.lastFreeTime;
      return {
        ok: confirmed,
        action: definition.action,
        status: confirmed ? "claimed" : observed ? "request-unconfirmed" : "request-timeout",
        drawType: Number(DrawRequest.Free_MianFei_Draw),
        before,
        after
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    } finally {
      try {
        freeView?.removeEventListener?.();
      } catch (error) {
        context.logger.warn("free general-draw listener cleanup failed", error);
      }
      try {
        destroyDetached(context, detachedWindow);
      } catch (error) {
        context.logger.warn("detached GeneralOpenWindow cleanup failed", error);
      }
    }
  }

  function blessRoundSnapshot(manager, roundId) {
    const id = Number(roundId) || 0;
    return {
      roundId: id,
      freeConfigured: Boolean(manager?.GetInfoById?.(id)?.freeOpen),
      inActivityTime: Boolean(manager?.IsInBlessTime?.(id)),
      inDrawTime: Boolean(manager?.IsInDrawTime?.(id)),
      canFree: Boolean(manager?.CanFreeBless?.(id))
    };
  }

  async function claimFreeBlessDrawRewards(context, lifecycle) {
    const definition = freeBlessDrawDefinition;
    try {
      const { manager, refreshEvent } = captureBlessManager(context);
      if (!manager || !refreshEvent) {
        return failure(definition, "runtime-unavailable", "Free blessing-draw manager could not be resolved.");
      }
      const refreshed = await requestAndWaitForEvent(
        context,
        lifecycle,
        manager,
        refreshEvent,
        () => manager.SendAllListReq(),
        "auto-rewards-free-bless-refresh",
        definition.requestTimeoutMs
      );
      if (!refreshed) {
        return failure(definition, "refresh-timeout", "Blessing data refresh did not settle; no draw was sent.");
      }

      const roundIds = Array.from(manager.infoDic?.keys || []).map(Number).filter((id) => id > 0);
      const before = roundIds.map((roundId) => blessRoundSnapshot(manager, roundId));
      const eligible = before.filter((round) =>
        round.freeConfigured && round.inActivityTime && round.inDrawTime && round.canFree
      );
      const draws = [];
      for (const round of eligible) {
        if (!lifecycle.active) {
          draws.push({ ...round, status: "inactive" });
          break;
        }
        const current = blessRoundSnapshot(manager, round.roundId);
        if (!current.freeConfigured || !current.inActivityTime || !current.inDrawTime || !current.canFree) {
          draws.push({ ...current, status: "no-longer-free" });
          continue;
        }
        manager.sendQifuDrawReq(round.roundId, 1);
        const settled = await waitForCondition(
          context,
          lifecycle,
          () => !manager.CanFreeBless(round.roundId),
          definition.requestTimeoutMs,
          `auto-rewards-free-bless-draw-${round.roundId}`
        );
        const afterRound = blessRoundSnapshot(manager, round.roundId);
        draws.push({
          ...afterRound,
          count: 1,
          status: settled && !afterRound.canFree ? "claimed" : "request-timeout"
        });
        if (!settled) break;
      }
      const after = roundIds.map((roundId) => blessRoundSnapshot(manager, roundId));
      const failed = draws.filter((item) => ["inactive", "request-timeout"].includes(item.status));
      const claimed = draws.filter((item) => item.status === "claimed");
      return {
        ok: failed.length === 0,
        action: definition.action,
        status: failed.length ? "partial" : claimed.length ? "claimed" : "nothing-claimable",
        before,
        draws,
        after
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    }
  }

  async function useFreeGuildDrums(context, lifecycle) {
    const definition = freeGuildDrumDefinition;
    let captured = null;
    try {
      captured = captureManagerFromClass(context, definition.className, ["SendGuildDonate"]);
      const manager = captured.manager;
      if (!manager) {
        return failure(definition, "runtime-unavailable", "Guild drum manager could not be resolved.");
      }
      const before = {
        guildId: Number(manager.GuildID) || 0,
        canDrum: Boolean(manager.CanDrum),
        freeTimes: Number(manager.LeftFreeDrumTimes) || 0
      };
      if (!before.guildId) {
        return {
          ok: true,
          action: definition.action,
          status: "not-in-guild",
          drum: { id: definition.freeDrumId, name: definition.freeDrumName },
          before,
          attempts: []
        };
      }
      if (!before.canDrum || before.freeTimes <= 0) {
        return {
          ok: true,
          action: definition.action,
          status: "nothing-claimable",
          drum: { id: definition.freeDrumId, name: definition.freeDrumName },
          before,
          attempts: [],
          remainingFreeTimes: before.freeTimes
        };
      }

      const attempts = [];
      const maxAttempts = Math.min(before.freeTimes, 100);
      while (lifecycle.active && attempts.length < maxAttempts) {
        const freeTimes = Number(manager.LeftFreeDrumTimes) || 0;
        if (freeTimes <= 0 || !manager.CanDrum) break;
        manager.SendGuildDonate();
        const settled = await waitForCondition(
          context,
          lifecycle,
          () => Number(manager.LeftFreeDrumTimes) < freeTimes,
          definition.requestTimeoutMs,
          `auto-rewards-free-guild-drum-${attempts.length + 1}`
        );
        const remaining = Number(manager.LeftFreeDrumTimes) || 0;
        attempts.push({
          index: attempts.length + 1,
          beforeFreeTimes: freeTimes,
          remainingFreeTimes: remaining,
          status: settled && remaining < freeTimes ? "used" : lifecycle.active ? "request-timeout" : "inactive"
        });
        if (!settled) break;
      }
      const remainingFreeTimes = Number(manager.LeftFreeDrumTimes) || 0;
      const failed = attempts.filter((item) => item.status !== "used");
      return {
        ok: failed.length === 0,
        action: definition.action,
        status: failed.length ? "partial" : attempts.length ? "completed" : "nothing-claimable",
        drum: { id: definition.freeDrumId, name: definition.freeDrumName },
        before,
        attempts,
        remainingFreeTimes
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    } finally {
      if (captured) releaseCapturedClass(context, captured, "guild drum");
    }
  }

  async function claimOfficerSalaryRewards(context, lifecycle) {
    const definition = officerRewardDefinition;
    let captured = null;
    try {
      captured = captureManagerFromClass(context, definition.className, [
        "CanGetOfficerDayReward",
        "CanGetOfficerWeekReward",
        "sendGetDayReward",
        "sendGetWeekReward"
      ]);
      const manager = captured.manager;
      if (!manager) {
        return failure(definition, "runtime-unavailable", "Officer reward manager could not be resolved.");
      }
      const before = {
        officerLevel: Number(manager.OfficerSLv) || 0,
        dailyClaimable: Boolean(manager.CanGetOfficerDayReward()),
        weeklyClaimable: Boolean(manager.CanGetOfficerWeekReward())
      };
      let daily = { status: before.dailyClaimable ? "pending" : "already-claimed" };
      if (before.dailyClaimable) {
        manager.sendGetDayReward();
        const settled = await waitForCondition(
          context,
          lifecycle,
          () => !manager.CanGetOfficerDayReward(),
          definition.requestTimeoutMs,
          "auto-rewards-officer-daily-salary"
        );
        daily = {
          status: settled ? "claimed" : lifecycle.active ? "request-timeout" : "inactive",
          claimableAfter: Boolean(manager.CanGetOfficerDayReward())
        };
      }

      const weeklyBefore = Boolean(manager.CanGetOfficerWeekReward());
      let weekly = { status: weeklyBefore ? "pending" : "already-claimed" };
      if (weeklyBefore && lifecycle.active) {
        manager.sendGetWeekReward();
        const settled = await waitForCondition(
          context,
          lifecycle,
          () => !manager.CanGetOfficerWeekReward(),
          definition.requestTimeoutMs,
          "auto-rewards-officer-weekly-salary"
        );
        weekly = {
          status: settled ? "claimed" : lifecycle.active ? "request-timeout" : "inactive",
          claimableAfter: Boolean(manager.CanGetOfficerWeekReward())
        };
      }
      const after = {
        dailyClaimable: Boolean(manager.CanGetOfficerDayReward()),
        weeklyClaimable: Boolean(manager.CanGetOfficerWeekReward())
      };
      const rewards = [daily, weekly];
      const failed = rewards.filter((item) =>
        ["runtime-unavailable", "request-timeout", "inactive"].includes(item.status)
      );
      const claimed = rewards.filter((item) => item.status === "claimed");
      return {
        ok: failed.length === 0,
        action: definition.action,
        status: failed.length ? "partial" : claimed.length ? "claimed" : "nothing-claimable",
        before,
        daily,
        weekly,
        after
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    } finally {
      if (captured) releaseCapturedClass(context, captured, "officer reward");
    }
  }

  function releaseRegistrations(registrations) {
    for (const registration of registrations || []) {
      try {
        registration.emitter?.off?.(
          registration.type,
          registration.caller,
          registration.listener
        );
      } catch {
        // Detached runtime objects are also destroyed by their owner.
      }
    }
  }

  function resolveManagerList(context, lifecycle) {
    if (lifecycle.managerList?.length) return lifecycle.managerList;
    let captured = null;
    try {
      captured = captureManagerFromClass(
        context,
        "ZhiGouMonthCardView",
        ["SendClientPrivilegeDataReq"]
      );
      const managerBase = captured.manager
        ? Object.getPrototypeOf(captured.manager.constructor)
        : null;
      const managers = Array.from(managerBase?.managerList || []);
      if (managers.length) lifecycle.managerList = managers;
      return managers;
    } finally {
      if (captured) releaseCapturedClass(context, captured, "manager-list resolver");
    }
  }

  function findManager(managers, methods) {
    return managers.find((manager) =>
      methods.every((method) => typeof manager?.[method] === "function")
    ) || null;
  }

  function serverClockSnapshot(context, lifecycle) {
    const managers = resolveManagerList(context, lifecycle);
    const clock = managers.find((manager) => {
      try {
        return Number.isFinite(Number(manager?.ServerTime)) &&
          manager?.ServerDate instanceof Date;
      } catch {
        return false;
      }
    });
    if (!clock) return null;
    const date = clock.ServerDate;
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      epochSeconds: Number(clock.ServerTime),
      dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      year,
      month,
      day,
      hour,
      minute,
      second,
      monthEnd: day === monthDays
    };
  }

  async function claimSignCumulativeRewards(context, lifecycle, view, manager) {
    const results = [];
    const totalSignNum = Number(manager?.TotalSignNum) || 0;
    const claimedDays = () => Array.from(manager?.AddupprizeDays || []).map(Number);
    for (const item of Array.from(view?.totalItemList || [])) {
      const rewardDay = Number(item?.Days) || 0;
      if (!rewardDay || rewardDay > totalSignNum) {
        results.push({ rewardDay, status: "not-eligible" });
        continue;
      }
      if (claimedDays().includes(rewardDay)) {
        results.push({ rewardDay, status: "already-claimed" });
        continue;
      }
      if (!lifecycle.active) {
        results.push({ rewardDay, status: "inactive" });
        break;
      }
      item.OnSignClick(false);
      const settled = await waitForCondition(
        context,
        lifecycle,
        () => claimedDays().includes(rewardDay),
        signRewardDefinition.requestTimeoutMs,
        `auto-rewards-sign-cumulative-${rewardDay}`
      );
      results.push({
        rewardDay,
        status: settled ? "claimed" : lifecycle.active ? "request-timeout" : "inactive"
      });
      if (!settled) break;
    }
    return { totalSignNum, results };
  }

  async function claimSignRewards(context, lifecycle, clock, signMode) {
    const definition = signRewardDefinition;
    const SignView = registeredClass(context, definition.className);
    if (!SignView) {
      return failure(definition, "runtime-unavailable", "Registered DailySignNewView is unavailable.");
    }
    let view = null;
    let registrations = [];
    try {
      view = new SignView();
      registrations = captureEventRegistrations(context, () => view.Init());
      const managerEntry = registrations.find(({ emitter }) =>
        typeof emitter?.CheckSignCanAward === "function"
      );
      const manager = managerEntry?.emitter;
      const signEvent = registrations.find(({ emitter, caller, listener }) =>
        emitter === manager &&
        caller === view &&
        listener === view.signSuccessHandler
      )?.type;
      if (!manager || !signEvent) {
        return failure(definition, "runtime-unavailable", "Sign-in manager could not be resolved.");
      }

      const signState = Number(view.signState) || 0;
      const reward = Array.from(view.rewardList || []).find((item) =>
        Number(item?.LoginDay ?? item?.loginday) === clock.day
      ) || null;
      const renderer = Array.from(view.itemList || []).find((item) =>
        Number(item?.Days) === clock.day
      ) || null;
      const rewardItemId = Number(reward?.Goods?.ItemID ?? reward?.goods?.ItemID) || null;
      const trialGeneral = Boolean(renderer?.baseData?.IsTryGeneralSkin);
      const skipTrial = trialGeneral && (
        signMode === "skip-trial" ||
        (signMode === "skip-trial-month-end" && !clock.monthEnd)
      );

      let dailyReward = {
        day: clock.day,
        rewardItemId,
        trialGeneral,
        signState,
        status: signState === 1
          ? "already-claimed"
          : signState === 3 ? "patch-only" : signState === 2 ? "pending" : "not-claimable"
      };
      if (signState === 2 && skipTrial) {
        dailyReward.status = "skipped-trial-general";
      } else if (signState === 2) {
        const observed = await requestAndWaitForEvent(
          context,
          lifecycle,
          manager,
          signEvent,
          () => view.onClickBigBtn(),
          "auto-rewards-sign-daily",
          definition.requestTimeoutMs
        );
        view.refreshItem?.();
        const afterState = Number(view.signState) || 0;
        dailyReward = {
          ...dailyReward,
          observed,
          signStateAfter: afterState,
          status: observed && afterState === 1
            ? "claimed"
            : observed ? "request-unconfirmed" : "request-timeout"
        };
      }

      const cumulativeRewards = await claimSignCumulativeRewards(
        context,
        lifecycle,
        view,
        manager
      );
      const all = [dailyReward, ...cumulativeRewards.results];
      const failed = all.filter((item) =>
        ["inactive", "request-timeout", "request-unconfirmed"].includes(item.status)
      );
      const claimed = all.filter((item) => item.status === "claimed");
      return {
        ok: failed.length === 0,
        action: definition.action,
        status: failed.length ? "partial" : claimed.length ? "claimed" : "nothing-claimable",
        signMode,
        serverDay: clock.dayKey,
        dailyReward,
        cumulativeRewards
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    } finally {
      releaseRegistrations(registrations);
      try {
        destroyDetached(context, view);
      } catch (error) {
        context.logger.warn("detached DailySignNewView cleanup failed", error);
      }
    }
  }

  function treeSnapshot(treeManager, freeManager) {
    const user = treeManager?.JbpUserData;
    return user ? {
      status: Number(user.Status),
      level: Number(user.Level) || 0,
      hasTriggerEvent: Boolean(user.HasTriggerEvent),
      eventId: Number(user.EventId) || null,
      freeRewardItemReady: Boolean(freeManager?.FreeBlessItemEnough),
      rewardItemId: Number(treeManager?.GetKanShuPropID?.()) || 0
    } : null;
  }

  async function claimTreeRewards(context, lifecycle, trigger) {
    const definition = treeRewardDefinition;
    try {
      const managers = resolveManagerList(context, lifecycle);
      const treeManager = findManager(managers, [
        "ReqJbpTreeUsing",
        "ReqJbpAwd",
        "GetKanShuPropID"
      ]);
      const freeManager = managers.find((manager) => {
        try {
          return typeof manager?.FreeBlessItemEnough === "boolean";
        } catch {
          return false;
        }
      }) || null;
      if (!treeManager || !freeManager) {
        return failure(definition, "runtime-unavailable", "KanShu managers could not be resolved.");
      }

      const before = treeSnapshot(treeManager, freeManager);
      if (!before) {
        return failure(definition, "tree-data-unavailable", "KanShu user data is unavailable.");
      }
      const forceCrossDay = trigger === "day-rollover" && before.status === 2;
      let chop = {
        forced: forceCrossDay,
        status: before.status === 0 || forceCrossDay ? "pending" : "not-required"
      };
      if (before.status === 0 || forceCrossDay) {
        treeManager.ReqJbpTreeUsing();
        const settled = await waitForCondition(
          context,
          lifecycle,
          () => {
            const status = Number(treeManager?.JbpUserData?.Status);
            return status === 1 || (!forceCrossDay && status === 2);
          },
          definition.requestTimeoutMs,
          "auto-rewards-tree-chop"
        );
        chop = {
          forced: forceCrossDay,
          status: settled ? "requested" : lifecycle.active ? "request-timeout" : "inactive"
        };
      }

      const afterChop = treeSnapshot(treeManager, freeManager) || before;
      if (afterChop.status !== 1) {
        return {
          ok: !["request-timeout", "inactive"].includes(chop.status),
          action: definition.action,
          status: afterChop.status === 2 ? "nothing-claimable" : "partial",
          trigger,
          before,
          chop,
          afterChop,
          reward: { status: afterChop.status === 2 ? "already-claimed" : "not-ready" }
        };
      }
      if (!afterChop.freeRewardItemReady || !afterChop.rewardItemId) {
        return {
          ok: true,
          action: definition.action,
          status: "reward-item-unavailable",
          trigger,
          before,
          chop,
          afterChop,
          reward: {
            status: "skipped-no-free-item",
            purchaseAttempted: false
          }
        };
      }
      if (afterChop.hasTriggerEvent) {
        return {
          ok: true,
          action: definition.action,
          status: "event-required",
          trigger,
          before,
          chop,
          afterChop,
          reward: {
            status: "skipped-event-window-required",
            purchaseAttempted: false
          }
        };
      }

      treeManager.ReqJbpAwd(afterChop.rewardItemId);
      const settled = await waitForCondition(
        context,
        lifecycle,
        () => Number(treeManager?.JbpUserData?.Status) === 2,
        definition.requestTimeoutMs,
        "auto-rewards-tree-reward"
      );
      const after = treeSnapshot(treeManager, freeManager) || afterChop;
      return {
        ok: settled,
        action: definition.action,
        status: settled ? "claimed" : lifecycle.active ? "request-timeout" : "inactive",
        trigger,
        before,
        chop,
        afterChop,
        reward: {
          status: settled ? "claimed" : lifecycle.active ? "request-timeout" : "inactive",
          rewardItemId: afterChop.rewardItemId,
          purchaseAttempted: false
        },
        after
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    }
  }

  async function runConfiguredRewards(context, lifecycle, trigger, clock) {
    const results = [];
    const run = async (id, enabled, callback) => {
      if (!enabled) {
        results.push({ id, ok: true, status: "disabled" });
        return;
      }
      if (!lifecycle.active) {
        results.push({ id, ok: false, status: "inactive" });
        return;
      }
      try {
        results.push({ id, ...(await callback()) });
      } catch (error) {
        results.push({
          id,
          ok: false,
          status: "runtime-error",
          reason: String(error?.message || error)
        });
      }
    };

    await run("cards", context.config.get("cards", true) === true,
      () => claimCardRewards(context, lifecycle, trigger));
    await run("general-draw", context.config.get("generalDraw", true) === true,
      () => claimFreeGeneralDrawRewards(context, lifecycle));
    await run("bless-draw", context.config.get("blessDraw", true) === true,
      () => claimFreeBlessDrawRewards(context, lifecycle));
    await run("guild-drums", true,
      () => useFreeGuildDrums(context, lifecycle));
    await run("officer-salary", context.config.get("officerSalary", true) === true,
      () => claimOfficerSalaryRewards(context, lifecycle));
    const signMode = String(context.config.get("signMode", "skip-trial"));
    await run("sign", context.config.get("autoSign", true) === true && signMode !== "disabled",
      () => claimSignRewards(context, lifecycle, clock, signMode));
    await run("tree", context.config.get("autoTree", true) === true,
      () => claimTreeRewards(context, lifecycle, trigger));

    const failed = results.filter((result) => result.ok === false);
    return {
      ok: failed.length === 0,
      status: failed.length ? "partial" : "completed",
      trigger,
      serverClock: clock,
      results
    };
  }

  SgsFramework.plugins.define({
    id: "sgs.auto-rewards",
    manifest: {
      name: "SGS AutoRewards",
      version: "0.1.0",
      description: "Automatically claims configured daily rewards at server-day rollover and plugin startup.",
      permissions: [
        "core.plugin-config",
        "laya.stage-ready",
        "laya.public-node-inspect",
        "game.privilege-reward-request",
        "game.free-draw-request",
        "game.guild-free-drum-request",
        "game.officer-reward-request",
        "game.sign-reward-request",
        "game.tree-reward-request"
      ]
    },
    defaults: {
      cards: true,
      generalDraw: true,
      blessDraw: true,
      officerSalary: true,
      autoSign: true,
      autoTree: true,
      signMode: "skip-trial"
    },
    settings: [
      {
        id: "automatic-rewards",
        name: "自动领奖",
        items: [
          { key: "cards", name: "领取周卡月卡", type: "toggle" },
          { key: "generalDraw", name: "自动免费将池", type: "toggle" },
          { key: "blessDraw", name: "自动免费祈福", type: "toggle" },
          { key: "officerSalary", name: "自动官阶俸禄", type: "toggle" },
          { key: "autoSign", name: "自动签到", type: "toggle" },
          { key: "autoTree", name: "自动砍树", type: "toggle" },
          {
            key: "signMode",
            name: "签到策略",
            type: "select",
            options: [
              { value: "disabled", label: "不自动签到" },
              { value: "skip-trial", label: "自动签到-跳过试用" },
              { value: "skip-trial-month-end", label: "自动签到-跳过使用-月底领" }
            ]
          }
        ]
      }
    ],
    actions: {},
    install(context) {
      const lifecycle = {
        active: true,
        waitCancels: new Set(),
        managerList: null,
        initialized: false,
        lastDayKey: "",
        pendingRun: null,
        runPromise: null,
        lastResult: null
      };

      const scheduleRun = (trigger, clock) => {
        lifecycle.pendingRun = { trigger, clock };
        if (lifecycle.runPromise) return lifecycle.runPromise;
        lifecycle.runPromise = (async () => {
          while (lifecycle.active && lifecycle.pendingRun) {
            const pending = lifecycle.pendingRun;
            lifecycle.pendingRun = null;
            lifecycle.lastResult = await runConfiguredRewards(
              context,
              lifecycle,
              pending.trigger,
              pending.clock
            );
            context.logger.info("automatic reward run completed", lifecycle.lastResult);
          }
          return lifecycle.lastResult;
        })().finally(() => {
          lifecycle.runPromise = null;
        });
        return lifecycle.runPromise;
      };

      const tick = () => {
        if (!lifecycle.active) return;
        let clock;
        try {
          clock = serverClockSnapshot(context, lifecycle);
        } catch (error) {
          context.logger.warn("server clock lookup failed", error);
          return;
        }
        if (!clock) return;
        if (!lifecycle.initialized) {
          lifecycle.initialized = true;
          lifecycle.lastDayKey = clock.dayKey;
          scheduleRun("startup", clock).catch((error) => {
            context.logger.error("startup reward run failed", error);
          });
          return;
        }
        if (clock.dayKey === lifecycle.lastDayKey) return;
        lifecycle.lastDayKey = clock.dayKey;
        scheduleRun("day-rollover", clock).catch((error) => {
          context.logger.error("day-rollover reward run failed", error);
        });
      };

      const cancelTick = context.timers.setInterval(tick, 1000, "auto-rewards-server-day");
      context.addDisposer(cancelTick, "auto-rewards-server-day");
      tick();
      return () => {
        lifecycle.active = false;
        lifecycle.pendingRun = null;
        for (const cancel of Array.from(lifecycle.waitCancels)) cancel();
        lifecycle.waitCancels.clear();
        lifecycle.managerList = null;
      };
    }
  });
})();
