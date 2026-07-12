# Skill Taxonomy Index (Non-Authoritative)

This document describes the retained text taxonomy and compatibility planner. It is not the physical game inference model and it does not prove that a skill is semantically understood or executable. See `game-inference-model.md` for the authoritative model and run `npm run skill-knowledge` for per-skill semantic coverage.

## Scope

This index combines the current SGS config set with the runtime protocol stream. It audits every skill for search and prioritization, but it must not be promoted into an exact card fact or a complete executable rule by itself.

Authoritative config path:

```text
RES.GetGroupByName("config")[0].url
-> Config_w.sgs
-> cha_spell.sgs
-> cha_spellextend.sgs
-> character.sgs
-> sys_playcard.sgs
```

Current audit scope:

- 3031 skills from the live `cha_spell.sgs` refreshed on 2026-07-11 (user-provided reference baseline: 3027).
- 568 extension rows from `cha_spellextend.sgs`.
- 1317 playable general rows from `character.sgs`.
- 2786 card rows from `sys_playcard.sgs`.
- 1996 skills are card-tracker relevant.
- 72 skills are supporting card-property constraints only.
- 963 skills do not create card facts.
- 1317 playable general rows are mapped to their owned skill slots in `general-skill-current.json`.
- 1 playable-general placeholder skill reference is missing from `cha_spell.sgs`; it is reported in `missing-general-skill-refs-current.json` and does not create card facts.

The repeatable config-table source is `src\runtime\sources\config-table-core.cjs`. The repeatable rule-definition source is `src\runtime\tracker\skill-rule-core.cjs`. The Node audit tool and the injected runtime both use these modules for table expansion, real-general ownership, category matching, priority/confidence, strategy assignment, review reasons, and old `spellId` branch mapping. The injected runtime also uses the config-table core for card/spell dictionary construction and legacy card type normalization.

Coverage rule: every row in `cha_spell.sgs` must have exactly one strategy. A character skill slot whose id has no `cha_spell.sgs` row is tracked separately under `missingGeneralSkillRefs` instead of being treated as a skill with inferred behavior.

## Fact Rule

A card can be rendered as known only when one of these sources supplies the identity:

- self hand UI or self hand fallback.
- authorized hand visibility.
- visible mask/card UI from a watch or reveal window.
- protocol/log data that lists the card id.
- authorized protocol hand snapshot responses that list exact card ids.
- public runtime zones such as equipment, judge, or general-card piles.

Skill text can classify how to interpret an event. It cannot create a card id.

## Execution Layers

1. Normalize protocol messages through `src\runtime\sources\protocol-normalizer-core.cjs`, keeping `turn`, `round`, and `phase` context.
2. Apply `PubGsCMoveCard` to the migrated `Card/Zone` state machine with that context mirrored into the old `GameState`.
3. Attach `skillRuleInfo(skillId)` to card, skill, and option protocol events.
4. Feed protocol-listed exact card ids into `tracker.protocolZoneLedger` so their latest protocol zone and source are visible in snapshots.
5. Feed protocol records into `tracker.rulePlanner` to produce compact action plans.
6. Update public zones from protocol and `snapshot.publicZones` runtime public fields.
7. Update the known-hand ledger from visible or authorized snapshots, including authorized protocol hand snapshots.
8. Apply skill-rule corrections for deck endpoint, deck order, virtual cards, judgement, pindian, recast, resolved-card gains, and random gains.
9. Render only exact facts with a source rule. Unknown cards remain counts or constraints.

## Rule Planner

The runtime exposes `tracker.rulePlanner.summary()` in every snapshot. It is the bridge between audited skill categories and concrete tracker behavior.

The planner records:

- `categories`: skill-rule categories attached to the protocol event.
- `actions`: tracker actions derived from categories and zone movement.
- `knownCardIds`: exact card ids listed by protocol.
- `orderSourceSensitive`: whether the skill belongs to an ordering/source-sensitive queue.
- `manualReview`: legacy compatibility alias for `orderSourceSensitive`.
- `legacyHint`: current meaning of old special `spellId` branches.

