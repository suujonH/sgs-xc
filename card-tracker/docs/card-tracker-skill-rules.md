# Card Tracker Skill Rules

## Correct Source Path

Use the live SGS Chrome page as the config decoder:

```powershell
cd E:\ds-sgs\src\card-tracker
npm run chrome
npm run audit:skills
npm run skill-rule-worklist
```

`npm run audit:skills` refreshes the complete skill audit. `npm run
skill-rule-worklist` reads that audit and writes the current queue to:

```text
E:\ds-sgs\src\card-tracker\reports\skill-audit\skill-rule-worklist-current.json
```

Use `SGS_SKILL_WORKLIST_OUT=<json>` only for temporary generator tests.
The command writes the full worklist file and prints a compact stdout summary;
set `SGS_SKILL_WORKLIST_STDOUT=full` only when the full JSON should be printed
to the terminal.

The audit command reads:

```text
RES.GetGroupByName("config")[0].url
-> Config_w.sgs
-> cha_spell.sgs
-> cha_spellextend.sgs
-> character.sgs
-> sys_playcard.sgs
```

Outputs are written to:

```text
E:\ds-sgs\src\card-tracker\reports\skill-audit
```

After entering a battle, record and read back a live protocol timeline:

```powershell
npm run record
npm run recording-report
```

Use the recording report to confirm which skill ids, categories, card movements,
and rule-planner actions actually appeared in the battle before changing a
skill-specific rule.

For the 19 `manual-order-or-source` skills, read
`manualOrderSourceReview` after `npm run recording-report`. A
`ready-for-manual-review` status means the skill appeared and at least one
accepted source/order evidence path was preserved. An
`observed-missing-evidence` status means the skill appeared, but the recording
does not yet contain the source needed to confirm a stronger automatic rule.

For `hand.watch`, also read `sourceChecks.handWatch` in the recording report.
The accepted evidence is `mask-visible-card-ui` or
`protocol-authorized-friend-hand`; a `hand-watch-without-source-evidence`
warning means the skill event was observed but no accepted hand-card source was
preserved in the recording.

For `hand.show`, read `sourceChecks.handShow`. The accepted evidence is visible
card UI or a public reveal protocol with listed card ids; a
`hand-show-without-source-evidence` warning means the show category appeared
without an accepted identity source.

For known hand movement, read `sourceChecks.knownHandMovement`. `hand.transfer`,
`hand.discard`, and `resolved.card.gain` may preserve exact identity only when
the recording has matching protocol-listed card ids or prior known hand-source
evidence from `mask-visible-card-ui` or `protocol-authorized-friend-hand`. A
`known-hand-movement-without-source-evidence` warning means the category was
seen, but the recording did not preserve an accepted source for exact hand-card
identity.

For random/search exact identity, read
`sourceChecks.protocolListedRandomSearch`. `random.card.gain` and `deck.search`
are exact only when the matching protocol lists card ids; a
`protocol-listed-random-search-without-card-id` warning means the category was
seen but the required protocol card id evidence was not preserved.

For judgement, virtual-transform, and pindian exact identity, read
`sourceChecks.protocolListedJudgementVirtualPindian`. `judgement.replace`,
`judgement.gain`, `virtual.transform`, and `pindian` are exact only when the
matching protocol lists card ids; a
`protocol-listed-judgement-virtual-pindian-without-card-id` warning means the
category was seen but the required protocol card id evidence was not preserved.

For deck endpoint order facts, read `sourceChecks.deckEndpoint`.
`deck.top.reveal`, `deck.bottom.reveal`, `deck.top.put`, `deck.bottom.put`,
`draw.bottom`, and `judgement.any` are accepted only when the recording
preserves `protocolZoneLedger.deckEndpoint` evidence or matching
protocol-listed card ids. A `deck-endpoint-without-source-evidence` warning
means the category was seen without an accepted endpoint/order source.

For public-zone facts, read `sourceChecks.publicEquip`,
`sourceChecks.publicJudge`, and `sourceChecks.publicGeneral`. `public.equip`,
`public.judge`, and `public.general` are accepted only when
`public-zone-report` records the matching `public-equip-runtime`,
`public-judge-runtime`, or `public-general-runtime` evidence. A
`public-equip-without-public-zone-evidence`,
`public-judge-without-public-zone-evidence`, or
`public-general-without-public-zone-evidence` warning means the category was
seen without a matching public runtime field source.

Generated files:

