# Game Inference Model

## Purpose

The game model is a headless, event-driven source of card-world facts and inferences. It does not draw UI and it does not treat the old `Card/Zone`, taxonomy, or an observed runtime object as the model itself.

The implementation is split into:

- `src/runtime/model/game-model-core.cjs`: pure state transitions and inference queries.
- `src/runtime/model/game-model.js`: live Laya/protocol adapter.
- `src/runtime/sources/*`: observations from protocol, table state, hands, logs, and public zones.
- `reports/skill-research/skill-knowledge-current.json`: per-skill research state.

The live adapter also feeds non-movement protocol events into `context`: turn, round, phase, active seat, stage, card/skill use summaries, and game over. Later discard/move facts inherit this context when their own packet omits it. A new table scene, a replacement table manager, or an observed `GsCStartGameRep` creates a new model session, preventing state from leaking across a reused Laya scene.

## Physical rules

### Card identity and deck definition

Every physical card is identified by its public `CardID`. The card catalog supplies name, suit, number, color, type, and skill metadata. A game deck is a mode-specific multiset of physical IDs; the 2786-row `sys_playcard` catalog is never a fallback deck.

The current rank rule (`RuleId=22`) resolves to the standard physical IDs `1..160`. Explicit `PlayCardPile.List` definitions are used for modes that provide one. If the mode-to-deck relation cannot be proven, `deck.definition.known=false` and probability queries return `deck-definition-unknown`.

### Zones

The core recognizes at least:

```text
deck
discard
process
shuffle
hand:<seat>
equip:<seat>
judge:<seat>
general:<seat>
removed
outside
```

Basic cards, non-delayed tricks, response cards, and judgement cards can remain in `process` while their use/play/judgement is resolving. They enter `discard` only after the corresponding resolution moves them there. Equipment, delayed tricks, general-card piles, and removed cards follow their actual destination instead.

Zone visibility is independent of physical membership. A special/general pile may be public, owner-only, team-visible, or opaque to this client. Named physical piles on a general must not be collapsed into one `general:<seat>` bucket: `observeNamedCardZone()` creates a stable namespaced zone carrying `zoneKind`, `pileKey`, SkillID/rule identity or protocol `zoneParam`, host seat/general area, controller and placer, explicit non-ownership, order, face state, visibility audience, authorized observer seats, per-card presentation state, and metadata. `ownershipKnown` distinguishes a proven no-owner rule from a missing owner observation, while `orderKnown` prevents JavaScript container enumeration from being promoted into game-rule order. `hostPlayerKey`, `hostAvatarKey`, and `lifecycleScope` distinguish a pile attached to the current general from a player-level pile that survives replacement by the same player's next avatar; player-scoped zone identity stays stable while the avatar descriptor changes. Equipment-attached piles may additionally bind a physical `hostCardId`, capacity, and an explicit attachment policy. Moving the equipment does not silently move the pile: `rehostNamedCardZone()` changes the attached zone only after an authoritative host transition and retains a dedicated before/after history. The live H5 adapter reads the actual `skillOutSideCardDict` keyed by SkillID/`ToZoneParam`. A positive CardID proves physical membership; a zero-ID entry alone does not. Reviewed SkillIDs classify such an entry as a hidden physical card count or a nonphysical mark/state, while an unreviewed SkillID remains `unresolved-outside-entry`. Only `physical-card-zone` reaches the physical reducer; nonphysical and unresolved counts are retained as typed rule-state evidence, so markers cannot consume deck capacity or alter probability. Numeric removed-zone keys resolve to the same `removed:<seat>:<zoneParam>` used by protocol movement, so a public snapshot refines rather than overwrites the protocol location. The physical CardIDs still use ordinary location/movement history. `visibleZone()` redacts exact identities for an unauthorized observer while retaining the known count, and `namedCardZones()` queries piles without merging “田”, “米”, “锋”, “笔”, or other same-seat piles. A later reveal refines observer knowledge; moving the card into judgement processing, a hand, discard, or removed area moves that same CardID and clears its old per-zone presentation.

This is separate from an independent skill deck (`physicalPiles`) and from a non-card entity pile (`entityPiles`). Cards stored face down on a general remain ordinary game cards that may later be gained, used as a judgement card, discarded, or returned. The descriptor never manufactures ownership or public visibility merely because the local client remembers an identity.

### Deck exhaustion

`deck.count` is the physical number of cards in the current draw pile. When an operation needs more cards than remain, the old-deck prefix is preserved and the current discard pile supplies the randomized continuation. When removal makes the deck exactly zero and discard is non-empty, recycling occurs immediately even if no later deck operation is pending.

Recycling is atomic at the model level:

```text
current discard membership -> new deck membership
discard becomes empty
known deck order becomes unknown
deck epoch increments
epoch-scoped search exclusions are cleared
```

If deck and discard are both empty, no recycle occurs. A card entering discard later does not trigger an unsolicited recycle; the next operation that needs the deck does.

Recast has an explicit ordered primitive. `recast()` first moves the selected physical entities from their proven source to the discard pile with movement reason `recast`, then performs the specified top-deck draw. Therefore, if that draw consumes the old deck's last card, the just-recast entities are already in the current discard pile and correctly enter the immediate recycle. Recast is not represented as card use, and its cost/draw remain one causal transaction.

`shuffleCurrentDeck()` is different from exhaustion recycling. A proven current-deck membership fact remains true across a pure reorder, so this operation clears endpoint/rank order but preserves negative membership constraints and the current deck count. It does not silently merge discard. A skill text that merely says “洗牌” is not executed until its actual scope is resolved; current-deck reorder and exhaustion recycle are different operations.

## Facts, knowledge, and provenance

The model stores three different kinds of hand knowledge:

- exact identity: concrete physical IDs;
- constraint: properties or candidate sets without a unique identity;
- unknown count: known hand size minus exact known identities.

Every seat is eligible. The adapter reads all concrete IDs that the server actually supplied in `seat.handCards`. Self, authorized visibility, public reveal, and raw server-exposed values keep different provenance labels; opaque entries remain counts. The model does not discard a concrete fact merely because the seat is an opponent.