The planner is intentionally non-authoritative for card identity. It can say that a random gain must be recorded only if protocol lists ids; it cannot decide which random card was gained from text alone.

`tracker.protocolZoneLedger.snapshot()` is the diagnostic execution path for protocol-listed identity. It records only positive card ids that appear in `PubGsCMoveCard`, stores their latest protocol zone, and marks the source as `protocol-listed-card-id`. Unknown move counts are retained as counters only. Its `deckEndpoint` section records top/bottom order only when an endpoint skill category and protocol-listed card ids are both present. Normal `draw.count` consumes the known top endpoint in protocol order; if listed draw ids contradict the known top order, the endpoint order is cleared. Shuffle, random insertion, and unknown deck movement also clear endpoint order.

For live rule confirmation, run:

```powershell
npm run protocol-flow-report
```

Use `npm run protocol-flow-report <snapshot.json>` or `SGS_PROTOCOL_FLOW_REPORT_FILE=<snapshot.json>` for a saved capture. The report is the repeatable entry point for connecting protocol records, parsed card movement, skill events, planner actions, and migrated old Card/Zone counters before changing a skill-specific rule.

## Rule Families

- `no-card-fact`: ignore skill text for card identity; protocol movement still updates counts.
- `constraint-only`: color, suit, number, and type restrictions narrow candidates only.
- `generic-protocol-movement`: protocol card movement and known-source invalidation are sufficient.
- `public-zone-sync`: sync public equipment, judge, discard, or general-card zones.
- `visible-identity-tracking`: identity must come from visible UI, authorized visibility, public fields, or protocol ids.
- `deck-endpoint-tracking`: keep top/bottom order only while observable and stable.
- `protocol-listed-identity`: random/search skills require protocol-listed ids for exact identity.
- `order-or-source-sensitive`: verify live behavior before adding a stronger automatic rule.
- `hand.watch`: a temporary authorized hand snapshot. Persist only seen exact cards, and invalidate when later unknown hand movement may have removed them.
- `hand.show`: public reveal. Record exact card ids if the UI or protocol exposes them.
- `resolved.card.gain`: the skill says "获得之", "获得此牌", or equivalent. Follow the already-known resolved card from process, discard, judgement, or public zone when protocol confirms the move.
- `random.card.gain`: the skill randomly gains card-like objects. Record exact ids only when protocol lists them; otherwise keep count or card-property constraints.
- `hand.transfer` / `hand.discard`: move exact ids only when backed by prior known hand-source evidence or protocol-listed card ids; otherwise update counts and invalidate stale hidden-hand facts.
- `deck.search`: a selected or matching card comes from the deck. Remove exact ids only when protocol lists them; use card catalog constraints only as candidates.
- `deck.top.reveal` / `deck.bottom.reveal`: record deck endpoint order only when the visible order is observable.
- `deck.top.put` / `deck.bottom.put`: write back endpoint order only for known source cards and known order.
- `deck.shuffle` and `deck.random.put`: clear exact deck order that is no longer stable.
- `draw.count`: consume known deck top cards in protocol order; clear endpoint order on contradiction, otherwise move unknown counts.
- `judgement.any`: judgement consumes deck top.
- `judgement.replace`: replace the judgement card from an observable source.
- `judgement.gain`: move the resolved judgement card when the gaining player is known.
- `public.equip`, `public.judge`, `public.general`: sync public card zones from runtime fields and movement protocol.
- `virtual.transform`: split the virtual card name from the physical source ids.
- `pindian`: both pindian cards are public facts.
- `recast`: discard the recast card, then draw through the normal draw rule.
- `constraint.property`: color, suit, number, and type restrictions narrow candidates only.

## Old Special Skill Mapping

The old `Zone.remove` branch idea is preserved, but the current source of truth is `src\runtime\tracker\legacy-special-skill-core.cjs`. Keep special behavior as objects with `spellId`, `currentSpellId`, `operate`, `order`, optional `zoneRemove`, and optional candidate constraints; do not reintroduce separate hard-coded ID lists. When a skill has a planner-level meaning and a different old `Zone.remove` pile-extraction branch, keep the pile behavior in `zoneRemove.order`.

