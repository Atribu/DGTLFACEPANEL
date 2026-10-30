import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Hotel, User } from "../types";
import { getDb, type Queryable } from "./db";
import { HttpError, requireAdmin } from "./http";
import { ownerPrivacyContext, redactOwnerReferences } from "./owner-identity";

export const hotelLifecycleSchema = z
  .object({ action: z.enum(["archive", "restore"]) })
  .strict();
export const deleteHotelSchema = z
  .object({
    confirmationName: z.string().trim().min(1).max(200),
    archivedAt: z.iso.datetime(),
  })
  .strict();

export interface HotelContentCounts {
  tasks: number;
  comments: number;
  attachments: number;
  recurrences: number;
}
export interface HotelLifecycleEvent {
  id: string;
  hotelId: string;
  hotelName: string;
  actorId: string;
  actorName: string;
  action: "archive" | "restore" | "delete";
  createdAt: string;
  counts: HotelContentCounts;
}

interface UserRow { data: User; auth_version: number }

async function lockPeople(tx: Queryable, actor: User) {
  // Shared with user administration: users, hotel, recurrence rules, tasks.
  const rows = await tx.query<UserRow>(
    "SELECT data,auth_version FROM app_users ORDER BY id FOR UPDATE",
  );
  const fresh = rows.find(({ data }) => data.id === actor.id)?.data;
  if (!fresh) throw new HttpError(403, "Yönetici hesabı bulunamadı.");
  requireAdmin(fresh);
  return { rows, actor: fresh };
}

async function lockHotel(tx: Queryable, id: string) {
  const [row] = await tx.query<{ data: Hotel }>(
    "SELECT data FROM hotels WHERE id=$1 FOR UPDATE", [id],
  );
  if (!row) throw new HttpError(404, "Otel bulunamadı.");
  return row.data;
}

async function hotelResult(tx: Queryable, actor: User, hotel: Hotel) {
  return redactOwnerReferences({ hotel }, await ownerPrivacyContext(tx, actor));
}

async function contentCounts(tx: Queryable, hotelId: string): Promise<HotelContentCounts> {
  const [counts] = await tx.query<HotelContentCounts>(`
    SELECT
      (SELECT count(*)::int FROM tasks WHERE hotel_id=$1) AS tasks,
      (SELECT count(*)::int FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE t.hotel_id=$1) AS comments,
      (SELECT count(*)::int FROM task_attachments a JOIN tasks t ON t.id=a.task_id WHERE t.hotel_id=$1) AS attachments,
      (SELECT count(*)::int FROM recurrence_rules WHERE hotel_id=$1) AS recurrences
  `, [hotelId]);
  return counts;
}

async function lifecycleEvent(
  tx: Queryable,
  actor: User,
  hotel: Hotel,
  action: HotelLifecycleEvent["action"],
  counts: HotelContentCounts,
  createdAt: string,
) {
  const event: HotelLifecycleEvent = {
    id: randomUUID(), hotelId: hotel.id, hotelName: hotel.name,
    actorId: actor.id, actorName: actor.name, action, counts, createdAt,
  };
  await tx.query(
    "INSERT INTO hotel_events(id,actor_id,hotel_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [event.id, actor.id, hotel.id, JSON.stringify(event)],
  );
}

export async function listArchivedHotels(actor: User) {
  requireAdmin(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const fresh = await lockPeople(tx, actor);
    const rows = await tx.query<{ data: Hotel }>(
      "SELECT data FROM hotels WHERE data->>'archivedAt' IS NOT NULL ORDER BY data->>'archivedAt' DESC,id",
    );
    const hotels = [];
    for (const { data: hotel } of rows) {
      hotels.push({ hotel, counts: await contentCounts(tx, hotel.id) });
    }
    return redactOwnerReferences({ hotels }, await ownerPrivacyContext(tx, fresh.actor));
  });
}