`observeHandConstraint()` records facts such as “this inspected hand currently contains no heart card” against a physical hand generation. Any subsequent membership change invalidates the active constraint and moves its lifecycle to `handConstraintHistory`; the fact is never carried across an unknown gain or loss. An in-place show or authorized view is different: it refines exact CardID knowledge without advancing the generation or clearing still-valid constraints. New identities are checked against those constraints and contradictory evidence is retained. `handKnowledgeHistory` records these refinements separately from `handHistory`, and `handKnowledgeChanges()` queries them.

Some server results expose only an aggregate number of correct Boolean guesses. `observeBooleanConstraint()` keeps each proposition, the submitted expected value for each cardinality term, exact/minimum/maximum match counts, directly observed proposition values, per-fact authority, and every currently possible value. Boolean and count inputs are strict: malformed values are rejected rather than coerced into `false` or an unconstrained range. For a small set it enumerates all satisfying assignments; an individual `derivedValue` and `entailedFacts` entry appears only when all solutions agree. For larger sets it performs only sound bound propagation and reports that the solution space was not completely enumerated. Thus “two of basic/trick/equipment were guessed correctly” initially reveals no individual answer; one or more later facts may make the rest derivable. A controlled `{kind:"hand-any", predicate}` statement can link a positive known CardID, a same-generation hand constraint, or a complete identity snapshot proving absence; an incomplete hidden hand never proves absence. Knowledge-only reveals re-solve the same row without advancing its generation. Conflicting assignments or an empty solution set produce zero entailed facts and retain a contradiction instead of arbitrary tie-breaking. A row explicitly bound to a subject hand generation expires on the first gain, loss, exchange, or other membership change; a late observation for an already stale generation is historical/inactive from creation, while full history remains in `booleanConstraintHistory`.

`handHistory` is an immutable physical-membership transition ledger for all seats, including moves whose CardIDs remain hidden. Each row stores before/after count, exact IDs known at each side, unknown count, generation, delta, `lostLastHand`, `gainedFirstHand`, turn/round/phase, causal event ID, and source. `handTransitions()` can therefore answer “did this character lose the last hand card during this turn/event?” without pretending to know which hidden cards moved. Pure show/view knowledge changes never create a false membership transition. This is separate from per-CardID history because an anonymous two-card loss has no physical identities to attach.

Whole-zone exchange is a distinct simultaneous operation. `exchangeZones()` snapshots both non-deck zones, exchanges their complete contents, then emits one direct before/after hand transition per affected seat under a shared `atomicOperationId`; it never creates the sequential fiction “A becomes empty, then B becomes empty”. Even when two opaque hands have the same count and therefore look identical, both hand generations advance and all old hand-property constraints expire because the hidden contents changed. Exact CardIDs retain physical move/residence history, conserved `locationGroup` quotas are remapped bijectively, and `zoneExchangeHistory` preserves the atomic fact. Deck, discard, and shuffle are excluded because their endpoint, epoch, and recycle semantics require specialized operations.

Hidden movement does not always erase all identity knowledge. If a fully known source contains `{A,B,C}` and one undisclosed CardID moves to another non-deck zone, the core creates a conserved `locationGroup`: the same three physical IDs are distributed across the source and destination with the proven per-zone counts, even though no individual assignment is invented. Subsequent hidden moves widen the possible-zone union; exact observations resolve members, and a complete zone snapshot removes that zone from the remaining possibilities. As long as every possible zone is outside `deck`/`shuffle`, every member stays excluded from next-card probability. If uncertainty reaches the deck, probability is unavailable unless the group has both an exact deck-member count and independently proven uniform/exchangeable selection. For proven uniform disjoint groups, next-card marginals use each group’s fixed deck quota and search hit distributions convolve one hypergeometric component per group plus the free population. Unknown selection is never silently replaced by a uniform assumption.

Current location is not enough for rules such as 统度. Every exact CardID therefore has a residence interval with `enteredEventIndex`, entry time, exit event, exit time, previous/next zone, and source. `cardLocationAt()` queries the exact zone at a historical event index or timestamp; when the query lands on a movement boundary, `moment: "before"` returns that movement's source and `moment: "after"` returns its destination, instead of depending on internal journal ordering. If several movements of the same CardID share one coarse timestamp, before means before the first and after means after the last movement at that timestamp. `cardsContinuouslyInZone()` proves that a card has remained in one zone since a supplied checkpoint; leaving and later returning creates a new interval and does not satisfy the old checkpoint. `cardEvents()` separately keeps per-physical-card use, response, offset, turn, round, phase, skill, and protocol facts. `movements()` retains the full move batch even when several cards leave one equipment area separately: `movementGroupId`, batch `sequenceIndex`, and per-card source/destination slots are explicit, so whole-zone movement and each equipment-loss trigger can coexist without reconstructing order from log arrival. A requested discard/transfer is not yet a move: `observeMovementAttempt()` and `resolveMovementAttempt()` retain pending, prevented, accepted, failed, cancelled, and moved outcomes without changing any location. Only a separately observed physical move sets `movementApplied=true` and links its movement ID; an explicitly prevented attempt leaves the card in place. These ledgers support temporal conditions without converting them into persistent name-based tags.

Sources carry an authority level and observation time. Current source classes are:

```text
server-protocol
runtime-public
runtime-seat-hand
visible-ui
game-log
rule-feedback
skill-text
statistical
```

Contradictions are appended to `snapshot().contradictions`; they are not hidden by overwriting the old conclusion.

## Deck endpoints

`deck.top[]` and `deck.bottom[]` are contiguous ordered exact facts. `deck.knownRanks` additionally stores sparse facts such as “the third card is CardID X”, so a model can represent 精策-style insertion at positions 3/6/9 without pretending that positions 1/2 are known. Top/bottom removal and insertion shift surviving ranks; random removal, an unresolved insertion, or shuffle invalidates only the order facts that can no longer be proved.

`insertAtRank({cardId, rank, fallback:"bottom"})` moves an outside physical card into a known rank, shifts existing sparse ranks, and supports the explicit bottom fallback. A deck-to-deck move at an arbitrary rank is deliberately rejected until its old position is known; the core does not invent a count-changing insertion for a reposition.

