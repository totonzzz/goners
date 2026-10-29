import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appKeys, pushSubscriptions } from "../db/schema.js";

export const SHEET_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/)?macros\/s\/[^/]+\/exec$/;
const SEEN_LIMIT = 500;

type Sub = typeof pushSubscriptions.$inferSelect;
type Tx = { id: string; src?: string; desc?: string; amount?: number; tipe?: string; emoji?: string; loan?: boolean };

export async function getVapidKeys() {
  const [row] = await db.select().from(appKeys).where(eq(appKeys.id, "vapid"));
  if (row) return row;
  const k = webpush.generateVAPIDKeys();
  await db.insert(appKeys).values({ id: "vapid", publicKey: k.publicKey, privateKey: k.privateKey }).onConflictDoNothing();
  const [saved] = await db.select().from(appKeys).where(eq(appKeys.id, "vapid"));
  return saved;
}

async function configure() {
  const k = await getVapidKeys();
  webpush.setVapidDetails("mailto:noreply@catatpanda.app", k.publicKey, k.privateKey);
}

// Mengambil data bulan berjalan dari Web App Google Sheets milik pengguna.
export async function fetchSheet(url: string, token: string): Promise<{ ok: boolean; auth?: boolean; recent: Tx[] }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "data", token, month: "" }),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const d = JSON.parse(await res.text());
  if (!d || d.ok === false) return { ok: false, auth: d?.error === "auth", recent: [] };
  return { ok: true, recent: Array.isArray(d.recent) ? d.recent : [] };
}

export const notifIds = (recent: Tx[]) => recent.filter((t) => t.src === "notif" && t.id).map((t) => String(t.id));

const rp = (n = 0) => "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");

// Mengirim push. Mengembalikan false bila langganan sudah tidak berlaku (lalu dihapus).
export async function sendPush(sub: Pick<Sub, "endpoint" | "p256dh" | "auth">, payload: object) {
  await configure();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 86400 });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
      return false;
    }
    throw e;
  }
}

export async function checkSubscription(sub: Sub) {
  const data = await fetchSheet(sub.sheetUrl, sub.token);
  if (!data.ok) {
    if (data.auth) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    return;
  }
  const seen = new Set(sub.seenIds);
  const fresh = data.recent.filter((t) => t.src === "notif" && t.id && !seen.has(String(t.id)));

  if (fresh.length === 1) {
    const t = fresh[0], inc = t.tipe === "Masuk" && !t.loan;
    await sendPush(sub, {
      title: "Catatan otomatis baru",
      body: `${t.emoji ? t.emoji + " " : ""}${t.desc || "Transaksi"} · ${inc ? "+" : ""}${rp(t.amount)}`,
      tag: "notif-" + t.id,
    });
  } else if (fresh.length > 1) {
    await sendPush(sub, {
      title: `${fresh.length} catatan otomatis baru`,
      body: fresh.slice(0, 3).map((t) => `${t.desc || "Transaksi"} ${rp(t.amount)}`).join(" · "),
      tag: "notif-batch",
    });
  }

  const next = [...sub.seenIds, ...fresh.map((t) => String(t.id))].slice(-SEEN_LIMIT);
  await db.update(pushSubscriptions).set({ seenIds: next, lastCheckedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
}
