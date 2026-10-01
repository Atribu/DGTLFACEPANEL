import type { Queryable } from "./db";

/** Additive migration: preserves existing users and makes legacy sessions version 1. */
export async function migrateUserSchema(tx: Queryable) {
  await tx.query(
    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS user_events (id text PRIMARY KEY, actor_id text NOT NULL REFERENCES app_users(id), target_id text NOT NULL REFERENCES app_users(id), data jsonb NOT NULL)",
  );
  await tx.query(
    "CREATE INDEX IF NOT EXISTS user_events_target_idx ON user_events(target_id)",
  );
}