`partitionDeckWindow()` applies a fully observed 观星-style split while keeping deck membership and count unchanged. `revealUntilResult()` models 荐言-style public scanning: all revealed cards first remain in `process`, the scan may cross an exhaustion recycle, prior misses therefore do not enter that recycle, and only after the scan do misses enter discard and the match enter its destination.

Default selectors are operation properties:

- normal draw: `top`;
- judgement: `top`;
- 寸目-modified draw: `bottom`;
- predicate search: `random` among matching current-deck cards;
- future reverse-judgement skill: judgement operation with `bottom`.

This avoids a skill-name branch in the deck reducer. A skill changes the operation, and the reducer executes the operation.

Judgement replacement has separate physical operations. `judgement-substitute` moves the old judgement card to discard; `judgement-exchange` moves it to the caster's hand. A replacement taken from the deck top leaves the deck before the old judgement card is discarded, so an exhaustion recycle cannot accidentally include that old card. The final effective judgement card remains in `process` until the normal judgement-end movement occurs.

Printed card identity is immutable. `observeEffectiveCardAttributes()` creates a provenance-scoped view for effects such as 红颜 or 真仪 that change a judgement's effective suit/color/number without changing its physical CardID or catalog row. `effectiveCard()` returns printed and effective values side by side. A view with no explicit causal/scope binding is global; event, target, or judgement views require the matching query context. A zone-scoped view expires when the card moves and remains in `cardViewHistory` as evidence.

Whether a judgement is ultimately successful is a fourth, independent fact. `observeJudgementOutcome()` binds one judgement event to its physical judgement CardID and records the rule's `baseSuccess`; `invertJudgementOutcome()` appends an idempotent, identity-keyed success-inversion layer without changing that CardID, its location, or its printed/effective attributes. The parity of all observed inversion layers produces `derivedSuccess`. A server-reported final result is retained separately as `reportedFinalSuccess` and takes authority for `finalSuccess`, so an implementation/version discrepancy remains auditable instead of rewriting the base condition. Repeating the same `layerId` is a duplicate observation, not a second inversion. This models delayed-trick rules such as “判定结果反转” without misrepresenting them as 改判.

Stable protocol position values (`bottom=0`, `top=65280`, `random=65281`, `needless=65282`) outrank taxonomy hints. `zoneParam` remains part of special/process/removed zone identity. Unknown random removal clears endpoint facts if the removed identity cannot prove that the endpoint survived. Known removal consumes or preserves the relevant endpoint by ID.

## Discard model

The core keeps both:

- current physical discard membership;
- immutable per-game discard-entry history with `turn`, `round`, `phase`, and `epoch`.

`discardForTurn(turn, round)` returns only cards that both entered during that turn and are still in the current discard pile. Recycling clears current membership but preserves every prior entry in `snapshot().discard.history`; the bounded recent event stream is only a diagnostic view. This is the required query for 谋董卓的封赏; a historical “discarded this turn” list alone is incorrect.

Being in `discard` is a location fact, not proof that a discard rule caused the movement. Each observed move can therefore retain a normalized explicit `movementReason` such as `discard`, `card-use`, or `card-response`, independent `reasonTags`, and the raw numeric `moveType`. The core never guesses a semantic reason from an undocumented raw number: identical `moveType` values may coexist with different proven reasons, while an unknown mapping remains raw evidence only. Discard entries and durable card events keep these fields, and `queryCurrentDiscard()`/`cardEvents()` can filter them.

Every resolved known-card movement also appends a durable physical-card event with source zone, destination zone, turn context, protocol source, and tags such as `gained-from-deck`, `entered-discard`, or `left-discard`. `queryCurrentDiscard()` intersects current membership with entry context, card predicates, and one or more event filters. Thus “used as a spade or was offset this turn and is still in discard” is represented as an explicit intersection; a past event alone never implies current discard membership.

Physical movement history alone cannot represent a complete resolution. `observeCausalEvent()` therefore maintains a separate durable event graph: a parent card-use event can own ordered per-target effect events; responses, offsets, inserted uses, damage, recovery, and source-replacement events can be children or explicit causes. Each node keeps stable event identity, root/parent links, channel key, sequence index, actor/user/caster/responder/damage-source/target roles, physical card IDs only when observed, effective name, status, outcome, rule context, and provenance. Repeated observations enrich one stable node and remain in immutable `causalEventHistory`; conflicting parent, identity, or role facts create contradictions instead of silently rewriting history.

`observeCardAction()` adds a validated card-identity binding to one causal node. It distinguishes `physical`, `virtual-zero-subcard`, and `virtual-with-subcards`; records the physical main card, consumed material subcards, unrelated cost cards, and non-moving reference cards separately; and keeps declared, revealed, and final effective identities as different fields. A reference may prove a suit, color, count, or legal declaration while remaining in its hand/zone; it is related to the causal event but is not silently promoted to a subcard or cost. Provider and effective user are independent roles, which is required for 激将/护驾. A server-side virtual/logical card token is stored only as `logicalCardToken` and is never admitted to the physical CardID set. Each related physical entity retains its real source zone and printed catalog identity. `cardAction()` and `queryCardActions()` expose these bindings, while actual movements remain protocol-backed card facts.

Rules that later refer to “此牌” may mean the parent action's corresponding physical entity group rather than a printed card name. `cardActionMaterials()` resolves the durable binding back to each main/subcard entity's current exact location or conserved location-group possibilities. `moveCardActionMaterials()` moves the group only when every required entity is proven in one source zone; if another effect already gained one material or any location is unresolved, it refuses instead of recreating or duplicating the missing CardID. Cost and reference cards remain excluded unless the caller explicitly asks for the corresponding category; therefore a same-suit hand reference never follows the actual material into the process or discard zone. This supports physical and multi-material virtual parents with the same identity-safe primitive.

This also separates use from recast and show: a shown hand CardID stays in hand; a recast physical card is discarded and draws another card but has no parent use effect; transformed delayed tricks keep their material CardID in the judgement zone; multi-material virtual cards have no fabricated suit/number unless the reviewed rule explicitly derives one. Identity-stage observations are retained in causal history so a declared 蛊惑 identity and later revealed printed identity need not agree.

