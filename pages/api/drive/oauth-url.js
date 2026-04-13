import { getOAuthAuthUrl, isOAuthConfigured } from "@/lib/driveOAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!isOAuthConfigured()) {
    return res.status(400).json({
      error:
        "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local.",
    });
  }
  const url = getOAuthAuthUrl();
  if (!url) return res.status(500).json({ error: "Failed to create auth URL" });
  return res.status(200).json({ url });
}

