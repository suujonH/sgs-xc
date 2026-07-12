# SGS Framework Contract

## Public Core

Core is exposed as both `window.SgsFramework` and `window.__SgsFramework`.

Stable top-level services:

```text
developerMode read-only Boolean controlled by the Core UI and available to plugin contexts
events       event bus
logger       scoped logger
storage      Core-scoped serialized storage
timers       disposable timers
hooks        reversible method hooks
dom          overlay and control helpers
browser      URL and network helpers
laya         raw Laya access and stage traversal
runtime      battle/window/log lifecycle events
plugins      installation, lifecycle, configuration, and updates
update       Core update check and hot reload
ui           edge dock, settings window, dialogs, and refresh
```

The matching capability name is `core.developer-mode`.

Core UI contract:

```text
edge dock       snaps to left or right; only the selected edge sensor accepts pointer input
auto hide       hides after pointer release/leave; keep-visible mode remains exposed on the edge
settings window defaults to 50% viewport width and height
minimum size    20% viewport width and height, with the existing 260x180 usability floor
geometry        drag, resize, viewport resize, and browser zoom must keep the full window in view
tabs            plugin management | plugin settings | Core
developer mode  persisted Core toggle; updates the public field before emitting core:developer-mode-changed
```

Plugin management rows show identity, version, description, update actions, the enable/disable control, and deletion. They do not repeat the declared capability list or render a separate running/disabled status label; capabilities remain visible in the mandatory first-install confirmation. Operational errors and update errors remain visible because they require action.

Core replacement is hot reload: the new source disposes the previous instance, then recreates services and restores enabled plugins from cached source.

Published Core source begins with a preserved `SgsCore` Header. Downloader and Core update checks read `@version` from that Header instead of depending on minified declaration layout. The Header also carries a comment-form `const version = "..."` compatibility marker so already-installed pre-Header Downloader/Core versions can discover and load the first Header-based release without executing a second global declaration. The two values and the runtime `version` constant must remain identical, and the build check rejects a mismatch.

## Plugin Source And Artifact Format

Plugin engineering source lives in its own project under `E:\ds-sgs\src` and may use multiple modules. The root build pipeline bundles and mangles that source into one standalone classic JavaScript artifact per plugin. Every published artifact begins with a machine-readable header and calls `SgsFramework.plugins.define(plugin)` when evaluated. Published code never requires a second project JavaScript download; in particular, Game Model embeds its runtime in `card-tracker.mjs`.

```javascript
// ==SgsPlugin==
// @id           example.plugin
// @name         Example Plugin
// @version      1.0.0
// @description  Example description.
// @permissions  core.events,browser.dom-overlay
// @updateMode   default
// ==/SgsPlugin==

(() => {
  SgsFramework.plugins.define({
    id: "example.plugin",
    manifest: {
      name: "Example Plugin",
      version: "1.0.0",
      description: "Example description.",
      permissions: ["core.events", "browser.dom-overlay"]
    },
    defaults: {},
    settings: [],
    install(context) {}
  });
})();
```

Header fields used before execution:

```text
@id             stable plugin id
@name           display name
@version        comparable dotted version
@description    installation description
@permissions    comma-separated capability disclosure
@updateMode     default | header | api
@versionHeader  response header for header mode
@versionApi     JSON endpoint for api mode
```

## Update Modes

- `default`: GET the plugin JavaScript, parse its header, and compare `@version`.
- `header`: send a HEAD request and compare the response header named by `@versionHeader` (default `x-sgs-plugin-version`). No response body is read.
- `api`: GET `@versionApi`; JSON must provide `version` and may provide `url`.

Each network request uses a five-second timeout unless the Core contract version changes explicitly.

Cross-origin header sources must expose the selected version header with `Access-Control-Expose-Headers`; `Access-Control-Allow-Origin` alone is not sufficient for browser JavaScript to read a custom response header.

## Plugin Settings

Plugin definitions may provide `defaults`, `settings`, and `actions`.

```javascript
settings: [
  {
    id: "display",
    name: "Display",
    items: [
      { key: "enabled", name: "Enabled", type: "toggle", onChange: "apply" },
      { key: "name", name: "Name", type: "text", patterns: ["^.{1,20}$"] },
      { key: "mode", name: "Mode", type: "select", options: [{ value: "a", label: "A" }] },
      { name: "Open list", type: "button", action: "openList" },
      { name: "Custom", type: "custom", render: "renderCustom" }
    ]
  }
]
```

