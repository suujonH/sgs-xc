import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CREDENTIALS_RELATIVE_PATH = path.join("config", "game-record-user.json");

export function credentialsPath(rootDir) {
  return path.join(rootDir, DEFAULT_CREDENTIALS_RELATIVE_PATH);
}

export function userCreateUrl(uploadUrl) {
  if (!uploadUrl) return "";
  return new URL("/api/user/create", uploadUrl).toString();
}

export function uploadApiBase(uploadUrl) {
  if (!uploadUrl) return "";
  try {
    return new URL(uploadUrl).origin;
  } catch {
    return "";
  }
}

export async function ensureUserCredentials(options = {}) {
  const uploadUrl = String(options.uploadUrl || "");
  const rootDir = options.rootDir || process.cwd();
  const filePath = options.filePath || credentialsPath(rootDir);
  const explicitUserId = cleanText(options.userId);
  const explicitPassword = cleanText(options.password);
  if (explicitUserId && explicitPassword) {
    return { userId: explicitUserId, password: explicitPassword, source: "env", filePath: "" };
  }

  const existing = await readCredentialsFile(filePath);
  const apiBase = uploadApiBase(uploadUrl);
  if (existing?.userId && existing?.password && (!apiBase || !existing.apiBase || existing.apiBase === apiBase)) {
    return { ...existing, source: "file", filePath };
  }

  if (!uploadUrl) {
    return {
      userId: explicitUserId || existing?.userId || "local",
      password: explicitPassword || existing?.password || "",
      source: existing ? "file" : "local",
      filePath: existing ? filePath : ""
    };
  }

  const created = await createUserCredentials({
    uploadUrl,
    fetchImpl: options.fetchImpl
  });
  const saved = {
    userId: created.userId,
    password: created.password,
    apiBase,
    createdAt: created.createdAt || new Date().toISOString()
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  return { ...saved, source: "server", filePath };
}

export async function createUserCredentials(options = {}) {
  const url = userCreateUrl(options.uploadUrl || "");
  if (!url) throw new Error("uploadUrl is required to create user credentials");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: "{}"
  });
  const text = await response.text();
  const parsed = parseJson(text);
  if (!response.ok) {
    throw new Error(`failed to create user credentials: ${response.status} ${text}`);
  }
  if (!parsed?.userId || !parsed?.password) {
    throw new Error("user credential response is missing userId/password");
  }
  return {
    userId: String(parsed.userId),
    password: String(parsed.password),
    createdAt: parsed.createdAt || ""
  };
}

async function readCredentialsFile(filePath) {
  const text = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim()) return null;
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    userId: cleanText(parsed.userId),
    password: cleanText(parsed.password),
    apiBase: cleanText(parsed.apiBase),
    createdAt: cleanText(parsed.createdAt)
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
