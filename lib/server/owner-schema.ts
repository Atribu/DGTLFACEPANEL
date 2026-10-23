import { randomUUID } from "node:crypto";
import type { User } from "../types";
import type { Database, Queryable } from "./db";
import { isSystemOwner, SYSTEM_OWNER_EMAIL } from "./owner-identity";

export async function migrateOwnerSchema(tx: Queryable) {
  await tx.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_system_owner_idx ON app_users ((data->>'isOwner')) WHERE data->>'isOwner'='true'",
  );
}

export function isValidOwnerPasswordHash(value: string): boolean {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value);
}

/** The selected server-side hash provisions once. Deployments never reset a password. */
export async function provisionSystemOwner(
  db: Database,
  passwordHash: string | undefined,
): Promise<User | undefined> {
  if (!passwordHash) return;
  if (!isValidOwnerPasswordHash(passwordHash))
    throw new Error("SYSTEM_OWNER_PASSWORD_HASH geçerli bir scrypt parola özeti olmalı.");
  return db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO app_meta(key,value) VALUES ('system-owner-provision-lock','1') ON CONFLICT DO NOTHING",
    );
    await tx.query("SELECT key FROM app_meta WHERE key='system-owner-provision-lock' FOR UPDATE");
    const rows = await tx.query<{ email: string; data: User }>(
      "SELECT email,data FROM app_users WHERE LOWER(email)=$1 OR data->>'isOwner'='true' ORDER BY id FOR UPDATE",
      [SYSTEM_OWNER_EMAIL],
    );
    if (rows.length) {
      if (rows.length !== 1 || rows[0].email.toLowerCase() !== SYSTEM_OWNER_EMAIL || !isSystemOwner(rows[0].data))
        throw new Error("Sistem sahibi hesabı oluşturulamadı: ayrılmış e-posta veya sahip kaydı zaten mevcut. Mevcut hesap otomatik yükseltilmez; sunucudaki hesap kaydı incelenmeli.");
      return rows[0].data;
    }
    const user: User = {
      id: randomUUID(),
      name: "Oğuz Kılınç",
      email: SYSTEM_OWNER_EMAIL,
      role: "admin",
      department: "Sistem yönetimi",
      hotelIds: [],
      active: true,
      isOwner: true,
    };
    await tx.query(
      "INSERT INTO app_users(id,email,password_hash,data,auth_version) VALUES ($1,$2,$3,$4::jsonb,1)",
      [user.id, user.email, passwordHash, JSON.stringify(user)],
    );
    return user;
  });
}
