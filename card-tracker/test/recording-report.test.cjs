const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

async function writeJsonl(filePath, rows) {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function fakeMoveRecord() {
  return {
    index: 7,
    time: 1000,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      skillId: 77,
      skillRule: {
        id: 77,
        name: "sample gain",
        confidence: "sample",
        categories: ["random.card.gain", "hand.transfer"]
      },
      count: 2,
      cards: [{ id: 11, name: "sha", suit: "spade", rank: "A" }],
      from: { code: 1, zone: "pile", seat: 255 },
      to: { code: 5, zone: "hand", seat: 1 }
    }
  };
}

function fakeSkillRecord() {
  return {
    index: 8,
    time: 1100,
    name: "PubGsCUseSpell",
    parsed: {
      type: "skill:use",
      protocol: "PubGsCUseSpell",
      skillId: 88,
      skillRule: {
        id: 88,
        name: "sample watch",
        confidence: "sample",
        categories: [{ id: "hand.watch" }]
      }
    }
  };
}

function fakeHandShowSkillRecord() {
  return {
    index: 9,
    time: 1200,
    name: "PubGsCUseSpell",
    parsed: {
      type: "skill:use",
      protocol: "PubGsCUseSpell",
      skillId: 99,
      skillRule: {
        id: 99,
        name: "sample show",
        confidence: "sample",
        categories: [{ id: "hand.show" }]
      }
    }
  };
}

function fakeHandShowMoveRecord() {
  return {
    index: 10,
    time: 1300,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      skillId: 99,
      skillRule: {
        id: 99,
        name: "sample show",
        confidence: "sample",
        categories: ["hand.show"]
      },
      count: 1,
      cards: [{ id: 44, name: "tao", suit: "heart", rank: "Q" }],
      from: { code: 5, zone: "hand", seat: 1 },
      to: { code: 3, zone: "process", seat: 255 }
    }
  };
}

function fakeDeckSearchUnknownMoveRecord() {
  return {
    index: 11,
    time: 1400,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      skillId: 100,
      skillRule: {
        id: 100,
        name: "sample search",
        confidence: "sample",
        categories: ["deck.search"]
      },
      count: 1,
      cards: [],
      from: { code: 1, zone: "pile", seat: 255 },
      to: { code: 5, zone: "hand", seat: 1 }
    }
  };
}

function fakeProtocolListedCategoryMoveRecord(category, skillId, ids) {
  return {
    index: skillId,
    time: 1450,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      skillId,
      skillRule: {
        id: skillId,
        name: `sample ${category}`,
        confidence: "sample",
        categories: [category]
      },
      count: ids.length || 1,
      cards: ids.map((id) => ({ id, name: `card-${id}`, suit: "spade", rank: "A" })),
      from: { code: 3, zone: "process", seat: 255 },
      to: { code: 2, zone: "discard", seat: 255 }
    }
  };
}

function fakeProtocolListedCategorySkillRecord(category, skillId) {
  return {
    index: skillId,
    time: 1460,
    name: "PubGsCUseSpell",
    parsed: {
      type: "skill:use",
      protocol: "PubGsCUseSpell",
      skillId,
      skillRule: {
        id: skillId,
        name: `sample ${category}`,
        confidence: "sample",
        categories: [category]
      }
    }
  };
}

function fakePublicZoneSkillRecord(category, skillId, name) {
  return {
    index: skillId,
    time: 1500,
    name: "PubGsCUseSpell",
    parsed: {
      type: "skill:use",
      protocol: "PubGsCUseSpell",
      skillId,
      skillRule: {
        id: skillId,
        name,
        confidence: "sample",
        categories: [{ id: category }]
      }
    }
  };
}

function fakePublicEquipSkillRecord() {
  return fakePublicZoneSkillRecord("public.equip", 101, "sample public equip");
}

function fakePublicJudgeSkillRecord() {
  return fakePublicZoneSkillRecord("public.judge", 102, "sample public judge");
}

function fakePublicGeneralSkillRecord() {
  return fakePublicZoneSkillRecord("public.general", 103, "sample public general");
}

function fakeKnownHandSourceReport() {
  return {
    visible: true,
    counts: {
      ledgerKnownCards: 1,
      rawVisibleCards: 1
    },
    sources: {
      ledgerRules: { "known-hand-ledger": 1 },
      ledgerUnderlyingRules: { "mask-visible-card-ui": 1 },
      rawRules: { "mask-visible-card-ui": 1 },
      legacySources: { mask: 1 }
    },
    mask: {
      rawCount: 1,
      ledgerCount: 1,
      rawProblems: [],
      ledgerProblems: [],
      examples: [{
        seatIndex: 1,
        id: 71,
        text: "sample known hand",
        rule: "mask-visible-card-ui",
        displayRule: "mask-visible-card-ui",
        legacySource: "mask"
      }]
    },
    protocolAuthorized: {
      ledgerCount: 0,
      ledgerProblems: [],
      examples: []
    }
  };
}

