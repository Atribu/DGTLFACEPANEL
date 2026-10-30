import type { Queryable } from "./db";

/** Lifecycle receipts survive deletion without retaining the hotel's work data. */
export async function migrateHotelSchema(tx: Queryable) {
  await tx.query(`CREATE TABLE IF NOT EXISTS hotel_events (
    id text PRIMARY KEY,
    actor_id text NOT NULL REFERENCES app_users(id),
    hotel_id text NOT NULL,
    data jsonb NOT NULL
  )`);
  await tx.query(
    "CREATE INDEX IF NOT EXISTS hotel_events_created_idx ON hotel_events ((data->>'createdAt') DESC,id DESC)",
  );
}
