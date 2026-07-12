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

async function main() {
  const credentials = await import("../src/node/commands/user-credentials.mjs");

  console.log("\nUser credentials");

  await test("uses complete explicit credentials without calling the API", async () => {
    const result = await credentials.ensureUserCredentials({
      uploadUrl: "http://example.test/game-record/save",
      userId: "user-uuid",
      password: "password-uuid",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    assert.equal(result.userId, "user-uuid");
    assert.equal(result.password, "password-uuid");
    assert.equal(result.source, "env");
  });

  await test("creates credentials from the API and reuses the cached file", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-user-credentials-"));
    const calls = [];
    const first = await credentials.ensureUserCredentials({
      rootDir,
      uploadUrl: "http://example.test/game-record/save",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            userId: "11111111-1111-1111-1111-111111111111",
            password: "22222222-2222-2222-2222-222222222222",
            createdAt: "2026-07-09T00:00:00.000Z"
          })
        };
      }
    });

    assert.equal(first.source, "server");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://example.test/api/user/create");
    assert.equal(calls[0].options.method, "POST");

    const saved = JSON.parse(await fs.readFile(credentials.credentialsPath(rootDir), "utf8"));
    assert.equal(saved.userId, first.userId);
    assert.equal(saved.password, first.password);
    assert.equal(saved.apiBase, "http://example.test");

    const second = await credentials.ensureUserCredentials({
      rootDir,
      uploadUrl: "http://example.test/api/game-record/save",
      fetchImpl: async () => {
        throw new Error("cached credentials should be reused");
      }
    });

    assert.equal(second.source, "file");
    assert.equal(second.userId, first.userId);
    assert.equal(second.password, first.password);
  });

  console.log(`\n========================================`);
  console.log(`  User credentials 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
