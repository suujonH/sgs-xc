# SGS Scripts

This directory contains the headless SGS Web H5 game model, Chrome/CDP runtime adapters, recording tools, and skill-research pipeline.

## Commands

```powershell
cd E:\ds-sgs\src\card-tracker
npm install
npm run chrome
npm run build:runtime
npm run install:tracker
npm run smoke:model
npm run status
npm run snapshot
npm run validate
npm run capture
npm run monitor
npm run record
npm run recording-report
npm run recording-timeline
npm run source-report
npm run public-zone-report
npm run protocol-flow-report
npm run audit:skills
npm run skill-rule-worklist
npm run skill-knowledge
npm run migration-coverage
npm run legacy-tracker-contract
npm run stop
npm test
```

Chrome must expose CDP on `http://127.0.0.1:9222`. `npm run chrome` starts Chrome with that port and reuses `E:\ds-sgs\devBrowserTools\work\chrome-profile` by default.

## Headless game model

The active runtime does not install UI. It has no known-card overlay, legacy sidebar, panel, button, or drawing layer.

The authoritative model is:

```text
src/runtime/model/game-model-core.cjs
src/runtime/model/game-model.js
docs/game-inference-model.md
```

It tracks:

- the verified mode-specific physical deck definition;
- authoritative incremental definitions for server-generated physical CardIDs, kept separate from zero-subcard virtual actions and effective-attribute overlays; object-form server packets preserve a distinct `protocolDefinition`, while ordinary packets carrying only a CardID do not fabricate or repeatedly register attributes;
- physical deck count and deck epoch;
- exact known deck top, bottom, and sparse ranks;
- independently keyed physical-card piles with their own membership, top/bottom order, shuffle epoch, recycle policy, movement history, and local next-card probability; these piles never consume the main deck or recycle its discard unless an authoritative move explicitly crosses those zones;
- current discard membership plus complete per-game turn/round entry history and explicit movement reasons;
- ordered recast transactions that discard physical costs before drawing, so those costs join an immediate exhaustion recycle at the correct instant;
- process, hand, equipment, judgement, removed, and other zones, plus distinct named physical general-card piles carrying pile/skill identity, host/controller/placer versus non-owner semantics, zoneParam, order evidence, face state, and observer-scoped visibility instead of collapsing every pile into `general:<seat>`; the live adapter reads the current H5 `skillOutSideCardDict` by numeric skill/zone key and reconciles numeric removed-zone keys with protocol `removed:<seat>:<zoneParam>` identity, but a zero-ID outside entry is first classified as reviewed physical, reviewed nonphysical, or unresolved—only the physical class can allocate an unknown card count; equipment-attached piles additionally retain host CardID, capacity, attachment policy, and explicit rehost history rather than following an equipment card by assumption;
- exact hand identities, constraints, and unknown counts for every seat;
- durable all-seat hand-count/generation transitions, including hidden-identity last-hand loss;
- a separate hand-knowledge revision ledger so in-place show/view events do not fake membership changes or invalidate sound constraints;
- typed Boolean/cardinality constraints for server results that reveal only “N guesses were correct”; individual propositions remain unknown until every satisfying assignment agrees, and hand-bound rows expire on the next membership generation;
- predicate-search negative evidence;
- hidden search results whose success count is known even when no CardID is exposed;
- explicit per-epoch segmentation for multi-result searches that cross immediate deck-exhaustion recycling, with unsegmented cross-epoch batches rejected before mutation;
- top/bottom first-match searches that preserve proven skipped deck order instead of moving nonmatching cards;
- physical CardID tags with physical-card, turn, round, phase, event, or while-zone lifecycles and retained expiry history;
- continuous per-CardID zone residence and per-card use/response/offset event history, including exact before/after location queries at a movement event/time boundary, plus a durable movement-batch ledger with explicit group/order and per-CardID source/destination slot provenance; attempted, prevented, cancelled, accepted, and actually applied movements live in a separate linked ledger, so prevention never fabricates a physical move;
- conserved location-uncertainty groups that keep a known CardID set outside the deck across hidden transfers, and solve deck-touching probabilities only for proven uniform disjoint groups;
- a durable causal graph linking parent card uses, per-target effects, responses, offsets, damage, and source overrides; the current ordered target collection lives in an identity-keyed rule state while parent/child events retain historical targets, effect invalidation, removal, and repeated resolution without duplicating the physical parent card;
- explicit physical, zero-subcard virtual, and transformed-card action bindings without synthetic CardIDs, separating consumed materials, unrelated costs, and non-moving reference cards;
- separate printed, rule-effective, and observer-scoped apparent card attributes; non-global views carry explicit use/effect, target-seat, channel, choice, skill, and lifecycle bindings, so one material may be effective as different identities for different targets without those views leaking into default legality, damage, physical identity, or deck probability;
- current-location queries and all-or-nothing movement for a parent action's corresponding physical material group;
- multi-party comparison/pindian groups with one shared initiator CardID, per-opponent cards/numbers/results, pre-reveal logical assignment swaps that do not fake hand movement, and immutable stage history;
- identity-keyed scalar, counter, set, and ordered-list rule state with lifecycle history;
- identity-keyed structured rule modifiers for legality, response, damage, limits, and effective-card changes, with explicit parent event, per-target effect event, and target-seat scopes;
- server-event-matched scheduled effects that remain pending/due facts until authoritative resolution, with physical-card and skill-binding lifecycles;
- typed server candidate/decision sets whose domains distinguish effective card identities, physical CardID references, seats, skills, suits, numbers, and ordinary branches; `selectionAgency` separates player choice from server randomness, and a random event retains its sampling model, complete/incomplete population, unresolved source zones, observer visibility, and result without moving a physical card until a separate authoritative movement observation;
- exact SkillID-to-owner bindings for base, dynamically granted, derived, replaced, and lost skills, with lifecycle history;
- isolated non-game-card entity piles for character/general decks and other rule-owned entity domains, plus observer-scoped `GeneralCardEntity` state for main/deputy slots, face state, and printed/effective SkillIDs without activating skills or entering the physical deck;
- explicit zone/area capability state for available, disabled, or permanently abolished equipment slots and judgement/other areas, kept separate from whatever physical cards happen to be present;
- typed equipment projections that distinguish one physical CardID's temporary effective equipment identity from a virtual equipment capability with no CardID; neither projection creates or moves a card, and physical-source projections expire when that source leaves its bound zone;
- judgement-result ledgers that keep the physical judgement card and its effective attributes separate from base success, ordered success-inversion layers, locally derived success, and a server-reported final result;
- explicit per-CardID physical lifecycles for special/generated cards: terminal destruction moves the same entity into a typed terminal zone, excludes it from deck probability and discard recycling, and permits reactivation only through an authoritative explicit transition; reissue increments the physical generation so old tags, views, modifiers, schedules, and parent-action material bindings cannot leak into the new same-number entity;
- atomic known-card swaps that suppress an invalid intermediate deck recycle;
- atomic whole-zone/whole-hand exchange with direct before/after transitions, opaque-hand generation invalidation, and conserved-location-group remapping;
- transactional execution of fully resolved rule operations;
- full next-card number, suit, type, color, name, and CardID probabilities;
- config-derived damage-card, delayed/ordinary-trick, spell-class, and equipment-subtype predicates;
- provenance, contradictions, and recent state transitions.

