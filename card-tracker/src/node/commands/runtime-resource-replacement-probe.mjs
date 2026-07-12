import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_RESOURCE_REPLACEMENT_PROBE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-resource-replacement-probe`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function probeExpression() {
  return String.raw`(() => {
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 14) => {
      if (!root || depth > maxDepth) return;
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const label = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + label + "#" + i, depth + 1, maxDepth);
      }
    };
    const textureInfo = (texture) => {
      if (!texture) return null;
      let bitmap = null;
      try { bitmap = texture.bitmap || texture._bitmap || null; } catch {}
      return {
        ctor: ctor(texture),
        url: texture.url || texture._url || bitmap && (bitmap.url || bitmap._url) || "",
        width: texture.width,
        height: texture.height,
        sourceWidth: texture.sourceWidth,
        sourceHeight: texture.sourceHeight,
        bitmapCtor: ctor(bitmap)
      };
    };
    const sampleTextures = [];
    let chosenTexture = null;
    walk(Laya.stage, (node, nodePath) => {
      if (!isVisible(node)) return;
      const candidates = [];
      try { if (node.texture) candidates.push(["texture", node.texture]); } catch {}
      try { if (node._texture) candidates.push(["_texture", node._texture]); } catch {}
      try { if (node.graphics && node.graphics._one && node.graphics._one.texture) candidates.push(["graphics._one.texture", node.graphics._one.texture]); } catch {}
      try {
        const cmds = node.graphics && node.graphics._cmds;
        if (Array.isArray(cmds)) {
          for (const cmd of cmds.slice(0, 8)) {
            if (cmd && cmd.texture) candidates.push(["graphics._cmds.texture", cmd.texture]);
          }
        }
      } catch {}
      for (const [field, texture] of candidates) {
        const info = textureInfo(texture);
        if (info && (info.url || info.width || info.height)) {
          sampleTextures.push({ path: nodePath, label: labelOf(node), field, texture: info });
          if (!chosenTexture && info.width && info.height) chosenTexture = texture;
        }
      }
    });
    const chosen = sampleTextures.find((item) => item.texture && item.texture.width && item.texture.height) || sampleTextures[0] || null;
    const drawProbe = {
      attempted: false,
      ok: false,
      usedTextureUrl: chosen && chosen.texture && chosen.texture.url || "",
      commandsBeforeRemove: null,
      nodePresentBeforeRemove: false,
      nodePresentAfterRemove: false,
      error: ""
    };
    if (chosen && window.Laya && Laya.Sprite && Laya.stage) {
      drawProbe.attempted = true;
      let sprite = null;
      try {
        const texture = chosenTexture || (chosen.texture.url && Laya.loader && Laya.loader.getRes && Laya.loader.getRes(chosen.texture.url)) || null;
        sprite = new Laya.Sprite();
        sprite.name = "__codex_resource_draw_probe";
        sprite.mouseEnabled = false;
        sprite.zOrder = 2147483647;
        sprite.pos(24, 24);
        if (texture && sprite.graphics && typeof sprite.graphics.drawTexture === "function") {
          sprite.graphics.drawTexture(texture, 0, 0, Math.min(96, texture.width || 96), Math.min(96, texture.height || 96));
          Laya.stage.addChild(sprite);
          drawProbe.ok = true;
          drawProbe.nodePresentBeforeRemove = !!sprite.parent;
          drawProbe.commandsBeforeRemove = {
            one: !!sprite.graphics._one,
            cmdsLength: Array.isArray(sprite.graphics._cmds) ? sprite.graphics._cmds.length : null
          };
        } else {
          drawProbe.error = "No usable loaded texture or graphics.drawTexture";
        }
      } catch (error) {
        drawProbe.error = String(error && error.stack || error && error.message || error);
      } finally {
        try {
          if (sprite && sprite.parent) sprite.removeSelf();
          drawProbe.nodePresentAfterRemove = !!(sprite && sprite.parent);
          if (sprite && typeof sprite.destroy === "function") sprite.destroy(true);
        } catch {}
      }
    }

    const RV = Laya && Laya.ResourceVersion || {};
    const URL = Laya && Laya.URL || {};
    const loader = Laya && Laya.loader || {};
    const api = {
      runtime: {
        page: { title: document.title, url: location.href },
        resourceVersion: window.resourceVersion || "",
        layaVersion: Laya && Laya.version || "",
        stage: Laya && Laya.stage ? { width: Laya.stage.width, height: Laya.stage.height, children: Laya.stage.numChildren } : null
      },
      resourceVersionApi: {
        ownKeys: own(RV).slice(0, 80),
        prototypeKeys: own(Object.getPrototypeOf(RV)).slice(0, 80),
        manifestKeys: RV.manifest && typeof RV.manifest === "object" ? own(RV.manifest).slice(0, 30) : [],
        manifestSize: RV.manifest && typeof RV.manifest === "object" ? own(RV.manifest).length : null,
        addVersionPrefixSource: typeof RV.addVersionPrefix === "function" ? String(RV.addVersionPrefix).slice(0, 2000) : null
      },
      urlApi: {
        ownKeys: own(URL).slice(0, 100),
        basePath: URL.basePath || "",
        rootPath: URL.rootPath || "",
        customFormatType: typeof URL.customFormat,
        customFormatSource: typeof URL.customFormat === "function" ? String(URL.customFormat).slice(0, 2000) : null,
        formatURLSource: typeof URL.formatURL === "function" ? String(URL.formatURL).slice(0, 2000) : null
      },
      loaderApi: {
        ctor: ctor(loader),
        ownKeys: own(loader).slice(0, 80),
        getResType: typeof loader.getRes,
        loadType: typeof loader.load,
        resourceMapKeys: loader._resMap && typeof loader._resMap === "object" ? own(loader._resMap).slice(0, 30) : []
      }
    };

    const hookProbe = {
      logicalPath: "res/codex/probe/a.png",
      replacementUrl: "https://example.invalid/codex-local-b.png",
      originalCustomFormatType: typeof URL.customFormat,
      originalAddVersionPrefixType: typeof RV.addVersionPrefix,
      customFormatCalls: [],
      addVersionPrefixCalls: [],
      manualCustomFormatResult: null,
      manualAddVersionPrefixResult: null,
      formatURLResult: null,
      errors: []
    };
    const originalCustomFormat = URL.customFormat;
    const originalAddVersionPrefix = RV.addVersionPrefix;
    try {
      if (typeof originalCustomFormat === "function") {
        URL.customFormat = function (url, ...args) {
          hookProbe.customFormatCalls.push({ url, argsLength: args.length });
          if (url === hookProbe.logicalPath) return hookProbe.replacementUrl;
          return originalCustomFormat.call(this, url, ...args);
        };
        hookProbe.manualCustomFormatResult = URL.customFormat(hookProbe.logicalPath);
      }
      if (typeof originalAddVersionPrefix === "function") {
        RV.addVersionPrefix = function (url, ...args) {
          hookProbe.addVersionPrefixCalls.push({ url, argsLength: args.length });
          if (url === hookProbe.logicalPath) return hookProbe.replacementUrl;
          return originalAddVersionPrefix.call(this, url, ...args);
        };
        hookProbe.manualAddVersionPrefixResult = RV.addVersionPrefix(hookProbe.logicalPath);
      }
      if (typeof URL.formatURL === "function") {
        hookProbe.formatURLResult = URL.formatURL(hookProbe.logicalPath);
      }
    } catch (error) {
      hookProbe.errors.push(String(error && error.stack || error && error.message || error));
    } finally {
      try { URL.customFormat = originalCustomFormat; } catch {}
      try { RV.addVersionPrefix = originalAddVersionPrefix; } catch {}
    }
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      api,
      sampleTextures: sampleTextures.slice(0, 60),
      drawProbe,
      hookProbe,
      conclusions: {
        drawImage: "Use Laya.Image.skin, Sprite.graphics.loadImage, or Laya.loader.load + Sprite.graphics.drawTexture; add the node to Laya.stage or a scene/window layer and remove it when leaving that scene.",
        logicalReplacement: "For already-versioned Laya resources, hook the logical path before final URL formatting: Laya.URL.customFormat and/or Laya.ResourceVersion.addVersionPrefix.",
        localFile: "A https game page should not load file:/// local files directly; serve local files via a trusted HTTP/HTTPS endpoint or fulfill/redirect original requests with CDP/extension interception.",
        networkFile: "An absolute HTTPS image URL can be returned by the hook for image resources if the server/CORS/content-type path is accepted by the browser and Laya loader."
      }
    };
  })()`;
}

function readmeText(value) {
  return [
    "# Resource Drawing And Replacement Probe",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Page: ${value.api?.runtime?.page?.title || ""} ${value.api?.runtime?.page?.url || ""}`,
    `- ResourceVersion: ${value.api?.runtime?.resourceVersion || ""}`,
    `- Laya version: ${value.api?.runtime?.layaVersion || ""}`,
    `- Sample textures: ${value.sampleTextures?.length || 0}`,
    `- Draw probe: ${value.drawProbe?.ok ? "ok" : "not-ok"}; texture=${value.drawProbe?.usedTextureUrl || ""}`,
    `- URL.customFormat: ${value.api?.urlApi?.customFormatType || ""}`,
    `- ResourceVersion.addVersionPrefix: ${value.api?.resourceVersionApi?.addVersionPrefixSource ? "present" : "missing"}`,
    `- Hook formatURL result: ${value.hookProbe?.formatURLResult || ""}`,
    "",
    "## Findings",
    "",
    "- Drawing is a normal Laya display-list operation: create `Laya.Image` / `Laya.Sprite`, set `skin` or draw a loaded texture, add it to the desired layer, and remove it on scene/window exit.",
    "- Replacement should be done before Laya resolves the final URL: wrap `Laya.URL.customFormat` and/or `Laya.ResourceVersion.addVersionPrefix`, match a logical `res/.../a.png`, and return the replacement URL.",
    "- Direct `file:///` replacement is not a credible default for a HTTPS game page. Use a local web server, an extension/CDP request fulfill, or an injected data/blob URL for image-only probes.",
    "- Absolute HTTPS replacements are feasible for image resources when the remote server allows the browser/Laya load path.",
    ""
  ].join("\n");
}

async function main() {
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const result = await evaluateOnSgs(probeExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const payload = {
    ok: true,
    target: result.target,
    value: result.value
  };
  await writeJson(path.join(dir, "resource-replacement-probe.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(result.value || {}), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    resourceVersion: result.value?.api?.runtime?.resourceVersion || null,
    layaVersion: result.value?.api?.runtime?.layaVersion || null,
    sampleTextures: result.value?.sampleTextures?.length || 0,
    drawOk: !!result.value?.drawProbe?.ok,
    customFormatType: result.value?.api?.urlApi?.customFormatType || null,
    addVersionPrefix: !!result.value?.api?.resourceVersionApi?.addVersionPrefixSource,
    formatURLResult: result.value?.hookProbe?.formatURLResult || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
