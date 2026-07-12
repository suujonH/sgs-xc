const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildSkillRuleWorklist } = require("../src/node/analysis/skill-rule-worklist.cjs");

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
    console.error(error.stack || error);
  }
}

function skill(id, name, strategy, categories, extra = {}) {
  return {
    id,
    name,
    sourceType: extra.sourceType || "general-skill",
    owners: extra.owners || [{ name: "sample general" }],
    ownerCount: Number(extra.ownerCount ?? 1),
    categories: categories.map((item) => ({ id: item })),
    actions: categories.map((item) => `action:${item}`),
    priority: extra.priority || (strategy === "no-card-fact" ? "none" : "tracker-relevant"),
    confidence: extra.confidence || "generic-log-rule",
    strategy: strategy ? { id: strategy } : null,
    candidateRules: extra.candidateRules || [],
    reviewReasons: extra.reviewReasons || [],
    desc: extra.desc || `${name} desc`
  };
}

function sampleAudit() {
  return {
    ok: true,
    source: "sample",
    generatedAt: "2026-07-04T00:00:00.000Z",
    counts: { totalSkills: 2, trackerRelevant: 1, supporting: 0, none: 1 },
    missingGeneralSkillRefs: [],
    legacySpecial: [],
    skills: [
      skill(35, "Guanxing", "order-or-source-sensitive", ["deck.bottom.put"], { confidence: "manual-order-or-source-required" }),
      skill(1, "Sha", "no-card-fact", [])
    ]
  };
}

console.log("\nSkill rule worklist");

test("builds strategy and category queues from skill audit", () => {
  const report = buildSkillRuleWorklist({
    ok: true,
    source: "sample",
    generatedAt: "2026-07-04T00:00:00.000Z",
    counts: { totalSkills: 8, trackerRelevant: 7, supporting: 0, none: 1 },
    missingGeneralSkillRefs: [{ generalId: 1, generalName: "Missing Owner", className: "MissingOwner", slot: "spellId1", skillId: 999 }],
    legacySpecial: [{ spellId: 987, oldHex: "0x3db", currentRule: "watch-hand-top-five-exchange", sourceZones: [1, 2], categories: ["hand.watch"], strategy: "visible-identity-tracking" }],
    skills: [
      skill(35, "Guanxing", "order-or-source-sensitive", ["deck.bottom.put"], { confidence: "manual-order-or-source-required" }),
      skill(304, "Gongxin", "deck-endpoint-tracking", ["hand.watch", "hand.show", "hand.discard", "deck.top.put"]),
      skill(310, "Guixin", "protocol-listed-identity", ["random.card.gain"], {
        confidence: "log-and-skill-specific",
        candidateRules: [{
          display: "红色",
          sourceRule: "skill-text-candidate-filter",
          appliesTo: "to-caster",
          constraints: [{ field: "color", values: ["red"], label: "红色" }]
        }]
      }),
      skill(75, "Weapon", "public-zone-sync", ["public.equip"], { confidence: "runtime-public-field" }),
      skill(76, "Delayed Trick", "public-zone-sync", ["public.judge"], { confidence: "runtime-public-field" }),
      skill(77, "Buqu", "public-zone-sync", ["public.general"], { confidence: "runtime-public-field" }),
      skill(51, "Tiandu", "generic-protocol-movement", ["judgement.gain", "resolved.card.gain"]),
      skill(1, "Sha", "no-card-fact", [])
    ]
  }, { sampleLimit: 2 });

  assert.equal(report.ok, true);
  assert.equal(report.counts.totalSkills, 8);
  assert.equal(report.counts.manualOrderOrSource, 1);
  assert.equal(report.counts.orderSourceRules, 1);
  assert.equal(report.counts.deckEndpoint, 1);
  assert.equal(report.counts.protocolListed, 1);
  assert.equal(report.counts.publicZone, 3);
  assert.equal(report.counts.skillTextCandidateRuleSkills, 1);
  assert.equal(report.counts.skillTextCandidateRules, 1);
  assert.equal(report.candidateRules.fields.color, 1);
  assert.equal(report.candidateRules.appliesTo["to-caster"], 1);
  assert.equal(report.counts.missingGeneralSkillRefs, 1);
  assert.equal(report.counts.missingGeneralSkillRefUnresolved, 1);
  assert.equal(report.counts.missingGeneralSkillRefPlaceholderCandidates, 0);
  assert.equal(report.strategyQueues.find((queue) => queue.id === "manual-order-or-source").samples[0].id, 35);
  assert.equal(report.orderSourceRules.count, 1);
  assert.equal(report.orderSourceRules.rules[0].spellId, 35);
  assert.equal(report.orderSourceRules.rules[0].primaryOrder, "bottom-put-source-order");
  assert.equal(report.orderSourceRules.rules[0].operations[0].operate, "deck-endpoint");
  assert.deepEqual(report.strategyQueues.find((queue) => queue.id === "protocol-listed").samples[0].candidateRuleFields, ["color"]);
  assert.equal(report.categoryQueues.find((queue) => queue.id === "hand.watch").count, 1);
  assert.equal(report.categoryQueues.find((queue) => queue.id === "hand.discard").count, 1);
  assert.equal(report.categoryQueues.find((queue) => queue.id === "resolved.card.gain").count, 1);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "random.card.gain"), true);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "hand.discard"), true);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "resolved.card.gain"), true);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "public.equip"), true);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "public.judge"), true);
  assert.equal(report.exactIdentityQueues.some((queue) => queue.id === "public.general"), true);
  assert.deepEqual(report.boundary.forbiddenSources, ["hidden opponent handCards"]);
  assert.deepEqual(report.legacySpecial[0].sourceZones, [1, 2]);
  assert.equal(report.nextActions.some((action) => action.id === "validate-manual-order-source"), true);
  assert.equal(report.nextActions.find((action) => action.id === "verify-known-hand-movement-sources").count, 2);
  assert.equal(report.nextActions.some((action) => action.id === "review-missing-general-skill-refs"), true);
  assert.equal(report.problems.some((problem) => problem.id === "missing-general-skill-refs" && problem.severity === "warn"), true);
  assert.equal(report.missingGeneralSkillRefReport.rows[0].reviewStatus, "needs-config-confirmation");
  assert.equal(report.missingGeneralSkillRefReport.rows[0].trackerDecision, "no-card-fact-without-cha-spell");
  assert.equal(report.ruleMatrix.counts.totalSkills, 8);
  assert.equal(report.ruleMatrix.counts.orderSourceSensitive, 1);
  assert.equal(report.ruleMatrix.categoryMatrix.find((row) => row.id === "deck.bottom.put").count, 1);
});

