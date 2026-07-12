import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(rootDir, "dist", "build-manifest.json"), "utf8"));
const required = new Set([
  "download.mjs",
  "core.mjs",
  "plugin/card-tracker.mjs",
  "plugin/auto-rewards.mjs",
  "plugin/automation.mjs",
  "plugin/blocker.mjs"
]);

for (const artifact of manifest.artifacts || []) {
  required.delete(artifact.path);
  const filePath = path.join(rootDir, "dist", artifact.path);
  const info = await stat(filePath);
  if (!info.isFile() || info.size !== artifact.bytes) {
    throw new Error(`Artifact size mismatch: ${artifact.path}`);
  }
  const source = await readFile(filePath, "utf8");
  if (artifact.path === "download.mjs" && !source.startsWith("// ==UserScript==")) {
    throw new Error("Userscript header was not preserved.");
  }
  if (artifact.path === "core.mjs") {
    if (!source.startsWith("// ==SgsCore==")) throw new Error("Core header was not preserved.");
    const headerVersion = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1];
    const legacyVersion = source.match(/\bconst\s+version\s*=\s*["']([^"']+)["']/)?.[1];
    if (!headerVersion || headerVersion !== legacyVersion) {
      throw new Error("Core new/legacy version markers are missing or inconsistent.");
    }
  }
  if (artifact.path.startsWith("plugin/") && !source.startsWith("// ==SgsPlugin==")) {
    throw new Error(`Plugin header was not preserved: ${artifact.path}`);
  }
  if (artifact.path === "plugin/card-tracker.mjs" && source.includes("card-tracker-runtime.js\"")) {
    throw new Error("Card tracker still depends on a second runtime download.");
  }
  const syntax = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
  if (syntax.error) throw syntax.error;
  if (syntax.status !== 0) {
    throw new Error(`Syntax check failed for ${artifact.path}: ${syntax.stderr}`);
  }
}

if (required.size) throw new Error(`Missing artifacts: ${Array.from(required).join(", ")}`);
console.log(JSON.stringify({ ok: true, artifacts: manifest.artifacts.length }, null, 2));
