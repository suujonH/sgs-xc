---
name: sgs-framework-development
description: Develop and verify SGS Framework Core, edge/settings UI, plugin manifests and config storage, update modes, Laya runtime events, official tracker/blocker plugins, hot reload, and the public manual under framework/.
---

# SGS Framework Development

## Scope

Use this skill for Framework files under `E:\ds-sgs\src`. Engineering source may be split into modules inside each project. The root build pipeline must emit `dist/core.mjs`, `dist/download.mjs`, and one directly downloadable JavaScript file per plugin before Laya starts.

## Required Reads

Read these files before changing the related surface:

- `memory/framework-contract.md` for Core, plugin, storage, update, and UI contracts.
- `memory/runtime-evidence.md` for battle, window, log, and Laya evidence boundaries.
- `plugin/index.json` for the official catalog shape.

## Runtime Rules

- Keep `window.SgsFramework` and `window.__SgsFramework` as the public globals.
- A replacement Core must call the previous Core's `dispose("framework-replaced")` before publishing itself.
- Every hook, timer, DOM node, listener, and plugin action must have a disposer.
- Plugins declare permissions for disclosure. Core reports them to the user but does not reject a plugin solely because of a permission.
- Plugin code is not sandboxed. Show the manifest, description, source URL, version, and permissions before first installation.
- Persist plugin data only through the plugin-scoped storage/config APIs. Core owns the real LocalStorage prefix.
- Keep scope separators canonical. Treat any `sgs.framework.*..*` key as a legacy migration input, never as a new output.
- Make the settings UI and active plugin context share the same config state; verify an `onChange` action reads the value that triggered it.
- Do not use hidden opponent hand cards as tracker facts.
- Do not use screenshots or OCR as runtime data.

## Blocker Changes

- Read `E:\tmp\SGS\doc\03-block-skip.md` only as legacy reference, then recheck every class/method against current `Laya.ClassUtils._classMap` and `Laya.stage`.
- Keep advertisement, effect, and item-popup settings independent.
- Use reversible Core hooks and public window methods. Do not implement blocker behavior as broad English class-name hiding.
- Preserve the verified effect URL allowlist and completion callbacks. Never disable global Tween, Timer, Animation, or rendering.
- Prove disable/enable lifecycle by comparing the wrapped method with the restored original method in the live page.

## Early Development Refactoring

The Framework is still in its initial development stage. Before implementing an addition or fix, compare the cost and maintenance impact of changing the current structure with rebuilding the affected structure cleanly.

- Refactor promptly when adding or fixing within the current structure costs more than a scoped refactor.
- Refactor promptly when a local addition or fix would introduce duplication, compatibility branches, brittle coupling, unclear ownership, or another structure that will be difficult to maintain.
- Do not preserve an unsuitable early-stage structure solely to minimize the diff or retain accidental compatibility.
- Keep the refactor bounded to the affected subsystem and its proven callers. Inspect public APIs, plugin contracts, persisted data, lifecycle cleanup, update behavior, and dependent plugins before changing them.
- Treat the refactor as the implementation, not as optional follow-up work. Complete its verification and manual rewrite in the same change set.

## Manual Maintenance

The public manual under `manual/` is a required deliverable for every Framework code change.

1. Before editing the manual, identify the chapter that owns the changed behavior and every related chapter that describes the same API, lifecycle, configuration, storage, update path, permission, or built-in plugin.
2. Read each selected chapter in full. Rewrite the complete chapter body as the current, self-contained description. Remove stale or duplicated statements at the same time.
3. Do not document a change as a patch note, appended exception, compatibility footnote, or "new behavior" fragment. The resulting chapter must describe how the Framework works now without requiring the reader to reconstruct its history.
4. Every change to Framework code, including `download.mjs`, `core.mjs`, `plugin/*.mjs`, `plugin/*.js`, and manual runtime code, must update `manual/` in the same change set. If no existing chapter owns the behavior, create a complete new chapter and add it to navigation and search.
5. A code change is not complete until the rewritten chapters and their related chapters agree with the implementation, the local manual has been checked, and the deployed manual has been verified after synchronization.

Use `memory/framework-contract.md` for the chapter-impact map and the detailed documentation synchronization contract.

## Verification

- Run `npm run build` and `npm run check` from `E:\ds-sgs\src`; the checks must cover every generated `.mjs` artifact and preserved Header.
- Run a mocked browser lifecycle check for Core replacement, plugin load/unload, storage, and update selection.
- Verify config constraint rejection, action visibility of the new value, orphan config/data cleanup, and legacy double-dot key migration.
- Verify UI in a browser at desktop and narrow/mobile viewport sizes.
- Verify every changed manual chapter together with the related chapters selected by the chapter-impact map.
- Verify the synced public files from `https://sgs.senrax.com/script/` after local checks pass.
- Keep automatic watchers disabled. Run `npm run publish:check` for a read-only Oracle comparison, then use the explicit `npm run deploy` command only after the completed local change set is ready to publish.
