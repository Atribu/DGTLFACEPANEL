import type { Queryable } from "./db";

export async function migrateNotificationSchema(tx: Queryable) {
  await tx.query(`
    CREATE TABLE IF NOT EXISTS personal_notifications (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES app_users(id),
      task_id text NOT NULL REFERENCES tasks(id),
      hotel_id text NOT NULL REFERENCES hotels(id),
      event_key text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz,
      UNIQUE(user_id,event_key)
    )
  `);
  await tx.query(
    "CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON personal_notifications(user_id,created_at DESC)",
  );
  await tx.query(
    "CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON personal_notifications(user_id) WHERE read_at IS NULL",
  );
}
