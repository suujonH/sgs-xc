(() => {
  const root = window.__SgsScripts;
  const core = root.modules.protocolZoneLedgerCore;

  const ledger = core.makeProtocolZoneLedger({
    cardText: root.utils.cardText,
    cardInfo: (id) => root.sources.cardInfo?.(id)
  });

  Object.assign(root.tracker, {
    protocolZoneLedger: ledger
  });
})();
