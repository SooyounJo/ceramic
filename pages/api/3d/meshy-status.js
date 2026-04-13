const MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

function pickMessage(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  return payload?.message || payload?.error?.message || payload?.error || null;
}

function looksLikeJwt(token) {
  const t = String(token || "").trim();
  if (!t) return false;
  if (!t.startsWith("eyJ")) return false;
  return t.split(".").length === 3;
}

function meshyAuthHint(msg) {
  const m = String(msg || "");
  if (!m) return null;
  const lower = m.toLowerCase();
  if (lower.includes("token is expired") || lower.includes("expired")) {
    return "Meshy 인증 토큰이 만료(exp)된 것으로 보입니다. Meshy 웹페이지에서 복사한 JWT(eyJ...)가 아니라, Meshy 대시보드에서 발급한 API Key를 `.env.local`의 MESHY_API_KEY에 넣어주세요.";
  }
  if (lower.includes("auth0")) {
    return "Auth0 인증 오류입니다. Meshy 웹 세션 토큰(JWT)을 넣은 경우에 흔히 발생합니다. Meshy 대시보드의 API Key를 `.env.local`의 MESHY_API_KEY로 사용해 주세요.";
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "Meshy 인증 실패입니다. `.env.local`의 MESHY_API_KEY 값이 올바른지(대시보드에서 발급한 API Key인지) 확인해 주세요.";
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = (process.env.MESHY_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(400).json({
      error: "MESHY_API_KEY가 없습니다. `.env.local`에 MESHY_API_KEY를 설정해 주세요.",
    });
  }
  if (looksLikeJwt(apiKey)) {
    return res.status(400).json({
      error:
        "MESHY_API_KEY에 JWT(eyJ...)가 들어가 있습니다. 이 토큰은 만료될 수 있어요. Meshy 대시보드에서 발급한 'API Key' 값을 MESHY_API_KEY에 넣어주세요.",
    });
  }

  const id = (req.query?.id || "").toString().trim();
  if (!id) return res.status(400).json({ error: "id가 필요합니다." });

  const upstream = await fetch(`${MESHY_BASE}/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const upstreamMsg = pickMessage(payload);
    return res.status(upstream.status).json({
      error:
        meshyAuthHint(upstreamMsg) || upstreamMsg || `Meshy 조회 실패 (HTTP ${upstream.status})`,
      details: payload || null,
    });
  }

  return res.status(200).json({
    id: payload?.id || id,
    status: payload?.status || "UNKNOWN",
    progress: payload?.progress ?? null,
    thumbnailUrl: payload?.thumbnail_url || payload?.thumbnailUrl || "",
    modelUrls: payload?.model_urls || payload?.modelUrls || null,
    textureUrls: payload?.texture_urls || payload?.textureUrls || null,
    taskError: payload?.task_error || payload?.taskError || null,
  });
}