- `skill-catalog-current.json`: all skill text, owners, strategy, and legacy-special marker.
- `skill-rule-audit-current.json`: full all-skill category and strategy audit.
- `skill-rule-audit-current.tsv`: table-friendly all-skill review.
- `general-skill-current.json`: playable general rows with each owned skill and tracker strategy.
- `missing-general-skill-refs-current.json`: playable-general skill slots whose ids are absent from `cha_spell.sgs`, split by review status.
- `skill-rule-playbook-current.md`: compact rule playbook for the current config.
- `skill-rule-worklist-current.json`: implementation and verification queues derived from the full audit.
- `summary.md`: compact count summary.

`skill-rule-audit-current.json` includes `candidateRuleCounts`, and each skill
row includes its generated skill-text `candidateRules`.
`skill-rule-worklist-current.json` includes a `candidateRules` summary with
source rules, fields, applies-to directions, and samples.

## Ownership Rules

- `cha_spell.sgs` is the skill text source.
- `cha_spellextend.sgs` is merged into the skill text by skill id.
- `character.sgs -> GameCharacters.character -> spellId1..spellIdN` is used only for real playable generals.
- A character row is treated as a real general only when it has the playable-general shape, such as `Class`, body fields, or `GeneralEnable`.
- Card display rows in `character.sgs`, including `Class` names ending with `Poker` and rows with `exType=55`, are not skill ownership evidence.
- `sys_playcard.sgs -> spellId` marks play-card and equipment skills.
- Skills that are neither owned by a real general nor attached to a play card are kept as `mode-or-system`.

## Tracker Principles

- Protocol card movement remains the primary state transition source.
- Skill text can classify how a movement should be interpreted, but it must not invent a card identity.
- Every concrete CardID actually supplied by the client runtime can be recorded, including opponent `handCards`; source provenance must distinguish self, authorized/public reveal, and raw server-exposed runtime state.
- A missing or placeholder opponent CardID remains an unknown count. The model does not manufacture hidden identities.
- Unknown hidden cards stay as counts until a later public or authorized source identifies them.

## Confirmed Rule Position

- All current `cha_spell.sgs` rows have one taxonomy strategy in `skill-rule-audit-current.json`; this proves catalog indexing only, not semantic or executable coverage.
- General ownership is metadata for review and display. It does not change the source boundary.
- `missing-general-skill-refs-current.json` records missing skill slots with `trackerDecision=no-card-fact-without-cha-spell`.
- The tracker does not need a hand-written rule for every skill. Most skills are handled by protocol movement plus the category strategy.
- Per-skill logic is reserved for source/order-sensitive effects: deck endpoints, bottom-deck behavior, shuffle/order invalidation, judgement replacement, virtual-card splitting, pindian, and old special branches.
- If protocol lists exact card ids, `protocolZoneLedger` can record their latest zone and possible deck endpoint.
- If protocol does not list exact ids and the UI is not visible/authorized, the tracker records only counts or constraints.
- Skill-text candidate rules can narrow guesses by `name`, `type`, `color`, `suit`, or `number`; exact identity still requires protocol ids, visible UI, authorized visibility, or public runtime fields. The current audit generates 158 skill-text candidate skills and 176 candidate rules. Runtime candidate sources are additive: legacy special `spellId` filters, explicit precomputed candidate rules, skill text, card-pool probability, and old packed-zone candidates can coexist on the same hidden hand gain and are deduped by their actual constraints.
- Candidate text covers direct gain, transfer, explicit hand insertion, draw effects, judgement-result pronouns such as "若结果为黑色，你获得此牌", discard-pile pronouns such as "梅花牌...置入弃牌堆后，你可以获得其中任意张牌", and remainder complements such as removing red-heart cards before gaining the remaining cards. These rules apply only when the gained or drawn card itself is constrained. Trigger conditions such as "获得你的黑色牌", accumulated history such as "累计获得了", and count-basis text such as "摸与其中红桃牌数量等量张牌" do not create candidates unless the same text also states that the remaining constrained complement is gained.
- Negated constraints such as non-equip, non-heart, non-black, or not a named card narrow the possible pool before probability guesses are calculated.
- Same-field "各一张" text is split into one-count candidate rules, such as one red card plus one black card, "颜色不同的牌各一张" as one red and one black candidate, direct "获得不同花色的牌各一张" as one candidate for each suit, each suit in "每种花色的牌各一张", or each core card type in "三种类型的牌各一张". Dynamic suit-comparison text such as "其中不同花色" or "与弃置牌花色不同" is not expanded into specific suits without runtime evidence.
- Single-card point ranges such as `点数小于等于8` expand to concrete number candidates. Point-sum text such as `点数和` remains excluded because it does not identify a single moved card.
- Old `Zone.remove` spell branches are retained as explicit object mappings, not as stale hardcoded names. Use `zoneRemove.order` for old pile-extraction behavior when it differs from the skill-level `order`.

