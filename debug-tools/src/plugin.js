// ==SgsPlugin==
// @id           sgs.automation
// @name         SGS DebugTools
// @version      0.6.0
// @description  Exposes Agent-callable navigation, self-profile reads, and daily-task reward diagnostics.
// @permissions  laya.stage-scan,laya.public-node-inspect,game.self-profile-read,game.task-reward-request
// @updateMode   default
// ==/SgsPlugin==

(() => {
  "use strict";

  const modeDefinitions = {
    rogueMap: {
      action: "openRogueMap",
      modeId: 151,
      targetScenes: ["RogueLikeBigMapScene", "RogueSmallMapScene", "RogueLikeGameScene"]
    },
    generalTrial: {
      action: "openGeneralTrial",
      modeId: 147,
      targetScenes: ["GeneralTrialScene", "GeneralTrialChallengeWin"]
    }
  };

  const dailyRewardDefinition = {
    action: "claimDailyTaskRewards",
    className: "TaskDailyView",
    dailyTag: "日",
    pollIntervalMs: 100,
    requestTimeoutMs: 5000
  };

  const characterInfoDefinition = {
    action: "getCharacterInfo"
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

  function findTargetScene(entries, names) {
    return entries.find(({ node, info }) =>
      labelParts(node, info).some((label) => names.includes(label))
    ) || null;
  }

  function findModeEntry(entries, modeId) {
    return entries.find(({ node }) =>
      Number(node?.modeId) === modeId &&
      typeof node?.onEnterMode === "function"
    ) || null;
  }

  function findActivityView(entries) {
    return entries.find(({ node, info }) =>
      labelParts(node, info).includes("ActivityModeView") &&
      typeof node?.onPageNumChange === "function"
    ) || null;
  }

  function findModeScene(entries) {
    return entries.find(({ node, info }) =>
      labelParts(node, info).includes("ModeScene") &&
      typeof node?.modeAtivitySelect === "function"
    ) || null;
  }

  function currentScene(entries) {
    const scenes = entries.filter(({ node, info }) =>
      String(info.sceneName || node?.sceneName || "").endsWith("Scene")
    );
    const current = scenes[scenes.length - 1];
    return current ? summary(current.node, current.info) : null;
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

  function scanActivityPages(context, definition, activity) {
    let entries = visibleEntries(context);
    let target = findModeEntry(entries, definition.modeId);
    if (target) return { entries, target, activity };

    const maxPage = Math.max(1, Number(activity.node.maxPage) || 1);
    let page = Math.max(1, Number(activity.node.curPage) || 1);
    while (page > 1) {
      const before = page;
      activity.node.onPageNumChange(false);
      entries = visibleEntries(context);
      target = findModeEntry(entries, definition.modeId);
      if (target) return { entries, target, activity: findActivityView(entries) || activity };
      activity = findActivityView(entries) || activity;
      page = Math.max(1, Number(activity.node.curPage) || before);
      if (page >= before) break;
    }
    while (page < maxPage) {
      const before = page;
      activity.node.onPageNumChange(true);
      entries = visibleEntries(context);
      target = findModeEntry(entries, definition.modeId);
      if (target) return { entries, target, activity: findActivityView(entries) || activity };
      activity = findActivityView(entries) || activity;
      page = Math.max(1, Number(activity.node.curPage) || before);
      if (page <= before) break;
    }
    return { entries, target: null, activity };
  }

  function openMode(context, definition) {
    let entries = visibleEntries(context);
    if (!entries.length) {
      return failure(definition, "stage-unavailable", "Laya stage is not ready.");
    }
    const alreadyOpen = findTargetScene(entries, definition.targetScenes);
    if (alreadyOpen) {
      return {
        ok: true,
        action: definition.action,
        status: "already-open",
        modeId: definition.modeId,
        target: summary(alreadyOpen.node, alreadyOpen.info)
      };
    }

    let target = findModeEntry(entries, definition.modeId);
    let activity = findActivityView(entries);
    if (!target && !activity) {
      const modeScene = findModeScene(entries);
      if (!modeScene) {
        return failure(
          definition,
          "navigation-unavailable",
          "Current scene cannot open the activity mode view.",
          entries
        );
      }
      modeScene.node.modeAtivitySelect();
      entries = visibleEntries(context);
      target = findModeEntry(entries, definition.modeId);
      activity = findActivityView(entries);
    }
    if (!target && activity) {
      const scanned = scanActivityPages(context, definition, activity);
      entries = scanned.entries;
      target = scanned.target;
      activity = scanned.activity;
    }
    if (!target) {
      return failure(
        definition,
        "mode-unavailable",
        `No visible modeId=${definition.modeId} entry was found.`,
        entries
      );
    }
    target.node.onEnterMode();
    return {
      ok: true,
      action: definition.action,
      status: "requested",
      modeId: definition.modeId,
      called: `modeId=${definition.modeId}.onEnterMode()`,
      activityPage: activity ? Number(activity.node.curPage) || null : null,
      target: summary(target.node, target.info)
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

  function numberOrNull(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function findSelfCharacter(context) {
    const stage = context.laya.getStage();
    if (!stage) return null;
    const entries = context.laya.walk(stage, { includeHidden: true, maxDepth: 18 });
    const seen = new Set();
    for (const entry of entries) {
      const candidates = [
        ["data", entry.node?.data],
        ["userData", entry.node?.userData],
        ["userInfoView.data", entry.node?.userInfoView?.data]
      ];
      for (const [field, candidate] of candidates) {
        if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
        seen.add(candidate);
        try {
          if (candidate.IsSelf !== true ||
              numberOrNull(candidate.Uuid) == null ||
              !candidate.Nickname) continue;
          return { entry, field, character: candidate };
        } catch {
          // Ignore unrelated runtime data objects whose getters are not readable.
        }
      }
    }
    return null;
  }

  function getCharacterInfo(context) {
    const definition = characterInfoDefinition;
    try {
      const located = findSelfCharacter(context);
      if (!located) {
        return failure(
          definition,
          "character-unavailable",
          "No self character data is available in the current Laya stage."
        );
      }
      const character = located.character;
      return {
        ok: true,
        action: definition.action,
        status: "ok",
        source: {
          field: located.field,
          ...summary(located.entry.node, located.entry.info)
        },
        character: {
          id: numberOrNull(character.Uuid),
          clientId: numberOrNull(character.ClientId),
          nickname: String(character.Nickname || ""),
          displayName: String(character.NickNameForLocal || character.Nickname || ""),
          level: numberOrNull(character.UserLevel),
          levelPercent: numberOrNull(character.LevelPercent),
          experience: numberOrNull(character.UserlScore),
          yuanBao: numberOrNull(character.YuanBao),
          boundYuanBao: numberOrNull(character.BindYuanBao),
          totalYuanBao: numberOrNull(character.TotalYuanBao),
          silver: numberOrNull(character.TongQian),
          todayOnlineSeconds: numberOrNull(character.TodayOnlineSecond),
          vipActive: Boolean(character.IsVipActive),
          vipLevel: numberOrNull(character.VipLevel),
          vipLevelIncludingTrial: numberOrNull(character.VipLevelIncludeTrial),
          vipDays: numberOrNull(character.VipDays),
          officerLevel: numberOrNull(character.OfficerLevel),
          guildId: numberOrNull(character.GuildID),
          guildName: String(character.GuildName || ""),
          guildJob: numberOrNull(character.GuildJob),
          reputationScore: numberOrNull(character.ReputationScore),
          popularity: numberOrNull(character.PopularityNum),
          recentPopularity: numberOrNull(character.RecentPopularityNum),
          factionType: numberOrNull(character.FactionType),
          monarchLevel: numberOrNull(character.MonarchLevel)
        }
      };
    } catch (error) {
      return failure(definition, "runtime-error", String(error?.message || error));
    }
  }

  function taskUiEntries(context) {
    return visibleEntries(context).filter(({ node, info }) =>
      labelParts(node, info).some((label) =>
        label === "TaskWindow" || label === "TaskDailyView"
      )
    );
  }

  function captureTaskRows(DailyView) {
    let rows = [];
    const taskPanel = { vScrollBar: { value: 0 } };
    Object.defineProperty(taskPanel, "DataProvider", {
      set(value) {
        rows = Array.isArray(value) ? value : [];
      }
    });
    DailyView.prototype.updateTaskUI.call({ taskPanel }, false);
    return rows;
  }

  function rowValue(row, upperName, lowerName) {
    return row?.[upperName] ?? row?.[lowerName] ?? null;
  }

  function taskState(renderer, row) {
    renderer.updateRenderer(row);
    const task = renderer.TaskVO;
    const base = task?.baseVo;
    return {
      task,
      value: {
        taskId: Number(rowValue(row, "Taskid", "taskid")) || null,
        description: String(rowValue(row, "ShowDesc", "showDesc") || base?.desc || ""),
        progress: String(task?.GetFirstConditionProDes || ""),
        canAward: Boolean(task?.CanAward),
        hasAward: Boolean(task?.HasAward)
      }
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

  async function waitForTaskReward(context, lifecycle, renderer, row) {
    const expiresAt = Date.now() + dailyRewardDefinition.requestTimeoutMs;
    let current = taskState(renderer, row);
    while (lifecycle.active && Date.now() < expiresAt) {
      if (!current.task || current.value.hasAward || !current.value.canAward) return current;
      await delay(
        context,
        lifecycle,
        dailyRewardDefinition.pollIntervalMs,
        "debug-tools-daily-task-reward"
      );
      current = taskState(renderer, row);
    }
    return current;
  }

  async function claimTaskRewards(context, lifecycle, renderer, rows) {
    const results = [];
    renderer.sendReq = () => {};
    for (const row of rows) {
      if (!lifecycle.active) {
        results.push({
          taskId: Number(rowValue(row, "Taskid", "taskid")) || null,
          status: "inactive"
        });
        continue;
      }
      try {
        const before = taskState(renderer, row);
        if (!before.task) {
          results.push({ ...before.value, status: "task-unavailable" });
          continue;
        }
        if (before.value.hasAward) {
          results.push({ ...before.value, status: "already-claimed" });
          continue;
        }
        if (!before.value.canAward) {
          results.push({ ...before.value, status: "not-claimable" });
          continue;
        }
        renderer.onOpClick();
        const after = await waitForTaskReward(context, lifecycle, renderer, row);
        const confirmed = !after.task || after.value.hasAward || !after.value.canAward;
        results.push({
          ...after.value,
          status: confirmed ? "claimed" : lifecycle.active ? "request-timeout" : "inactive"
        });
      } catch (error) {
        results.push({
          taskId: Number(rowValue(row, "Taskid", "taskid")) || null,
          status: "error",
          reason: String(error?.message || error)
        });
      }
    }
    return results;
  }

  function milestoneState(topDayTask, index) {
    topDayTask.UpdateUI();
    const item = topDayTask.items?.[index];
    return {
      completionCount: Number(topDayTask.cntTxt?.text) || 0,
      claimed: Boolean(item?.hadTex?.visible)
    };
  }

  function claimMilestoneRewards(lifecycle, topDayTask) {
    const data = Array.from(topDayTask.itemDatas || []);
    const results = [];
    for (let index = 0; index < data.length; index += 1) {
      const reward = data[index];
      const detail = {
        rewardId: Number(rowValue(reward, "Id", "id")) || null,
        requiredCount: Number(rowValue(reward, "RewardNeed", "rewardneed")) || 0,
        goodsId: Number(rowValue(reward, "RewardGoodsId", "rewardgoodsid")) || null,
        goodsCount: Number(rowValue(reward, "RewardGoodsCnt", "rewardgoodscnt")) || 0
      };
      if (!lifecycle.active) {
        results.push({ ...detail, status: "inactive" });
        continue;
      }
      try {
        const before = milestoneState(topDayTask, index);
        topDayTask.onClickItem(index);
        results.push({
          ...detail,
          completionCount: before.completionCount,
          status: before.claimed
            ? "already-claimed"
            : before.completionCount >= detail.requiredCount
              ? "requested"
              : "not-eligible"
        });
      } catch (error) {
        results.push({
          ...detail,
          status: "error",
          reason: String(error?.message || error)
        });
      }
    }
    return {
      completionCount: data.length ? milestoneState(topDayTask, 0).completionCount : 0,
      results
    };
  }

  async function claimDailyTaskRewards(context, lifecycle) {
    const definition = dailyRewardDefinition;
    const beforeEntries = taskUiEntries(context);
    let detachedView = null;
    let result = null;
    try {
      const DailyView = registeredClass(context, definition.className);
      if (!DailyView || typeof DailyView.prototype?.updateTaskUI !== "function") {
        result = failure(definition, "runtime-unavailable", "Registered TaskDailyView is unavailable.");
      } else {
        const allRows = captureTaskRows(DailyView);
        const dailyRows = allRows.filter((row) =>
          String(rowValue(row, "Tag", "tag") || "") === definition.dailyTag &&
          !Boolean(rowValue(row, "IsGift", "isGift"))
        );
        if (!allRows.length) {
          result = failure(definition, "task-data-unavailable", "Daily task data is not ready.");
        } else {
          detachedView = new DailyView();
          detachedView.createChildren();
          const seed = dailyRows[0] || allRows[0];
          detachedView.taskPanel.DataProvider = seed ? [seed] : [];
          const renderer = detachedView.taskPanel.CurDrawRenderers?.[0];
          const topDayTask = detachedView.topDayTask;
          if (!renderer || typeof renderer.updateRenderer !== "function" ||
              typeof renderer.onOpClick !== "function" ||
              !topDayTask || typeof topDayTask.UpdateUI !== "function" ||
              typeof topDayTask.onClickItem !== "function") {
            result = failure(definition, "runtime-unavailable", "Daily task reward controls are unavailable.");
          } else {
            const taskRewards = await claimTaskRewards(
              context,
              lifecycle,
              renderer,
              dailyRows
            );
            const milestoneRewards = claimMilestoneRewards(lifecycle, topDayTask);
            const allRewards = [...taskRewards, ...milestoneRewards.results];
            const failed = allRewards.filter((item) =>
              ["error", "request-timeout", "inactive"].includes(item.status)
            );
            const claimed = allRewards.filter((item) =>
              item.status === "claimed" || item.status === "requested"
            );
            result = {
              ok: failed.length === 0,
              action: definition.action,
              status: failed.length ? "partial" : claimed.length ? "claimed" : "nothing-claimable",
              dailyTaskCount: dailyRows.length,
              taskRewards,
              milestoneCompletionCount: milestoneRewards.completionCount,
              milestoneRewards: milestoneRewards.results
            };
          }
        }
      }
    } catch (error) {
      result = failure(definition, "runtime-error", String(error?.message || error));
    } finally {
      try {
        detachedView?.destroy?.(true);
      } catch (error) {
        context.logger.warn("detached TaskDailyView cleanup failed", error);
      }
      const afterEntries = taskUiEntries(context);
      const beforeNodes = new Set(beforeEntries.map((entry) => entry.node));
      result = {
        ...(result || failure(definition, "runtime-error", "Daily reward action did not produce a result.")),
        taskUi: {
          before: beforeEntries.map(({ node, info }) => summary(node, info)),
          after: afterEntries.map(({ node, info }) => summary(node, info)),
          opened: afterEntries
            .filter((entry) => !beforeNodes.has(entry.node))
            .map(({ node, info }) => summary(node, info))
        }
      };
    }
    return result;
  }

  function inactive(action) {
    return {
      ok: false,
      action,
      status: "inactive",
      reason: "Plugin is not active."
    };
  }

  SgsFramework.plugins.define({
    id: "sgs.automation",
    manifest: {
      name: "SGS DebugTools",
      version: "0.6.0",
      description: "Exposes Agent-callable navigation, self-profile reads, and daily-task reward diagnostics.",
      permissions: [
        "laya.stage-scan",
        "laya.public-node-inspect",
        "game.self-profile-read",
        "game.task-reward-request"
      ]
    },
    defaults: {},
    settings: [],
    actions: {
      openRogueMap(context) {
        return context.debugTools?.openRogueMap?.() || inactive("openRogueMap");
      },
      openGeneralTrial(context) {
        return context.debugTools?.openGeneralTrial?.() || inactive("openGeneralTrial");
      },
      getCharacterInfo(context) {
        return context.debugTools?.getCharacterInfo?.() || inactive("getCharacterInfo");
      },
      claimDailyTaskRewards(context) {
        return context.debugTools?.claimDailyTaskRewards?.() || inactive("claimDailyTaskRewards");
      }
    },
    install(context) {
      const lifecycle = {
        active: true,
        actionPromises: new Map(),
        waitCancels: new Set()
      };
      const runExclusive = (action, callback) => {
        if (!lifecycle.active) return inactive(action);
        if (lifecycle.actionPromises.has(action)) {
          return lifecycle.actionPromises.get(action);
        }
        const promise = callback().finally(() => {
          lifecycle.actionPromises.delete(action);
        });
        lifecycle.actionPromises.set(action, promise);
        return promise;
      };
      const debugTools = {
        openRogueMap() {
          return openMode(context, modeDefinitions.rogueMap);
        },
        openGeneralTrial() {
          return openMode(context, modeDefinitions.generalTrial);
        },
        getCharacterInfo() {
          return getCharacterInfo(context);
        },
        claimDailyTaskRewards() {
          return runExclusive(
            "claimDailyTaskRewards",
            () => claimDailyTaskRewards(context, lifecycle)
          );
        }
      };
      context.debugTools = debugTools;
      return () => {
        lifecycle.active = false;
        for (const cancel of Array.from(lifecycle.waitCancels)) cancel();
        lifecycle.waitCancels.clear();
        lifecycle.actionPromises.clear();
        if (context.debugTools === debugTools) context.debugTools = null;
      };
    }
  });
})();
