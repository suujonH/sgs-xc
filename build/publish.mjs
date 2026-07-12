import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const configPath = process.env.SGS_DEPLOY_CONFIG
  ? path.resolve(process.env.SGS_DEPLOY_CONFIG)
  : path.join(rootDir, "build", "deploy.config.local.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
validateConfig(config, configPath);
const deploy = process.argv.includes("--deploy");
const dryRun = process.argv.includes("--dry-run");
if (deploy === dryRun) throw new Error("Choose exactly one mode: --dry-run or --deploy.");

const manifest = JSON.parse(await readFile(path.join(distDir, "build-manifest.json"), "utf8"));
for (const artifact of manifest.artifacts || []) {
  const info = await stat(path.join(distDir, artifact.path));
  if (!info.isFile() || info.size !== artifact.bytes) throw new Error(`Invalid artifact: ${artifact.path}`);
}

if (dryRun) {
  const remote = run("ssh.exe", [config.remoteHost, `find '${config.remotePath}' -maxdepth 2 -type f -printf '%P %s bytes\\n' | sort`], { capture: true });
  console.log(JSON.stringify({
    ok: true,
    mode: "dry-run",
    localArtifacts: manifest.artifacts,
    remoteFiles: remote.stdout.trim().split(/\r?\n/).filter(Boolean)
  }, null, 2));
  process.exit(0);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "sgs-script-publish-"));
const archive = path.join(tempDir, "script.tar");
const remoteArchive = `/tmp/sgs-script-${crypto.randomUUID()}.tar`;
try {
  run("tar.exe", ["-C", distDir, "-cf", archive, "."]);
  run("scp.exe", ["-q", archive, `${config.remoteHost}:${remoteArchive}`]);
  const commandParts = [
    "set -eu",
    `target=${shellQuote(config.remotePath)}`,
    `archive=${shellQuote(remoteArchive)}`,
    "tmp=$(mktemp -d)",
    "cleanup(){ rm -rf \"$tmp\" \"$archive\"; }",
    "trap cleanup EXIT",
    "mkdir -p \"$target\"",
    "tar -C \"$tmp\" -xf \"$archive\"",
    "rsync -a --delete \"$tmp\"/ \"$target\"/"
  ];
  if (config.remoteOwner) {
    commandParts.push(`chown -R ${shellQuote(config.remoteOwner)} \"$target\"`);
  }
  if (config.acl?.user) {
    const traversePaths = Array.isArray(config.acl.traversePaths) ? config.acl.traversePaths : [];
    const traverse = traversePaths.length
      ? `setfacl -m ${shellQuote(`u:${config.acl.user}:--x`)} ${traversePaths.map(shellQuote).join(" ")}`
      : "true";
    commandParts.push([
      "if command -v setfacl >/dev/null 2>&1",
      `then ${traverse}`,
      `setfacl -R -m ${shellQuote(`u:${config.acl.user}:rX`)} \"$target\"`,
      `setfacl -d -m ${shellQuote(`u:${config.acl.user}:rX`)} \"$target\"`,
      "fi"
    ].join("; "));
  }
  const command = commandParts.join("; ");
  run("ssh.exe", [config.remoteHost, command]);

  const verified = [];
  for (const artifact of manifest.artifacts || []) {
    const response = await fetch(new URL(artifact.path, config.publicBaseUrl), { cache: "no-store" });
    if (!response.ok) throw new Error(`Published ${artifact.path} returned HTTP ${response.status}.`);
    const body = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    if (sha256 !== artifact.sha256) throw new Error(`Published hash mismatch: ${artifact.path}`);
    verified.push({ path: artifact.path, sha256 });
  }
  console.log(JSON.stringify({ ok: true, mode: "deploy", verified }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr || ""}`.trim());
  }
  return result;
}

function validateConfig(value, filePath) {
  for (const key of ["remoteHost", "remotePath", "publicBaseUrl"]) {
    if (!String(value?.[key] || "").trim()) {
      throw new Error(`Deployment config ${filePath} is missing ${key}.`);
    }
  }
  new URL(value.publicBaseUrl);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