`queryCausalEvents()` filters the current graph by root, parent, type, channel, card, skill, seat, tag, or status. `causalLineage()` returns ancestors and descendants. This keeps the user of 【南蛮入侵】 distinct from a replaced damage source such as 祸首, links one 【闪】/【杀】 response only to its current target effect, and lets a multi-response loop retain exact order without pretending that an unplayed response proves anything about a hidden hand. Card-move events may carry the same `causalEventId`, joining the logical graph to physical evidence without merging their lifecycles.

Target membership and target-effect outcome are different facts. When the server exposes an exact current target collection, the binding keeps its order in an identity-keyed `ordered-list` rule state and applies explicit append/remove updates there. The parent causal event's `targetSeats` is a monotonic record of every observed target, so removing a target never erases historical evidence. A per-target child then records whether that target remained selected, was removed, had only its effect invalidated, responded, or resolved. An extra resolution is another ordered child under the same parent use, not another physical card or copied material group. This distinction covers target additions, minimum-one-target removals, 智迟/无言-style effect invalidation, and whole-effect repetition without using card movement as state.

Pindian/comparison resolution has a normalized ledger in addition to the causal graph. `observeComparison()` stores one initiator side and ordered opponent sides, their exact physical CardIDs when public, printed and separately observed effective numbers, per-opponent winner/tie/outcome, stage, skill, channel, and provenance. A multi-target skill such as 鼓舌 keeps one initiator CardID shared across all opponents; it never duplicates that entity. Revealed cards remain wherever movement protocol places them—normally `process` through the result window—and the comparison ledger itself never discards them early. `swapComparisonAssignments()` handles a server-confirmed pre-reveal one-on-one exchange of which committed entity belongs to which participant: it swaps logical assignment and card-derived numbers but performs no hand or process-zone movement. The swap fact is valid even while one or both CardIDs remain hidden; later reveal packets populate the already-swapped participant sides. It refuses after reveal/result or for a multi-opponent group whose shared-initiator semantics would be ambiguous. `comparison()` and `queryComparisons()` expose current groups while `comparisonHistory` retains every assignment/reveal/result/settled observation. Winner rules are not recomputed from printed numbers when a skill may modify the effective number.

## Search and negative evidence

Search is represented by:

```text
source
predicate
selector
requested count
destination
exhaustive flag
observed result IDs
insufficient-result policy
```

If an exhaustive search returns fewer than requested, the remaining matching identities become impossible in the current deck epoch. A pure current-deck shuffle preserves this membership fact; recycle or insertion invalidates it because the deck membership changed.

Search success count and exposed identity count are distinct. When the server reports that one card was found but withholds its CardID, the model first removes one unknown predicate-matching card and adds an unknown destination member. Only after that movement may it infer that no further match remains. If that removal exhausts the deck and causes a recycle, the old-deck shortfall is not applied to the new epoch.

A multi-result predicate search may itself cross that exhaustion instant. Such a batch cannot be reduced as one removal: the last old-epoch result must move first, the then-current discard must recycle immediately, and all remaining result/shortfall evidence belongs to the new epoch. `segmentedSearch()` therefore requires an explicit ordered list of per-epoch observations and applies them transactionally. A segment may carry its own predicate, requested/found counts, exposed CardIDs, exhaustive flag, and asserted epoch. An epoch mismatch or a segment that itself crosses a boundary rolls the complete operation back. Plain `search()` rejects `foundCount > currentDeckCount` before recording any result, because guessing the server's hidden batch order would corrupt both membership and negative evidence.

`queryCardSources()` handles rules whose source is a union such as “牌堆或弃牌堆”. It reports each source independently: exact matching IDs, opaque count, unresolved deck candidates, capacity, visibility, and completeness. The combined query is read-only and explicitly returns `negativeEvidenceApplied:false`; a refused or failed union-source choice cannot silently become a deck-only exclusion.

`resolveCardSourceResult()` applies the later server result without inventing a source policy. A concrete CardID may move when its current source is already proven or the protocol explicitly identifies one of the allowed sources. A hidden result requires an explicit source. If the source is still ambiguous, the operation is rejected before any count changes; if an explicit source conflicts with a proven location, the contradiction is retained instead of decrementing two zones. Even a zero-result exhaustive union query returns `negativeEvidenceApplied:false`: source-specific exclusions require a separate source-specific server fact.

An endpoint first-match search is not a reveal-until operation. `orderedMatchSearch()` models rules that take the first matching card from the top or bottom while every skipped nonmatching card remains in the deck. If the found CardID's exact rank is proven by a sparse-rank fact or a known endpoint, `takeFromDeckAtRank()` removes that one physical card and shifts only later ranks; known prefix/suffix order survives. A supplied rank that conflicts with stronger order evidence records a contradiction, clears the stale order, and still honors the observed physical movement conservatively. If no rank is visible or derivable, the model removes one predicate-matching unknown position and refuses to invent the hidden scan length or skipped identities. A zero result may create whole-deck negative evidence only when the ordered search is explicitly exhaustive.

This distinction is required for 偏宠 and bottom-first variants such as the documented 奢葬 behavior. `revealUntilResult()` remains reserved for effects that physically expose and move every scanned card; it must not be substituted for a hidden first-match lookup.

Single-card predicates support nested `all`/`any`/`not`, equality sets, and concrete comparisons over ID, name, type, subtype, color, suit, number, spell ID, effective damage nature, spell class, damage-card status, delayed/ordinary-trick status, and equipment subtype. Config-derived fields come from the current `cha_spell` and `sys_playcard` rows, not from a hand-maintained card-name list; event-scoped nature may come from a proven transformation. Aggregate selectors such as “点数和为 36 的子集” are a different problem. Until an aggregate solver and its sampling distribution are proven, the model returns `predicate-not-executable` and refuses to turn a failed search into false negative evidence.

For 浑天仪, the predicate is:

```text
type = trick
number = trigger.card.number
```

A zero-card result proves that no matching card was in the current deck at that moment. It does not itself trigger recycling. The one-matching-card behavior remains an explicit open question until a protocol sample or reliable rule source resolves it.

## Independent physical-card piles

