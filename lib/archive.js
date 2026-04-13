import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { google } from "googleapis";
import { getAuthedOAuthClient, isOAuthConfigured } from "@/lib/driveOAuth";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function readEnvLocalServiceAccountFallback() {
  // Fallback: support a multi-line JSON block inside `.env.local` like:
  // DRIVE_SERVICE_ACCOUNT_JSON={
  //   ...
  // }
  // Next/dotenv may not load this as a single env var.
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
    const jsonStr = rest.slice(0, endRel + 2); // include "\n}"

    const parsed = safeJsonParse(jsonStr);
    if (parsed && parsed.client_email && parsed.private_key) return parsed;
    return null;
  } catch {
    return null;
  }
}

function normalizeDriveFolderId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // allow user to paste a full Drive folder URL
  // ex: https://drive.google.com/drive/folders/<ID>?hl=ko
  const m = s.match(/drive\.google\.com\/drive\/folders\/([^?/#]+)/i);
  if (m?.[1]) return m[1];
  return s;
}

function nowIso() {
  return new Date().toISOString();
}

function extFromMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  return "png";
}

function archiveRoot() {
  return path.join(process.cwd(), "data", "archive");
}

function recordsDir() {
  return path.join(archiveRoot(), "records");
}

function imagesDir() {
  return path.join(archiveRoot(), "images");
}

function groupsPath() {
  return path.join(archiveRoot(), "groups.json");
}

function makeId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${ts}-${rand}`;
}

function shortHash(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 8);
}

function extractParenHint(s) {
  const m = String(s || "").match(/\(([^)]+)\)/);
  return m?.[1] ? m[1] : "";
}

function slugify(raw, prefix) {
  const base = extractParenHint(raw) || String(raw || "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (slug) return slug.slice(0, 48);
  return `${prefix}-${shortHash(raw)}`;
}

function groupKeyFromInputs(inputs) {
  const emotion = String(inputs?.emotion || "").trim();
  const material = inputs?.material || "";
  const finish = inputs?.finish || "";
  // New mode: ceramic is fixed; group by emotion when provided
  if (emotion) return `emo__${slugify(emotion, "emo")}`;
  // Legacy mode: group by material+finish
  return `${slugify(material, "mat")}__${slugify(finish, "fin")}`;
}

function groupLabelFromInputs(inputs) {
  const emotion = String(inputs?.emotion || "").trim();
  const material = String(inputs?.material || "").trim();
  const finish = String(inputs?.finish || "").trim();
  if (emotion) return emotion;
  if (!material && !finish) return "unknown";
  if (!finish) return material;
  if (!material) return finish;
  return `${material} · ${finish}`;
}

function nextGroupSeq(groupKey) {
  initArchiveDirs();
  const p = groupsPath();
  const json = fs.existsSync(p) ? safeJsonParse(fs.readFileSync(p, "utf8")) : null;
  const map = json && typeof json === "object" ? json : {};
  const prev = Number(map[groupKey] || 0) || 0;
  const next = prev + 1;
  map[groupKey] = next;
  fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
  return next;
}

function readServiceAccountFromEnv() {
  const raw = (
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON ||
    process.env.DRIVE_SERVICE_ACCOUNT_JSON ||
    ""
  ).trim();
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (parsed && parsed.client_email && parsed.private_key) return parsed;

  // allow passing a file path for convenience in local dev
  const maybePath = raw;
  if (fs.existsSync(maybePath)) {
    const txt = fs.readFileSync(maybePath, "utf8");
    const p2 = safeJsonParse(txt);
    if (p2 && p2.client_email && p2.private_key) return p2;
  }

  // fallback: try to read a multi-line JSON block from `.env.local`
  const p3 = readEnvLocalServiceAccountFallback();
  if (p3) return p3;
  return null;
}

async function tryUploadToDrive({ filePath, mimeType, filename }) {
  const enabled = (process.env.ENABLE_GDRIVE_ARCHIVE || "").trim() === "1";
  if (!enabled) return null;

  const folderId = normalizeDriveFolderId(process.env.GDRIVE_FOLDER_ID || "");
  if (!folderId) {
    throw new Error("GDRIVE_FOLDER_ID is missing (or invalid).");
  }

  // Prefer OAuth upload (works with My Drive).
  const oauthClient = getAuthedOAuthClient();
  if (oauthClient) {
    const drive = google.drive({ version: "v3", auth: oauthClient });
    const res = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body: fs.createReadStream(filePath) },
      fields: "id,webViewLink,webContentLink",
    });
    return {
      fileId: res.data.id || "",
      webViewLink: res.data.webViewLink || "",
      webContentLink: res.data.webContentLink || "",
    };
  }

  // Fallback: service account upload (works best with Shared drives; My Drive may fail).
  const sa = readServiceAccountFromEnv();
  if (!sa) {
    if (isOAuthConfigured()) {
      throw new Error(
        "Google Drive OAuth is configured but not authorized yet. Open /api/drive/oauth-url to connect.",
      );
    }
    throw new Error(
      "Drive is not authorized. For My Drive uploads, configure OAuth (GOOGLE_OAUTH_CLIENT_ID/SECRET) and connect. Service accounts cannot upload to My Drive due to quota limitations.",
    );
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: (sa.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: "id,webViewLink,webContentLink",
  });

  return {
    fileId: res.data.id || "",
    webViewLink: res.data.webViewLink || "",
    webContentLink: res.data.webContentLink || "",
  };
}

function humanizeDriveError(err) {
  const msg = String(err?.message || err || "").trim();
  if (!msg) return "Drive upload failed";
  const lower = msg.toLowerCase();
  if (lower.includes("service accounts do not have storage quota")) {
    return [
      "서비스 계정(Service Account)은 개인 Google Drive(My Drive)에 저장 용량(quota)이 없어 업로드가 거부되었습니다.",
      "해결:",
      "- (권장) 공유 드라이브(Shared drive)를 만들고, 그 안에 폴더를 옮긴 뒤 서비스 계정을 멤버(Contributor 이상)로 추가하세요.",
      "- Google Workspace(회사/학교)라면 Domain-wide delegation + 사용자 위임(subject)으로 업로드를 실행해야 합니다.",
    ].join("\n");
  }
  if (lower.includes("file not found")) {
    return [
      msg,
      "대부분 권한 문제입니다. 해당 폴더를 서비스 계정 이메일에 '편집자'로 공유했는지 확인하세요.",
    ].join("\n");
  }
  return msg;
}

export function initArchiveDirs() {
  ensureDir(recordsDir());
  ensureDir(imagesDir());
}

export function getArchiveRecordPath(id) {
  return path.join(recordsDir(), `${id}.json`);
}

export function getArchiveImagePath(id, ext) {
  return path.join(imagesDir(), `${id}.${ext}`);
}

export function getArchiveImagePathByFile(imageFile) {
  return path.join(imagesDir(), imageFile);
}

export function listArchives({ limit = 200 } = {}) {
  initArchiveDirs();
  const files = fs.readdirSync(recordsDir()).filter((f) => f.endsWith(".json"));
  const records = files
    .map((f) => {
      const full = path.join(recordsDir(), f);
      const txt = fs.readFileSync(full, "utf8");
      const json = safeJsonParse(txt);
      return json || null;
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return records.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name || r.imageFile || r.id,
    groupKey: r.groupKey || "",
    groupSeq: r.groupSeq || null,
    groupLabel: r.groupLabel || "",
    createdAt: r.createdAt,
    inputs: r.inputs || null,
    promptKo: r.promptKo,
    promptEn: r.promptEn,
    promptCmf: r.promptCmf,
    imageMimeType: r.imageMimeType,
    imageUrl: `/api/archive/image/${r.id}`,
    drive: r.drive || null,
    driveError: r.driveError || null,
  }));
}

export function getArchive(id) {
  initArchiveDirs();
  const p = getArchiveRecordPath(id);
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, "utf8");
  return safeJsonParse(txt);
}

export async function saveArchive({
  imageBase64,
  mimeType,
  promptKo,
  promptEn,
  promptCmf,
  generation,
  inputs,
}) {
  initArchiveDirs();
  const id = makeId();
  const ext = extFromMime(mimeType);
  const groupKey = groupKeyFromInputs(inputs);
  const groupSeq = nextGroupSeq(groupKey);
  const groupLabel = groupLabelFromInputs(inputs);
  const seqStr = String(groupSeq).padStart(4, "0");
  const filenameBase = `${groupKey}__${seqStr}`;
  const filename = `${filenameBase}.${ext}`;

  const imgPath = getArchiveImagePathByFile(filename);
  fs.writeFileSync(imgPath, Buffer.from(imageBase64, "base64"));

  const record = {
    id,
    createdAt: nowIso(),
    name: filenameBase,
    groupKey,
    groupSeq,
    groupLabel,
    imageMimeType: mimeType,
    imageExt: ext,
    imageFile: filename,
    inputs: inputs || null,
    promptKo,
    promptEn,
    promptCmf,
    generation: generation || null,
    drive: null,
    driveError: null,
  };

  // Optional: upload to Google Drive using service account
  try {
    const driveInfo = await tryUploadToDrive({ filePath: imgPath, mimeType, filename });
    if (driveInfo) record.drive = driveInfo;
  } catch (e) {
    record.driveError = humanizeDriveError(e);
    // local archive still works; keep going
    console.warn("[archive] Drive upload skipped/failed:", record.driveError);
  }

  fs.writeFileSync(getArchiveRecordPath(id), JSON.stringify(record, null, 2), "utf8");

  return {
    id,
    name: record.name,
    groupKey: record.groupKey,
    groupSeq: record.groupSeq,
    imageUrl: `/api/archive/image/${id}`,
    drive: record.drive,
    driveError: record.driveError,
  };
}

