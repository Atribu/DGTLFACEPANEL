import type { Queryable } from "./db";

export async function migrateOwnerConsoleSchema(tx: Queryable) {
  await tx.query(`CREATE TABLE IF NOT EXISTS account_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES app_users(id),
    auth_version integer NOT NULL,
    started_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    ended_at timestamptz,
    channel text NOT NULL CHECK (channel IN ('web','mobile'))
  )`);
  await tx.query("CREATE INDEX IF NOT EXISTS account_sessions_user_seen_idx ON account_sessions(user_id,last_seen_at DESC)");
  await tx.query(`CREATE TABLE IF NOT EXISTS account_events (
    id text PRIMARY KEY,
    user_id text REFERENCES app_users(id),
    action text NOT NULL CHECK (action IN ('login','logout','login_failed')),
    actor_name text NOT NULL,
    created_at timestamptz NOT NULL
  )`);
  await tx.query("CREATE INDEX IF NOT EXISTS account_events_created_idx ON account_events(created_at DESC,id DESC)");
  await tx.query("CREATE INDEX IF NOT EXISTS account_events_user_idx ON account_events(user_id,created_at DESC)");
  await tx.query("CREATE INDEX IF NOT EXISTS activities_created_idx ON activities ((data->>'createdAt') DESC,id DESC)");
  await tx.query("CREATE INDEX IF NOT EXISTS user_events_created_idx ON user_events ((data->>'createdAt') DESC,id DESC)");
}