Some skills own a real, ordered CardID pile that is neither the main draw pile nor a non-card entity domain. `observePhysicalPile()` records its count, exact membership when known, ordered top/bottom facts, visibility, rule-scoped key, recycle policy, and provenance in a namespaced `physical-pile:<key>` zone. Its entities remain ordinary physical cards: taking or returning one creates normal location, residence, movement, causal, and hand facts. A dynamically observed ID outside the initial mode catalog is registered as physical, but stays outside the main-deck probability population while its location is this independent pile.

`takeFromPhysicalPile()` and `putIntoPhysicalPile()` preserve or conservatively invalidate that pile's endpoint facts according to the observed endpoint and identities. `shufflePhysicalPile()` advances only its own epoch and clears only its own order; it never increments the main deck epoch, consumes the main deck, or merges the main discard. Empty-pile reseeding or recycling is therefore never inferred from main-deck exhaustion rules: the binding must report the server-authoritative membership/reseed event and its explicit `recyclePolicy`.

`physicalPileNextProbability()` is exact when the requested endpoint is known. After an observed shuffle it reports a uniform distribution only when the pile's full current membership is proven; incomplete membership yields unavailable rather than an invented population. `physicalPileHistory()` retains observations, takes, returns, and shuffles separately from the main deck/discard history. This domain is required for rules such as Skill 6102's exclusive physical skill pile and remains distinct from `entityPiles`, whose IDs are not game cards at all.

## Non-card entity piles

Some rules operate on a character/general deck rather than the physical game-card deck. Even when a general ID has the same numeric value as a CardID, it is a different identity domain and must not change deck count, discard membership, endpoint order, or card probability. `observeEntityPile()` records an exact or opaque snapshot for a named entity pile, `moveEntityPile()` records known and hidden transfers between entity piles, and `entityPile()` reads one pile. The snapshot exposes `entityPiles`, `entityLocations`, and immutable `entityPileHistory` separately from all card zones.

The caller supplies an explicit `entityType` such as `general`; pile keys carry the concrete rule/mode/seat scope. This supports current character-deck rules while leaving room for other non-card rule entities. An entity-pile operation is also available through `applyOperation()`, but it never enters the physical card reducer.

A general card currently installed on a player is more specific than a member of a general deck. `observeGeneralCardEntity()` therefore stores a stable slot instance with host seat, main/deputy or other slot, GeneralID, face state, printed SkillIDs, separately observed effective SkillIDs, active state, and observer visibility. Hidden identity queries redact GeneralID and skills for unauthorized observers. These rows never create CardIDs and printed skills do not activate a runtime skill binding by themselves; activation still requires `observeSkillBinding()` evidence. Slot updates and identity changes remain in `generalCardEntityHistory`.

Area existence is a third independent domain. `observeZoneCapability()` records whether an equipment slot, judgement area, or other named capability is available, disabled, or abolished, including permanent state and provenance. It does not discard, create, or relocate any card. This separation is required when a rule first moves existing equipment and then abolishes a slot, or grants a virtual equipment capability without creating a physical equipment card.

Equipment rule identity is a fourth domain. `observeEquipmentProjection()` requires an explicit kind. A `physical-effective-identity` projection binds one already located source CardID to the equipment name/SkillID/range or other rule identity it currently provides; the source remains the sole physical entity and the projection expires when that CardID leaves its bound zone. A `virtual-equipment` projection has no source CardID and does not occupy a physical slot unless the rule explicitly says so. Both carry host seat, slot, visibility, source authority, optional skill-binding lifetime, and `createsPhysicalCard=false`. Therefore a transformed original equipment, a generated unique ship, and a “视为装备八阵” ability cannot be collapsed into the same synthetic card.

## Probability model

`nextCardProbability({ endpoint })` returns the complete distribution for:

- physical CardID and name;
- 13 numbers;
- 4 suits;
- 3 types;
- 2 colors.

If the requested endpoint is known, the result is exact. Otherwise the model distinguishes:

- identities known to be in the deck;
- identities known to be outside the deck;
- unresolved identities that may be in the deck or an unknown hand;
- identities excluded from the current deck by search feedback.

Let `D` be physical deck count, `E` exact known deck identities, `U` unresolved identities, and `R=D-|E|`. An exact deck identity has top probability `1/D`; each unresolved identity has probability `(R/|U|)/D`. This reduces to `1/|U|` when no deck membership is exact, which is why unknown opponent hands remain in the candidate population without being falsely assigned to the deck.

`searchProbability()` uses a hypergeometric distribution over unresolved identity placement and reports no-match, at-least-one, and requested-count probabilities. The complete hit-count tail is retained, so “at least N” includes outcomes with more than N matching cards instead of truncating at the requested count. Probability APIs refuse to answer when known and opaque zones over-allocate the physical card world or when the remaining deck capacity exceeds the unresolved identity population.

## Physical tags and resolved operations

Some rules create a real CardID that was not present in the mode's initial deck list. `observePhysicalCardDefinition()` adds the server-supplied printed name, suit, number, type, and related fixed traits to the physical catalog without turning a zero-subcard virtual action into a card. When an object-form protocol card actually carries those attributes, the protocol normalizer preserves only the fields present in that packet as a separate `protocolDefinition`; config-enriched display fields are not promoted to server evidence. The live adapter registers the definition before the same packet's physical movement, skips an identical existing definition, and does nothing when the packet contains only a CardID. The ID enters `deck.dynamicIds`, so once its actual zone is observed it remains excluded from or included in deck probability normally, and it can later join an exhaustion recycle if it is physically in discard. Printed definitions have per-ID provenance and immutable revision history. A lower-authority skill-text conflict is rejected; an authoritative revision is retained as a contradiction instead of silently rewriting history. Event-scoped transformations continue to use `observeEffectiveCardAttributes()` and never overwrite the printed definition.

