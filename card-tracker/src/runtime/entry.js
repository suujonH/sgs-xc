(() => {
  const root = window.__SgsScripts;
  const state = {
    intervalId: 0,
    tickCount: 0,
    lastError: "",
    lastStorageVisible: null,
    lastSnapshot: null
  };

  function update() {
    state.tickCount++;
    state.lastError = "";
    root.sources.ensureConfigLoading?.();
    const snapshot = root.tracker.buildSnapshot();
    state.lastSnapshot = snapshot;
    appendSnapshotStorageLog(snapshot);
    return snapshot;
  }

  function appendSnapshotStorageLog(snapshot) {
    const visible = snapshot?.visible === true;
    const shouldLog =
      state.tickCount === 1 ||
      visible !== state.lastStorageVisible ||
      state.tickCount % 10 === 0;
    if (!shouldLog) return;
    state.lastStorageVisible = visible;
    root.sources.appendStorageLog?.("snapshot", {
      tick: state.tickCount,
      visible,
      reason: snapshot?.reason || "",
      selfSeatIndex: snapshot?.table?.selfSeatIndex ?? snapshot?.selfSeatIndex ?? -1,
      seatCount: snapshot?.table?.seatCount || 0,
      gameMode: snapshot?.table?.mode || null,
      protocolCounts: snapshot?.protocol?.counts || {},
      consoleProtocolCounts: snapshot?.protocol?.consoleCounts || {}
    });
  }

  function stop() {
    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = 0;
    root.tracker.leaveGameModelBattle?.("runtime-stop");
  }

  const manager = {
    update,
    snapshot: update,
    stop,
    state
  };

  root.manager = manager;
  root.sources.loadGameConfig?.().catch((error) => {
    state.lastError = String(error?.stack || error);
  });
  update();
  state.intervalId = setInterval(() => {
    try {
      update();
    } catch (error) {
      state.lastError = String(error?.stack || error);
      console.warn("[sgs-scripts]", error);
    }
  }, 500);
})();