The 2786-row `sys_playcard` catalog is never treated as an active game deck. The current rank `RuleId=22` resolves to IDs `1..160`; explicit `PlayCardPile.List` values are used for modes that provide them. Unresolved modes return `deck-definition-unknown` instead of guessing.

Runtime queries:

```js
const runtime = window.__SgsScripts;
runtime.manager.update();

const model = runtime.tracker.gameModel;
model.snapshot();
model.remainingDeck();
model.nextCardProbability({ endpoint: "top" });
model.observePhysicalPile({ key: "rule:<id>:<scope>", count: 3, cardIds: [201, 202, 203], topCardIds: [201], complete: true });
model.takeFromPhysicalPile({ key: "rule:<id>:<scope>", endpoint: "top", count: 1, cardIds: [201], to: "hand:0" });
model.physicalPileNextProbability({ key: "rule:<id>:<scope>", endpoint: "top" });
model.recast({ eventId: "recast:<protocol-id>", actorSeat: 0, from: "hand:0", cardIds: [72], drawnCardIds: [91] });
model.searchProbability({
  predicate: { type: "trick", number: [1, 12] },
  requestedCount: 2
});
model.orderedMatchSearch({
  endpoint: "top",
  predicate: { color: "red" },
  foundCount: 1,
  foundCardIds: [72],
  to: "hand:0"
});
model.segmentedSearch({
  predicate: { type: "trick" },
  to: "hand:0",
  segments: [
    { epoch: 0, requestedCount: 1, foundCardIds: [72] },
    { epoch: 1, requestedCount: 1, foundCardIds: [91] }
  ]
});
model.takeFromDeckAtRank({ cardId: 72, rank: 3, to: "hand:0" });
model.aggregateSubsetFeasibility({ field: "number", sum: 36, minCount: 1, maxCount: 10 });
model.discardForTurn(4, 2);
model.snapshot().discard.history;
const checkpoint = model.observeGameEvent({ type: "game:turn", turn: 4, round: 2 });
model.cardsContinuouslyInZone({ zoneKey: "hand:0", sinceEventIndex: checkpoint.eventIndex });
model.handTransitions({ seatIndex: 1, turn: 4, lostLastHand: true });
model.handKnowledgeChanges({ seatIndex: 1, knowledgeOnly: true });
model.exchangeZones({ leftZone: "hand:0", rightZone: "hand:1", atomicOperationId: "whole-hand:1" });
model.zoneExchanges({ atomicOperationId: "whole-hand:1" });
model.cardEvents({ cardId: 72, turn: 4, movementReason: "discard", tags: ["discard-phase"] });
model.observeCausalEvent({
  eventId: "response:<protocol-id>",
  eventType: "card:respond",
  parentEventId: "target-effect:<protocol-id>",
  roles: { responderSeat: 1 },
  cardId: 72
});
model.causalLineage("response:<protocol-id>");
model.observeCardAction({
  eventId: "use:<protocol-id>",
  action: "use",
  identityKind: "virtual-with-subcards",
  subcards: [{ cardId: 72, fromZone: "hand:1", role: "material" }],
  effectiveIdentity: { name: "杀", type: "basic" },
  providerSeat: 1,
  effectiveUserSeat: 0
});
model.queryCardActions({ identityKind: "virtual-with-subcards", effectiveName: "杀" });
model.cardActionMaterials("use:<protocol-id>", { zone: "discard" });
model.moveCardActionMaterials({ eventId: "use:<protocol-id>", from: "discard", to: "hand:0" });
model.observeComparison({
  comparisonId: "pindian:<protocol-id>",
  kind: "pindian",
  initiator: { seat: 0, cardId: 72 },
  opponents: [{ seat: 1, cardId: 91 }],
  status: "chosen"
});
model.swapComparisonAssignments({ comparisonId: "pindian:<protocol-id>", opponentSeat: 1 });
model.queryComparisons({ kind: "pindian", seat: 1 });
model.queryCurrentDiscard({
  eventAny: [{ turn: 4, tag: "used" }, { turn: 4, tag: "offset" }],
  movementReasons: ["card-use", "card-response"],
  predicate: { type: "trick" }
});
model.queryCardSources({ zones: ["deck", "discard"], predicate: { name: "无中生有" } });
model.resolveCardSourceResult({
  zones: ["deck", "discard"],
  predicate: { name: "无中生有" },
  foundCount: 1,
  foundCardIds: [72],
  to: "hand:0"
});
model.observeEntityPile({
  key: "character-deck:lord-choice",
  entityType: "general",
  count: 3,
  entityIds: [1001, 1002, 1003],
  complete: true
});
model.moveEntityPile({
  entityType: "general",
  from: "character-deck:lord-choice",
  to: "general-zone:seat:0",
  entityIds: [1001],
  count: 1
});
model.observeLocationGroup({
  cardIds: [72, 91, 98],
  zoneKeys: ["hand:0", "hand:1"],
  zoneCounts: { "hand:0": 2, "hand:1": 1 }
});
model.activeLocationGroups({ cardId: 72 });
model.updateRuleState({
  key: "rule:<identity>:owner:0:used-names",
  kind: "ordered-list",
  operation: "append",
  value: "杀",
  lifecycle: "turn"
});
model.registerRuleModifier({
  key: "rule:<identity>:owner:0:weapon:<cardId>:sha-limit",
  kind: "modify-limit",
  subject: "sha-use-count",
  selector: { actorSeat: 0, phase: "play" },
  effect: { delta: 3 },
  lifecycle: "while-zone",
  whileCardId: 72,
  whileZone: "equip:0"
});
model.observeSkillBinding({
  skillId: 21134,
  ownerSeat: 0,
  derivedFromSkillId: 21132,
  ruleIdentityKey: "sgs-web-h5:21134:owner:0"
});
model.activeSkillBindings({ skillId: 21134, ownerSeat: 0 });
model.activeRuleModifiers({ subject: "sha-use-count", ownerSeat: 0 });
model.explainCard(72);
model.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { suit: "红桃" } });
model.observeBooleanConstraint({
  key: "lingren:use:1:target:1",
  propositions: ["has-basic", "has-trick", "has-equipment"],
  terms: [{ key: "has-basic", equals: true }, { key: "has-trick", equals: true }, { key: "has-equipment", equals: true }],
  correctCount: 2,
  subjectSeat: 1,
  bindToCurrentHand: true
});
model.observeEffectiveCardAttributes({ cardId: 72, scope: "judgement", attributes: { suit: "红桃", number: 5 } });
model.observeJudgementOutcome({ judgementId: "judge:1", judgementCardId: 72, baseSuccess: true });
model.invertJudgementOutcome({ judgementId: "judge:1", layerId: "skill:1110", skillId: 1110 });
model.destroyPhysicalCard({ cardId: 4308, from: "discard", terminalZoneKey: "terminal:special-equipment" });
model.observeDeckRanks({ rank: 3, cardId: 72 });
model.insertAtRank({ cardId: 72, rank: 6, fallback: "bottom" });
model.tagCard({ cardId: 72, tag: "example" });
model.applyOperation({
  type: "search-feedback",
  predicate: { all: [{ type: "trick" }, { number: [1, 12] }] },
  requestedCount: 2,
  foundCount: 0,
  foundCardIds: [],
  exhaustive: true
});
runtime.tracker.skillResearchCoverage();
runtime.tracker.skillKnowledgeFor(816);
runtime.tracker.applyResolvedSkillOperation(816, resolvedOperation);
```

