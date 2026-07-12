# Architecture

## Project layout

```text
src/node/
  cli.mjs                         CDP command entry
  cdp/client.mjs                  Chrome target selection and Runtime.evaluate
  commands/*.mjs                  capture, recording, reports, and runtime sessions
  analysis/*.cjs                  saved/live snapshot analysis
  tools/*.mjs                     skill audit, knowledge coverage, and migration tools
  validation/*.cjs                snapshot validation

src/runtime/
  00-namespace.js                 browser namespace and lifecycle
  lib/laya-utils.js               Laya traversal and card normalization
  sources/*.js                    protocol, config, table, hand, log, and public-zone adapters
  model/game-model-core.cjs       pure card-world reducer and inference engine
  model/game-model.js             live runtime adapter
  tracker/*.js                    compatibility ledgers and taxonomy diagnostics
  entry.js                        headless runtime loop

data/
  skill-knowledge-overrides.json  researched skill semantics and sources

test/
  game-model-core.test.cjs        physical deck-cycle and inference cases
  *.test.cjs                      source, protocol, recording, and compatibility cases
```

There is no runtime UI directory. The game-model plugin installs no overlay, sidebar, panel, button, or drawing layer.

## Runtime lifecycle

The browser runtime is `window.__SgsScripts`.

```text
entry.update() every 500ms
  -> ensure current Config_w is loaded
  -> find effective visible TableGameScene
  -> collect table, hands, logs, and public zones
  -> sync the unique game model
  -> build a serializable snapshot
  -> append recording data when recording is enabled
```

Important methods:

- `manager.update()` runs one model/snapshot tick.
- `manager.snapshot()` is an alias for an immediate update.
- `manager.state.lastSnapshot` stores the most recent result.
- `manager.stop()` stops timers and resets the live game session.
- `tracker.gameModel` is the authoritative card-world model.
- `tracker.configureGameDeck()` supplies an explicitly verified mode deck when automatic resolution is unavailable.

Leaving the effective table scene resets the game model and the auxiliary ledgers. A new scene starts a new session key and cannot inherit cards, endpoints, discard membership, or search constraints from the previous game.

## Input adapters

### Configuration

`config-source.js` decodes these current `Config_w.sgs` tables in the page runtime:

```text
sys_playcard
cha_spell
cha_spellextend
character
sys_gs_game_logic_rule_config
```

`sys_playcard` is the identity catalog, not an active deck. `buildGameRuleDecks()` extracts explicit `PlayCardPile.List` definitions and the current rank `RuleId=22` standard IDs `1..160`.

### Protocol

The proxy hook normalizes `PubGsCMoveCard` and related game protocols. A card-move record retains:

```text
from/to zone and seat
from/to position
from/to zone parameter
listed physical CardIDs
server-carried printed attributes, when the listed entry is an object rather than a bare CardID
declared count
move type
skill id and taxonomy index
turn/round/phase context
raw protocol object
```

The normalized record is dispatched to auxiliary ledgers and once to the game model. If an object-form card entry actually carries a name, suit, number, base type, subtype, or spell identity, the normalizer keeps those fields in a separate `protocolDefinition`. The live adapter registers that authoritative physical definition before applying the movement. Catalog-enriched convenience fields are never copied back as server evidence, and a bare CardID neither invents a definition nor adds duplicate definition history. The game model performs the physical transition; the taxonomy planner remains diagnostic and is not a second world state.

### Runtime table state

The table adapter reads stable or inspectable fields from the current visible scene:

- mode/rule candidates;
- `CardPileCardCount` and compatible spellings;
- seat order, identity, general, relation, and hand count;
- public equipment, judgement, and general-card zones;
- every concrete CardID actually present in `seat.handCards`.

Hand provenance distinguishes self, authorized, raw server-exposed, visible UI, protocol reveal, and opaque counts. The model accepts concrete identities for every seat and records how they became observable.

## Unique game model

The authoritative state is implemented in `model/game-model-core.cjs`. It owns:

