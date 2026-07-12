(() => {
  const root = window.__SgsScripts;
  const core = root.modules.maskHandCore;
  const { seatIsDead, effectiveHandCount } = root.sources;

  function collectMaskHandFacts(context) {
    return core.collectMaskHandFacts(context, {
      effectiveVisible: root.utils.effectiveVisible,
      traverse: root.utils.traverse,
      runtimeCard: root.utils.runtimeCard,
      cardText: root.utils.cardText,
      visualRect: root.utils.visualRect,
      nodeDebugInfo: root.utils.nodeDebugInfo,
      seatIsDead,
      effectiveHandCount
    });
  }

  Object.assign(root.sources, {
    collectMaskHandFacts,
    inspectMask: core.inspectMask
  });
})();
