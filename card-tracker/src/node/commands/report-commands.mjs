import { readFile } from "node:fs/promises";
import path from "node:path";
import { readRuntimeSnapshot } from "./runtime-session.mjs";

export function reportFilePath(envName, argv = process.argv, env = process.env) {
  return env[envName] || argv[3] || "";
}

export async function readSnapshotValue(options = {}) {
  const filePath = options.filePath || "";
  const readFileImpl = options.readFileImpl || readFile;
  const readRuntimeSnapshotImpl = options.readRuntimeSnapshotImpl || readRuntimeSnapshot;
  if (filePath) return JSON.parse(await readFileImpl(path.resolve(filePath), "utf8"));
  return readRuntimeSnapshotImpl();
}

export async function buildSnapshotReport(options) {
  const filePath = reportFilePath(options.envName, options.argv, options.env);
  const value = await readSnapshotValue({
    filePath,
    readFileImpl: options.readFileImpl,
    readRuntimeSnapshotImpl: options.readRuntimeSnapshotImpl
  });
  const validation = options.validateSnapshotValue(value, options.validationOptions());
  const report = options.buildReport(value, validation);
  return {
    ok: report.ok,
    filePath: filePath || null,
    report
  };
}
