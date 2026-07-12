// ==SgsPlugin==
// @id           sgs.card-tracker
// @name         SGS Game Model
// @version      0.5.1
// @description  Headless physical-card, deck-cycle, causal-event, entity-pile, skill-rule and probability inference core.
// @permissions  laya.stage-scan,laya.public-node-inspect,runtime.battle-events,runtime.log-events
// @updateMode   default
// ==/SgsPlugin==

(() => {
  "use strict";

  const embeddedRuntimeGzipBase64 = "__SGS_CARD_TRACKER_RUNTIME_GZIP_BASE64__";

  async function decodeEmbeddedRuntime() {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser does not support the gzip DecompressionStream required by SGS Game Model.");
    }
    const binary = atob(embeddedRuntimeGzipBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  SgsFramework.plugins.define({
    id: "sgs.card-tracker",
    manifest: {
      name: "SGS Game Model",
      version: "0.5.1",
      description: "Headless physical-card, deck-cycle, causal-event, entity-pile, skill-rule and probability inference core.",
      permissions: [
        "laya.stage-scan",
        "laya.public-node-inspect",
        "runtime.battle-events",
        "runtime.log-events"
      ]
    },
    defaults: {},
    settings: [],
    async install() {
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = `${await decodeEmbeddedRuntime()}\n//# sourceURL=sgs-plugin://sgs.card-tracker/embedded-runtime.js`;
      (document.head || document.documentElement || document.body).appendChild(script);
      script.remove();

      if (!window.__SgsScripts?.manager?.update) throw new Error("Game model runtime did not start.");

      return () => {
        window.__SgsScripts?.manager?.stop?.();
        try {
          delete window.__SgsScripts;
        } catch {
          window.__SgsScripts = undefined;
        }
      };
    }
  });
})();