## Input sources

The runtime reads the current page through:

```text
Chrome CDP Runtime.evaluate
-> Laya.stage
-> effective visible TableGameScene
-> table manager / seats / public zones / logs
-> proxy protocol stream
-> headless game model
```

It does not use screenshots or OCR.

`PubGsCMoveCard` normalization retains zones, seats, positions, zone parameters, physical CardIDs, count, movement type, skill ID, turn/round/phase context, and the raw protocol object.

Every concrete hand CardID actually supplied by the runtime can enter the model, including opponent seats. Provenance distinguishes self, authorized visibility, public reveal, raw server-exposed `handCards`, and opaque counts. The server remains authoritative about which identities are sent to the client.

## Skill audit and semantic research

`npm run audit:skills` refreshes the complete current config taxonomy under `reports/skill-audit`.

`npm run skill-rule-worklist` generates the taxonomy-based implementation queues. These queues are useful indexes, not executable semantics.

`npm run skill-knowledge` writes:

```text
reports/skill-research/skill-knowledge-current.json
reports/skill-research/summary.md
```

Coverage is split into:

```text
catalog text loaded
semantic research
executable rule
runtime evidence
```

The knowledge ledger stores each skill's config text, raw catalog owners and every `cha_spellextend` row, reviewed owners, taxonomy, research priority, sources, structured operation rule, open questions, review batch, extended semantic details, and conflicts. Raw `catalogEvidence` is never replaced by a human semantic summary, so mode/difficulty/`par1` values remain independently auditable. Every row also receives a rule identity made from skill ID, product/config path, current catalog fingerprint, reviewed owner IDs or mode, and source type. This prevents same-name, inherited, legacy, and cross-version rules from being merged. The user-provided baseline contained 3027 rows; the live config refreshed on 2026-07-11 contains 3031. The current stable checkpoint has 3031 semantic reviews: every current catalog row is linked to a review file, evidence sources, a mechanic summary, a structured rule or explicit non-executable status, failure semantics, and preserved open questions. `p1-no-card-suspect`, `p2-identity-semantics`, all 1021 `p3-generic-movement` rows, and the complete `p4-no-card-audit` queue are fully reviewed. The three verified raw `cha_spell` gaps are SkillIDs 3973, 7110, and 7111. Catalog and semantic coverage are both complete; executable closure and live packet verification remain separate per-rule evidence levels and are not implied by semantic completion.