async function createRecordingDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-report-"));
  const runDir = path.join(root, "recording-sample");
  await fs.mkdir(runDir, { recursive: true });
  const summary = {
    ok: true,
    runDir,
    startedAt: "2026-07-04T10:00:00.000Z",
    finishedAt: "2026-07-04T10:00:01.000Z",
    elapsedMs: 1000,
    durationMs: 1000,
    intervalMs: 100,
    snapshotEveryMs: 500,
    installFirst: true,
    installTarget: { id: "target-1", title: "SGS", url: "https://web.sanguosha.com" },
    ticks: 2,
    protocolRecords: 2,
    snapshots: 1,
    reports: 1,
    firstVisibleAt: "2026-07-04T10:00:00.500Z",
    lastVisible: true
  };
  const plan = {
    recordIndex: 7,
    time: 1000,
    protocol: "PubGsCMoveCard",
    eventType: "card:move",
    skillId: 77,
    skillName: "sample gain",
    categories: ["random.card.gain"],
    actions: ["remove-deck-card-only-if-protocol-lists-id"],
    knownCardIds: [11],
    cardCount: 2,
    manualReview: true,
    legacyHint: "sample"
  };
  const manualPlan = {
    recordIndex: 12,
    time: 1250,
    protocol: "PubGsCMoveCard",
    eventType: "card:move",
    skillId: 35,
    skillName: "sample order",
    categories: ["deck.top.reveal", "deck.top.put"],
    actions: ["record-deck-top-order-if-observable", "put-known-source-on-deck-top"],
    knownCardIds: [31, 32],
    cardCount: 2,
    manualReview: true,
    legacyHint: ""
  };

  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeJsonl(path.join(runDir, "meta.session.jsonl"), [
    { type: "start", ts: summary.startedAt, durationMs: 1000, intervalMs: 100, snapshotEveryMs: 500, installFirst: true, installTarget: summary.installTarget },
    { type: "stop", ts: summary.finishedAt, elapsedMs: 1000, protocolRecords: 2, snapshots: 1, reports: 1 }
  ]);
  await writeJsonl(path.join(runDir, "protocol.records.jsonl"), [
    { type: "protocol.record", tick: 1, ts: "2026-07-04T10:00:00.100Z", record: fakeMoveRecord() },
    { type: "protocol.record", tick: 2, ts: "2026-07-04T10:00:00.200Z", record: fakeSkillRecord() }
  ]);
  await writeJsonl(path.join(runDir, "protocol.console.records.jsonl"), [
    {
      type: "protocol.console.record",
      tick: 1,
      ts: "2026-07-04T10:00:00.150Z",
      record: {
        index: 1,
        time: 1050,
        name: "PubGsCUseSpell",
        source: "console",
        parsed: {
          type: "skill:use",
          protocol: "PubGsCUseSpell",
          skillId: 88,
          skillRule: {
            id: 88,
            name: "sample watch",
            categories: ["hand.watch"]
          }
        }
      }
    },
    {
      type: "protocol.console.record",
      tick: 2,
      ts: "2026-07-04T10:00:00.250Z",
      record: {
        index: 2,
        time: 1150,
        name: "ConsoleOnlyProtocol",
        source: "console",
        parsed: {
          type: "protocol"
        }
      }
    }
  ]);
  await writeJsonl(path.join(runDir, "snapshots.jsonl"), [
    {
      type: "snapshot",
      tick: 2,
      ts: "2026-07-04T10:00:00.500Z",
      value: {
        ok: true,
        snapshot: {
          visible: true,
          protocol: {
            recentSkillEvents: [{
              time: 1100,
              protocol: "PubGsCUseSpell",
              type: "skill:use",
              skillId: 88,
              skillRule: { name: "sample watch", categories: ["hand.watch"] }
            }]
          },
          protocolZoneLedger: {
            version: 1,
            moveCount: 1,
            knownMoveCount: 1,
            unknownMoveCount: 1,
            cardCount: 1,
            knownLocationCount: 1,
            zoneCount: 1,
            byZone: { hand: 1 },
            sources: { "protocol-listed-card-id": 1 },
            deckEndpoint: {
              version: 1,
              top: [31, 32],
              bottom: [],
              knownTopCount: 2,
              knownBottomCount: 0,
              invalidationCount: 0,
              lastReason: "deck.top.reveal",
              recentEvents: [{ type: "set", endpoint: "top", ids: [31, 32] }]
            },
            recentEvents: [{
              type: "card-move",
              recordIndex: 7,
              knownCardIds: [11],
              unknownCount: 1
            }]
          },
          knownHandLedger: {
            version: 1,
            rowCount: 1,
            knownCount: 1,
            dirtyRows: [1],
            completeRows: [],
            lastUpdateAt: 1200,
            recentEvents: [
              {
                type: "add-protocol-known",
                time: 1201,
                seatIndex: 1,
                added: 1,
                protocol: "PubGsCMoveCard",
                recordIndex: 7,
                msgId: 9,
                skillId: 77,
                skillName: "sample gain",
                categories: ["random.card.gain", "hand.transfer"],
                sourceRule: "protocol-hand-move"
              },
              {
                type: "remove-known",
                time: 1202,
                seatIndex: 1,
                ids: [11],
                removed: 1,
                reason: "protocol-hand-from-known",
                protocol: "PubGsCMoveCard",
                recordIndex: 7,
                msgId: 9,
                skillId: 77,
                skillName: "sample gain",
                categories: ["random.card.gain", "hand.transfer"]
              },
              {
                type: "invalidate-seat",
                time: 1203,
                seatIndex: 1,
                reason: "protocol-hand-from-unknown",
                clearKnown: true,
                protocol: "PubGsCMoveCard",
                recordIndex: 7,
                msgId: 9,
                skillId: 77,
                skillName: "sample gain",
                categories: ["random.card.gain", "hand.transfer"]
              }
            ]
          },
          rulePlanner: { recentPlans: [plan, manualPlan] }
        }
      }
    }
  ]);
  await writeJsonl(path.join(runDir, "reports.jsonl"), [
    {
      type: "reports",
      tick: 2,
      ts: "2026-07-04T10:00:00.500Z",
      validation: {
        ok: false,
        status: "failed",
        checks: [
          { id: "protocol.installed", status: "pass", message: "ok" },
          { id: "planner.events", status: "fail", message: "missing planner" }
        ]
      },
      reports: {
        handSourceReport: {
          visible: true,
          counts: {
            ledgerRows: 1,
            visibleRows: 1,
            ledgerKnownCards: 2,
            rawVisibleCards: 1
          },
          sources: {
            ledgerRules: { "known-hand-ledger": 2 },
            ledgerUnderlyingRules: {
              "mask-visible-card-ui": 1,
              "protocol-authorized-friend-hand": 1
            },
            rawRules: { "mask-visible-card-ui": 1 },
            legacySources: { mask: 2, protocol: 1 }
          },
          mask: {
            rawCount: 1,
            rawWithProvenance: 1,
            rawProblems: [],
            ledgerCount: 1,
            ledgerWithHistory: 1,
            ledgerProblems: [],
            examples: [{
              seatIndex: 1,
              id: 11,
              text: "sha",
              rule: "mask-visible-card-ui",
              displayRule: "mask-visible-card-ui",
              legacySource: "mask",
              origin: "laya-card-ui",
              groupName: "WatchHandWindow",
              nodePath: "Stage/TableGameScene/WatchHandWindow#3/CardUI#0"
            }]
          },
          protocolAuthorized: {
            ledgerCount: 1,
            ledgerWithHistory: 0,
            ledgerProblems: [{
              seatIndex: 2,
              id: 12,
              text: "shan",
              rule: "known-hand-ledger",
              firstRule: "protocol-authorized-friend-hand",
              lastRule: "protocol-authorized-friend-hand",
              legacySource: "protocol",
              missing: ["msgId"]
            }],
            examples: [{
              seatIndex: 2,
              id: 12,
              text: "shan",
              rule: "known-hand-ledger",
              displayRule: "protocol-authorized-friend-hand",
              legacySource: "protocol",
              origin: "protocol",
              protocol: "ClientHappyGetFriendHandcardRep",
              msgId: null
            }]
          }
        },
        publicZoneReport: { counts: { cards: 2 } },
        legacyComparisonReport: { counts: { handMismatches: 1, zoneMismatches: 0 } },
        protocolFlowReport: {
          counts: { records: 2, cardMoves: 1, problems: 1 },
          protocolZoneLedger: {
            version: 1,
            moveCount: 1,
            knownMoveCount: 1,
            unknownMoveCount: 1,
            cardCount: 1,
            knownLocationCount: 1,
            zoneCount: 1,
            byZone: { hand: 1 },
            sources: { "protocol-listed-card-id": 1 },
            deckEndpoint: {
              version: 1,
              top: [31, 32],
              bottom: [],
              knownTopCount: 2,
              knownBottomCount: 0,
              invalidationCount: 0,
              lastReason: "deck.top.reveal",
              recentEvents: [{ type: "set", endpoint: "top", ids: [31, 32] }]
            },
            recentEvents: [{
              type: "card-move",
              recordIndex: 7,
              knownCardIds: [11],
              unknownCount: 1
            }]
          },
          planner: { recentPlans: [plan, manualPlan] },
          problems: [{
            severity: "warn",
            id: "sample-flow-problem",
            message: "sample problem",
            actual: { cardMoves: 1 }
          }]
        }
      }
    }
  ]);
  const skillAuditPath = path.join(runDir, "skill-rule-audit-current.json");
  await fs.writeFile(skillAuditPath, JSON.stringify({
    ok: true,
    source: "sample",
    generatedAt: "2026-07-04T10:00:00.000Z",
    counts: { totalSkills: 3 },
    skills: [
      {
        id: 35,
        name: "sample order",
        sourceType: "general-skill",
        owners: [{ name: "order general", className: "OrderGeneral" }],
        ownerCount: 1,
        categories: [{ id: "deck.top.reveal" }, { id: "deck.top.put" }],
        actions: ["record-deck-top-order-if-observable", "put-known-source-on-deck-top"],
        strategy: { id: "order-or-source-sensitive" },
        confidence: "manual-order-or-source-required",
        priority: "tracker-relevant",
        reviewReasons: ["manual-order-or-source-required", "category:deck.top.reveal", "category:deck.top.put"],
        legacySpecialRule: "",
        desc: "sample order desc"
      },
      {
        id: 77,
        name: "sample gain",
        sourceType: "general-skill",
        owners: [{ name: "sample general", className: "SampleGeneral" }],
        ownerCount: 1,
        categories: [{ id: "random.card.gain" }],
        actions: ["remove-deck-card-only-if-protocol-lists-id"],
        strategy: { id: "protocol-listed-identity" },
        confidence: "specific-log-rule",
        priority: "tracker-relevant",
        reviewReasons: ["category:random.card.gain"],
        legacySpecialRule: ""
      },
      {
        id: 88,
        name: "sample watch",
        sourceType: "general-skill",
        owners: [{ name: "watch general", className: "WatchGeneral" }],
        ownerCount: 1,
        categories: [{ id: "hand.watch" }],
        actions: ["recordAuthorizedHandSnapshot"],
        strategy: { id: "visible-identity-tracking" },
        confidence: "generic-log-rule",
        priority: "tracker-relevant",
        reviewReasons: ["category:hand.watch"],
        legacySpecialRule: ""
      }
    ]
  }, null, 2), "utf8");
  return { root, runDir, skillAuditPath };
}

