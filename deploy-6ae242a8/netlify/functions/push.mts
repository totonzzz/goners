import type { Config, Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { pushSubscriptions } from "../../db/schema.js";
import { SHEET_URL_RE, fetchSheet, getVapidKeys, notifIds, sendPush } from "../../lib/push.js";

const bad = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });

export default async (req: Request, context: Context) => {
  const action = context.params.action;

  if (action === "key" && req.method === "GET") {
    const k = await getVapidKeys();
    return Response.json({ ok: true, publicKey: k.publicKey });
  }
  if (req.method !== "POST") return bad("Metode tidak didukung", 405);
  const body = await req.json().catch(() => null);
  if (!body) return bad("Permintaan tidak valid");

  if (action === "subscribe") {
    const { subscription: s, url, token } = body;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint)) return bad("Langganan tidak valid");
    if (typeof url !== "string" || !SHEET_URL_RE.test(url) || typeof token !== "string" || !token) return bad("Koneksi tidak valid");

    let data;
    try { data = await fetchSheet(url, token); } catch { return bad("Google Sheets tidak bisa dihubungi", 502); }
    if (!data.ok) return bad(data.auth ? "Kode rahasia ditolak" : "Google Sheets menolak permintaan", 403);

    // Catatan yang sudah ada tidak dinotifikasi ulang.
    const values = { p256dh: s.keys.p256dh, auth: s.keys.auth, sheetUrl: url, token, seenIds: notifIds(data.recent), lastCheckedAt: new Date() };
    await db.insert(pushSubscriptions).values({ endpoint: s.endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });

    await sendPush({ endpoint: s.endpoint, ...values }, {
      title: "Notifikasi aktif",
      body: "Kamu akan diberi tahu setiap ada catatan otomatis baru dari notifikasi bank.",
      tag: "push-on",
    });
    return Response.json({ ok: true });
  }

  if (action === "unsubscribe") {
    if (typeof body.endpoint !== "string") return bad("Langganan tidak valid");
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint));
    return Response.json({ ok: true });
  }

  return bad("Tidak ditemukan", 404);
};

export const config: Config = { path: "/api/push/:action" };