A real special CardID may have a lifecycle outside the ordinary mode deck. `observePhysicalCardLifecycle()` records active, available, reserved, destroyed, retired, consumed, or terminal-removed state separately from printed identity and current zone. A terminal transition relocates the same entity into a typed `terminal-card-zone`, marks it non-recyclable, removes it from the active probability population, and keeps the transition and movement IDs in `physicalCardLifecycleHistory`; it never copies the equipment or leaves a recyclable duplicate in discard. The terminal zone is excluded from active-world allocation totals but remains queryable evidence. Reactivation is rejected unless the caller supplies both explicit authorization and a concrete destination under sufficient authority. An authorized reissue keeps the protocol CardID but increments its physical generation. Tags, effective/apparent views, equipment projections, rule modifiers, and scheduled effects bound to the ended generation expire; a historical parent action retains its original generation and `moveCardActionMaterials()` refuses to move the newly issued same-number entity. `physicalCardGeneration()` exposes this boundary. This supports unique special equipment and generated ships whose “离开装备区后销毁” is stronger than ordinary `removed`, including server-confirmed reuse of a fixed special equipment ID without letting old-instance facts leak into the next issue.

An apparent or disguised identity is neither printed nor rule-effective. `observeApparentCardAttributes()` stores it with an explicit scope, authorized observer seats, visibility, provenance, and lifecycle. `apparentCard()` applies only views visible to the requested observer, while `effectiveCard()` ignores every apparent view. Therefore a card disguised as one of three candidate names for a guessing prompt keeps its true printed CardID/name and its rule-effective legality; only authorized guessers receive the apparent name. Views may expire on movement, phase/turn/round/event, skill loss, explicit clear, or resolution of a bound choice set. All invalidations remain in `cardViewHistory`.

Rule-effective views can also be scoped to an exact parent use/effect, target seat, and channel. A non-global view is applied only when the query supplies its matching `scope` or typed causal context; a context-free `effectiveCard(cardId)` applies global views only. Thus one physical black 【杀】 may remain 【杀】 for one target while being effective as 【决斗】 for another target, without the target-specific name leaking into movement history, another target, or the printed card. `whileCausalEventId` expires that view when the bound per-target effect settles; the inactive row and its reason remain in `cardViewHistory`.

`tagCard()` attaches a lifecycle-tagged fact to a physical CardID. A `physical-card` tag follows that entity across hand, public zone, discard, and deck movement. `turn`, `round`, and `phase` tags expire when the corresponding context changes; `while-zone` tags expire on departure; explicit event expiry is also supported. Every expiry moves an immutable row into `cardTagHistory`, so a former restriction is not confused with an active one. This is the primitive required by “币”“镜花”, 本回合禁用牌, and similar mechanics; a count on the owning character is not equivalent.

Not every persistent rule fact belongs to one card. `updateRuleState()` stores identity-keyed `scalar`, `counter`, `set`, or `ordered-list` values and retains every mutation in `ruleStateHistory`. The key must include the reviewed rule identity and concrete instance/owner scope. Sets represent facts such as “本回合已触发花色”; ordered lists preserve duplicates and sequence for rules such as 赂存, where `杀,闪,杀` is not interchangeable with an unordered name set. Rule state can expire by turn, round, phase, explicit event, game end, or explicit clear. The physical reducer does not interpret Chinese state names.

Continuous or event-scoped changes to legality and resolution are kept in a separate structured modifier ledger. `registerRuleModifier()` records a full identity key, kind, subject, unevaluated selector, resolved effect, owner/rule identity, priority, event/channel binding, and lifecycle. Parent `eventId`, per-target `targetEventId`, and `targetSeat` are independent immutable scope fields: a red judgement may prohibit one target from responding to a multi-target parent use without affecting another target's response or damage branch. Settlement of the target effect expires only its target-scoped row, while settlement of the parent expires every remaining child modifier bound to that use. Examples also include a while-equipped Sha use-count delta, a turn-scoped target prohibition, a two-response requirement bound to one Sha event, a damage delta, or an effective-card transformation. `activeRuleModifiers()` filters proven active rows but does not execute arbitrary selector text; a binding layer must supply resolved context. Modifiers expire with turn/round/phase changes, explicit events, game over, settlement of their causal event, departure of their concrete `whileCardId` from `whileZone`, or termination of that physical-card generation. Every registration, update, and expiry remains in `ruleModifierHistory`.

This prevents “no direct card movement” from becoming “no model fact”. 连弩/诸葛连弩 use-limit changes, 同疾/机关/才识 target legality, 无双 response count, 酒/古锭刀 damage changes, 青釭剑 armor suppression, and 矢志 effective identity can share lifecycle machinery without a Chinese skill-name branch. Physical movement, causal events, scalar state, and modifiers remain separate evidence domains.

Effects promised for a later phase, turn, target event, or other exact server event use a separate scheduled-effect ledger. `scheduleEffect()` stores a concrete trigger matcher, the unresolved future effect, rule/skill/owner identity, causal provenance, and optional physical-card, zone, or skill-binding lifetime. `observeGameEvent()` changes a matching row from `pending` to `due`; it never executes the payload or invents a card movement. The binding layer applies only the subsequent authoritative result and then calls `resolveScheduledEffect()`, while cancellation and expiry remain distinguishable history. `dueScheduledEffects()` therefore answers what should now be checked without treating a skill-text promise as an observed outcome. This covers next-end-phase rewards, delayed reuse, phase replacement, and extra-turn promises without branches on Chinese skill names.

Server prompts and random candidate lists use a distinct typed choice-set ledger. `observeChoiceSet()` requires a domain such as `effective-card-identity`, `physical-card-id`, `seat`, `skill-id`, `suit`, `number`, or a rule-specific branch domain, then retains candidate order, completeness, selection limits, visibility, actor/observer scope, rule identity, provenance, and lifecycle. Numeric SkillIDs or card-template IDs in an `effective-card-identity` set are nonphysical values: they never enter the deck, locations, discard, or probability population. Even `physical-card-id` candidates are references only. `resolveChoiceSet()` records selected indexes and outcome but sets `movementApplied=false`; a later authoritative move must relocate the selected entity. Lower-authority candidate rewrites are rejected, phase/turn/round and skill-binding expiry are retained in `choiceSetHistory`, and duplicate server observations are idempotent. This is the generic boundary for random trick candidates, declaration menus, target/branch choices, and similar information that must be predicted without being mistaken for displayed deck cards.

