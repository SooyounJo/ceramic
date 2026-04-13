import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeDriveFolderId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/drive\.google\.com\/drive\/folders\/([^?/#]+)/i);
  if (m?.[1]) return m[1];
  return s;
}

function readEnvLocalServiceAccountFallback() {
  try {
    const p = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, "utf8");

    const key1 = "DRIVE_SERVICE_ACCOUNT_JSON=";
    const key2 = "GDRIVE_SERVICE_ACCOUNT_JSON=";
    let idx = txt.indexOf(key1);
    let keyLen = key1.length;
    if (idx < 0) {
      idx = txt.indexOf(key2);
      keyLen = key2.length;
    }
    if (idx < 0) return null;

    const after = txt.slice(idx + keyLen);
    const braceStart = after.indexOf("{");
    if (braceStart < 0) return null;

    const startAbs = idx + keyLen + braceStart;
    const rest = txt.slice(startAbs);
    const endRel = rest.indexOf("\n}");
    if (endRel < 0) return null;
    const jsonStr = rest.slice(0, endRel + 2);

    const parsed = safeJsonParse(jsonStr);
    if (parsed && parsed.client_email && parsed.private_key) return parsed;
    return null;
  } catch {
    return null;
  }
}

function readServiceAccount() {
  const raw = (
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON ||
    process.env.DRIVE_SERVICE_ACCOUNT_JSON ||
    ""
  ).trim();

  const parsedInline = safeJsonParse(raw);
  if (parsedInline?.client_email && parsedInline?.private_key) return parsedInline;

  if (raw && fs.existsSync(raw)) {
    const txt = fs.readFileSync(raw, "utf8");
    const parsedFile = safeJsonParse(txt);
    if (parsedFile?.client_email && parsedFile?.private_key) return parsedFile;
  }

  return readEnvLocalServiceAccountFallback();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const enabled = (process.env.ENABLE_GDRIVE_ARCHIVE || "").trim() === "1";
  const folderId = normalizeDriveFolderId(process.env.GDRIVE_FOLDER_ID || "");
  const sa = readServiceAccount();

  if (!enabled) {
    return res.status(200).json({ ok: false, enabled, folderId, error: "ENABLE_GDRIVE_ARCHIVE is not 1" });
  }
  if (!folderId) {
    return res.status(200).json({ ok: false, enabled, folderId, error: "GDRIVE_FOLDER_ID is missing" });
  }
  if (!sa) {
    return res.status(200).json({
      ok: false,
      enabled,
      folderId,
      error: "Drive service account JSON missing/invalid",
    });
  }

  try {
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: (sa.private_key || "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });

    const meta = await drive.files.get({
      fileId: folderId,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed,driveId,capabilities",
    });

    return res.status(200).json({
      ok: true,
      enabled,
      folderId,
      serviceAccountEmail: sa.client_email,
      folder: meta.data,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      enabled,
      folderId,
      serviceAccountEmail: sa.client_email,
      error: e?.message || String(e),
    });
  }
}

