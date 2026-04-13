export const config = {
  api: {
    bodyParser: {
      // data URL(base64) 전달을 허용 (4K는 매우 커질 수 있음)
      sizeLimit: "25mb",
    },
  },
};

const MESHY_ENDPOINT = "https://api.meshy.ai/openapi/v1/image-to-3d";

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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

  const { imageDataUrl, enablePbr = false, shouldRemesh = true, shouldTexture = false, targetFormats } =
    req.body || {};

  const image_url = (imageDataUrl || "").toString().trim();
  if (!image_url) return res.status(400).json({ error: "imageDataUrl이 필요합니다." });
  if (!image_url.startsWith("data:image/")) {
    return res.status(400).json({ error: "imageDataUrl은 data:image/... 형태여야 합니다." });
  }

  const body = {
    image_url,
    enable_pbr: !!enablePbr,
    should_remesh: !!shouldRemesh,
    should_texture: !!shouldTexture,
    save_pre_remeshed_model: true,
  };

  // Docs: `target_formats` string[]
  if (Array.isArray(targetFormats) && targetFormats.length) {
    body.target_formats = targetFormats;
  } else {
    body.target_formats = ["stl"];
  }

  const upstream = await fetch(MESHY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const upstreamMsg = pickMessage(payload);
    return res.status(upstream.status).json({
      error:
        meshyAuthHint(upstreamMsg) ||
        upstreamMsg ||
        `Meshy 요청 실패 (HTTP ${upstream.status})`,
      details: payload || null,
    });
  }

  const taskId = payload?.result || payload?.id || "";
  if (!taskId) {
    return res.status(502).json({ error: "Meshy task id를 받지 못했습니다.", details: payload || null });
  }

  return res.status(200).json({ taskId });
}