async function main() {
  const command = await import("../src/node/commands/recording-report.mjs");
  const analysis = require("../src/node/analysis/recording-report.cjs");

  console.log("\nRecording report");

  await test("summarizes new JSONL recording files", async () => {
    const { runDir, skillAuditPath } = await createRecordingDir();
    const report = await command.buildRecordingReportForDir(runDir, { skillAuditPath });

    assert.equal(report.ok, true);
    assert.equal(report.recordingDir, path.resolve(runDir));
    assert.equal(report.counts.protocolRecords, 2);
    assert.equal(report.counts.consoleProtocolRecords, 2);
    assert.equal(report.counts.uniqueConsoleProtocols, 2);
    assert.equal(report.counts.consoleOnlyProtocols, 1);
    assert.equal(report.counts.cardMoves, 1);
    assert.equal(report.counts.cardMovesWithKnownIds, 1);
    assert.equal(report.counts.cardMovesWithUnknownCount, 1);
    assert.equal(report.counts.skillEvents, 2);
    assert.equal(report.counts.rulePlans, 2);
    assert.equal(report.counts.manualReviewPlans, 2);
    assert.equal(report.counts.manualOrderSourceQueuedSkills, 1);
    assert.equal(report.counts.manualOrderSourceObservedSkills, 1);
    assert.equal(report.counts.manualOrderSourceReadyForReview, 1);
    assert.equal(report.counts.manualOrderSourceMissingEvidence, 0);
    assert.equal(report.counts.observedSkills, 3);
    assert.equal(report.counts.skillAuditMatches, 3);
    assert.equal(report.counts.handSourceReportRows, 1);
    assert.equal(report.counts.maskRawMax, 1);
    assert.equal(report.counts.maskLedgerMax, 1);
    assert.equal(report.counts.protocolAuthorizedLedgerMax, 1);
    assert.equal(report.counts.handSourceProblemRows, 1);
    assert.equal(report.counts.knownHandLedgerEvents, 3);
    assert.equal(report.counts.knownHandLedgerRemoveKnownEvents, 1);
    assert.equal(report.counts.knownHandLedgerInvalidateSeatEvents, 1);
    assert.equal(report.counts.knownHandLedgerAddProtocolKnownEvents, 1);
    assert.equal(report.counts.handWatchSkillEvents, 1);
    assert.equal(report.counts.handWatchSourceEvidenceRows, 1);
    assert.equal(report.counts.knownHandMovementObservations, 1);
    assert.equal(report.counts.knownHandMovementSourceEvidenceRows, 2);
    assert.equal(report.counts.protocolListedRandomSearchObservations, 2);
    assert.equal(report.counts.protocolListedRandomSearchProtocolIdRows, 2);
    assert.equal(report.counts.publicZoneReportRows, 1);
    assert.equal(report.counts.publicZoneCardMax, 2);
    assert.equal(report.counts.protocolZoneLedgerRows, 2);
    assert.equal(report.counts.protocolZoneMoveMax, 1);
    assert.equal(report.counts.protocolZoneKnownLocationMax, 1);
    assert.equal(report.counts.protocolZoneDeckTopMax, 2);
    assert.equal(report.counts.protocolZoneDeckBottomMax, 0);
    assert.equal(report.counts.protocolZoneDeckInvalidationMax, 0);
    assert.equal(report.counts.validationFailures, 1);
    assert.equal(report.protocols.byName.PubGsCMoveCard, 1);
    assert.equal(report.protocols.console.byName.PubGsCUseSpell, 1);
    assert.deepEqual(report.protocols.console.onlyInConsole, ["ConsoleOnlyProtocol"]);
    assert.equal(report.protocols.byEventType["card:move"], 1);
    assert.equal(report.protocols.bySkillId["77"], 1);
    assert.equal(report.protocols.byCategory["random.card.gain"], 1);
    assert.equal(report.cardMoves.byTo["5:hand:seat1"], 1);
    assert.equal(report.skills.planActions["remove-deck-card-only-if-protocol-lists-id"], 1);
    assert.equal(report.skills.planActions["record-deck-top-order-if-observable"], 1);
    assert.deepEqual(report.skills.catalog.map((row) => row.name), ["sample order", "sample gain", "sample watch"]);
    assert.deepEqual(report.skills.catalog[1].owners, ["sample general"]);
    assert.equal(report.skills.catalog[1].strategy, "protocol-listed-identity");
    assert.equal(report.skills.audit.totalSkills, 3);
    assert.equal(report.handSources.sourceOccurrences.legacySources.mask, 2);
    assert.equal(report.handSources.sourceMax.legacySources.protocol, 1);
    assert.equal(report.handSources.mask.rawMax, 1);
    assert.equal(report.handSources.mask.examples[0].legacySource, "mask");
    assert.equal(report.handSources.protocolAuthorized.problemCount, 1);
    assert.equal(report.handSources.protocolAuthorized.problems[0].missing[0], "msgId");
    assert.equal(report.knownHandLedgerEvents.eventCount, 3);
    assert.equal(report.knownHandLedgerEvents.byType["remove-known"], 1);
    assert.equal(report.knownHandLedgerEvents.bySkillId["77"], 3);
    assert.equal(report.knownHandLedgerEvents.byCategory["hand.transfer"], 3);
    assert.equal(report.knownHandLedgerEvents.byProtocol.PubGsCMoveCard, 3);
    assert.equal(report.knownHandLedgerEvents.timeline[1].recordIndex, 7);
    assert.deepEqual(report.knownHandLedgerEvents.timeline[1].ids, [11]);
    assert.equal(report.manualOrderSourceReview.queueCount, 1);
    assert.equal(report.manualOrderSourceReview.ruleCount, 1);
    assert.equal(report.manualOrderSourceReview.operateCounts["deck-endpoint"], 2);
    assert.equal(report.manualOrderSourceReview.orderCounts["top-reveal-order"], 1);
    assert.equal(report.manualOrderSourceReview.rules[0].spellId, 35);
    assert.equal(report.manualOrderSourceReview.observedSkills[0].id, 35);
    assert.equal(report.manualOrderSourceReview.observedSkills[0].orderSourceRule.spellId, 35);
    assert.equal(report.manualOrderSourceReview.observedSkills[0].orderSourceRule.operate, "deck-endpoint");
    assert.equal(report.manualOrderSourceReview.observedSkills[0].orderSourceRule.order, "compound");
    assert.equal(report.manualOrderSourceReview.observedSkills[0].status, "ready-for-manual-review");
    assert.equal(report.manualOrderSourceReview.observedSkills[0].evidenceChecks[0].key, "deckEndpoint");
    assert.equal(report.manualOrderSourceReview.byStatus["ready-for-manual-review"], 1);
    assert.equal(report.sourceChecks.handWatch.eventCount, 1);
    assert.equal(report.sourceChecks.handWatch.hasAllowedEvidence, true);
    assert.equal(report.sourceChecks.handWatch.bySkillId["88"], 1);
    assert.equal(report.sourceChecks.knownHandMovement.observedCount, 1);
    assert.equal(report.sourceChecks.knownHandMovement.hasKnownHandMovementEvidence, true);
    assert.equal(report.sourceChecks.knownHandMovement.handSourceEvidenceRows, 1);
    assert.equal(report.sourceChecks.knownHandMovement.protocolCardIdRows, 1);
    assert.equal(report.sourceChecks.protocolListedRandomSearch.observedCount, 2);
    assert.equal(report.sourceChecks.protocolListedRandomSearch.hasProtocolCardIds, true);
    assert.equal(report.sourceChecks.protocolListedRandomSearch.protocolCardIdRows, 2);
    assert.equal(report.publicZones.reportRows, 1);
    assert.equal(report.publicZones.cardMax, 2);
    assert.deepEqual(report.protocolZoneLedger.byZoneMax, { hand: 1 });
    assert.equal(report.protocolZoneLedger.sourceMax["protocol-listed-card-id"], 1);
    assert.equal(report.protocolZoneLedger.latest.knownLocationCount, 1);
    assert.deepEqual(report.protocolZoneLedger.latest.deckEndpoint.top, [31, 32]);
    assert.equal(report.validation.failures[0].id, "planner.events");
    assert.equal(report.reports.latestProtocolFlowCounts.cardMoves, 1);
    assert.equal(report.problems.some((problem) => problem.id === "validation-failures"), true);
    assert.equal(report.problems.some((problem) => problem.id === "hand-source-protocol-authorized-problems"), true);
    assert.equal(report.problems.some((problem) => problem.id === "console-protocols-not-in-proxy-records"), true);
    assert.equal(report.problems.some((problem) => problem.id === "hand-watch-without-source-evidence"), false);
    assert.equal(report.problems.some((problem) => problem.id === "known-hand-movement-without-source-evidence"), false);
    assert.equal(report.problems.some((problem) => problem.id === "protocol-listed-random-search-without-card-id"), false);
  });

  await test("finds the newest recording directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-latest-"));
    const first = path.join(root, "recording-2026-07-04T10-00-00");
    const second = path.join(root, "recording-2026-07-04T10-01-00");
    await fs.mkdir(first);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.mkdir(second);
    assert.equal(await command.latestRecordingDir(root), second);
  });

  await test("reports missing recording directory as not ok", async () => {
    const report = await command.buildRecordingReportForDir(path.join(os.tmpdir(), "sgs-recording-missing-dir"));
    assert.equal(report.ok, false);
    assert.equal(report.problems[0].id, "recording-directory-read-failed");
  });

  await test("records observed protocols outside the migrated normalizer list", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: { name: "NewSampleProtocol", parsed: { type: "sample" } } }]
    });
    assert.deepEqual(report.protocols.missingFromNormalizer, ["NewSampleProtocol"]);
    assert.equal(report.problems.some((problem) => problem.id === "observed-protocol-missing-normalizer"), true);
  });

  await test("warns when hand watch skill events lack allowed source evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeSkillRecord() }],
      reportRows: [{
        reports: {
          handSourceReport: {
            visible: true,
            counts: {
              ledgerKnownCards: 0,
              rawVisibleCards: 0
            },
            sources: {
              ledgerRules: {},
              ledgerUnderlyingRules: {},
              rawRules: {},
              legacySources: {}
            },
            mask: {
              rawCount: 0,
              ledgerCount: 0,
              rawProblems: [],
              ledgerProblems: [],
              examples: []
            },
            protocolAuthorized: {
              ledgerCount: 0,
              ledgerProblems: [],
              examples: []
            }
          }
        }
      }]
    });

    assert.equal(report.sourceChecks.handWatch.eventCount, 1);
    assert.equal(report.sourceChecks.handWatch.hasAllowedEvidence, false);
    assert.equal(report.counts.handWatchSkillEvents, 1);
    assert.equal(report.counts.handWatchSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "hand-watch-without-source-evidence"), true);
  });

  await test("accepts hand show source evidence from protocol-listed ids", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeHandShowMoveRecord() }]
    });

    assert.equal(report.sourceChecks.handShow.eventCount, 1);
    assert.equal(report.sourceChecks.handShow.hasAllowedEvidence, true);
    assert.equal(report.sourceChecks.handShow.evidence.protocolCardIdRows, 1);
    assert.equal(report.counts.handShowSkillEvents, 1);
    assert.equal(report.counts.handShowSourceEvidenceRows, 1);
    assert.equal(report.problems.some((problem) => problem.id === "hand-show-without-source-evidence"), false);
  });

  await test("warns when hand show events lack visible or protocol evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeHandShowSkillRecord() }]
    });

    assert.equal(report.sourceChecks.handShow.eventCount, 1);
    assert.equal(report.sourceChecks.handShow.hasAllowedEvidence, false);
    assert.equal(report.counts.handShowSkillEvents, 1);
    assert.equal(report.counts.handShowSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "hand-show-without-source-evidence"), true);
  });

  await test("accepts known hand movement evidence from protocol-listed ids", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategoryMoveRecord("hand.transfer", 109, [71]) }]
    });

    assert.equal(report.sourceChecks.knownHandMovement.observedCount, 1);
    assert.equal(report.sourceChecks.knownHandMovement.hasKnownHandMovementEvidence, true);
    assert.equal(report.sourceChecks.knownHandMovement.protocolCardIdRows, 1);
    assert.equal(report.sourceChecks.knownHandMovement.handSourceEvidenceRows, 0);
    assert.equal(report.counts.knownHandMovementObservations, 1);
    assert.equal(report.counts.knownHandMovementSourceEvidenceRows, 1);
    assert.equal(report.problems.some((problem) => problem.id === "known-hand-movement-without-source-evidence"), false);
  });

  await test("accepts known hand movement evidence from hand-source reports", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategorySkillRecord("hand.discard", 110) }],
      reportRows: [{ reports: { handSourceReport: fakeKnownHandSourceReport() } }]
    });

    assert.equal(report.sourceChecks.knownHandMovement.observedCount, 1);
    assert.equal(report.sourceChecks.knownHandMovement.hasKnownHandMovementEvidence, true);
    assert.equal(report.sourceChecks.knownHandMovement.handSourceEvidenceRows, 1);
    assert.equal(report.sourceChecks.knownHandMovement.protocolCardIdRows, 0);
    assert.equal(report.counts.knownHandMovementObservations, 1);
    assert.equal(report.counts.knownHandMovementSourceEvidenceRows, 1);
    assert.equal(report.problems.some((problem) => problem.id === "known-hand-movement-without-source-evidence"), false);
  });

  await test("warns when known hand movement lacks known hand source evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategorySkillRecord("resolved.card.gain", 111) }]
    });

    assert.equal(report.sourceChecks.knownHandMovement.observedCount, 1);
    assert.equal(report.sourceChecks.knownHandMovement.hasKnownHandMovementEvidence, false);
    assert.equal(report.sourceChecks.knownHandMovement.byCategory["resolved.card.gain"], 1);
    assert.equal(report.counts.knownHandMovementObservations, 1);
    assert.equal(report.counts.knownHandMovementSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "known-hand-movement-without-source-evidence"), true);
  });

  await test("warns when random or search observations lack protocol-listed ids", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeDeckSearchUnknownMoveRecord() }]
    });

    assert.equal(report.sourceChecks.protocolListedRandomSearch.observedCount, 1);
    assert.equal(report.sourceChecks.protocolListedRandomSearch.hasProtocolCardIds, false);
    assert.equal(report.counts.protocolListedRandomSearchObservations, 1);
    assert.equal(report.counts.protocolListedRandomSearchProtocolIdRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "protocol-listed-random-search-without-card-id"), true);
  });

  await test("accepts judgement virtual or pindian evidence from protocol-listed ids", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategoryMoveRecord("pindian", 104, [61, 62]) }]
    });

    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.observedCount, 1);
    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.hasProtocolCardIds, true);
    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.protocolCardIdRows, 1);
    assert.equal(report.counts.protocolListedJudgementVirtualPindianObservations, 1);
    assert.equal(report.counts.protocolListedJudgementVirtualPindianProtocolIdRows, 1);
    assert.equal(report.problems.some((problem) => problem.id === "protocol-listed-judgement-virtual-pindian-without-card-id"), false);
  });

  await test("warns when judgement virtual or pindian observations lack protocol-listed ids", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [
        { record: fakeProtocolListedCategorySkillRecord("judgement.gain", 105) },
        { record: fakeProtocolListedCategorySkillRecord("virtual.transform", 106) }
      ]
    });

    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.observedCount, 2);
    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.hasProtocolCardIds, false);
    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.byCategory["judgement.gain"], 1);
    assert.equal(report.sourceChecks.protocolListedJudgementVirtualPindian.byCategory["virtual.transform"], 1);
    assert.equal(report.counts.protocolListedJudgementVirtualPindianObservations, 2);
    assert.equal(report.counts.protocolListedJudgementVirtualPindianProtocolIdRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "protocol-listed-judgement-virtual-pindian-without-card-id"), true);
  });

  await test("accepts deck endpoint evidence from protocol zone ledger", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategorySkillRecord("deck.top.reveal", 107) }],
      reportRows: [{
        reports: {
          protocolFlowReport: {
            protocolZoneLedger: {
              version: 1,
              moveCount: 1,
              deckEndpoint: {
                version: 1,
                top: [31, 32],
                bottom: [],
                knownTopCount: 2,
                knownBottomCount: 0,
                invalidationCount: 0,
                lastReason: "deck.top.reveal",
                recentEvents: [{ type: "set", endpoint: "top", reason: "deck.top.reveal", ids: [31, 32] }]
              }
            }
          }
        }
      }]
    });

    assert.equal(report.sourceChecks.deckEndpoint.observedCount, 1);
    assert.equal(report.sourceChecks.deckEndpoint.hasDeckEndpointEvidence, true);
    assert.equal(report.sourceChecks.deckEndpoint.endpointEvidenceRows, 1);
    assert.equal(report.sourceChecks.deckEndpoint.sourceEvidenceRows, 1);
    assert.equal(report.counts.deckEndpointObservations, 1);
    assert.equal(report.counts.deckEndpointSourceEvidenceRows, 1);
    assert.equal(report.protocolZoneLedger.deckTopMax, 2);
    assert.equal(report.protocolZoneLedger.endpointKnownEventMax, 1);
    assert.equal(report.protocolZoneLedger.reasonMax["deck.top.reveal"], 1);
    assert.equal(report.problems.some((problem) => problem.id === "deck-endpoint-without-source-evidence"), false);
  });

  await test("warns when deck endpoint observations lack endpoint evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakeProtocolListedCategorySkillRecord("deck.bottom.reveal", 108) }]
    });

    assert.equal(report.sourceChecks.deckEndpoint.observedCount, 1);
    assert.equal(report.sourceChecks.deckEndpoint.hasDeckEndpointEvidence, false);
    assert.equal(report.sourceChecks.deckEndpoint.endpointEvidenceRows, 0);
    assert.equal(report.counts.deckEndpointObservations, 1);
    assert.equal(report.counts.deckEndpointSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "deck-endpoint-without-source-evidence"), true);
  });

  await test("marks observed manual order/source skills as missing evidence until sources appear", () => {
    const report = analysis.buildRecordingReport({
      snapshotRows: [{
        snapshot: {
          visible: true,
          rulePlanner: {
            recentPlans: [{
              recordIndex: 35,
              time: 1600,
              protocol: "PubGsCMoveCard",
              eventType: "card:move",
              skillId: 35,
              skillName: "sample order",
              categories: ["deck.top.reveal"],
              actions: ["record-deck-top-order-if-observable"],
              knownCardIds: [],
              manualReview: true
            }]
          }
        }
      }],
      skillAudit: {
        skills: [{
          id: 35,
          name: "sample order",
          categories: [{ id: "deck.top.reveal" }],
          actions: ["record-deck-top-order-if-observable"],
          strategy: { id: "order-or-source-sensitive" },
          confidence: "manual-order-or-source-required",
          owners: [{ name: "order general" }]
        }]
      }
    });

    assert.equal(report.manualOrderSourceReview.queueCount, 1);
    assert.equal(report.manualOrderSourceReview.observedCount, 1);
    assert.equal(report.manualOrderSourceReview.missingEvidenceCount, 1);
    assert.equal(report.manualOrderSourceReview.observedSkills[0].status, "observed-missing-evidence");
    assert.equal(report.manualOrderSourceReview.observedSkills[0].evidenceChecks[0].hasEvidence, false);
  });

  await test("accepts public equip and judge evidence from public-zone report", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [
        { record: fakePublicEquipSkillRecord() },
        { record: fakePublicJudgeSkillRecord() }
      ],
      reportRows: [{
        reports: {
          publicZoneReport: {
            visible: true,
            counts: {
              cards: 2,
              known: 2,
              byZone: { equip: 1, judge: 1 },
              byRule: { "public-equip-runtime": 1, "public-judge-runtime": 1 }
            },
            provenance: {
              problems: [],
              examples: [
                { seatIndex: 1, zoneName: "equip", id: 55, text: "sample equip", rule: "public-equip-runtime" },
                { seatIndex: 1, zoneName: "judge", id: 56, text: "sample judge", rule: "public-judge-runtime" }
              ]
            }
          }
        }
      }]
    });

    assert.equal(report.sourceChecks.publicEquip.eventCount, 1);
    assert.equal(report.sourceChecks.publicEquip.hasPublicZoneEvidence, true);
    assert.equal(report.sourceChecks.publicEquip.sourceEvidenceRows, 1);
    assert.equal(report.sourceChecks.publicJudge.eventCount, 1);
    assert.equal(report.sourceChecks.publicJudge.hasPublicZoneEvidence, true);
    assert.equal(report.sourceChecks.publicJudge.sourceEvidenceRows, 1);
    assert.equal(report.counts.publicEquipSkillEvents, 1);
    assert.equal(report.counts.publicEquipSourceEvidenceRows, 1);
    assert.equal(report.counts.publicJudgeSkillEvents, 1);
    assert.equal(report.counts.publicJudgeSourceEvidenceRows, 1);
    assert.equal(report.publicZones.byZoneMax.equip, 1);
    assert.equal(report.publicZones.byZoneMax.judge, 1);
    assert.equal(report.publicZones.byRuleMax["public-equip-runtime"], 1);
    assert.equal(report.publicZones.byRuleMax["public-judge-runtime"], 1);
    assert.equal(report.problems.some((problem) => problem.id === "public-equip-without-public-zone-evidence"), false);
    assert.equal(report.problems.some((problem) => problem.id === "public-judge-without-public-zone-evidence"), false);
  });

  await test("warns when public equip and judge events lack public-zone evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [
        { record: fakePublicEquipSkillRecord() },
        { record: fakePublicJudgeSkillRecord() }
      ]
    });

    assert.equal(report.sourceChecks.publicEquip.eventCount, 1);
    assert.equal(report.sourceChecks.publicEquip.hasPublicZoneEvidence, false);
    assert.equal(report.sourceChecks.publicJudge.eventCount, 1);
    assert.equal(report.sourceChecks.publicJudge.hasPublicZoneEvidence, false);
    assert.equal(report.counts.publicEquipSkillEvents, 1);
    assert.equal(report.counts.publicEquipSourceEvidenceRows, 0);
    assert.equal(report.counts.publicJudgeSkillEvents, 1);
    assert.equal(report.counts.publicJudgeSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "public-equip-without-public-zone-evidence"), true);
    assert.equal(report.problems.some((problem) => problem.id === "public-judge-without-public-zone-evidence"), true);
  });

  await test("accepts public general evidence from public-zone report", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakePublicGeneralSkillRecord() }],
      reportRows: [{
        reports: {
          publicZoneReport: {
            visible: true,
            counts: {
              cards: 1,
              known: 1,
              byZone: { general: 1 },
              byRule: { "public-general-runtime": 1 }
            },
            provenance: {
              problems: [],
              examples: [{
                seatIndex: 1,
                zoneName: "general",
                id: 55,
                text: "sample",
                rule: "public-general-runtime"
              }]
            }
          }
        }
      }]
    });

    assert.equal(report.sourceChecks.publicGeneral.eventCount, 1);
    assert.equal(report.sourceChecks.publicGeneral.hasPublicGeneralEvidence, true);
    assert.equal(report.sourceChecks.publicGeneral.sourceEvidenceRows, 1);
    assert.equal(report.counts.publicGeneralSkillEvents, 1);
    assert.equal(report.counts.publicGeneralSourceEvidenceRows, 1);
    assert.equal(report.publicZones.byZoneMax.general, 1);
    assert.equal(report.publicZones.byRuleMax["public-general-runtime"], 1);
    assert.equal(report.problems.some((problem) => problem.id === "public-general-without-public-zone-evidence"), false);
  });

  await test("warns when public general events lack public-zone evidence", () => {
    const report = analysis.buildRecordingReport({
      recordingDir: "memory",
      files: {
        meta: { exists: true },
        protocolRecords: { exists: true },
        snapshots: { exists: true },
        reports: { exists: true },
        summary: { exists: true }
      },
      protocolRows: [{ record: fakePublicGeneralSkillRecord() }]
    });

    assert.equal(report.sourceChecks.publicGeneral.eventCount, 1);
    assert.equal(report.sourceChecks.publicGeneral.hasPublicGeneralEvidence, false);
    assert.equal(report.counts.publicGeneralSkillEvents, 1);
    assert.equal(report.counts.publicGeneralSourceEvidenceRows, 0);
    assert.equal(report.problems.some((problem) => problem.id === "public-general-without-public-zone-evidence"), true);
  });

  console.log(`\n========================================`);
  console.log(`  Recording report 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
