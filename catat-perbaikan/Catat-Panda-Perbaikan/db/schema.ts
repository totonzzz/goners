import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Satu baris per HP/browser yang menyalakan notifikasi.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial().primaryKey(),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  sheetUrl: text("sheet_url").notNull(),
  token: text().notNull(),
  seenIds: jsonb("seen_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastCheckedAt: timestamp("last_checked_at"),
});

// Kunci VAPID untuk Web Push, dibuat otomatis saat pertama dipakai.
export const appKeys = pgTable("app_keys", {
  id: text().primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
});
