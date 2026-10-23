import { createHash, randomUUID } from "node:crypto";
import type { SessionData } from "./auth";
import type { Database } from "./db";
import type { User } from "../types";

export const PRESENCE_WINDOW_SECONDS = 90;
const SESSION_LIFETIME = 8 * 60 * 60 * 1000;

// Old cookies remain usable; their immutable authentication fields identify
// their session until the next login issues a random identifier.
export function presenceSessionId(session: SessionData): string {
  return session.sessionId || createHash("sha256").update(JSON.stringify([
    session.userId, session.authenticatedAt, session.authVersion ?? 1,
  ])).digest("hex");
}

export async function touchPresence(
  db: Database,
  user: User,
  session: SessionData,
  channel: "web" | "mobile",
  now = new Date(),
) {
  if (!session.authenticatedAt || session.userId !== user.id) return;
  const expires = new Date(session.authenticatedAt + SESSION_LIFETIME);
  if (expires.getTime() <= now.getTime()) return;
  await db.query(`INSERT INTO account_sessions
      (id,user_id,auth_version,started_at,expires_at,last_seen_at,channel)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,channel=EXCLUDED.channel
    WHERE account_sessions.ended_at IS NULL
      AND account_sessions.last_seen_at <= EXCLUDED.last_seen_at - interval '20 seconds'`, [
    presenceSessionId(session), user.id, session.authVersion ?? 1,
    new Date(session.authenticatedAt).toISOString(), expires.toISOString(), now.toISOString(), channel,
  ]);
}

export async function recordLogin(db: Database, user: User, _session: SessionData) {
  const now = new Date();
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO account_events(id,user_id,action,actor_name,created_at)
      VALUES ($1,$2,'login',$3,$4)`, [randomUUID(), user.id, user.name, now.toISOString()]);
    // A login is recorded immediately; presence starts when a workspace fetch
    // confirms that the client is actually connected (web or native mobile).
  });
}

export async function recordLogout(db: Database, user: User, session: SessionData) {
  if (!session.authenticatedAt || session.userId !== user.id) return;
  const authenticatedAt = session.authenticatedAt;
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    // A tombstone also revokes a login that never fetched a workspace. An old
    // cookie cannot reopen it, and repeated requests do not duplicate events.
    const closed = await tx.query<{id: string}>(`INSERT INTO account_sessions
      (id,user_id,auth_version,started_at,expires_at,last_seen_at,ended_at,channel)
      VALUES ($1,$2,$3,$4,$5,$4,$6,'web')
      ON CONFLICT(id) DO UPDATE SET ended_at=EXCLUDED.ended_at
      WHERE account_sessions.ended_at IS NULL AND account_sessions.user_id=EXCLUDED.user_id
      RETURNING id`, [presenceSessionId(session), user.id, session.authVersion ?? 1,
      new Date(authenticatedAt).toISOString(),
      new Date(authenticatedAt + SESSION_LIFETIME).toISOString(), now]);
    if (closed.length) {
      await tx.query(`INSERT INTO account_events(id,user_id,action,actor_name,created_at)
        VALUES ($1,$2,'logout',$3,$4)`, [randomUUID(), user.id, user.name, now]);
    }
  });
}

export async function recordFailedLogin(db: Database, email: string) {
  const [row] = await db.query<{data: User}>("SELECT data FROM app_users WHERE email=$1", [email]);
  // Unknown account input, passwords, IP addresses and browser fingerprints are
  // deliberately not stored. Known accounts can be correlated by the owner.
  if (!row) return;
  await db.query(`INSERT INTO account_events(id,user_id,action,actor_name,created_at)
    VALUES ($1,$2,'login_failed',$3,$4)`, [randomUUID(), row?.data.id ?? null,
    row?.data.name ?? "Bilinmeyen hesap", new Date().toISOString()]);
}
