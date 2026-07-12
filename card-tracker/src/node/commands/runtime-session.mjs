import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const defaultRuntimePath = path.join(rootDir, "dist", "sgs-runtime.js");

export function buildInstallRuntimeExpression(runtime) {
  return `(() => { ${runtime}\n return window.__SgsScripts.manager.update(); })()`;
}

export function buildConfigureRecordingExpression(config = {}) {
  return `(() => {
    const root = window.__SgsScripts;
    if (!root?.sources?.configureRecordingStorage) return { ok: false, error: "recording storage is not installed" };
    return { ok: true, state: root.sources.configureRecordingStorage(${JSON.stringify(config)}) };
  })()`;
}

export const runtimeSnapshotExpression = `(() => {
    const manager = window.__SgsScripts?.manager;
    if (!manager) return { ok: false, error: "runtime is not installed" };
    return { ok: true, snapshot: manager.update(), state: manager.state };
  })()`;

export const stopRuntimeExpression = `(() => {
    const manager = window.__SgsScripts?.manager;
    if (!manager) return { ok: false, error: "runtime is not installed" };
    manager.stop();
    return { ok: true };
  })()`;

export async function installRuntime(options = {}) {
  const runtimePath = options.runtimePath || defaultRuntimePath;
  const readFileImpl = options.readFileImpl || readFile;
  const evaluateOnSgsImpl = options.evaluateOnSgsImpl || evaluateOnSgs;
  const runtime = await readFileImpl(runtimePath, "utf8");
  const { target, value } = await evaluateOnSgsImpl(buildInstallRuntimeExpression(runtime), {
    timeoutMs: 60000,
    cdpTimeoutMs: 90000
  });
  return { target, value };
}

export async function readRuntimeSnapshot(options = {}) {
  const evaluateOnSgsImpl = options.evaluateOnSgsImpl || evaluateOnSgs;
  const { value } = await evaluateOnSgsImpl(runtimeSnapshotExpression, {
    timeoutMs: 30000,
    cdpTimeoutMs: 45000
  });
  return value;
}

export async function configureRuntimeRecording(config = {}, options = {}) {
  const evaluateOnSgsImpl = options.evaluateOnSgsImpl || evaluateOnSgs;
  const { value } = await evaluateOnSgsImpl(buildConfigureRecordingExpression(config), {
    timeoutMs: 30000,
    cdpTimeoutMs: 45000
  });
  return value;
}

export async function stopRuntime(options = {}) {
  const evaluateOnSgsImpl = options.evaluateOnSgsImpl || evaluateOnSgs;
  const { value } = await evaluateOnSgsImpl(stopRuntimeExpression);
  return value;
}
