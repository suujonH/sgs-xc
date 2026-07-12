(() => {
  const root = window.__SgsScripts;
  const { readTableScene, collectMaskHandFacts, collectPublicZoneFacts } = root.sources;

  function summarizeCard(card) {
    return {
      id: card?.id ?? null,
      name: card?.name || "",
      suit: card?.suit || "",
      rank: card?.rank || "",
      color: card?.color || "",
      text: card?.text || root.utils.cardText(card),
      source: card?.source || null
    };
  }

  function summarizeCandidate(candidate) {
    return {
      kind: candidate?.kind || "candidate",
      text: candidate?.text || candidate?.display || "",
      display: candidate?.display || candidate?.text || "",
      probability: Number(candidate?.probability || 0),
      count: Number(candidate?.count || 1),
      constraints: candidate?.constraints || [],
      source: candidate?.source || null
    };
  }

  function buildSnapshot() {
    const context = readTableScene();
    if (!context.ok) {
      root.sources.installProtocolHook();
      root.tracker.knownHandLedger?.reset?.("table-scene-not-visible");
      root.tracker.protocolZoneLedger?.reset?.("table-scene-not-visible");
      root.tracker.leaveGameModelBattle?.("table-scene-not-visible");
      return {
        ok: false,
        visible: false,
        reason: context.reason,
        rows: [],
        logs: [],
        table: tableSummary(context),
        visibility: [],
        publicZones: emptyPublicZones(),
        config: configSummary(),
        protocol: root.sources.protocolState,
        knownHandLedger: root.tracker.knownHandLedger?.summary?.() || null,
        protocolZoneLedger: root.tracker.protocolZoneLedger?.snapshot?.() || null,
        rulePlanner: root.tracker.rulePlanner?.summary?.() || null,
        gameModel: root.tracker.gameModel?.snapshot?.() || null
      };
    }
    root.sources.installProtocolHook();
    const visibleRows = collectMaskHandFacts(context);
    const publicZones = collectPublicZoneFacts?.(context) || emptyPublicZones();
    const gameModel = root.tracker.syncGameModel?.(context, publicZones) || null;
    let rows = root.tracker.knownHandLedger?.ingestVisibleRows?.(context, visibleRows) || visibleRows;
    const summarizedRows = rows.map((row) => ({
      seatIndex: row.seatIndex,
      names: row.names,
      handCardCount: row.handCardCount,
      knownCount: row.knownCount,
      candidateCount: row.candidateCount || row.candidates?.length || 0,
      unknownCount: row.unknownCount,
      complete: row.complete === true,
      dirty: row.dirty === true,
      invalidationReason: row.invalidationReason || "",
      cards: row.cards.map(summarizeCard),
      candidates: (row.candidates || []).map(summarizeCandidate),
      sources: row.sources
    }));

    return {
      ok: true,
      visible: true,
      rows: summarizedRows,
      visibleRows: visibleRows.map((row) => ({
        seatIndex: row.seatIndex,
        names: row.names,
        handCardCount: row.handCardCount,
        knownCount: row.knownCount,
        candidateCount: row.candidateCount || row.candidates?.length || 0,
        unknownCount: row.unknownCount,
        cards: row.cards.map(summarizeCard),
        candidates: (row.candidates || []).map(summarizeCandidate),
        sources: row.sources
      })),
      publicZones,
      logs: context.logs.map((entry) => ({ index: entry.index, text: entry.text })),
      table: tableSummary(context),
      visibility: context.visibility,
      selfSeatIndex: context.selfSeatIndex,
      config: configSummary(),
      protocol: root.sources.protocolState,
      knownHandLedger: root.tracker.knownHandLedger?.summary?.() || null,
      protocolZoneLedger: root.tracker.protocolZoneLedger?.snapshot?.() || null,
      rulePlanner: root.tracker.rulePlanner?.summary?.() || null,
      gameModel
    };
  }

  function tableSummary(context) {
    const seats = Array.isArray(context?.seatRecords) ? context.seatRecords : [];
    const selfSeat = seats.find((seat) => seat.isSelf) || null;
    return {
      schemaVersion: 1,
      mode: context?.mode || { known: false, candidates: {} },
      seatCount: seats.length,
      selfSeatIndex: context?.selfSeatIndex ?? -1,
      selfSeat,
      seats,
      allGenerals: seats.map((seat) => ({
        seatIndex: seat.seatIndex,
        managerSeatIndex: seat.managerSeatIndex,
        names: seat.names,
        general: seat.general,
        relation: seat.relation
      })),
      selfGenerals: seats
        .filter((seat) => seat.isSelf)
        .map((seat) => ({ seatIndex: seat.seatIndex, names: seat.names, general: seat.general })),
      teammateGenerals: seats
        .filter((seat) => !seat.isSelf && seat.relation?.isFriend === true)
        .map((seat) => ({ seatIndex: seat.seatIndex, names: seat.names, general: seat.general }))
    };
  }

  function configSummary() {
    const config = root.sources.configState || {};
    return {
      loaded: !!config.loaded,
      loading: !!config.loading,
      error: config.error || "",
      sourceUrl: config.sourceUrl || "",
      version: config.version || 0,
      cardCount: config.cardCount || 0,
      standardDeckCount: Array.isArray(config.standardDeckIds) ? config.standardDeckIds.length : 0,
      gameRuleDeckCount: Object.keys(config.gameRuleDecks || {}).length,
      spellCount: config.spellCount || 0,
      markSpellCount: config.markSpellCount || 0,
      skillRuleSummary: config.skillRuleSummary || null
    };
  }

  function emptyPublicZones() {
    return {
      seats: [],
      counts: { seats: 0, zones: 0, cards: 0, known: 0, byZone: {} },
      sources: {}
    };
  }

  Object.assign(root.tracker, { buildSnapshot, summarizeCard, summarizeCandidate });
})();
