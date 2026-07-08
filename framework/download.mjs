// ==UserScript==
// @name         SGS XC Downloader
// @namespace    https://github.com/suujonH/sgs-xc
// @version      0.1.2
// @description  Download and inject SGS Framework before Laya starts.
// @author       Codex
// @updateURL    https://raw.githubusercontent.com/suujonH/sgs-xc/main/framework/download.mjs
// @downloadURL  https://raw.githubusercontent.com/suujonH/sgs-xc/main/framework/download.mjs
// @match        https://web.sanguosha.com/220/h5_2/*
// @match        http://web.sanguosha.com/220/h5_2/*
// @match        https://web.sanguosha.com/login/*
// @match        http://web.sanguosha.com/login/*
// @run-at       document-start
// @noframes
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// ==/UserScript==

(function sgsXcDownloader() {
  "use strict";

  const config = {
    frameworkUrl: "https://raw.githubusercontent.com/suujonH/sgs-xc/main/framework/core.mjs",
    timeoutMs: 5000,
    cachePrefix: "sgs.xc.download.v1",
    sourceUrlPrefix: "sgs-xc-framework"
  };

  const keys = {
    meta: `${config.cachePrefix}.meta`,
    code: `${config.cachePrefix}.code`
  };

  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const state = {
    phase: "starting",
    startedAt: Date.now(),
    finishedAt: 0,
    remote: null,
    loadedMeta: null,
    cacheBackend: "",
    error: "",
    continuedWithoutFramework: false,
    usedCacheAfterFailure: false,
    usedLocalStorageAfterFailure: false
  };

  const layaBarrier = installLayaBarrier(pageWindow);
  publishDownloaderApi();

  boot().catch((error) => {
    state.error = String(error?.stack || error?.message || error);
    console.error("[sgs-xc-downloader]", error);
    releaseLayaBarrier("downloader-unhandled-error");
  });

  async function boot() {
    const cached = readCache();
    try {
      state.phase = "downloading";
      const response = await requestFramework(config.frameworkUrl, config.timeoutMs, cached.meta);
      const remote = {
        url: config.frameworkUrl,
        status: response.status,
        etag: response.headers.etag || "",
        lastModified: response.headers["last-modified"] || "",
        contentLength: response.headers["content-length"] || ""
      };
      state.remote = remote;
      if (response.status === 304) {
        if (!cached.code) throw new Error("Framework returned 304 but no cached code exists.");
        injectFramework(cached.code, {
          ...cached.meta,
          source: "cache-304"
        });
        finish("framework-cache-304");
        return;
      }

      const code = response.text;
      const sha256 = await sha256Text(code).catch(() => "");
      const meta = {
        version: extractFrameworkVersion(code, sha256),
        frameworkUrl: config.frameworkUrl,
        etag: response.headers.etag || "",
        lastModified: response.headers["last-modified"] || "",
        contentLength: response.headers["content-length"] || String(code.length),
        sha256,
        downloadedAt: new Date().toISOString()
      };
      writeCache(meta, code);
      injectFramework(code, {
        ...meta,
        source: "download"
      });
      finish("framework-downloaded");
    } catch (error) {
      state.phase = "failed";
      state.error = String(error?.stack || error?.message || error);
      const localCache = readLocalStorageCache();
      if (localCache.code) {
        try {
          state.usedLocalStorageAfterFailure = true;
          injectFramework(localCache.code, {
            ...localCache.meta,
            source: "localStorage-after-download-failure"
          });
          finish("framework-localStorage-after-download-failure");
          return;
        } catch (localError) {
          state.error = [
            state.error,
            `LocalStorage fallback failed: ${String(localError?.stack || localError?.message || localError)}`
          ].join("\n");
        }
      }
      const choice = await showFailureMessageBox(state.error, cached.meta);
      if (choice === "reload") {
        location.reload();
        return;
      }
      if (cached.code) {
        state.usedCacheAfterFailure = true;
        injectFramework(cached.code, {
          ...cached.meta,
          source: "cache-after-failure"
        });
        finish("framework-cache-after-failure");
        return;
      }
      state.continuedWithoutFramework = true;
      finish("framework-skipped-after-failure");
    }
  }

  function requestFramework(url, timeoutMs, cachedMeta) {
    const headers = {
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    };
    if (cachedMeta?.etag) headers["If-None-Match"] = cachedMeta.etag;
    if (cachedMeta?.lastModified) headers["If-Modified-Since"] = cachedMeta.lastModified;
    return request(url, "GET", timeoutMs, headers);
  }

  function request(url, method, timeoutMs, headers) {
    if (!url) return Promise.reject(new Error("Missing request URL."));
    if (timeoutMs <= 0) return Promise.reject(new Error(`Invalid timeout for ${url}`));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        timeout: timeoutMs,
        headers,
        onload(response) {
          if ((response.status >= 200 && response.status < 300) || response.status === 304) {
            resolve({
              status: response.status,
              text: String(response.responseText || ""),
              headers: parseHeaders(response.responseHeaders || "")
            });
            return;
          }
          reject(new Error(`${method} ${url} failed with HTTP ${response.status}.`));
        },
        onerror(error) {
          reject(new Error(`${method} ${url} failed: ${String(error?.error || error?.message || "network error")}`));
        },
        ontimeout() {
          reject(new Error(`${method} ${url} timed out after ${timeoutMs} ms.`));
        },
        onabort() {
          reject(new Error(`${method} ${url} was aborted.`));
        }
      });
    });
  }

  function parseHeaders(text) {
    const headers = {};
    for (const line of String(text || "").split(/\r?\n/)) {
      const index = line.indexOf(":");
      if (index <= 0) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    return headers;
  }

  async function sha256Text(text) {
    if (!crypto?.subtle || typeof TextEncoder === "undefined") return "";
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function extractFrameworkVersion(code, sha256) {
    const match = String(code || "").match(/\bconst\s+version\s*=\s*["']([^"']+)["']/);
    return match?.[1] || (sha256 ? `sha256:${sha256.slice(0, 12)}` : "unknown");
  }

  function readCache() {
    const meta = readJson(keys.meta, null);
    const code = gmGet(keys.code, "") || localStorageGet(keys.code, "");
    if (meta && code) state.cacheBackend = "cache";
    return {
      meta,
      code: typeof code === "string" ? code : ""
    };
  }

  function readLocalStorageCache() {
    const meta = readLocalStorageJson(keys.meta, null);
    const code = localStorageGet(keys.code, "");
    if (meta && code) state.cacheBackend = "localStorage";
    return {
      meta,
      code: typeof code === "string" ? code : ""
    };
  }

  function writeCache(meta, code) {
    const metaText = JSON.stringify(meta);
    gmSet(keys.meta, metaText);
    gmSet(keys.code, String(code || ""));
    localStorageSet(keys.meta, metaText);
    localStorageSet(keys.code, String(code || ""));
    state.cacheBackend = "gm+localStorage";
  }

  function clearCache() {
    gmDelete(keys.meta);
    gmDelete(keys.code);
    localStorageDelete(keys.meta);
    localStorageDelete(keys.code);
    state.cacheBackend = "";
  }

  function readJson(key, fallback) {
    const text = gmGet(key, "") || localStorageGet(key, "");
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function readLocalStorageJson(key, fallback) {
    const text = localStorageGet(key, "");
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
    } catch (error) {
      console.warn("[sgs-xc-downloader] GM_getValue failed", error);
    }
    return fallback;
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch (error) {
      console.warn("[sgs-xc-downloader] GM_setValue failed", error);
    }
  }

  function gmDelete(key) {
    try {
      if (typeof GM_deleteValue === "function") GM_deleteValue(key);
    } catch (error) {
      console.warn("[sgs-xc-downloader] GM_deleteValue failed", error);
    }
  }

  function localStorageGet(key, fallback) {
    try {
      return pageWindow.localStorage?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function localStorageSet(key, value) {
    try {
      pageWindow.localStorage?.setItem(key, String(value ?? ""));
    } catch (error) {
      console.warn("[sgs-xc-downloader] localStorage set failed", error);
    }
  }

  function localStorageDelete(key) {
    try {
      pageWindow.localStorage?.removeItem(key);
    } catch (error) {
      console.warn("[sgs-xc-downloader] localStorage remove failed", error);
    }
  }

  function injectFramework(code, meta) {
    state.phase = "injecting";
    state.loadedMeta = meta;
    pageWindow.__SGS_XC_DOWNLOADER_META__ = {
      ...meta,
      injectedAt: new Date().toISOString()
    };
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.textContent = [
      `window.__SGS_XC_DOWNLOADER_META__ = ${JSON.stringify(pageWindow.__SGS_XC_DOWNLOADER_META__)};`,
      String(code || ""),
      `//# sourceURL=${config.sourceUrlPrefix}://${encodeURIComponent(meta.version || "unknown")}/core.mjs`
    ].join("\n");
    const host = document.head || document.documentElement || document.body;
    if (!host) throw new Error("Cannot inject framework before document root exists.");
    host.appendChild(script);
    script.remove();
  }

  function finish(reason) {
    state.phase = "ready";
    state.finishedAt = Date.now();
    releaseLayaBarrier(reason);
  }

  function releaseLayaBarrier(reason) {
    try {
      layaBarrier?.release?.(reason);
    } catch (error) {
      console.warn("[sgs-xc-downloader] release barrier failed", error);
    }
  }

  function installLayaBarrier(win) {
    const key = "__SGS_XC_LAYA_BARRIER__";
    if (win[key]?.release) return win[key];
    const barrierState = {
      released: false,
      releaseReason: "",
      installedAt: Date.now(),
      queuedInitCalls: [],
      initPatchCount: 0,
      lastError: ""
    };
    let layaValue = win.Laya;

    function patchLaya(value) {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
      patchMethod(value, "init", "Laya.init");
      patchMethod(value.ILaya, "init", "Laya.ILaya.init");
      return value;
    }

    function patchMethod(owner, methodName, label) {
      if (!owner || typeof owner[methodName] !== "function") return;
      const original = owner[methodName];
      if (original.__sgsXcDownloaderWrapped) return;
      const wrapped = function sgsXcDownloaderLayaInitBarrier(...args) {
        if (barrierState.released) return original.apply(this, args);
        barrierState.queuedInitCalls.push({ label, owner: this, original, args });
        console.warn(`[sgs-xc-downloader] Deferred ${label} until downloader is ready.`);
        return undefined;
      };
      Object.defineProperty(wrapped, "__sgsXcDownloaderWrapped", { value: true });
      try {
        owner[methodName] = wrapped;
        barrierState.initPatchCount++;
      } catch (error) {
        barrierState.lastError = String(error?.message || error);
      }
    }

    function release(reason) {
      if (barrierState.released) return;
      barrierState.released = true;
      barrierState.releaseReason = String(reason || "released");
      const queued = barrierState.queuedInitCalls.splice(0);
      for (const item of queued) {
        try {
          item.original.apply(item.owner, item.args);
        } catch (error) {
          barrierState.lastError = String(error?.stack || error?.message || error);
          console.error(`[sgs-xc-downloader] Deferred ${item.label} failed`, error);
        }
      }
    }

    try {
      Object.defineProperty(win, "Laya", {
        configurable: true,
        enumerable: true,
        get() {
          return layaValue;
        },
        set(value) {
          layaValue = patchLaya(value);
        }
      });
      if (layaValue) layaValue = patchLaya(layaValue);
    } catch (error) {
      barrierState.lastError = String(error?.message || error);
    }

    win[key] = {
      release,
      status() {
        return {
          released: barrierState.released,
          releaseReason: barrierState.releaseReason,
          initPatchCount: barrierState.initPatchCount,
          queuedInitCalls: barrierState.queuedInitCalls.length,
          lastError: barrierState.lastError,
          ageMs: Date.now() - barrierState.installedAt
        };
      }
    };
    return win[key];
  }

  function publishDownloaderApi() {
    const api = {
      version: "0.1.2",
      config: { ...config },
      status() {
        return {
          ...state,
          ageMs: Date.now() - state.startedAt,
          layaBarrier: layaBarrier?.status?.() || null
        };
      },
      clearCache
    };
    try {
      Object.defineProperty(pageWindow, "__SgsXcDownloader", {
        configurable: true,
        value: api
      });
    } catch {
      pageWindow.__SgsXcDownloader = api;
    }
  }

  function showFailureMessageBox(errorText, cachedMeta) {
    return new Promise((resolve) => {
      const render = () => {
        const host = document.body || document.documentElement;
        if (!host) {
          setTimeout(render, 16);
          return;
        }
        const hasCache = !!cachedMeta;
        const overlay = document.createElement("div");
        overlay.id = "sgs-xc-downloader-messagebox";
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);font-family:Arial,'Microsoft YaHei',sans-serif;color:#f6ead0;pointer-events:auto";
        const box = document.createElement("div");
        box.style.cssText = "width:min(560px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #8d6a35;background:#20170f;box-shadow:0 16px 54px rgba(0,0,0,.46);padding:22px;line-height:1.55";
        const title = document.createElement("div");
        title.textContent = "SGS Framework 下载失败";
        title.style.cssText = "font-size:20px;font-weight:700;margin-bottom:12px;color:#ffd990";
        const body = document.createElement("div");
        body.style.cssText = "font-size:14px;white-space:pre-wrap;margin-bottom:16px;color:#f6ead0";
        body.textContent = [
          "5 秒内没有完成 Framework 下载请求。",
          hasCache ? `继续游戏将使用已缓存版本：${cachedMeta.version || cachedMeta.sha256 || "unknown"}` : "继续游戏将不加载 Framework。",
          "",
          "错误信息：",
          String(errorText || "unknown error").slice(0, 1000)
        ].join("\n");
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
        const continueButton = createDialogButton("继续游戏", "#7a5525");
        const reloadButton = createDialogButton("刷新重试", "#9b3030");
        continueButton.addEventListener("click", () => {
          overlay.remove();
          resolve("continue");
        });
        reloadButton.addEventListener("click", () => {
          overlay.remove();
          resolve("reload");
        });
        buttons.append(continueButton, reloadButton);
        box.append(title, body, buttons);
        overlay.appendChild(box);
        host.appendChild(overlay);
      };
      render();
    });
  }

  function createDialogButton(text, background) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.style.cssText = `min-width:104px;height:34px;border:1px solid #d8b36a;background:${background};color:#fff3d2;font-size:14px;font-weight:700;cursor:pointer`;
    return button;
  }
})();