export async function archiveHotel(actor: User, hotelId: string) {
  requireAdmin(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const fresh = await lockPeople(tx, actor);
    const hotel = await lockHotel(tx, hotelId);
    if (hotel.archivedAt) return hotelResult(tx, fresh.actor, hotel);
    const now = new Date().toISOString();
    hotel.archivedAt = now;
    await tx.query("UPDATE hotels SET data=$2::jsonb WHERE id=$1", [hotel.id, JSON.stringify(hotel)]);
    // Paused rules keep their schedule/history, and require an explicit resume after restore.
    await tx.query("SELECT id FROM recurrence_rules WHERE hotel_id=$1 ORDER BY id FOR UPDATE", [hotel.id]);
    await tx.query(
      "UPDATE recurrence_rules SET active=false,data=data || jsonb_build_object('active',false,'updatedAt',$2::text) WHERE hotel_id=$1 AND active=true",
      [hotel.id, now],
    );
    await lifecycleEvent(tx, fresh.actor, hotel, "archive", await contentCounts(tx, hotel.id), now);
    return hotelResult(tx, fresh.actor, hotel);
  });
}

export async function restoreHotel(actor: User, hotelId: string) {
  requireAdmin(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const fresh = await lockPeople(tx, actor);
    const hotel = await lockHotel(tx, hotelId);
    if (!hotel.archivedAt) return hotelResult(tx, fresh.actor, hotel);
    delete hotel.archivedAt;
    await tx.query("UPDATE hotels SET data=$2::jsonb WHERE id=$1", [hotel.id, JSON.stringify(hotel)]);
    await lifecycleEvent(tx, fresh.actor, hotel, "restore", await contentCounts(tx, hotel.id), new Date().toISOString());
    return hotelResult(tx, fresh.actor, hotel);
  });
}

export async function deleteHotel(actor: User, hotelId: string, rawInput: unknown) {
  requireAdmin(actor);
  const input = deleteHotelSchema.parse(rawInput);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const fresh = await lockPeople(tx, actor);
    const hotel = await lockHotel(tx, hotelId);
    if (!hotel.archivedAt)
      throw new HttpError(409, "Kalıcı silmeden önce oteli arşivleyin.");
    if (hotel.archivedAt !== input.archivedAt)
      throw new HttpError(409, "Otelin arşiv durumu değişti. Listeyi yenileyip tekrar deneyin.");
    if (hotel.name.trim() !== input.confirmationName)
      throw new HttpError(400, "Onaylamak için otelin adını eksiksiz yazın.");

    await tx.query("SELECT id FROM recurrence_rules WHERE hotel_id=$1 ORDER BY id FOR UPDATE", [hotel.id]);
    await tx.query("SELECT id FROM tasks WHERE hotel_id=$1 ORDER BY id FOR UPDATE", [hotel.id]);
    const counts = await contentCounts(tx, hotel.id);
    // Delete all dependent records, including soft-deleted attachments and their bytes.
    // Cross references are covered as well, so no historical foreign key can block deletion.
    await tx.query("DELETE FROM personal_notifications WHERE hotel_id=$1 OR task_id IN (SELECT id FROM tasks WHERE hotel_id=$1)", [hotel.id]);
    await tx.query("DELETE FROM recurrence_occurrences WHERE rule_id IN (SELECT id FROM recurrence_rules WHERE hotel_id=$1) OR task_id IN (SELECT id FROM tasks WHERE hotel_id=$1)", [hotel.id]);
    await tx.query("DELETE FROM recurrence_rules WHERE hotel_id=$1", [hotel.id]);
    await tx.query("DELETE FROM task_attachments WHERE task_id IN (SELECT id FROM tasks WHERE hotel_id=$1)", [hotel.id]);
    await tx.query("DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE hotel_id=$1)", [hotel.id]);
    await tx.query("DELETE FROM activities WHERE hotel_id=$1 OR task_id IN (SELECT id FROM tasks WHERE hotel_id=$1)", [hotel.id]);
    await tx.query("DELETE FROM tasks WHERE hotel_id=$1", [hotel.id]);
    await tx.query("DELETE FROM hotels WHERE id=$1", [hotel.id]);
    for (const row of fresh.rows) {
      if (!row.data.hotelIds.includes(hotel.id)) continue;
      const user: User = { ...row.data, hotelIds: row.data.hotelIds.filter((id) => id !== hotel.id) };
      await tx.query("UPDATE app_users SET data=$2::jsonb,auth_version=auth_version+1 WHERE id=$1", [user.id, JSON.stringify(user)]);
    }
    // app_meta import markers deliberately survive: deployment must not recreate deleted hotels.
    await lifecycleEvent(tx, fresh.actor, hotel, "delete", counts, new Date().toISOString());
    return { deleted: true, hotelId: hotel.id, counts };
  });
}
