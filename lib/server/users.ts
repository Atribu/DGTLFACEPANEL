import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../types";
import { getDb, type Queryable } from "./db";
import { HttpError, requireAdmin } from "./http";
import { hashPassword } from "./password";
import { idSchema } from "./validation";
import { isUserActive, permissionsChanged } from "./user-policies";

const fields = {
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["admin", "staff", "observer"]),
  department: z.string().trim().min(1).max(200),
  hotelIds: z.array(idSchema).max(200),
};
export const createUserSchema = z
  .object({
    ...fields,
    password: z.string().min(12).max(256),
  })
  .strict();
export const updateUserSchema = z
  .object({
    ...fields,
    active: z.boolean(),
  })
  .strict();

interface UserRow {
  data: User;
  auth_version: number;
}
interface UserEvent {
  id: string;
  actorId: string;
  actorName: string;
  targetId: string;
  targetName: string;
  message: string;
  createdAt: string;
}

// All user changes take locks in the same order. Recheck the actor after waiting
// for those locks so two admins cannot deactivate/demote one another concurrently.
async function lockUsers(tx: Queryable, actor: User): Promise<UserRow[]> {
  const rows = await tx.query<UserRow>(
    "SELECT data,auth_version FROM app_users ORDER BY id FOR UPDATE",
  );
  const freshActor = rows.find((row) => row.data.id === actor.id)?.data;
  if (!freshActor || !isUserActive(freshActor) || freshActor.role !== "admin") {
    throw new HttpError(
      403,
      "Kullanıcı yönetimi için aktif yönetici yetkisi gerekiyor.",
    );
  }
  return rows;
}

async function hotelMembership(
  tx: Queryable,
  input: { role: User["role"]; hotelIds: string[] },
) {
  if (input.role !== "observer") return [];
  const ids = [...new Set(input.hotelIds)];
  if (!ids.length)
    throw new HttpError(400, "Otel gözlemcisine en az bir otel seçin.");
  const hotels = await tx.query<{ id: string }>(
    "SELECT id FROM hotels WHERE id=ANY($1::text[])",
    [ids],
  );
  if (hotels.length !== ids.length)
    throw new HttpError(400, "Seçilen otellerden biri bulunamadı.");
  return ids;
}

async function userEvent(
  tx: Queryable,
  actor: User,
  target: User,
  message: string,
) {
  const event: UserEvent = {
    id: randomUUID(),
    actorId: actor.id,
    actorName: actor.name,
    targetId: target.id,
    targetName: target.name,
    message,
    createdAt: new Date().toISOString(),
  };
  await tx.query(
    "INSERT INTO user_events(id,actor_id,target_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [event.id, actor.id, target.id, JSON.stringify(event)],
  );
}

function duplicateEmail(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    throw new HttpError(
      409,
      "Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.",
    );
  }
  throw error;
}

export async function createUser(
  actor: User,
  rawInput: z.infer<typeof createUserSchema>,
) {
  requireAdmin(actor);
  const input = createUserSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.password);
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const rows = await lockUsers(tx, actor);
      if (rows.some((row) => row.data.email.toLowerCase() === input.email)) {
        throw new HttpError(
          409,
          "Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.",
        );
      }
      const user: User = {
        id: randomUUID(),
        name: input.name,
        email: input.email,
        role: input.role,
        department: input.department,
        hotelIds: await hotelMembership(tx, input),
        active: true,
      };
      await tx.query(
        "INSERT INTO app_users(id,email,password_hash,data,auth_version) VALUES ($1,$2,$3,$4::jsonb,1)",
        [user.id, user.email, passwordHash, JSON.stringify(user)],
      );
      await userEvent(
        tx,
        rows.find((row) => row.data.id === actor.id)!.data,
        user,
        `Kullanıcı oluşturuldu. Rol: ${user.role}.`,
      );
      return { user };
    });
  } catch (error) {
    return duplicateEmail(error);
  }
}