Legacy special `spellId` candidate filters keep the old `Zone.remove` source scope: they apply only when the hidden source zone is deck or discard (`sourceZones=[1,2]`).

## Rule Categories

- `hand.watch`: record a hand snapshot only when the game gives authorized visibility, such as a watch/check hand effect.
- `hand.show`: record exact cards that are publicly shown or revealed.
- `resolved.card.gain`: follow a resolved or referenced card, such as "获得之" or "获得此牌", only when protocol or public state identifies the card.
- `random.card.gain`: record randomly gained card-like objects only when protocol lists exact ids.
- `hand.transfer`: move exact cards when the source card id is known; otherwise move only unknown counts.
- `hand.discard`: discard exact cards only when ids are known.
- `deck.top.reveal`: record deck-top order when the reveal order is observable.
- `deck.bottom.reveal`: record deck-bottom order only when the order is observable.
- `deck.top.put`: put known source cards on deck top when the destination order is known.
- `deck.bottom.put`: put known source cards on deck bottom when the destination order is known.
- `deck.random.put`: invalidate exact deck order for cards inserted without a stable endpoint.
- `deck.search`: remove exact cards from the deck only when protocol/log lists their ids.
- `deck.shuffle`: clear exact deck order while preserving public zones and known hand facts.
- `draw.bottom`: consume deck bottom instead of deck top for the affected draw.
- `draw.count`: consume known deck top cards in protocol order; if listed draw ids contradict the known top order, clear endpoint order.
- `judgement.any`: consume deck top as a judgement card.
- `judgement.replace`: replace the judgement card from the known source if observable.
- `judgement.gain`: move the resolved judgement card to the gaining player only when unique.
- `public.equip`: sync equipment zone from runtime public fields and movement protocol.
- `public.judge`: sync judge zone from runtime public fields and movement protocol.
- `public.general`: sync public cards placed on or beside general cards.
- `discard.zone`: maintain the exact public discard subset.
- `outside.remove`: move exact cards to the removed zone when ids are observable.
- `virtual.transform`: split the virtual card name from the physical source cards.
- `pindian`: both revealed pindian cards become exact facts.
- `recast`: discard the recast card and then draw according to the active draw source.
- `constraint.property`: use card catalog filtering only; this is not a direct card fact.

## Current Audit Counts

The live config audit refreshed on `2026-07-11` covers 3031 skills (the user-provided reference baseline was 3027):

- `trackerRelevant`: 1996
- `supporting`: 72
- `none`: 963
- `orderSourceSensitive`: 19
- `orderSourceRules`: 20
- `manualReview`: 19 (legacy compatibility alias)
- `skillTextCandidateRuleSkills`: 158
- `skillTextCandidateRules`: 176

Every skill is assigned one tracker strategy:

- `generic-protocol-movement`: 1297
- `no-card-fact`: 963
- `public-zone-sync`: 325
- `visible-identity-tracking`: 178
- `deck-endpoint-tracking`: 89
- `protocol-listed-identity`: 88
- `constraint-only`: 72
- `order-or-source-sensitive`: 19

Important current category counts:

- `draw.count`: 868
- `hand.transfer`: 598
- `hand.discard`: 613
- `virtual.transform`: 354
- `public.equip`: 254
- `hand.show`: 138
- `public.general`: 83
- `deck.search`: 74
- `resolved.card.gain`: 64
- `public.judge`: 43
- `hand.watch`: 41
- `random.card.gain`: 28

`general-skill-current.json` currently contains 1317 playable general rows; 1299 rows have at least one skill slot, and 1053 rows have at least one card-tracker relevant skill.

`skill-rule-worklist-current.json` currently has:

- 8 strategy queues.
- 18 high-risk category queues.
- 15 exact-identity queues.
- `manual-order-or-source`: 19.
- `visible-identity`: 178.
- `deck-endpoint`: 89.
- `verify-known-hand-movement-sources`: 1087 unique skills across `hand.transfer`, `hand.discard`, and `resolved.card.gain`.
- `protocol-listed`: 88.
- `public-zone`: 325.
- `generic-movement`: 1297.

