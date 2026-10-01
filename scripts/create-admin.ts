import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/server/db";
import { hashPassword } from "../lib/server/password";
import type { User } from "../lib/types";

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL for account provisioning.");
  const input = z
    .object({
      email: z.email().transform((value) => value.toLowerCase()),
      name: z.string().trim().min(2).max(100),
      password: z.string().min(12).max(256),
    })
    .parse({
      email: process.env.ADMIN_EMAIL,
      name: process.env.ADMIN_NAME,
      password: process.env.ADMIN_PASSWORD,
    });
  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      if (
        (
          await tx.query("SELECT id FROM app_users WHERE email=$1", [
            input.email,
          ])
        ).length
      )
        throw new Error(
          "An account with this email already exists; no change made.",
        );
      const user: User = {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        role: "admin",
        department: "Yönetim",
        hotelIds: [],
      };
      await tx.query(
        "INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)",
        [
          user.id,
          user.email,
          await hashPassword(input.password),
          JSON.stringify(user),
        ],
      );
    });
    console.log("Administrator created. No password was printed.");
  } finally {
    await db.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Account could not be created.",
  );
  process.exitCode = 1;
});
