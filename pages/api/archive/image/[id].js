import fs from "node:fs";
import { getArchive, getArchiveImagePathByFile } from "@/lib/archive";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  const id = (req.query?.id || "").toString().trim();
  if (!id) return res.status(400).end("Bad Request");

  const record = getArchive(id);
  if (!record) return res.status(404).end("Not Found");

  const p = getArchiveImagePathByFile(record.imageFile || `${id}.${record.imageExt || "png"}`);
  if (!fs.existsSync(p)) return res.status(404).end("Not Found");

  const buf = fs.readFileSync(p);
  res.setHeader("Content-Type", record.imageMimeType || "image/png");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buf);
}

