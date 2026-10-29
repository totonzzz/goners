import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pushSubscriptions } from "../../db/schema.js";
import { checkSubscription } from "../../lib/push.js";

// Setiap 5 menit: cek catatan otomatis baru di Google Sheets setiap pelanggan, lalu kirim push.
export default async () => {
  const subs = await db.select().from(pushSubscriptions);
  const results = await Promise.allSettled(subs.map((s) => checkSubscription(s)));
  results.forEach((r, i) => { if (r.status === "rejected") console.error("push-check gagal untuk langganan", subs[i].id, r.reason?.message || r.reason); });
};

export const config: Config = { schedule: "*/5 * * * *" };
