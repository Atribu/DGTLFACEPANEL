import type { Hotel, User } from "../types";
import type { Queryable } from "./db";
import { HttpError } from "./http";
import { isUserActive } from "./user-policies";

// Shared order for writes: users, hotel, recurrence/task, attachments.
// Lock all users in stable order because assignment and notification writes can
// reference different people in the same transaction. Inactive rows stay locked.
export async function lockActiveUsers(tx: Queryable): Promise<User[]> {
  return (await tx.query<{ data: User }>(
    "SELECT data FROM app_users ORDER BY id FOR UPDATE",
  )).map(({ data }) => data);
}

export async function lockActiveActor(tx: Queryable, actor: User): Promise<User> {
  const current = (await lockActiveUsers(tx)).find((user) => user.id === actor.id);
  if (!current || !isUserActive(current))
    throw new HttpError(403, "Bu işlem için aktif hesap gerekiyor.");
  return current;
}

export async function requireActiveHotel(
  tx: Queryable,
  id: string,
  lock = false,
): Promise<Hotel> {
  const [row] = await tx.query<{ data: Hotel }>(
    `SELECT data FROM hotels WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  // Check the freshly locked row, including after waiting for an archive write.
  if (!row || row.data.archivedAt)
    throw new HttpError(404, "Otel bulunamadı veya arşivlenmiş.");
  return row.data;
}
