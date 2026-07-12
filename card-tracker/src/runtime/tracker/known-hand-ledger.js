(() => {
  const root = window.__SgsScripts;
  const core = root.modules.knownHandLedgerCore;

  const ledger = core.makeKnownHandLedger({
    cardText: root.utils.cardText,
    seatIsDead: (seat) => root.sources.seatIsDead?.(seat) === true,
    cardPool: () => Object.values(root.sources.configState?.cardDict || {}),
    knownCardsFromProtocolZone: (record) => {
      const snapshot = root.tracker.protocolZoneLedger?.snapshot?.();
      const rows = snapshot?.recentCards || [];
      return rows
        .filter((row) =>
          row?.source?.rule === "protocol-inferred-deck-endpoint" &&
          Number(row.source.recordIndex) === Number(record?.index) &&
          Number(row.zone?.code) === 5
        )
        .map((row) => ({
          ...(root.sources.cardInfo?.(row.id) || row.card || {}),
          id: Number(row.id),
          source: row.source
        }));
    }
  });

  Object.assign(root.tracker, {
    knownHandLedger: ledger
  });
})();