Use the worklist as a research-priority source. Executable and semantic completion is tracked separately by `npm run skill-knowledge`.

## Strategy Rules

- `no-card-fact`: the skill may affect rules, damage, distance, limits, HP, marks, or skill ownership, but it does not create a card identity fact.
- `constraint-only`: color, suit, number, and type text narrows candidates only.
- `generic-protocol-movement`: normal protocol card movement is enough; hidden unknowns invalidate stale hand facts.
- `public-zone-sync`: sync public equipment, judge, discard, or general-card zones from protocol and runtime public fields.
- `visible-identity-tracking`: record identity only from visible UI, authorized visibility, public fields, or protocol ids.
- `deck-endpoint-tracking`: preserve deck top/bottom order only while the endpoint order is observable and stable.
- `protocol-listed-identity`: random/search effects use skill text as context only; exact identity needs protocol ids.
- `order-or-source-sensitive`: live `TableGameScene` verification is required because source, order, or endpoint matters.

## Implementation Order

1. Start from `skill-rule-worklist-current.json`.
2. Record live `TableGameScene` battles and use `recording-report.manualOrderSourceReview` plus `npm run order-source-coverage` to confirm the 20 generated order/source rule objects. The 19 `manual-order-or-source` skills still need live evidence before stronger automatic rules; `816` (`寸目`) is the deterministic `draw.bottom` object in the same table.
3. Implement and verify exact-identity queues first: `hand.watch`, `hand.show`, known hand movement (`hand.transfer`, `hand.discard`, `resolved.card.gain`), `deck.bottom.reveal`, judgement, random/search, public runtime zones, virtual transform, and pindian.
4. Apply protocol movement to the legacy `Card/Zone` state machine.
5. Record protocol-listed exact card ids in `snapshot.protocolZoneLedger` with source `protocol-listed-card-id`.
6. Overlay public runtime zones from `snapshot.publicZones`: equipment, judgement, and general-card zones.
7. Apply authorized hand reveal/watch snapshots.
8. Apply skill-category corrections for deck endpoint changes, virtual cards, judgement replacement, pindian, recast, and shuffle/order invalidation.
9. Render only facts with an explicit source rule.

## Runtime Index

The injected runtime also builds the same rule index in `window.__SgsScripts.sources.configState`:

- `skillRules`: full lookup by skill id.
- `skillRuleSummary`: compact counts for snapshot/debug output.
- `skillRuleInfo(skillId)`: compact per-skill lookup for protocol records.

Protocol records with `skillId` attach `parsed.skillRule`, and the protocol state keeps a compact `recentSkillEvents` queue. This is the runtime bridge from raw protocol skill ids to tracker rule categories.

`tracker.rulePlanner.summary()` is the runtime bridge from categories to tracker action plans. It records recent plans with `categories`, `actions`, `knownCardIds`, `orderSourceSensitive`, `manualReview`, `ruleQueue`, and `legacyHint`, while preserving the rule that exact card identity must come from protocol ids, visible UI, authorized visibility, or public runtime fields. `manualReview` is kept as a legacy compatibility alias; the actual meaning is order/source-sensitive protocol evidence.

The compatibility migration table is generated at `skill-rule-worklist-current.json.ruleMatrix` and summarized in `docs\card-tracker-skill-migration.md`. It is historical planning evidence; current physical behavior comes from `game-model-core.cjs` and per-skill semantics from the skill knowledge ledger.

`tracker.protocolZoneLedger.snapshot()` is the runtime bridge for protocol-listed exact card locations. It records only card ids listed by `PubGsCMoveCard`, keeps unknown movement as counts, and exposes zone/source summaries for `protocol-flow-report`. Its `deckEndpoint` section records top/bottom order only for endpoint categories with listed ids. Normal `draw.count` consumes the known top endpoint in protocol order; contradiction, shuffle, random insertion, or unknown deck movement clears endpoint order.

`npm run recording-report` aggregates `knownHandLedger.recentEvents` as
`knownHandLedgerEvents`, grouped by event type, seat, skill id, category,
protocol, and reason. This is the saved-report path for reviewing which skills
kept, added, removed, or invalidated known hand-card facts.

`npm run recording-timeline` expands `knownHandLedger.recentEvents` into readable `known-hand-ledger` rows with record, skill, and category context, so recorded battles show when exact hand facts were preserved, removed, added from protocol ids, or cleared because an unknown hidden hand movement made them stale.
