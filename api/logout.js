import { clearSessionCookie, rejectCrossOrigin } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rejectCrossOrigin(req, res)) return;
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