- `0xc88` / `3208` = `骋烈`: deck-top reveal plus secret hand/top-card exchange into public general-card piles.
- `0x1b63` / `7011` = `权变`: choose from the top X cards, gain one matching card, and return the remainder to deck top in chosen order.
- `0x3db` / `987` = `观虚`: authorized hand watch plus exchange with the top five cards; old `Zone.remove` also uses `zoneRemove.order=reverse-pile-extraction`.
- `0x3dc` / `988` = `雅士`: delegates the `观虚` effect. If protocol reports only `988`, treat it as an alias of the `987` rule; old `Zone.remove` also uses `zoneRemove.order=reverse-pile-extraction`.
- `0xda0` / `3488` = `佐练`: random reveal from hands, then exchange with fire/thunder/ice Slash from deck or discard.
- `0x35e` / `862` = `兴乱`: legacy point-6 candidate filter for unknown deck or discard removal; other exact sources still need protocol ids, visible UI, authorized visibility, or public runtime fields.
- `0x2b60` is not present in the current skill catalog. Do not give it a current rule unless a live config maps it again.

## Order/Source Skill Mapping

Order/source-sensitive current skills are generated through `src\runtime\tracker\order-source-rule-core.cjs`. The module maps category-level operations such as deck top reveal, deck bottom put, bottom draw, shuffle invalidation, hand source movement, public-zone sync, and candidate constraints into objects with `spellId`, `operate`, `order`, `operations`, `requiredSources`, `evidenceChecks`, `mappingComplete`, and `unmappedCategories`. `skill-rule-worklist`, `skill-rule-matrix`, and `recording-report.manualOrderSourceReview` consume this object table instead of repeating a separate list of skill ids.

## Generated Rule Files

Run:

```powershell
npm run audit:skills
npm run skill-rule-worklist
```

Use these generated files as the repeatable rule source:

- `reports\skill-audit\skill-catalog-current.json`: all 3031 current skills with owner and strategy metadata.
- `reports\skill-audit\skill-rule-audit-current.json`: all skill categories, strategies, review reasons, and legacy special mappings.
- `reports\skill-audit\skill-rule-audit-current.tsv`: table review form for all skills.
- `reports\skill-audit\general-skill-current.json`: playable general rows with their skill slots and strategies.
- `reports\skill-audit\missing-general-skill-refs-current.json`: missing playable-general skill slots with review status and tracker decision.
- `reports\skill-audit\skill-rule-playbook-current.md`: current compact playbook.
- `reports\skill-audit\rule-review-current.md`: full-scope review entry with manual skills, owners, descriptions, category actions, and legacy special branch mapping.
- `reports\skill-audit\skill-rule-worklist-current.json`: strategy queues, exact-identity queues, category queues, legacy special queue, missing skill refs, and next actions for tracker implementation.
- `missingGeneralSkillRefs` in the generated audit files: character skill slots whose ids do not exist in `cha_spell.sgs`.

The audit and worklist also expose generated skill-text candidate rules, so
candidate filtering can be reviewed by source rule, applies-to direction, and
field (`name`, `type`, `color`, `suit`, `number`). The current generated audit
contains 158 skill-text candidate skills and 176 candidate rules, including
direct moved-card constraints, explicit hand insertion, judgement-result,
discard-pile, used-card, and branch-property pronoun gains where the constrained
card is the gained card, cross-field alternative pools such as named card or
card type, letter-rank constraints, direct different-suit each-one gains,
single-card point ranges such as `点数小于等于8`, and remainder complements where a named property is removed
before the remaining cards are gained. Point-sum text such as `点数和` remains
excluded because it does not identify a single moved card.
When a candidate rule has multiple positive constraints for the same field, the
probability pass treats those values as alternatives. For example, `type=trick`
plus `type=equip` means the possible pool is trick-or-equip. When the text has a
cross-field `or`, such as named card or trick card, the rule stores
`alternatives`; each alternative set is matched independently and their union is
the possible pool. Constraints inside one alternative set still combine, so
`red Slash` remains red-and-Slash. Negated constraints such as `non-heart`,
`non-black`, `non-equip`, or `not Slash` remove those cards from the possible
pool before the same 75% probability check is applied.

