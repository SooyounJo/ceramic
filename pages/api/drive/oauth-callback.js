import { exchangeCodeForToken, isOAuthConfigured } from "@/lib/driveOAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }
  if (!isOAuthConfigured()) {
    return res.status(400).send("OAuth not configured in .env.local");
  }
  const code = (req.query?.code || "").toString();
  if (!code) return res.status(400).send("Missing code");

  try {
    await exchangeCodeForToken(code);
  } catch (e) {
    return res
      .status(500)
      .send(`OAuth token exchange failed: ${e?.message || "unknown error"}`);
  }

  // Back to app
  res.setHeader("Location", "/");
  return res.status(302).end();
}