export async function updateUser(
  actor: User,
  targetId: string,
  rawInput: z.infer<typeof updateUserSchema>,
) {
  requireAdmin(actor);
  const input = updateUserSchema.parse(rawInput);
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const rows = await lockUsers(tx, actor);
      const target = rows.find((row) => row.data.id === targetId);
      if (!target) throw new HttpError(404, "Kullanıcı bulunamadı.");
      if (
        targetId === actor.id &&
        (!input.active || input.role !== target.data.role)
      ) {
        throw new HttpError(
          409,
          "Kendi hesabınızı pasifleştiremez veya kendi rolünüzü değiştiremezsiniz.",
        );
      }
      if (
        rows.some(
          (row) =>
            row.data.id !== targetId &&
            row.data.email.toLowerCase() === input.email,
        )
      ) {
        throw new HttpError(
          409,
          "Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.",
        );
      }
      if (
        isUserActive(target.data) &&
        target.data.role === "admin" &&
        (!input.active || input.role !== "admin") &&
        rows.filter(
          (row) => isUserActive(row.data) && row.data.role === "admin",
        ).length <= 1
      ) {
        throw new HttpError(409, "Sistemde en az bir aktif yönetici kalmalı.");
      }
      if (!input.active || input.role === "observer") {
        const openTasks = await tx.query<{ id: string }>(
          "SELECT id FROM tasks WHERE assignee_id=$1 AND data->>'status'<>'completed' LIMIT 1",
          [targetId],
        );
        if (openTasks.length)
          throw new HttpError(
            409,
            "Bu kullanıcının açık görevleri var. Önce görevleri başka bir aktif personele atayın.",
          );
        const managedHotels = await tx.query<{ id: string }>(
          "SELECT id FROM hotels WHERE data->>'managerId'=$1 LIMIT 1",
          [targetId],
        );
        if (managedHotels.length)
          throw new HttpError(
            409,
            "Bu kullanıcı otel sorumlusu. Önce otel detayından sorumluyu başka bir aktif personelle değiştirin.",
          );
      }
      const user: User = {
        id: targetId,
        name: input.name,
        email: input.email,
        role: input.role,
        department: input.department,
        hotelIds: await hotelMembership(tx, input),
        active: input.active,
      };
      const changedPermissions = permissionsChanged(target.data, user);
      await tx.query(
        "UPDATE app_users SET email=$2,data=$3::jsonb,auth_version=$4 WHERE id=$1",
        [
          targetId,
          user.email,
          JSON.stringify(user),
          target.auth_version + (changedPermissions ? 1 : 0),
        ],
      );
      const details = [
        target.data.role !== user.role
          ? `Rol: ${target.data.role} → ${user.role}.`
          : "",
        isUserActive(target.data) !== isUserActive(user)
          ? user.active
            ? "Hesap etkinleştirildi."
            : "Hesap pasifleştirildi."
          : "",
        JSON.stringify([...target.data.hotelIds].sort()) !==
        JSON.stringify([...user.hotelIds].sort())
          ? `Otel erişimi güncellendi (${user.hotelIds.length} otel).`
          : "",
      ].filter(Boolean);
      await userEvent(
        tx,
        rows.find((row) => row.data.id === actor.id)!.data,
        user,
        details.join(" ") || "Kullanıcı bilgileri güncellendi.",
      );
      return { user };
    });
  } catch (error) {
    return duplicateEmail(error);
  }
}

export async function listUsers(actor: User) {
  requireAdmin(actor);
  const db = await getDb();
  const [fresh] = await db.query<{ data: User }>(
    "SELECT data FROM app_users WHERE id=$1",
    [actor.id],
  );
  if (!fresh || !isUserActive(fresh.data) || fresh.data.role !== "admin")
    throw new HttpError(403, "Yönetici yetkisi gerekiyor.");
  const users = (
    await db.query<{ data: User }>(
      "SELECT data FROM app_users ORDER BY data->>'name'",
    )
  ).map((row) => row.data);
  const events = (
    await db.query<{ data: UserEvent }>(
      "SELECT data FROM user_events ORDER BY data->>'createdAt' DESC LIMIT 250",
    )
  ).map((row) => row.data);
  return { users, events };
}