- session and deck epoch;
- mode-specific deck definition;
- physical deck count;
- ordered known top and bottom;
- independent ordered physical-card piles with their own epoch, endpoint facts, and recycle policy;
- current discard membership and discard-entry history, including explicit semantic movement reasons and uninterpreted raw move types;
- process, hand, equipment, judgement, removed, and other zones, including named general-card piles with stable descriptors and observer-scoped identity queries; current H5 `skillOutSideCardDict` keys are retained as SkillID/`zoneParam`, while zero-ID entries are triaged into reviewed physical-card counts, reviewed nonphysical state, or unresolved evidence so markers cannot inflate the physical world; `ownershipKnown`/`orderKnown` distinguish proven null/known state from missing evidence, and attached piles retain host CardID/capacity/policy and move to a new host only through explicit rehost evidence;
- judgement-result state independent from the physical judgement entity: base success, idempotent ordered inversion layers, derived success, and an authoritative server-reported final result;
- per-physical-CardID lifecycle state for active/reserved versus terminally destroyed special cards, with typed terminal zones, authority-checked reactivation, monotonically increasing physical generations, old-generation binding expiry, and immutable transition history;
- equipment projections separating a physical source card's rule-effective equipment identity from a zero-CardID virtual equipment capability, with source-zone and skill-binding lifetimes;
- exact card locations;
- typed Boolean proposition/cardinality ledgers for aggregate correctness feedback, with satisfying-assignment intersection and optional hand-generation lifetime;
- continuous location residence history;
- historical CardID location queries at an exact movement event/time boundary, with explicit `before` and `after` semantics;
- per-physical-card use/response/offset event history and ordered movement-group history with per-card source/destination slots;
- separate main/deputy general-card entities and zone-capability/abolition state, neither of which can become a physical CardID;
- unknown counts;
- epoch-scoped search constraints;
- source provenance;
- contradictions and an event journal.

The full rule and probability design is in `docs/game-inference-model.md`.

## Auxiliary compatibility state

The following modules remain available for recording comparison while the new model expands:

- `knownHandLedger`: older persistent known-hand facts and text candidates.
- `protocolZoneLedger`: older protocol-listed exact-location and endpoint summary.
- `rulePlanner`: taxonomy-to-action diagnostic rows.

The old `Card/Zone`, `Classifier`, legacy sidebar, and overlay are not bundled into the active runtime. Their source and tests remain historical migration material only. Snapshot consumers must use `snapshot.gameModel` for new logic.

## Snapshot shape

A visible-table snapshot includes:

```text
table
visibility
logs
publicZones
config
protocol
gameModel
knownHandLedger
protocolZoneLedger
rulePlanner
```

`gameModel` includes:

```text
deck.definition
catalog.observedDefinitionSources / catalog.definitionHistory
deck.count
deck.top / deck.bottom / deck.knownRanks
deck.remaining
deck.constraints
discard
hands
handHistory
handKnowledgeHistory
zoneExchangeHistory
zones
locations
locationHistory
locationGroups / locationGroupHistory
cardTags
cardTagHistory
cardEventHistory
causalEvents / causalEventHistory
comparisons / comparisonHistory
cardViews / cardViewHistory
ruleStates / ruleStateHistory
ruleModifiers / ruleModifierHistory
scheduledEffects / scheduledEffectHistory
choiceSets / choiceSetHistory
skillBindings / skillBindingHistory
physicalPiles / physicalPileHistory
entityPiles / entityLocations / entityPileHistory
contradictions
recentEvents
```

Outside a battle, `visible=false` is valid and the runtime/config/protocol hook may remain healthy; game-scoped model state is reset.

## Probability queries

The game model exposes:

```js
gameModel.nextCardProbability({ endpoint: "top" });
gameModel.recast({ eventId, actorSeat, from: "hand:0", cardIds, drawnCardIds });
gameModel.searchProbability({ predicate, requestedCount });
gameModel.segmentedSearch({ predicate, to, segments });
gameModel.orderedMatchSearch({ endpoint, predicate, foundCount, foundCardIds, foundRank, to });
gameModel.takeFromDeckAtRank({ cardId, rank, to });
gameModel.aggregateSubsetFeasibility({ field: "number", sum, minCount, maxCount });
gameModel.remainingDeck();
gameModel.discardForTurn(turn, round);
gameModel.cardResidence(cardId);
gameModel.physicalCardGeneration(cardId);
gameModel.cardLocationAt({ cardId, eventIndex, moment: "before" });
gameModel.cardsContinuouslyInZone({ zoneKey, sinceEventIndex });
gameModel.handTransitions({ seatIndex, turn, round, lostLastHand, causalEventId });
gameModel.handKnowledgeChanges({ seatIndex, knowledgeOnly: true, sinceEventIndex });
gameModel.exchangeZones({ leftZone: "hand:0", rightZone: "hand:1", atomicOperationId });
gameModel.zoneExchanges({ zoneKey: "hand:0", causalEventId });
gameModel.cardEvents({ cardId, turn, movementReasons, moveType, tags });
gameModel.observeCausalEvent({ eventId, eventType, parentEventId, roles, cardIds });
gameModel.causalEvent(eventId);
gameModel.queryCausalEvents({ rootEventId, eventTypes, cardId, seat });
gameModel.causalLineage(eventId);
gameModel.observeCardAction({ eventId, action, identityKind, subcards, effectiveIdentity, roles });
gameModel.cardAction(eventId);
gameModel.queryCardActions({ identityKind, effectiveName, providerSeat, effectiveUserSeat });
gameModel.cardActionMaterials(eventId, { zone: "discard" });
gameModel.moveCardActionMaterials({ eventId, from: "discard", to: "hand:0" });
gameModel.observeComparison({ comparisonId, kind, initiator, opponents, status });
gameModel.comparison(comparisonId);
gameModel.queryComparisons({ kind, skillId, seat, cardId, status });
gameModel.swapComparisonAssignments({ comparisonId, opponentSeat });
gameModel.queryCurrentDiscard({ entryContext, eventAny, movementReasons, predicate });
gameModel.queryCardSources({ zones, predicate });
gameModel.resolveCardSourceResult({ zones, predicate, foundCount, foundCardIds, from, to });
gameModel.observeNamedCardZone({ pileKey, zoneKind, hostSeat, skillId, zoneParam, cardIds, faceUp, observerSeats });
gameModel.rehostNamedCardZone({ zoneKey, hostCardId, newHostSeat, newHostArea });
gameModel.visibleZone(zoneKey, { observerSeat });
gameModel.namedCardZones({ hostSeat, pileKey, skillId, observerSeat });
gameModel.observeMovementAttempt({ attemptId, from, to, cardIds, actorSeat, status: "pending" });
gameModel.resolveMovementAttempt({ attemptId, status: "prevented", preventionSkillId });
gameModel.movements({ movementGroupId, cardId });
gameModel.observeGeneralCardEntity({ hostSeat, generalSlot, generalId, faceState, printedSkillIds });
gameModel.observeZoneCapability({ seat, area: "equipment", slot: "weapon", status: "abolished" });
gameModel.observePhysicalPile({ key, count, cardIds, topCardIds, bottomCardIds, complete });
gameModel.takeFromPhysicalPile({ key, endpoint: "top", count, cardIds, to: "hand:0" });
gameModel.putIntoPhysicalPile({ key, endpoint: "bottom", count, cardIds, from: "hand:0" });
gameModel.shufflePhysicalPile({ key, reason: "server-reseed" });
gameModel.physicalPileNextProbability({ key, endpoint: "top" });
gameModel.observeEntityPile({ key, entityType, count, entityIds, complete });
gameModel.moveEntityPile({ entityType, from, to, count, entityIds });
gameModel.entityPile(key);
gameModel.observeLocationGroup({ key, cardIds, zoneKeys, zoneCounts });
gameModel.activeLocationGroups({ cardId, zoneKey });
gameModel.invalidateLocationGroup({ key, reason });
gameModel.updateRuleState({ key, kind, operation, value, lifecycle });
gameModel.ruleState(key);
gameModel.registerRuleModifier({ key, kind, subject, selector, effect, lifecycle });
gameModel.activeRuleModifiers({ kind, subject, ownerSeat, eventId, channelKey });
gameModel.removeRuleModifier({ key, reason });
gameModel.observeChoiceSet({ key, domain: "effective-card-identity", candidates, exactSelections: 1 });
gameModel.choiceSets({ domain, skillId, actorSeat });
gameModel.resolveChoiceSet({ key, selectedIndexes, outcome });
gameModel.choiceSetHistory({ key, operation: "resolved" });
gameModel.observeStochasticEvent({ key, domain: "physical-card-id", candidates, complete, samplingModel, sourceZones });
gameModel.stochasticProbability({ key });
gameModel.resolveStochasticEvent({ key, resultCardIds, outcome });
gameModel.stochasticEventHistory({ key, operation: "resolved" });
gameModel.observeSkillBinding({ skillId, ownerSeat, derivedFromSkillIds, replacesSkillIds, lifecycle });
gameModel.activeSkillBindings({ skillId, ownerSeat, ownerGeneralId, ruleIdentityKey });
gameModel.removeSkillBinding({ key, skillId, ownerSeat });
gameModel.explainCard(cardId);
gameModel.observeHandConstraint({ seatIndex, kind, predicate });
gameModel.observeBooleanConstraint({ key, propositions, terms, correctCount, subjectSeat, bindToCurrentHand });
gameModel.observeEffectiveCardAttributes({ cardId, scope, causalEventId, targetSeat, whileCausalEventId, attributes });
gameModel.effectiveCard(cardId, { scope, causalEventId, targetSeat, channelKey });
gameModel.observeApparentCardAttributes({ cardId, scope, attributes, observerSeats, whileChoiceSetKey });
gameModel.apparentCard(cardId, { scope, observerSeat });
gameModel.cardAttributeViews(cardId, { viewKind: "apparent", observerSeat });
gameModel.observeDeckRanks({ rank, cardId });
gameModel.insertAtRank({ cardId, rank, fallback: "bottom" });
gameModel.tagCard({ cardId, tag });
gameModel.applyOperation(resolvedOperation);
```

