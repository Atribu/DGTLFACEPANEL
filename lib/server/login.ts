import type { User } from "../types";
import { getDb } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { HttpError } from "./http";
import { isUserActive } from "./user-policies";

type Attempt = { count: number; expires: number };
const globals = globalThis as typeof globalThis & {
  dgtlLoginAttempts?: Map<string, Attempt>;
  dgtlDummyPassword?: Promise<string>;
};
const attempts = (globals.dgtlLoginAttempts ??= new Map<string, Attempt>());

export async function authenticate(
  email: string,
  password: string,
): Promise<{ user: User; authVersion: number }> {
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.expires <= now) attempts.delete(key);
  const entry = attempts.get(email);
  if ((entry?.count ?? 0) >= 10 || (!entry && attempts.size >= 5000))
    throw new HttpError(
      429,
      "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.",
    );
  attempts.set(email, {
    count: (entry?.count ?? 0) + 1,
    expires: entry?.expires ?? now + 15 * 60 * 1000,
  });
  const db = await getDb();
  const [row] = await db.query<{
    data: User;
    password_hash: string;
    auth_version: number;
  }>("SELECT data,password_hash,auth_version FROM app_users WHERE email=$1", [
    email,
  ]);
  globals.dgtlDummyPassword ??= hashPassword(
    "unused-random-login-timing-placeholder",
  );
  const valid = await verifyPassword(
    password,
    row?.password_hash ?? (await globals.dgtlDummyPassword),
  );
  if (!row || !valid || !isUserActive(row.data))
    throw new HttpError(401, "E-posta veya şifre hatalı.");
  attempts.delete(email);
  return { user: row.data, authVersion: row.auth_version };
}
