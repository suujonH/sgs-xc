// ==SgsPlugin==
// @id           xxx
// @name         Example Plugin
// @version      0.2.0
// @description  Minimal SGS Framework plugin example.
// @permissions  core.logger
// @updateMode   default
// ==/SgsPlugin==

(() => {
  "use strict";

  SgsFramework.plugins.define({
    id: "xxx",
    manifest: {
      name: "Example Plugin",
      version: "0.2.0",
      description: "Minimal SGS Framework plugin example.",
      permissions: ["core.logger"]
    },
    defaults: {},
    settings: [],
    install(context) {
      context.logger.info("plugin installed", "xxx");
      return () => context.logger.info("plugin disposed", "xxx");
    }
  });
})();
