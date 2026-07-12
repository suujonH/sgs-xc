const assert = require("node:assert/strict");
const { buildPublicZoneReport } = require("../src/node/analysis/public-zone-report.cjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function publicSource(zoneName, overrides = {}) {
  return {
    rule: `public-${zoneName}-runtime`,
    legacySource: "public-zone",
    origin: "runtime-public-field",
    seatIndex: 0,
    zoneName,
    fieldName: `${zoneName}Cards`,
    cardIndex: 0,
    ...overrides
  };
}

function snapshotWithPublicZones(sourceOverrides = {}) {
  return {
    ok: true,
    snapshot: {
      visible: true,
      visibility: [{ seatIndex: 0 }],
      logs: [],
      publicZones: {
        seats: [{
          seatIndex: 0,
          names: ["刘备"],
          totalCount: 3,
          knownCount: 3,
          zones: {
            equip: {
              zoneName: "equip",
              count: 1,
              knownCount: 1,
              fields: ["equipCards"],
              cards: [{ id: 11, text: "杀♠7", source: publicSource("equip", sourceOverrides.equip) }]
            },
            judge: {
              zoneName: "judge",
              count: 1,
              knownCount: 1,
              fields: ["judgeCards"],
              cards: [{ id: 12, text: "闪♥2", source: publicSource("judge", sourceOverrides.judge) }]
            },
            general: {
              zoneName: "general",
              count: 1,
              knownCount: 1,
              fields: ["generalCards"],
              cards: [{ id: 13, text: "桃♦A", source: publicSource("general", sourceOverrides.general) }]
            }
          }
        }]
      },
      legacyCardTracker: {
        zoneProjection: {
          totals: { cards: 3 },
          seats: [{
            seatIndex: 0,
            zones: {
              equip: { zoneName: "equip", count: 1, knownCount: 1, unknownCount: 0 },
              judge: { zoneName: "judge", count: 1, knownCount: 1, unknownCount: 0 },
              mark: { zoneName: "mark", count: 1, knownCount: 1, unknownCount: 0 }
            }
          }]
        }
      }
    }
  };
}

console.log("\nPublic zone report");

test("summarizes public zone provenance and legacy projection comparison", () => {
  const report = buildPublicZoneReport(snapshotWithPublicZones(), {
    checks: [
      { id: "publicZones.present", status: "pass", message: "present" },
      { id: "publicZones.sources", status: "pass", message: "sources", actual: 3 }
    ]
  });
  assert.equal(report.ok, true);
  assert.equal(report.visible, true);
  assert.equal(report.counts.cards, 3);
  assert.equal(report.counts.byZone.equip, 1);
  assert.equal(report.counts.byRule["public-equip-runtime"], 1);
  assert.equal(report.provenance.sourcesCheck.status, "pass");
  assert.equal(report.provenance.problems.length, 0);
  assert.equal(report.legacyProjection.present, true);
  assert.equal(report.legacyProjection.byZone.mark, 1);
  assert.equal(report.comparisons.length, 3);
  assert.equal(report.comparisons.every((item) => item.status === "match"), true);
});

test("reports public zone source provenance problems and count mismatch", () => {
  const report = buildPublicZoneReport(snapshotWithPublicZones({
    equip: { fieldName: "" }
  }));
  assert.equal(report.provenance.problems.length, 1);
  assert.deepEqual(report.provenance.problems[0].missing, ["fieldName"]);

  report.seats[0].zones.equip.cards.push({
    id: 14,
    text: "酒♣9",
    rule: "public-equip-runtime",
    fieldName: "equipCards",
    cardIndex: 1
  });
  const mismatch = buildPublicZoneReport({
    ok: true,
    snapshot: {
      visible: true,
      publicZones: {
        seats: [{
          seatIndex: 0,
          zones: {
            equip: {
              count: 2,
              knownCount: 2,
              fields: ["equipCards"],
              cards: [
                { id: 11, text: "杀♠7", source: publicSource("equip") },
                { id: 14, text: "酒♣9", source: publicSource("equip", { cardIndex: 1 }) }
              ]
            }
          }
        }]
      },
      legacyCardTracker: {
        zoneProjection: {
          seats: [{
            seatIndex: 0,
            zones: {
              equip: { zoneName: "equip", count: 1, knownCount: 1, unknownCount: 0 }
            }
          }]
        }
      }
    }
  });
  assert.equal(mismatch.comparisons[0].status, "mismatch");
});

test("reports physical named piles while separating nonphysical outside state", () => {
  const namedSource = {
    rule: "public-named-general-runtime",
    legacySource: "public-zone",
    origin: "runtime-public-named-field",
    seatIndex: 0,
    zoneName: "general",
    fieldName: "skillOutSideCardDict",
    pileKey: "123",
    cardIndex: 0
  };
  const report = buildPublicZoneReport({
    snapshot: {
      visible: true,
      publicZones: {
        seats: [{
          seatIndex: 0,
          names: ["邓艾"],
          totalCount: 1,
          knownCount: 1,
          zones: {
            equip: { count: 0, cards: [] },
            judge: { count: 0, cards: [] },
            general: { count: 0, cards: [] }
          },
          namedZones: [{
            zoneName: "general",
            zoneKind: "removed",
            pileKey: "123",
            skillId: 123,
            zoneParam: 123,
            representationKind: "physical-card-zone",
            count: 1,
            knownCount: 1,
            complete: true,
            cards: [{ id: 13, text: "桃♦A", source: namedSource }]
          }, {
            zoneName: "general",
            zoneKind: "removed",
            pileKey: "922",
            skillId: 922,
            zoneParam: 922,
            representationKind: "nonphysical-state",
            count: 1,
            knownCount: 0,
            complete: false,
            cards: []
          }]
        }]
      },
      legacyCardTracker: {
        zoneProjection: {
          seats: [{
            seatIndex: 0,
            zones: { mark: { zoneName: "mark", count: 1, knownCount: 1, unknownCount: 0 } }
          }]
        }
      }
    }
  });

  assert.equal(report.counts.cards, 1);
  assert.equal(report.counts.known, 1);
  assert.equal(report.counts.namedEntries, 1);
  assert.equal(report.counts.nonphysicalOutsideEntries, 1);
  assert.equal(report.counts.byZone.general, 1);
  assert.equal(report.counts.byRule["public-named-general-runtime"], 1);
  assert.equal(report.provenance.problems.length, 0);
  assert.equal(report.seats[0].namedZones.length, 2);
  assert.equal(report.comparisons[0].status, "match");
});

test("reports missing snapshot object", () => {
  const report = buildPublicZoneReport(null);
  assert.equal(report.ok, false);
  assert.equal(report.error, "snapshot object is missing");
});

console.log(`\n========================================`);
console.log(`  Public zone report 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
