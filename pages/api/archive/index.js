import { listArchives, getArchive } from "@/lib/archive";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const id = (req.query?.id || "").toString().trim();
  if (id) {
    const record = getArchive(id);
    if (!record) return res.status(404).json({ error: "Not Found" });
    return res.status(200).json(record);
  }

  const limitRaw = (req.query?.limit || "").toString().trim();
  const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw) || 200)) : 200;
  const items = listArchives({ limit });
  return res.status(200).json({ items });
}