`npm run skill-rule-worklist` writes `reports\skill-audit\skill-rule-worklist-current.json`.
Use `SGS_SKILL_WORKLIST_OUT=<json>` only when testing the generator with a
temporary output file. The command prints a compact stdout summary by default;
set `SGS_SKILL_WORKLIST_STDOUT=full` only when the full JSON should also be
printed to the terminal.

## Rule Decision Order

1. Trust protocol movement for zone transitions.
2. Attach skill categories to explain source/order semantics.
3. Accept exact identity only from protocol ids, visible UI, authorized visibility, or public runtime fields.
4. Use card-property text only as constraints unless a valid identity source appears.
5. Preserve deck endpoint order only while the endpoint is known and stable.
6. Clear endpoint order on shuffle, random deck insertion, or unknown deck movement.
7. Keep old special `spellId` branches as mapped hints and validate them through current config.
8. Use `skill-rule-worklist-current.json` as the implementation order; do not maintain a parallel manual skill list.

## Order/Source Sensitive Queues

`skill-rule-worklist-current.json` is the current queue source for rule work. It is generated from the full audit instead of maintained by hand. The generated `orderSourceRules` table currently has 20 objects: the 19 `manual-order-or-source` compatibility-queue skills plus `816` (`寸目`) for `draw.bottom`. The top strategy queues are:

- `manual-order-or-source`: 19 skills.
- `visible-identity`: 178 skills.
- `deck-endpoint`: 89 skills.
- `protocol-listed`: 88 skills.
- `public-zone`: 325 skills.
- `generic-movement`: 1297 skills.
- `constraint-only`: 72 skills.
- `no-card-fact`: 963 skills.

These category queues need behavior checks in live `TableGameScene`, because they can affect ordering or authorized visibility:

- `hand.watch`: 41 skills.
- `hand.show`: 138 skills.
- `hand.transfer`: 598 skills.
- `hand.discard`: 613 skills.
- `deck.bottom.reveal`: 6 skills.
- `deck.bottom.put`: 13 skills.
- `deck.shuffle`: 2 skills.
- `draw.bottom`: 1 skill.
- `judgement.replace`: 10 skills.
- `judgement.gain`: 10 skills.
- `resolved.card.gain`: 64 skills.
- `random.card.gain`: 28 skills.
- `deck.search`: 74 skills.
- `public.equip`: 254 skills.
- `public.judge`: 43 skills.
- `virtual.transform`: 354 skills.
- `public.general`: 83 skills.
- `pindian`: 47 skills.

The complete current list is generated by:

```powershell
cd E:\ds-sgs\src\card-tracker
npm run audit:skills
npm run skill-rule-worklist
```

Use `reports\skill-audit\skill-rule-audit-current.json` for full per-skill rules, `reports\skill-audit\skill-rule-audit-current.tsv` for table review, and `reports\skill-audit\skill-rule-worklist-current.json` for implementation order. The worklist's `ruleMatrix` object is the repeatable migration table for old `Card/Zone` behavior, current category actions, accepted identity sources, deck top/bottom state, and legacy special `spellId` branches. The same path is summarized in `docs\card-tracker-skill-migration.md`.

After a live battle recording, run `npm run recording-report` and use
`manualOrderSourceReview` for the `manual-order-or-source` queue. It reports
queue size, observed skills, `ready-for-manual-review`,
`observed-missing-evidence`, and `not-observed` rows, plus the source checks
that made each status. This is the repeatable path for confirming source/order
behavior before changing a skill into a stronger automatic rule.

After one or more recordings, run `npm run order-source-coverage` to aggregate
the same queue across `recordings\recording-*`. The generated
`reports\skill-audit\order-source-coverage-current.json` is the repeatable
coverage gate for the 20 generated order/source rule objects. The 19
`manual-order-or-source` skills are the live-evidence compatibility queue;
`draw.bottom` is included in the same object table as a deterministic bottom
draw source rule.