Server randomness uses the same typed candidate foundation with `selectionAgency=server-random`, exposed through `observeStochasticEvent()`. It additionally preserves `samplingModel`, candidate weights when proven, a predicate-only incomplete population, possible source zones including `unresolved`, source-resolution state, and observer visibility. A text rule such as “随机获得一张牌” may therefore remain pending with no enumerated candidate and no assumed source. `stochasticProbability()` reports the next-selection marginal only for a complete candidate population and an explicit uniform, weighted, or deterministic model; `unknown` never silently becomes uniform, and multi-result inclusion probabilities are not fabricated from that marginal. `resolveStochasticEvent()` may record a server-returned CardID from an incomplete population, but still sets `movementApplied=false`: only a later move with a proven source changes deck/hand/equipment state. The result and the later automatic-use/equip action can share a causal chain without conflating outcome selection, source resolution, movement, and subsequent use.

Skill availability is another independent evidence domain. `observeSkillBinding()` records an exact SkillID bound to a concrete seat, general, mode, or explicit instance key. It retains the reviewed `ruleIdentityKey`, version scope, source type, derivation parent IDs, grant event, and lifecycle. `replace-skill` deactivates only explicitly named prior SkillIDs for the same owner; an equal Chinese name never merges identities. `activeSkillBindings()` is therefore the gate for base, mission-derived, temporary, replaced, or lost rules. A catalog owner row or an old client class is not enough to activate a rule without a current-match binding observation. Rule state, modifiers, or scheduled effects that explicitly declare `whileSkillBindingKey` expire with that binding; effects meant to survive skill loss omit it. Every grant, update, replacement, expiry, and loss remains in `skillBindingHistory`.

`applyOperation()` accepts only an already resolved operation IR: concrete counts, zones, card IDs/results, predicates, endpoints, and shuffle scope. It currently applies sequences, draws, ordered recasts, moves/puts, in-place show/view knowledge observations, server-generated physical-card definitions and terminal/reactivation lifecycle transitions, equipment projection changes, rule-effective and observer-scoped apparent attribute views, single-epoch random searches, explicitly segmented cross-epoch searches, endpoint-first-match searches, explicitly resolved union-source searches, known-count hidden search results, search feedback, reveal-until scans, endpoint window partitioning, endpoint/rank observations and rank removal/insertion, judgement substitution/exchange, judgement-outcome observation/inversion, atomic known-card swaps, atomic whole-zone/whole-hand exchanges, complete parent-material-group moves, hand and Boolean/cardinality constraints, physical-card tags, location-uncertainty groups, comparison observations, generic rule state, structured modifiers, scheduled-effect registration/resolution, typed choice-set observation/resolution, exact skill binding changes, isolated non-card entity-pile observations/transfers, current-deck shuffle, and discard recycle. An atomic known-card swap removes the deck-side card before inserting its counterpart and suppresses intermediate recycling, so exchanging the last deck card does not create a false epoch. A whole-hand exchange instead uses the simultaneous zone primitive described above. The whole sequence is transactional: any unresolved expression such as `min(alivePlayers,5)` rolls the sequence back. Trigger binding, dynamic expression evaluation, and the physical effects selected by a choice belong to a separate skill/event layer and cannot silently mutate the physical model.

## Skill knowledge base

The taxonomy is retained only as a search index. The user-provided baseline contained 3027 rows; the live config refreshed on 2026-07-11 contains 3031 and 395 category signatures. Neither count can execute a skill because a category signature lacks trigger, guard, source, destination, count, selector, order, replacement, duration, failure, and deck-cycle semantics.

Run:

```powershell
npm run skill-knowledge
```

The generated coverage is split into four independent layers:

```text
catalog text loaded
semantic research
executable rule
runtime evidence
```

Each skill row keeps sources, open questions, conflicts, a structured rule or explicit non-executable status, the exact review batch, failure semantics, extended semantic details, and the original taxonomy as a non-authoritative index. Its `ruleIdentity` contains skill ID, product/config path, the SHA-256 catalog fingerprint, reviewed owner IDs or mode, and source type. Reviewed inherited owners override empty taxonomy placeholders; a Chinese display name is never used to merge rules. A taxonomy conflict never counts as semantic review completion. The current stable checkpoint has 3031/3031 semantic reviews: `p1-no-card-suspect`, `p2-identity-semantics`, all 1021 `p3-generic-movement` rows, and the complete `p4-no-card-audit` queue are reviewed. SkillIDs 3973/7110/7111 are the three explicitly verified current raw-configuration gaps. Open questions remain attached to their exact rule identities and do not permit invented card facts.

The headless runtime does not create DOM or Laya display nodes, including detached helper elements. Config text normalization uses pure string tag removal and entity decoding; overlays, panels, buttons, sidebars, canvas drawings, and UI roots are outside the game-model bundle.

## Runtime API

The headless runtime is exposed at:

```js
const runtime = window.__SgsScripts;
runtime.manager.update();

const model = runtime.tracker.gameModel;
model.snapshot();
model.remainingDeck();
model.nextCardProbability({ endpoint: "top" });
model.searchProbability({
  predicate: { type: "trick", number: [1, 12] },
  requestedCount: 2
});
model.orderedMatchSearch({
  endpoint: "bottom",
  predicate: { suit: "黑桃" },
  foundCount: 1,
  foundCardIds: [72],
  to: "hand:0"
});
model.takeFromDeckAtRank({ cardId: 72, rank: 3, to: "hand:0" });
model.aggregateSubsetFeasibility({
  field: "number",
  sum: 36,
  minCount: 1,
  maxCount: 10
});
model.discardForTurn(4, 2);
const checkpoint = model.observeGameEvent({ type: "game:turn", turn: 4, round: 2 });
model.cardResidence(72);
model.cardLocationAt({ cardId: 72, eventIndex: movement.eventIndex, moment: "before" });
model.cardsContinuouslyInZone({ zoneKey: "hand:0", sinceEventIndex: checkpoint.eventIndex });
model.handTransitions({ seatIndex: 1, turn: 4, lostLastHand: true, causalEventId: "discard:<id>" });
model.cardEvents({ cardId: 72, turn: 4, movementReason: "discard", moveType: 17, tags: ["discard-phase"] });
model.observeCausalEvent({
  eventId: "response:<protocol-id>",
  eventType: "card:respond",
  parentEventId: "target-effect:<protocol-id>",
  roles: { responderSeat: 1 },
  cardId: 72,
  effectiveName: "杀"
});
model.queryCausalEvents({ rootEventId: "use:<protocol-id>" });
model.causalLineage("response:<protocol-id>");
model.observeCardAction({
  eventId: "use:<protocol-id>",
  action: "use",
  identityKind: "virtual-with-subcards",
  subcards: [{ cardId: 72, fromZone: "hand:1", role: "material" }],
  declaredIdentity: { name: "杀" },
  effectiveIdentity: { name: "杀", type: "basic" },
  providerSeat: 1,
  effectiveUserSeat: 0
});
model.queryCardActions({ identityKind: "virtual-with-subcards", effectiveName: "杀" });
model.observeComparison({
  comparisonId: "pindian:<protocol-id>",
  kind: "pindian",
  initiator: { seat: 0, cardId: 72, effectiveNumber: 10 },
  opponents: [{ seat: 1, cardId: 91, effectiveNumber: 8, winnerSeat: 0 }],
  status: "result"
});
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
  key: "character-deck:mode:<id>",
  entityType: "general",
  count: 3,
  entityIds: [1001, 1002, 1003],
  complete: true
});
model.moveEntityPile({
  entityType: "general",
  from: "character-deck:mode:<id>",
  to: "general-zone:seat:0",
  count: 1,
  entityIds: [1001]
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
  ruleIdentityKey: "sgs-web-h5:21134:owner:0",
  versionScope: { resourceVersion: "2026070605" }
});
model.activeSkillBindings({ skillId: 21134, ownerSeat: 0 });
model.activeRuleModifiers({ subject: "sha-use-count", ownerSeat: 0 });
model.ruleState("rule:<identity>:owner:0:used-names");
model.explainCard(72);
model.observeHandConstraint({
  seatIndex: 1,
  kind: "none-match",
  predicate: { suit: "红桃" },
  reason: "完整观看后的规则反馈"
});
model.observeEffectiveCardAttributes({
  cardId: 72,
  scope: "judgement",
  whileZone: "process",
  attributes: { suit: "红桃", number: 5 }
});
model.observeEffectiveCardAttributes({
  cardId: 91,
  scope: "target-effect",
  causalEventId: "use:<id>",
  targetSeat: 2,
  whileCausalEventId: "effect:<id>:target:2",
  attributes: { name: "决斗" }
});
model.effectiveCard(91, { scope: "target-effect", causalEventId: "use:<id>", targetSeat: 2 });
model.observeDeckRanks({ rank: 3, cardId: 72 });
model.insertAtRank({ cardId: 72, rank: 6, fallback: "bottom" });
model.tagCard({ cardId: 72, tag: "example-physical-tag" });
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
runtime.tracker.listResearchedSkillRules();
runtime.tracker.applyResolvedSkillOperation(816, {
  type: "draw",
  endpoint: "bottom",
  destination: "hand:0",
  count: 1,
  cardIds: [72]
});
```

If a mode deck cannot yet be resolved automatically, the runtime accepts an explicit public definition:

```js
runtime.tracker.configureGameDeck({
  cardIds: [1, 2, 3],
  deckCount: 3,
  label: "verified-mode-deck"
});
```

This is a data API only. No overlay, sidebar, button, panel, or Laya drawing is installed.

Only semantically reviewed rows are embedded in the browser runtime. `applyResolvedSkillOperation()` does not execute the stored text rule directly: the caller must supply a concrete, already observed/resolved operation, and the same transactional validation as `applyOperation()` applies.

`npm run smoke:model` performs a read-only CDP check of the live page: runtime version, model API surface, embedded research coverage, a known reviewed rule, absence of the old UI namespace, and absence of tracker DOM/Laya nodes.

## Current validation boundary

The pure core currently proves:

- exact exhaustion immediately recycles discard;
- a multi-card draw preserves old/new deck segments;
- draw-bottom and judgement-top remain independent;
- a hidden draw with an omitted CardID inherits a proven top/bottom identity;
- every seat can store exact hand identities with provenance;
- unknown hands participate correctly in candidate probabilities;
- failed predicate search creates epoch-scoped negative evidence;
- a known-count hidden search moves unknown identities before deriving shortfall evidence and never leaks it across recycle;
- repeated failed-search feedback is idempotent and capacity-checked;
- unsupported aggregate predicates cannot create false negative evidence;
- current-turn discard membership resets on recycle;
- non-movement game events supply turn/round/phase context to later movements;
- full discard-entry history survives recycle within the game session;
- predicate-search probability retains the full hypergeometric tail;
- exact endpoint or rank-one facts produce exact attribute distributions;
- sparse ranks shift across top/bottom removals and exact insertions;
- physical tags follow CardID across zones;
- continuous zone residence distinguishes “never left” from “left and returned”, and physical-card events remain queryable by turn and tag;
- movement events expose source/destination, explicit semantic movement reason, raw move type, and reason tags, and can be intersected with current discard membership instead of treating history as a zone;
- generic identity-keyed state preserves ordered repeated names, sets, flags, and counters with explicit lifecycle expiry;
- multi-source candidate queries keep deck and discard evidence separate and never infer a deck-only miss from a union source;
- a known-card swap involving the final deck card settles atomically without a false recycle;
- resolved operation sequences commit atomically and unresolved ones roll back;
- zone-9 staging is separated from recycle, and deck-to-deck reposition is count-neutral;
- inconsistent physical allocation makes probability unavailable instead of fabricating a distribution.

Still requiring live or external evidence:

- runtime mode-to-rule field for every game mode;
- protocol semantics of explicit zone-9 shuffle sequences;
- 浑天仪 with exactly one matching card;
- automatic runtime binding for zero-result searches, sparse ranks, tags, judgement replacement variants, and skill operation IR;
- reconnect/bootstrap of an already active battle's current discard and process zones;
- server selection distributions for aggregate subsets and skill-specific random sampling;
- all skill-specific triggers and failure semantics not yet marked researched;
- dynamic validation in a battle that crosses a real deck recycle.