test("reports missing strategy as an error", () => {
  const report = buildSkillRuleWorklist({
    counts: { totalSkills: 1 },
    skills: [skill(1, "Broken", "", ["hand.watch"])]
  });
  assert.equal(report.ok, false);
  assert.equal(report.problems.some((problem) => problem.id === "skills-missing-strategy"), true);
});

test("reports incomplete order/source operation mapping as an error", () => {
  const report = buildSkillRuleWorklist({
    counts: { totalSkills: 1 },
    skills: [
      skill(999, "Future", "order-or-source-sensitive", ["future.category"], {
        confidence: "manual-order-or-source-required"
      })
    ]
  });

  assert.equal(report.ok, false);
  assert.equal(report.counts.orderSourceRuleMappingIncomplete, 1);
  assert.equal(report.problems.some((problem) => problem.id === "order-source-rule-mapping-incomplete"), true);
  assert.deepEqual(report.orderSourceRules.rules[0].unmappedCategories, ["future.category"]);
});

test("reports missing audit as an error", () => {
  const report = buildSkillRuleWorklist({});
  assert.equal(report.ok, false);
  assert.equal(report.problems[0].id, "skill-audit-missing");
});

test("cli writes the current worklist file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sgs-skill-worklist-"));
  const auditPath = path.join(root, "audit.json");
  const outPath = path.join(root, "worklist.json");
  fs.writeFileSync(auditPath, JSON.stringify(sampleAudit()), "utf8");

  const result = spawnSync(process.execPath, ["src/node/tools/skill-rule-worklist.mjs", auditPath, "1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, SGS_SKILL_WORKLIST_OUT: outPath },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(outPath), true);
  const report = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.outPath, path.resolve(outPath));
  assert.equal(report.counts.totalSkills, 2);

  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.outPath, path.resolve(outPath));
  assert.equal(stdout.stdout.mode, "summary");
  assert.equal(stdout.stdout.fullStdoutEnv, "SGS_SKILL_WORKLIST_STDOUT=full");
  assert.equal(stdout.strategyQueues.some((queue) => Object.hasOwn(queue, "samples")), false);
  assert.equal(stdout.ruleMatrix.counts.orderSourceSensitive, 1);
});

test("cli can print the full worklist when requested", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sgs-skill-worklist-full-"));
  const auditPath = path.join(root, "audit.json");
  const outPath = path.join(root, "worklist.json");
  fs.writeFileSync(auditPath, JSON.stringify(sampleAudit()), "utf8");

  const result = spawnSync(process.execPath, ["src/node/tools/skill-rule-worklist.mjs", auditPath, "1"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, SGS_SKILL_WORKLIST_OUT: outPath, SGS_SKILL_WORKLIST_STDOUT: "full" },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.strategyQueues.find((queue) => queue.id === "manual-order-or-source").samples[0].id, 35);
});

if (failed) {
  console.error(`\nSkill rule worklist 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nSkill rule worklist 测试: ${passed} 通过, ${failed} 失败`);
