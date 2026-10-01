import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import type { User } from "../types";
import { getDb } from "./db";
import { isProduction, sessionSecret } from "./config";
import { isUserActive, sessionVersionMatches } from "./user-policies";

export interface SessionData {
  userId?: string;
  authenticatedAt?: number;
  authVersion?: number;
}
export async function getSession() {
  return getIronSession<SessionData>(await cookies(), {
    cookieName: "dgtlface-session",
    password: await sessionSecret(),
    ttl: 60 * 60 * 8,
    cookieOptions: {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    },
  });
}
export async function getCurrentUser(): Promise<User | null> {
  return resolveSessionUser(await getSession());
}

export async function resolveSessionUser(
  session: SessionData,
): Promise<User | null> {
  if (
    !session.userId ||
    !session.authenticatedAt ||
    Date.now() - session.authenticatedAt > 8 * 60 * 60 * 1000
  )
    return null;
  const db = await getDb();
  const [row] = await db.query<{ data: User; auth_version: number }>(
    "SELECT data,auth_version FROM app_users WHERE id=$1",
    [session.userId],
  );
  if (
    !row ||
    !isUserActive(row.data) ||
    !sessionVersionMatches(row.auth_version, session.authVersion)
  )
    return null;
  return row.data;
}
