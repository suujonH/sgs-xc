import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_RESOURCE_LOAD_SCHEME_PROOF_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-resource-load-scheme-proof`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixturePath() {
  const candidates = [
    path.join(projectRoot, "work", "sgs-resource", "data", "1", "220", "h5_2", "res", "assets", "css", "remind.png"),
    path.join(projectRoot, "work", "sgs-resource", "data", "1", "220", "h5_2", "res", "assets", "zgs", "zgs.png"),
    path.join(projectRoot, "work", "sgs-resource", "data", "1", "220", "h5_2", "res", "assets", "window", "gameover.png")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server, sockets) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function proofExpression(cases) {
  return `(${String.raw`async (cases) => {
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textureInfo = (img) => {
      let tex = null;
      try { tex = img && (img.source || img.texture || img._texture || img._bitmap || null); } catch {}
      return tex ? {
        ctor: ctor(tex),
        url: tex.url || tex._url || "",
        width: tex.width,
        height: tex.height,
        sourceWidth: tex.sourceWidth,
        sourceHeight: tex.sourceHeight
      } : null;
    };
    const hookAndLoad = async (entry, index) => {
      const L = window.Laya || {};
      const URL = L.URL || {};
      const RV = L.ResourceVersion || {};
      const logicalPath = "res/codex/proof/" + entry.label + "-" + Date.now() + "-" + index + ".png";
      const originalCustomFormat = URL.customFormat;
      const originalAddVersionPrefix = RV.addVersionPrefix;
      const calls = [];
      const errors = [];
      const restore = () => {
        try { URL.customFormat = originalCustomFormat; } catch (error) { errors.push("restore customFormat: " + String(error && error.message || error)); }
        try { RV.addVersionPrefix = originalAddVersionPrefix; } catch (error) { errors.push("restore addVersionPrefix: " + String(error && error.message || error)); }
      };
      try {
        if (typeof originalCustomFormat === "function") {
          URL.customFormat = function (url, ...args) {
            calls.push({ hook: "customFormat", url, argsLength: args.length });
            if (url === logicalPath) return entry.url;
            return originalCustomFormat.call(this, url, ...args);
          };
        }
        if (typeof originalAddVersionPrefix === "function") {
          RV.addVersionPrefix = function (url, ...args) {
            calls.push({ hook: "addVersionPrefix", url, argsLength: args.length });
            if (url === logicalPath) return entry.url;
            return originalAddVersionPrefix.call(this, url, ...args);
          };
        }
        let formatted = null;
        try { formatted = typeof URL.formatURL === "function" ? URL.formatURL(logicalPath) : null; } catch (error) { errors.push("formatURL: " + String(error && error.message || error)); }
        let img = null;
        let status = "timeout";
        let eventName = "";
        let eventDetail = "";
        try {
          img = new L.Image();
          img.name = "__codex_resource_load_scheme_" + entry.label;
          img.mouseEnabled = false;
          img.zOrder = 2147483647 - index;
          img.pos(32, 32 + index * 30);
          img.size(24, 24);
          let settled = false;
          const loadedEvent = L.Event && L.Event.LOADED || "loaded";
          const errorEvent = L.Event && L.Event.ERROR || "error";
          const onLoaded = () => {
            settled = true;
            status = "loaded";
            eventName = loadedEvent;
          };
          const onError = (error) => {
            settled = true;
            status = "error";
            eventName = errorEvent;
            eventDetail = String(error && error.message || error || "");
          };
          try { img.once(loadedEvent, null, onLoaded); } catch (error) { errors.push("bind loaded: " + String(error && error.message || error)); }
          try { img.once(errorEvent, null, onError); } catch (error) { errors.push("bind error: " + String(error && error.message || error)); }
          L.stage.addChild(img);
          img.skin = logicalPath;
          const startedAt = Date.now();
          while (!settled && Date.now() - startedAt < 4500) {
            if (textureInfo(img)) {
              settled = true;
              status = "loaded-by-texture";
              eventName = "texture-present";
              break;
            }
            await delay(100);
          }
        } catch (error) {
          status = "exception";
          errors.push(String(error && error.stack || error && error.message || error));
        } finally {
          const info = textureInfo(img);
          const parentBeforeRemove = !!(img && img.parent);
          try { if (img && img.parent) img.removeSelf(); } catch (error) { errors.push("removeSelf: " + String(error && error.message || error)); }
          try { if (img && typeof img.destroy === "function") img.destroy(true); } catch (error) { errors.push("destroy: " + String(error && error.message || error)); }
          try { if (L.loader && typeof L.loader.clearRes === "function") L.loader.clearRes(logicalPath); } catch (error) { errors.push("clearRes logical: " + String(error && error.message || error)); }
          restore();
          return {
            label: entry.label,
            kind: entry.kind,
            logicalPath,
            replacementUrl: entry.url,
            formatted,
            status,
            ok: status === "loaded" || status === "loaded-by-texture",
            eventName,
            eventDetail,
            texture: info,
            parentBeforeRemove,
            parentAfterRemove: !!(img && img.parent),
            calls: calls.slice(0, 20),
            errors
          };
        }
      } catch (error) {
        restore();
        return {
          label: entry.label,
          kind: entry.kind,
          logicalPath,
          replacementUrl: entry.url,
          status: "exception",
          ok: false,
          errors: [String(error && error.stack || error && error.message || error)],
          calls: calls.slice(0, 20)
        };
      }
    };
    const results = [];
    for (let i = 0; i < cases.length; i++) {
      results.push(await hookAndLoad(cases[i], i));
    }
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      page: { title: document.title, url: location.href },
      runtime: {
        resourceVersion: window.resourceVersion || "",
        layaVersion: window.Laya && Laya.version || "",
        stage: window.Laya && Laya.stage ? { width: Laya.stage.width, height: Laya.stage.height, children: Laya.stage.numChildren } : null
      },
      results
    };
  }`})(${JSON.stringify(cases)})`;
}

function readmeText(payload) {
  const rows = (payload.value?.results || []).map((result) => {
    return `| ${result.label} | ${result.kind} | ${result.ok ? "yes" : "no"} | ${result.status} | ${result.formatted || ""} |`;
  });
  return [
    "# Resource Load Scheme Proof",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${payload.value?.page?.title || ""} ${payload.value?.page?.url || ""}`,
    `- ResourceVersion: ${payload.value?.runtime?.resourceVersion || ""}`,
    `- Laya version: ${payload.value?.runtime?.layaVersion || ""}`,
    `- Fixture: ${payload.fixture?.path || ""}`,
    "",
    "| Label | Kind | Loaded | Status | Formatted URL |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Interpretation",
    "",
    "- The hook point is the logical resource path before final URL formatting.",
    "- `file://` is tested as a direct local-file replacement from the HTTPS game page.",
    "- `local-http` is tested with a temporary `127.0.0.1` image server and permissive CORS headers.",
    "- `same-origin-https` proves a normal HTTPS replacement URL in the current game origin.",
    "- `data-url` proves an injected self-contained image replacement for image-only probes.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const fixture = fixturePath();
  if (!fixture) throw new Error("No local PNG fixture was found under work/sgs-resource.");
  const fixtureBytes = await readFile(fixture);
  const server = createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/b.png")) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
      "Content-Length": fixtureBytes.length
    });
    res.end(fixtureBytes);
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const address = await listen(server);
  const localHttpUrl = `http://127.0.0.1:${address.port}/b.png?codex=${Date.now()}`;
  const cases = [
    {
      label: "file-url",
      kind: "file",
      url: pathToFileURL(fixture).href
    },
    {
      label: "local-http",
      kind: "local-http",
      url: localHttpUrl
    },
    {
      label: "same-origin-https",
      kind: "https",
      url: `https://web.sanguosha.com/220/h5_2/res/assets/css/remind.png?codex=${Date.now()}`
    },
    {
      label: "data-url",
      kind: "data",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    }
  ];
  try {
    const result = await evaluateOnSgs(proofExpression(cases), { timeoutMs: 40000, cdpTimeoutMs: 60000 });
    const payload = {
      ok: true,
      target: result.target,
      fixture: {
        path: fixture,
        bytes: fixtureBytes.length,
        localHttpUrl
      },
      value: result.value
    };
    await writeJson(path.join(dir, "resource-load-scheme-proof.json"), payload);
    await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
    const summary = Object.fromEntries((result.value?.results || []).map((item) => [item.label, item.status]));
    console.log(JSON.stringify({
      ok: true,
      dir,
      resourceVersion: result.value?.runtime?.resourceVersion || null,
      layaVersion: result.value?.runtime?.layaVersion || null,
      fixture,
      results: summary
    }, null, 2));
  } finally {
    await closeServer(server, sockets);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
