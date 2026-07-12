(() => {
  const existing = window.__SgsScripts;
  if (existing?.manager?.stop) existing.manager.stop();
  window.__SgsScripts = {
    version: "0.5.0",
    installedAt: new Date().toISOString(),
    modules: {},
    state: {},
    utils: {},
    sources: {},
    tracker: {}
  };
})();
