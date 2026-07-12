import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build as esbuild } from "esbuild";
import { minify } from "terser";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const projects = JSON.parse(await readFile(path.join(rootDir, "build", "projects.json"), "utf8"));

runNode(path.join(rootDir, "card-tracker", "scripts", "build-runtime.mjs"), rootDir);
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const artifacts = [];
for (const project of projects) {
  const entryPath = path.join(rootDir, project.entry);
  const entrySource = await readFile(entryPath, "utf8");
  const header = extractHeader(entrySource, project.kind);
  let code = await bundle(entryPath);

  if (project.kind === "embedded-runtime-plugin") {
    const runtime = await readFile(path.join(rootDir, project.runtime));
    const quotedMarker = /(["'])__SGS_CARD_TRACKER_RUNTIME_GZIP_BASE64__\1/;
    if (!quotedMarker.test(code)) {
      throw new Error(`Runtime marker missing after bundling ${project.id}.`);
    }
    const runtimeLiteral = JSON.stringify(gzipSync(runtime, { level: 9 }).toString("base64"));
    code = code.replace(quotedMarker, () => runtimeLiteral);
  }

  let result;
  try {
    result = await minify(code, {
      compress: {
        passes: 2,
        keep_fnames: true
      },
      mangle: {
        keep_classnames: true,
        keep_fnames: true,
        reserved: ["version"]
      },
      format: {
        ascii_only: false,
        comments: false
      }
    });
  } catch (error) {
    const debugDir = path.join(rootDir, ".build");
    const debugPath = path.join(debugDir, `${project.id}.bundle.js`);
    await mkdir(debugDir, { recursive: true });
    await writeFile(debugPath, code, "utf8");
    error.message = `${error.message} (unminified bundle: ${debugPath})`;
    throw error;
  }
  if (!result.code) throw new Error(`Terser produced no output for ${project.id}.`);

  const outputPath = path.join(distDir, project.output);
  const artifact = `${header}${header ? "\n\n" : ""}${result.code}\n`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, artifact, "utf8");
  artifacts.push(describeArtifact(project.id, project.output, artifact));
}

await copyStatic("framework/manual", "manual");
await copyStatic("plugin-catalog/src/index.json", "plugin/index.json");

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  pipeline: {
    bundle: "esbuild",
    obfuscation: "terser-compress-and-mangle",
    output: "one JavaScript file per userscript/plugin"
  },
  artifacts
};
await writeFile(path.join(distDir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, distDir, artifacts }, null, 2));

async function bundle(entryPath) {
  const result = await esbuild({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    charset: "utf8",
    legalComments: "none",
    treeShaking: true
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`esbuild produced no output for ${entryPath}.`);
  return output;
}

function extractHeader(source, kind) {
  const markers = kind === "userscript"
    ? ["UserScript", "UserScript"]
    : kind === "core"
      ? ["SgsCore", "SgsCore"]
    : kind.includes("plugin")
      ? ["SgsPlugin", "SgsPlugin"]
      : null;
  if (!markers) return "";
  const pattern = new RegExp(`^// ==${markers[0]}==[\\s\\S]*?// ==/${markers[1]}==`);
  const match = source.match(pattern);
  if (!match) throw new Error(`Required ${markers[0]} header is missing.`);
  return match[0];
}

function describeArtifact(id, relativePath, content) {
  return {
    id,
    path: relativePath.replaceAll("\\", "/"),
    bytes: Buffer.byteLength(content),
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}

async function copyStatic(sourceRelative, outputRelative) {
  const source = path.join(rootDir, sourceRelative);
  const output = path.join(distDir, outputRelative);
  await mkdir(path.dirname(output), { recursive: true });
  await cp(source, output, { recursive: true, force: true });
}

function runNode(scriptPath, cwd) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${scriptPath} exited with ${result.status}.`);
}