Supported types are `toggle`, `button`, `text`, `select`, and `custom`. String action names resolve against `plugin.actions`. A custom renderer receives a Core-owned host element and plugin context; the plugin controls only the contents of that host.

## Storage

Core owns all LocalStorage keys.

```text
sgs.framework.ui.*
sgs.framework.core.developer-mode
sgs.framework.plugins.registry
sgs.framework.plugins.sources
sgs.framework.plugins.catalog-cache
sgs.framework.plugins.<pluginId>.code
sgs.framework.plugins.<pluginId>.config
sgs.framework.plugins.<pluginId>.data.*
```

`context.storage` is automatically scoped to `plugins.<pluginId>.data.`. `context.config` serializes one configuration object, merges first-run defaults, validates declared text patterns, and invokes plugin actions after successful changes.

The active plugin context and the Core settings UI must share one configuration state object. A UI write is invalid if the plugin action invoked for that write can still read the previous value. TextBox constraints (`min`, `max`, `minLength`, `maxLength`, and every declared `patterns` entry) are enforced before persistence and before the action runs.

Scope names never add duplicate separators. Core startup migrates legacy `sgs.framework.*..*` keys to their single-dot form before reading UI or plugin state. If both names exist, the single-dot key wins.

## Catalog

`plugin/index.json` is the official source. Third-party sources use the same structure:

```json
{
  "name": "Source name",
  "plugins": [
    { "id": "example.plugin", "url": "https://example/plugin.js" }
  ]
}
```

The official source is fixed. Third-party sources can be added, renamed, disabled, and removed by the user.

Configuration cleanup groups both `<pluginId>.config` and `<pluginId>.data.*` as one orphan entry when the plugin registry no longer contains that id. Deleting the orphan removes only those configuration/data keys; it does not affect installed plugins or unrelated LocalStorage.

## Official Blocker

`sgs.blocker` keeps three independent settings: advertisements, verified effect resources, and item popups.

- Advertisement blocking hooks the current registered `ModeScene.showAdView`, filters the verified military-manual button type `0x27cb`, hides an already visible ModeScene ad view, and closes `AdPushWindow` through its public close path.
- Effect blocking wraps `XMLHttpRequest.open` and replaces only the resource patterns carried from the old script with known JSON/PNG/skeleton placeholders. It preserves the old iron-chain/alcohol allowlist and the two verified `playEffect` completion paths. It must not disable global Tween, Timer, Animation, or rendering.
- Item-popup blocking closes the verified `GetPropSpecialWindow`, `GeneralOpenResultWindow`, `SkinOpenResultWindowNew`, and `OldbackOneClickDrawAwdWin` windows and handles the verified `TianShuWindow.updateWinUI(type=6)` path.

Every method hook is owned by the plugin lifecycle and restores the exact previous method when the plugin is disabled, updated, removed, or when Core is replaced.

## Official DebugTools

`sgs.automation` keeps its stable plugin id and is displayed as SGS DebugTools. It exposes four Agent-callable actions through `SgsFramework.plugins.invokeAction(pluginId, actionName)`:

```text
openRogueMap          modeId 151 -> RogueLikeBigMapScene / RogueSmallMapScene / RogueLikeGameScene
openGeneralTrial      modeId 147 -> GeneralTrialScene / GeneralTrialChallengeWin
getCharacterInfo      read the current self character and allowlisted game-profile fields
claimDailyTaskRewards claim completed daily task rewards, then eligible count milestones
```

The two navigation actions use effective-visible `Laya.stage` nodes. From `ModeScene`, they open `ActivityModeView`, traverse its pages through `onPageNumChange`, find the requested `NCt` entry, and call its `onEnterMode()` method. If the target mode is already visible, the action returns `already-open`. If the current Scene cannot expose the activity view or the requested entry is unavailable, the action returns a structured failure and does not navigate backward, select a character, start a challenge, confirm a dialog, buy an item, or continue a battle.

