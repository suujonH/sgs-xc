# SGS Runtime Evidence Contract

## Battle Lifecycle

Battle state is not derived from `console.log`.

Entry evidence:

```text
Laya.stage
-> effectively visible TableGameScene or RogueLikeGameScene
-> scene.manager.seats exists
```

Core emits `battle:start` once when this state appears. Core emits `battle:end` once when the active scene is no longer effectively visible, its seats disappear, or the scene leaves the stage. Plugins must remove battle-only UI and clear temporary state on `battle:end`.

Effective visibility requires every node in the parent chain to have `visible !== false`, non-zero `alpha`, non-zero `scaleX/scaleY`, and `destroyed !== true`.

## Window Lifecycle

Window registries are not authoritative. Core scans effective visibility under `Laya.stage`, including scene and window layers, and emits:

```text
window:open
window:close
```

Payloads include stable runtime object identity for the current Core instance, class/scene/name information, and the raw node reference.

## Battle Logs

Core may expose `battle:log` only from visible/public log containers or an observed public log cache. The event is a convenience stream, not permission to inspect hidden seat state.

## Laya Access

`framework.laya.getLaya()`, `getStage()`, `walk()`, `find()`, and raw scene/node references remain available when a higher-level event is insufficient. Registered class strings in `Laya.ClassUtils._classMap` are preferred over compressed constructor names when a stable class lookup is needed.

## Tracker Boundary

Known cards may come from the current player's own hand, visible logs/windows, public zones, and protocol records that explicitly reveal a card. Opponent `handCards` must never be read as known-card facts.

The published `card-tracker.mjs` contains the runtime as an embedded gzip payload and expands it with Chrome's native `DecompressionStream` only when the plugin starts. It does not fetch or cache a separate `card-tracker-runtime.js`; disabling the plugin still stops and removes the runtime through the normal disposer.

## Effect Blocking Boundary

Do not globally disable Laya Tween, Timer, Animation, or rendering. A blocking rule must target a named, reversible method or an identified node class/pattern and must restore the original behavior when disabled or uninstalled.

Current verified blocker paths:

```text
ModeScene.showAdView / hideAdView
ModeScene.leftView.getBtnRes type 0x27cb
AdPushWindow public close methods
XMLHttpRequest.open effect-resource replacement rules from the old script
registered or visible playEffect methods for Plot_tiesuolianhuan and FX_SHT_SLCX completion
GetPropSpecialWindow, GeneralOpenResultWindow, SkinOpenResultWindowNew, OldbackOneClickDrawAwdWin
TianShuWindow.updateWinUI with type 6
```

Class paths were rechecked through `Laya.ClassUtils._classMap` and live `Laya.stage`. Do not replace these with broad English-name node hiding.

## AutoRewards Runtime Evidence

Server-day scheduling resolves the shared manager registry from the registered `ZhiGouMonthCardView`, then selects the manager exposing long `ServerTime` and `ServerDate` members. `ServerDate` is the +8 game-server calendar used for `dayKey` rollover and month-end sign-in policy; local browser time is not used.

Verified card paths:

```text
ZhiGouMonthCardView        type 3 month card
NewWeekCardView            type 2 week card
SendClientPrivilegeDataReq refresh card state
SendClientPrivilegeRewardReq(rewardDays,type)
PrivilegeCardDaliyRewardReq(type)
AddAwardsCanAwardList / AddAwardsHasAwardList / addItemClick month-card cumulative rewards
```

The old type-1 `NewMonthCardView` is not an active target. Week card has daily and silver requests but no cumulative-day reward path. Cross-day requests deliberately rely on server-side idempotence when the client availability flag is stale; startup runs first refresh the card state and honor its already-claimed flags.

Verified free and salary paths:

```text
ClientGeneralDrawCardReq.Free_MianFei_Draw
SendClientUseGeneralDrawCardReq
BlessNewWindowView -> SendAllListReq / CanFreeBless / sendQifuDrawReq
GuildDrumWindow -> GuildID / CanDrum / LeftFreeDrumTimes / SendGuildDonate
OfficerWindow -> CanGetOfficerDayReward / CanGetOfficerWeekReward / sendGetDayReward / sendGetWeekReward
```

The sign-in path uses registered `DailySignNewView`. Only `signState === 2` is a normal free sign-in; state 3 is patch-only. Trial-general rewards are identified by the renderer's long `baseData.IsTryGeneralSkin` field. Cumulative rewards use the runtime `totalItemList`, `TotalSignNum`, and `AddupprizeDays` state.

The Fortune Tree manager is identified through `ReqJbpTreeUsing`, `ReqJbpAwd`, `GetKanShuPropID`, and `JbpUserData`; the free-item manager exposes `FreeBlessItemEnough`. `HasTriggerEvent` means the normal event window is required, so background automation must stop before `ReqJbpAwd` instead of bypassing that interaction.
