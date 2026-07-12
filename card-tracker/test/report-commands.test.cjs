const assert = require("node:assert/strict");

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

async function main() {
  const commands = await import("../src/node/commands/report-commands.mjs");

  console.log("\nReport commands");

  await test("resolves report file path from env before argv", () => {
    assert.equal(commands.reportFilePath("REPORT_FILE", ["node", "cli", "cmd", "argv.json"], { REPORT_FILE: "env.json" }), "env.json");
    assert.equal(commands.reportFilePath("REPORT_FILE", ["node", "cli", "cmd", "argv.json"], {}), "argv.json");
    assert.equal(commands.reportFilePath("REPORT_FILE", ["node", "cli", "cmd"], {}), "");
  });

  await test("reads snapshot from saved file when filePath is provided", async () => {
    const value = await commands.readSnapshotValue({
      filePath: "saved.json",
      readFileImpl: async (filePath, encoding) => {
        assert.equal(filePath.endsWith("saved.json"), true);
        assert.equal(encoding, "utf8");
        return JSON.stringify({ ok: true, snapshot: { visible: false } });
      },
      readRuntimeSnapshotImpl: async () => {
        throw new Error("runtime should not be read");
      }
    });
    assert.deepEqual(value, { ok: true, snapshot: { visible: false } });
  });

  await test("reads live runtime snapshot when no filePath is provided", async () => {
    const value = await commands.readSnapshotValue({
      readRuntimeSnapshotImpl: async () => ({ ok: true, snapshot: { visible: true } })
    });
    assert.deepEqual(value, { ok: true, snapshot: { visible: true } });
  });

  await test("builds report with validation result and resolved file path", async () => {
    const result = await commands.buildSnapshotReport({
      envName: "REPORT_FILE",
      argv: ["node", "cli", "cmd", "saved.json"],
      env: {},
      validationOptions: () => ({ requireVisible: true }),
      validateSnapshotValue: (value, options) => {
        assert.deepEqual(value, { ok: true, snapshot: { visible: false } });
        assert.deepEqual(options, { requireVisible: true });
        return { ok: true, checks: [{ id: "sample", status: "pass" }] };
      },
      buildReport: (value, validation) => ({
        ok: true,
        visible: value.snapshot.visible,
        checks: validation.checks
      }),
      readFileImpl: async () => JSON.stringify({ ok: true, snapshot: { visible: false } })
    });

    assert.deepEqual(result, {
      ok: true,
      filePath: "saved.json",
      report: {
        ok: true,
        visible: false,
        checks: [{ id: "sample", status: "pass" }]
      }
    });
  });

  console.log(`\n========================================`);
  console.log(`  Report commands 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
