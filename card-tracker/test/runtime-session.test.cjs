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
  const session = await import("../src/node/commands/runtime-session.mjs");

  console.log("\nRuntime session");

  await test("builds the install expression around the runtime bundle", () => {
    const expression = session.buildInstallRuntimeExpression("window.__SgsScripts = { manager: { update: () => 1 } };");
    assert.match(expression, /window\.__SgsScripts =/);
    assert.match(expression, /manager\.update\(\)/);
  });

  await test("installs the runtime through CDP with long timeouts", async () => {
    const calls = [];
    const result = await session.installRuntime({
      runtimePath: "runtime.js",
      readFileImpl: async (filePath, encoding) => {
        calls.push({ kind: "read", filePath, encoding });
        return "window.__SgsScripts = { manager: { update: () => ({ ok: true }) } };";
      },
      evaluateOnSgsImpl: async (expression, options) => {
        calls.push({ kind: "evaluate", expression, options });
        return {
          target: { id: "target-1", title: "SGS", url: "https://web.sanguosha.com/220/h5_2/index_210000.php" },
          value: { ok: true }
        };
      }
    });

    assert.deepEqual(result, {
      target: { id: "target-1", title: "SGS", url: "https://web.sanguosha.com/220/h5_2/index_210000.php" },
      value: { ok: true }
    });
    assert.equal(calls[0].kind, "read");
    assert.equal(calls[0].filePath, "runtime.js");
    assert.equal(calls[0].encoding, "utf8");
    assert.equal(calls[1].kind, "evaluate");
    assert.match(calls[1].expression, /window\.__SgsScripts/);
    assert.match(calls[1].expression, /manager\.update\(\)/);
    assert.deepEqual(calls[1].options, { timeoutMs: 60000, cdpTimeoutMs: 90000 });
  });

  await test("builds and sends the recording storage configuration", async () => {
    const expression = session.buildConfigureRecordingExpression({
      userId: "tester",
      clientSessionId: "recording-test",
      uploadAllowed: false
    });
    assert.match(expression, /configureRecordingStorage/);
    assert.match(expression, /recording-test/);

    const calls = [];
    const result = await session.configureRuntimeRecording({
      userId: "tester",
      clientSessionId: "recording-test",
      uploadAllowed: true
    }, {
      evaluateOnSgsImpl: async (sentExpression, options) => {
        calls.push({ expression: sentExpression, options });
        return { value: { ok: true, state: { userId: "tester" } } };
      }
    });

    assert.deepEqual(result, { ok: true, state: { userId: "tester" } });
    assert.match(calls[0].expression, /recording storage is not installed/);
    assert.deepEqual(calls[0].options, { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  });

  await test("reads a runtime snapshot through the installed manager", async () => {
    const calls = [];
    const snapshot = await session.readRuntimeSnapshot({
      evaluateOnSgsImpl: async (expression, options) => {
        calls.push({ expression, options });
        return { value: { ok: true, snapshot: { visible: false }, state: { ticks: 1 } } };
      }
    });

    assert.deepEqual(snapshot, { ok: true, snapshot: { visible: false }, state: { ticks: 1 } });
    assert.match(calls[0].expression, /runtime is not installed/);
    assert.match(calls[0].expression, /manager\.update\(\)/);
    assert.deepEqual(calls[0].options, { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  });

  await test("stops the installed runtime through CDP", async () => {
    const calls = [];
    const result = await session.stopRuntime({
      evaluateOnSgsImpl: async (expression, options) => {
        calls.push({ expression, options });
        return { value: { ok: true } };
      }
    });

    assert.deepEqual(result, { ok: true });
    assert.match(calls[0].expression, /manager\.stop\(\)/);
    assert.equal(calls[0].options, undefined);
  });

  console.log(`\n========================================`);
  console.log(`  Runtime session 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