The character information action walks current and hidden Stage nodes, locates a data object whose long `IsSelf`, `Uuid`, and `Nickname` properties identify the current character, and returns only an explicit allowlist. The allowlist covers role identity, level/progress, YuanBao/bound YuanBao/total YuanBao, silver, online duration, VIP/officer levels, guild, reputation/popularity, faction, and monarch level. It does not return the source object, session/reconnect tokens, passwords, account hashes, or login IP fields. When no self-profile node exists in the current Stage, the action returns `character-unavailable` without opening or navigating to a profile window.

The daily reward action does not create or add a task window to `Laya.stage`. It captures the current `TaskDailyView` data provider, filters the runtime rows tagged as daily without assuming or comparing a fixed count, and loops over a detached task renderer to click only rows whose task state reports `CanAward`. It waits for each task reward state to settle, then loops over the detached cumulative-reward items in their runtime-configured order; each item's own click method decides whether the threshold is eligible or already claimed. A cross-day change in task count is ordinary loop input and never an error condition.

Each mutating DebugTools action has an exclusive in-flight Promise. Disabling, removing, or updating DebugTools, or replacing Core, cancels pending waits and removes the callable service; a call against an inactive plugin returns `inactive` without touching the game runtime.

## Official AutoRewards

`sgs.auto-rewards` has six independent Boolean settings and one sign-in strategy:

```text
cards            claim active month/week cards and their silver rewards
generalDraw      perform confirmed free general draws
blessDraw        perform confirmed free blessing draws
officerSalary    claim eligible daily and weekly officer salaries
autoSign         master switch for sign-in and cumulative sign rewards
autoTree         chop and claim the free Fortune Tree reward
signMode         disabled | skip-trial | skip-trial-month-end
```

All Boolean settings default to true. `signMode` defaults to `skip-trial`. Free Changshan guild drums always participate because the plugin has no separate drum setting. Installation starts a one-second server-clock watcher. The clock is resolved from the runtime manager list through long `ServerTime` and `ServerDate` members. The first usable snapshot runs the complete sequence with trigger `startup`; a change in the +8 server `dayKey` runs it with trigger `day-rollover`. Overlapping ticks are serialized, and a rollover observed during an existing run remains pending for one following pass.

The run order is cards, free general draw, free blessing draw, free guild drums, officer salary, sign-in, and Fortune Tree. A disabled setting produces a skipped result without resolving or calling that subsystem. The plugin does not expose these reward operations as manual actions.

Month card uses the active type-3 `ZhiGouMonthCardView`; week card uses the active type-2 `NewWeekCardView`. Each detached view first sends `SendClientPrivilegeDataReq()`. On `startup`, daily and silver requests are sent only when the refreshed state reports them available. On `day-rollover`, an active card receives exactly one `SendClientPrivilegeRewardReq(rewardDays,type)` and one `PrivilegeCardDaliyRewardReq(type)` even if the local availability fields are stale. Month-card cumulative rewards are then checked independently through `AddAwardsCanAwardList()` and confirmed through `AddAwardsHasAwardList()`; week card has no cumulative path. Inactive cards never call purchase or renewal methods.

The general-draw path requires a positive free drop id, active free label and button, the manager's free state, an idle request pool, and the registered `Free_MianFei_Draw` enum. It sends one `SendClientUseGeneralDrawCardReq` only after all checks agree. The blessing path refreshes all rounds, then sends `sendQifuDrawReq(roundId,1)` only for rounds whose `freeOpen`, activity time, draw time, and `CanFreeBless` checks all agree. Neither path enters paid draw, purchase, or YuanBao completion methods.

The guild-drum path requires a guild id, `CanDrum`, and `LeftFreeDrumTimes > 0`. It calls only `SendGuildDonate()` and waits for the free count to decrease before repeating. The officer path checks and confirms daily and weekly salary eligibility independently and does not upgrade rank or claim unrelated officer activities.

Sign-in constructs a detached `DailySignNewView` and only treats `signState === 2` as a normal free sign-in. State 3 is patch-only and is never clicked. A trial-general reward is detected through `IsTryGeneralSkin`: `skip-trial` always skips it, while `skip-trial-month-end` allows it only on the last server-calendar day of the month. Eligible cumulative sign rewards are checked even when the daily reward is already claimed or skipped. `disabled` and the Boolean master switch both suppress the whole sign-in subsystem.

