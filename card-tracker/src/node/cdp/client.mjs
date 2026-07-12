import WebSocket from "ws";

export const defaultCdpBase = process.env.SGS_CDP || process.env.DEV_BROWSER_TOOLS_CDP || "http://127.0.0.1:9222";

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${body}`);
  }
  return response.json();
}

export class CdpSession {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.webSocketUrl);
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
      this.ws.on("message", (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result || {});
      });
      this.ws.on("close", () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("CDP socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP socket is not open"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

export async function listTargets(cdpBase = defaultCdpBase) {
  const targets = await fetchJson(`${cdpBase}/json/list`);
  return targets.filter((target) => target.type === "page");
}

export async function selectSgsTarget(cdpBase = defaultCdpBase, targetId = process.env.SGS_TARGET_ID) {
  const targets = await listTargets(cdpBase);
  if (targetId) {
    const target = targets.find((item) => item.id === targetId);
    if (!target) throw new Error(`Target was not found: ${targetId}`);
    return target;
  }
  const target = targets.find((item) => /web\.sanguosha\.com/.test(item.url || ""));
  if (!target) {
    throw new Error("No web.sanguosha.com Chrome page target was found.");
  }
  return target;
}

export function valueFromEvaluation(evaluated) {
  if (evaluated.exceptionDetails) {
    const details = evaluated.exceptionDetails;
    const exception = details.exception || {};
    const location = [
      Number.isInteger(details.lineNumber) ? `line ${details.lineNumber + 1}` : "",
      Number.isInteger(details.columnNumber) ? `column ${details.columnNumber + 1}` : ""
    ].filter(Boolean).join(", ");
    const description = exception.description || exception.value || details.text || JSON.stringify(details);
    throw new Error([details.text || "Runtime.evaluate exception", location, description].filter(Boolean).join(": "));
  }
  if (evaluated.result && "value" in evaluated.result) return evaluated.result.value;
  return evaluated.result?.description ?? null;
}

export async function evaluateOnSgs(expression, options = {}) {
  const cdpBase = options.cdpBase || defaultCdpBase;
  const target = await selectSgsTarget(cdpBase, options.targetId);
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    await session.send("Runtime.enable");
    const evaluated = await session.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: options.returnByValue !== false,
        awaitPromise: options.awaitPromise !== false,
        timeout: options.timeoutMs || 30000
      },
      options.cdpTimeoutMs || 45000
    );
    return { target, value: valueFromEvaluation(evaluated) };
  } finally {
    session.close();
  }
}
