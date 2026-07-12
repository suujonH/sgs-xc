(() => {
  const root = window.__SgsScripts;
  const STATE_KEY = "sgs-scripts:recording-state";
  const LOG_KEY = "sgs-scripts:recording-log";
  const MAX_LOGS = 300;

  function readJson(storage, key, fallback) {
    try {
      const text = storage?.getItem?.(key);
      return text ? JSON.parse(text) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function configureRecordingStorage(value) {
    const next = {
      ...(root.state.recording || readJson(window.sessionStorage, STATE_KEY, {})),
      ...(value || {}),
      updatedAt: new Date().toISOString()
    };
    root.state.recording = next;
    writeJson(window.sessionStorage, STATE_KEY, next);
    writeJson(window.localStorage, STATE_KEY, next);
    appendStorageLog("recording:configure", {
      userId: next.userId || "",
      clientSessionId: next.clientSessionId || "",
      uploadAllowed: next.uploadAllowed !== false,
      uploadBlockedReason: next.uploadBlockedReason || "",
      reconnected: next.reconnected === true
    });
    return next;
  }

  function appendStorageLog(type, payload) {
    const entry = {
      time: Date.now(),
      ts: new Date().toISOString(),
      type,
      payload: compact(payload, 0)
    };
    const logs = readJson(window.sessionStorage, LOG_KEY, []);
    const next = Array.isArray(logs) ? logs : [];
    next.push(entry);
    if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
    writeJson(window.sessionStorage, LOG_KEY, next);
    writeJson(window.localStorage, LOG_KEY, next);
    return entry;
  }

  function markRecordingUploadBlocked(reason) {
    return configureRecordingStorage({
      uploadAllowed: false,
      uploadBlockedReason: reason || "upload-not-allowed",
      reconnected: true
    });
  }

  function compact(value, depth) {
    if (value == null || typeof value !== "object") return value;
    if (depth >= 3) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => compact(item, depth + 1));
    const out = {};
    for (const key of Object.keys(value).slice(0, 30)) {
      out[key] = compact(value[key], depth + 1);
    }
    return out;
  }

  Object.assign(root.sources, {
    configureRecordingStorage,
    appendStorageLog,
    markRecordingUploadBlocked
  });
})();