Foundational overrides live in `data/skill-knowledge-overrides.json`; reviewed batches live in `data/skill-reviews/*.json`. A batch may refine a foundational entry, while duplicate IDs across batch files fail generation. New batches are checked with `src/node/tools/validate-skill-review-batch.mjs`: the default profile requires the exact 15-field contract, all current raw owners/extensions, current config class, fixed resource hashes, and either an exact constructor fingerprint or `staticAbsenceVerified=true`. A current character-bound/catalogued skill that is genuinely absent from the raw `cha_spell` snapshot is accepted only with `runtimeBinding.rawChaSpellAbsenceVerified=true`, current catalog owner evidence, and an explicit `current-config-gap` source; the validator reports those IDs/count separately instead of pretending a raw row exists. `--profile legacy` re-audits older template variants without confusing their reviewed semantic owner/version scope with the separately generated current `catalogEvidence`.

`npm run skill-review-evidence -- --ids 13,40,119` produces a read-only dossier from the current audit, raw config, resource hashes, and exact H5 fingerprint index. It includes every raw owner/extension row, constructor candidate, and method fingerprint, but deliberately does not invent a mechanic summary, rule, failure behavior, or open-question answer; those remain semantic research work.

## Recording

`npm run record` injects the runtime and writes a continuous local JSONL recording under `recordings/recording-*`. It stores deduplicated proxy protocols, audit-only console protocols, periodic headless snapshots, validation/report rows, a replay-ready `game-record.json`, and `summary.json`.

