import { isOAuthConfigured, loadOAuthToken } from "@/lib/driveOAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const configured = isOAuthConfigured();
  const token = loadOAuthToken();
  return res.status(200).json({
    configured,
    authorized: !!token,
    hasRefreshToken: !!token?.refresh_token,
  });
}

