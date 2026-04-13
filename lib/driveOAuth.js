import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function tokenDir() {
  return path.join(process.cwd(), "data", "drive");
}

function tokenPath() {
  return path.join(tokenDir(), "oauth-token.json");
}

export function getOAuthConfig() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  const effectiveRedirectUri =
    redirectUri || "http://localhost:3000/api/drive/oauth-callback";
  return { clientId, clientSecret, redirectUri: effectiveRedirectUri };
}

export function isOAuthConfigured() {
  const cfg = getOAuthConfig();
  return !!(cfg.clientId && cfg.clientSecret);
}

export function loadOAuthToken() {
  try {
    const p = tokenPath();
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, "utf8");
    const json = JSON.parse(txt);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

export function saveOAuthToken(token) {
  ensureDir(tokenDir());
  fs.writeFileSync(tokenPath(), JSON.stringify(token, null, 2), "utf8");
}

export function createOAuthClient() {
  const cfg = getOAuthConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

export function getOAuthAuthUrl() {
  const client = createOAuthClient();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });
}

export async function exchangeCodeForToken(code) {
  const client = createOAuthClient();
  if (!client) throw new Error("OAuth client not configured");
  const { tokens } = await client.getToken(code);
  if (!tokens) throw new Error("No OAuth tokens returned");
  saveOAuthToken(tokens);
  return tokens;
}

export function getAuthedOAuthClient() {
  const client = createOAuthClient();
  if (!client) return null;
  const token = loadOAuthToken();
  if (!token) return null;
  client.setCredentials(token);
  // Persist refreshed access tokens when googleapis refreshes them
  client.on("tokens", (t) => {
    if (!t) return;
    const current = loadOAuthToken() || {};
    const merged = { ...current, ...t };
    saveOAuthToken(merged);
  });
  return client;
}