Environment controls:

```text
SGS_RECORD_MS
SGS_RECORD_INTERVAL_MS
SGS_RECORD_SNAPSHOT_EVERY_MS
SGS_RECORD_STOP_ON_GAME_OVER
SGS_GAME_RECORD_API_URL
SGS_RECORD_USER_ID
SGS_RECORD_PASSWORD
```

If injected after a game is already in progress, the session is marked reconnected and is not uploaded automatically.

Read-only post-processing:

- `recording-report`: protocol, movement, skill, source, and validation summary.
- `recording-timeline`: chronological movement/skill/source rows.
- `protocol-flow-report`: normalized protocol and endpoint evidence.
- `public-zone-report`: public equipment/judgement/general-card evidence.
- `source-report`: hand source provenance.
- `capture`: snapshot plus report sidecars.

Historical legacy comparison reports may still read old compatibility fields, but new implementation decisions must use `snapshot.gameModel`.

## Plugin build

This project builds the headless runtime with `npm run build:runtime`. The workspace build at `E:\ds-sgs\src` embeds that runtime into the single published `plugin/card-tracker.mjs`; Framework and Downloader sources are owned by their separate workspace projects.

The official plugin keeps ID `sgs.card-tracker` for update compatibility, but its current display name is `SGS Game Model` and it is headless.

## Validation

```powershell
npm run check
npm test
npm run build:runtime
npm run skill-knowledge
```

During a live battle:

```powershell
npm run install:tracker
npm run smoke:model
npm run snapshot
npm run validate
npm run record
```

Outside a battle, validation may correctly return `pending` while config and protocol hooks remain healthy. A skill may be marked `runtime-verified` only after a matching live or replayed evidence sample exists.

## Boundaries

- Use current config and current page runtime; do not infer from screenshots.
- Do not use the complete card catalog as a mode deck.
- Do not convert taxonomy labels into exact identities without observation or rule feedback.
- Keep process and discard separate.
- Keep current discard membership separate from discard history.
- Keep the physical destination separate from the reason for movement. A card in discard is not necessarily there because a discard rule fired.
- Preserve a raw protocol `moveType` as evidence, but do not assign it a semantic `movementReason` until the current runtime/config binding proves that mapping.
- Distinguish exhaustion recycling from shuffling the current deck.
- Preserve unresolved mechanics as open questions instead of inventing fallback behavior.
