(() => {
  const root = window.__SgsScripts;
  const core = root.modules.publicZoneCore;

  function collectPublicZoneFacts(context) {
    return core.collectPublicZoneFacts(context, {
      runtimeCard: root.utils.runtimeCard,
      cardInfo: root.sources.cardInfo
    });
  }

  Object.assign(root.sources, { collectPublicZoneFacts });
})();