Probability uses exact deck membership where available and an exchangeability assumption only for unresolved identities. It never reports the 2786-row global catalog as the current deck.

## Skill research

`npm run audit:skills` refreshes the taxonomy index. `npm run skill-knowledge` builds the semantic knowledge ledger.

Coverage is deliberately split:

- catalog text loaded;
- semantic research;
- executable rule;
- runtime evidence.

The 27 taxonomy labels, eight strategies, and current 395 signatures are search and prioritization metadata. They do not prove skill semantics. Every generated row keeps immutable `catalogEvidence` with current raw owners and all `cha_spellextend` rows in addition to the reviewed semantic layer, so a summarized mode rule cannot erase difficulty or `par1` data. Every researched skill must carry sources, open questions, and a structured rule or an explicit reason why no card-world operation exists. Its runtime identity is bound to skill ID, product/config path, catalog fingerprint, reviewed owner IDs or mode, and source type; Chinese name equality is never an identity rule. Review batches may refine a foundational override once, but two batch files may not claim the same skill ID.

## Recording and reports

`npm run record` stores protocol and periodic headless snapshots. `recording-report`, `recording-timeline`, `protocol-flow-report`, `public-zone-report`, and source reports remain read-only evidence tools.

New reports should prefer `snapshot.gameModel` and retain original protocol/raw source references so a later rule correction can replay old evidence through a newer model.

## Validation

Static validation:

```powershell
npm run check
npm test
npm run build:runtime
npm run skill-knowledge
node src/node/tools/validate-skill-review-batch.mjs --file data/skill-reviews/<batch>.json --ids 1,2,3
```

The batch validator's default `current` profile enforces the exact 15-field review contract, current raw owner/extension evidence, config class, fixed resource hashes, and constructor fingerprint or explicit `staticAbsenceVerified`. Older completed templates can be re-audited with `--profile legacy`; that profile still verifies resources, config identity, constructor/absence evidence, and semantic fields while allowing their historical owner/extension summaries because generated `catalogEvidence` independently carries the current raw rows.

Live validation:

```powershell
npm run install:tracker
npm run smoke:model
npm run snapshot
npm run validate
npm run record
```

A completion claim for a skill needs semantic evidence; a runtime-verified claim additionally needs a matching protocol/table/log sample. A taxonomy match alone is insufficient.