The Fortune Tree path calls `ReqJbpTreeUsing()` when runtime status is ready to chop. A `day-rollover` also sends one chop request when cached status is still 2, while `startup` trusts the refreshed login state. It sends `ReqJbpAwd(itemId)` only when the free reward item exists. If `HasTriggerEvent` is true, it returns `event-required` without opening or bypassing the event window and without sending the award request. It never buys a reward item.

Disabling, removing, or updating AutoRewards, or replacing Core, stops its clock watcher, cancels pending waits, destroys detached views, and prevents further requests after the current short check yields.

## Early Development Refactoring Policy

The Framework is in initial development. Existing structure is evidence, but it is not automatically a compatibility requirement or a reason to accumulate difficult maintenance work.

Before every feature addition or defect fix, make this comparison:

```text
local change cost
local change maintenance cost
scoped refactor cost
refactor impact range
```

Choose a scoped refactor immediately when either condition is true:

1. The total cost of adding or fixing within the current structure is greater than the cost of refactoring the affected structure and implementing the behavior on the refactored structure.
2. The local change would make future maintenance difficult through duplicated paths, special-case branches, unstable coupling, mixed ownership, incomplete cleanup, or contracts that can no longer be explained coherently.

The refactor must cover the smallest complete ownership boundary that resolves the structural problem. Before implementation, inspect callers, public Core APIs, plugin contracts, lifecycle and disposal behavior, LocalStorage compatibility, update and hot-reload behavior, official plugins, and affected manual chapters. Remove superseded paths instead of leaving parallel old and new implementations unless a compatibility requirement is explicitly confirmed.

Refactoring does not relax delivery requirements. The same change set must include affected plugin adjustments, verification, and a complete rewrite of the owning and related manual chapters.

## Documentation Synchronization

`manual/` is part of the Framework contract. Every Framework code modification must include a corresponding manual update in the same change set. Documentation-only changes do not require an unrelated code modification.

### Chapter Impact Map

Start with the chapter that owns the changed surface, then inspect and update every related chapter listed on the same row whose statements are affected.

| Changed surface | Owning chapter | Related chapters to inspect |
| --- | --- | --- |
| Downloader, boot barrier, source URL, cache, or failure handling | `install` | `overview`, `updates`, `risk` |
| Public Core service or browser/Laya API | `core-api` | `events`, `storage`, `risk` |
| Plugin header, definition, lifecycle, or permission declaration | `plugin-format` | `core-api`, `settings`, `updates`, `sources`, `risk` |
| Plugin setting schema, defaults, actions, validation, or custom renderer | `settings` | `plugin-format`, `storage`, `risk` |
| Core/plugin version check, update mode, fallback, or hot reload | `updates` | `install`, `plugin-format`, `sources`, `risk` |
| Battle, window, log, or other runtime event | `events` | `core-api`, `built-ins`, `risk` |
| LocalStorage key, serialization, prefix, cache, or cleanup behavior | `storage` | `settings`, `updates`, `risk` |
| Official or third-party source behavior | `sources` | `plugin-format`, `updates`, `risk` |
| Official plugin behavior or lifecycle | `built-ins` | `events`, `settings`, `risk` |
| Dock, settings window, dialogs, navigation, or other Core UI | `overview` or `install` | `settings`, `core-api` |
| Version label, public deployment path, or release entry point | `overview` or `install` | `updates` and the manual header |

The map defines the minimum inspection range, not a limit. Follow shared terms and cross-references into additional chapters when the implementation affects them.

### Rewrite Rule

For every selected chapter:

1. Read the entire existing chapter and the relevant implementation before writing.
2. Replace the chapter body with one coherent, complete description of the current behavior.
3. Include prerequisites, normal flow, failure behavior, boundaries, and user-visible consequences when they apply.
4. Remove statements that describe superseded behavior and eliminate contradictions in related chapters.
5. Do not append patch-style wording such as "added", "changed", "now", "since version", or isolated compatibility notes as a substitute for rewriting the chapter.

The manual is current-state documentation, not a changelog. A reader must be able to understand the feature without knowing previous versions or combining old text with an appended correction.

### Completion Gate

A Framework code change is incomplete unless all conditions are true:

```text
owning chapter identified
related chapters inspected
affected chapters completely rewritten
navigation and search updated when chapters change
manual version and public URLs checked when applicable
desktop and narrow layouts checked when markup or styling changes
deployed manual verified after sync
```
