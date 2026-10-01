import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  NotificationKind,
  NotificationList,
  PersonalNotification,
} from "../notifications";
import type { Task, User } from "../types";
import { getDb, type Queryable } from "./db";
import { HttpError } from "./http";
import { idSchema } from "./validation";

export const notificationReadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: idSchema }).strict(),
  z.object({ action: z.literal("read_all") }).strict(),
]);

const labels: Record<NotificationKind, string> = {
  assigned: "Yeni görev atandı",
  priority_changed: "Görevin önceliği değişti",
  due_date_changed: "Hedef tarih değişti",
  returned: "Görev düzeltme için geri gönderildi",
  approved: "Görev onaylandı",
  review_requested: "Görev kontrolünüzü bekliyor",
  waiting: "Görev beklemeye alındı",
  due_today: "Görevin hedef tarihi bugün",
  overdue: "Görevin hedef tarihi geçti",
};

const internal = (user: User) =>
  user.active !== false && user.role !== "observer";
const active = (user: User) => user.active !== false;
const dateLabel = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Istanbul",
      }).format(new Date(`${date}T12:00:00+03:00`))
    : "belirlenmedi";

async function insertNotifications(
  tx: Queryable,
  actor: User | null,
  task: Task,
  recipients: User[],
  kind: NotificationKind,
  message: string,
  eventKey: string,
) {
  let created = 0;
  for (const user of new Map(
    recipients.map((item) => [item.id, item]),
  ).values()) {
    if (!active(user) || user.id === actor?.id) continue;
    const notification: PersonalNotification = {
      id: randomUUID(),
      userId: user.id,
      taskId: task.id,
      hotelId: task.hotelId,
      kind,
      title: labels[kind],
      message,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    const rows = await tx.query<{ id: string }>(
      "INSERT INTO personal_notifications(id,user_id,task_id,hotel_id,event_key,data,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (user_id,event_key) DO NOTHING RETURNING id",
      [
        notification.id,
        user.id,
        task.id,
        task.hotelId,
        `${eventKey}:${kind}`,
        JSON.stringify(notification),
        notification.createdAt,
      ],
    );
    created += rows.length;
  }
  return created;
}

/** Call inside the task mutation transaction, after its INSERT or UPDATE. */
export async function notifyTaskChange(
  tx: Queryable,
  actor: User | null,
  before: Task | null,
  after: Task,
  detail: { reason?: string; eventKey?: string } = {},
) {
  const users = (
    await tx.query<{ data: User }>("SELECT data FROM app_users")
  ).map((row) => row.data);
  const assignee = users.filter(
    (user) => internal(user) && user.id === after.assigneeId,
  );
  const admins = users.filter((user) => active(user) && user.role === "admin");
  const observers = users.filter(
    (user) =>
      active(user) &&
      user.role === "observer" &&
      user.hotelIds.includes(after.hotelId),
  );
  const eventKey = detail.eventKey ?? randomUUID();
  let created = 0;
  const send = async (
    kind: NotificationKind,
    recipients: User[],
    message: string,
  ) => {
    created += await insertNotifications(
      tx,
      actor,
      after,
      recipients,
      kind,
      message,
      eventKey,
    );
  };
  if (after.assigneeId && after.assigneeId !== before?.assigneeId)
    await send(
      "assigned",
      assignee,
      `“${after.title}” görevi size atandı. Öncelik: ${after.priority}. Hedef tarih: ${dateLabel(after.dueDate)}.`,
    );
  if (before && before.priority !== after.priority)
    await send(
      "priority_changed",
      assignee,
      `“${after.title}” görevinin önceliği ${before.priority} → ${after.priority} olarak değiştirildi. 1 en yüksek önceliktir.`,
    );
  if (before && before.dueDate !== after.dueDate)
    await send(
      "due_date_changed",
      assignee,
      `“${after.title}” görevinin hedef tarihi ${dateLabel(after.dueDate)} olarak güncellendi.`,
    );
  if (before?.status === "review" && after.status === "in_progress")
    await send(
      "returned",
      assignee,
      `“${after.title}” görevi düzeltme için geri gönderildi.${detail.reason?.trim() ? ` Neden: ${detail.reason.trim()}` : ""}`,
    );
  if (before?.status !== "completed" && after.status === "completed")
    await send(
      "approved",
      [...assignee, ...observers],
      `“${after.title}” görevi yönetici onayıyla tamamlandı.`,
    );
  if (before?.status !== "review" && after.status === "review")
    await send(
      "review_requested",
      admins,
      `“${after.title}” görevi kontrole gönderildi; onayınızı bekliyor.`,
    );
  if (before?.status !== "waiting" && after.status === "waiting")
    await send(
      "waiting",
      [...admins, ...observers],
      `“${after.title}” görevi beklemeye alındı.${after.waitingReason ? ` Neden: ${after.waitingReason}` : ""}`,
    );
  return { created };
}

/** Unique task/date keys keep repeated scheduler or GET calls from duplicating reminders. */
export async function generateDueNotifications(today?: string) {
  const day =
    today ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(
      new Date(),
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day
  )
    throw new HttpError(400, "Geçerli bir tarih gerekiyor.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const tasks = (
      await tx.query<{ data: Task }>(
        "SELECT data FROM tasks WHERE data->>'dueDate' <= $1 AND data->>'status' <> 'completed' FOR UPDATE",
        [day],
      )
    ).map((row) => row.data);
    const users = (
      await tx.query<{ data: User }>("SELECT data FROM app_users")
    ).map((row) => row.data);
    const admins = users.filter(
      (user) => active(user) && user.role === "admin",
    );
    let created = 0;
    for (const task of tasks) {
      const assignee = users.filter(
        (user) => internal(user) && user.id === task.assigneeId,
      );
      const kind = task.dueDate === day ? "due_today" : "overdue";
      created += await insertNotifications(
        tx,
        null,
        task,
        [...admins, ...assignee],
        kind,
        kind === "due_today"
          ? `“${task.title}” görevinin hedef tarihi bugün.`
          : `“${task.title}” görevinin ${dateLabel(task.dueDate)} hedef tarihi geçti.`,
        `deadline:${task.id}:${task.dueDate}`,
      );
    }
    return { created };
  });
}

async function ownerAndScope(tx: Queryable, user: User) {
  const [row] = await tx.query<{ data: User }>(
    "SELECT data FROM app_users WHERE id=$1",
    [user.id],
  );
  if (!row || !active(row.data))
    throw new HttpError(403, "Bildirimler için aktif bir hesap gerekiyor.");
  return {
    owner: row.data,
    scope: row.data.role === "observer" ? row.data.hotelIds : null,
  };
}

export async function listNotifications(user: User): Promise<NotificationList> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { owner, scope } = await ownerAndScope(tx, user);
    const where = `n.user_id=$1${scope ? " AND t.hotel_id=ANY($2::text[])" : ""}`;
    const values = scope ? [owner.id, scope] : [owner.id];
    const rows = await tx.query<{
      data: PersonalNotification;
      read_at: string | Date | null;
    }>(
      `SELECT n.data,n.read_at FROM personal_notifications n JOIN tasks t ON t.id=n.task_id WHERE ${where} ORDER BY (n.read_at IS NULL) DESC,n.created_at DESC,n.id DESC LIMIT 100`,
      values,
    );
    const [total] = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM personal_notifications n JOIN tasks t ON t.id=n.task_id WHERE ${where} AND n.read_at IS NULL`,
      values,
    );
    return {
      notifications: rows.map((row) => ({
        ...row.data,
        readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      })),
      unreadCount: total.count,
    };
  });
}

export async function markNotificationRead(user: User, id?: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { owner, scope } = await ownerAndScope(tx, user);
    const values: unknown[] = [owner.id];
    let where = "n.user_id=$1";
    if (scope) {
      values.push(scope);
      where += ` AND t.hotel_id=ANY($${values.length}::text[])`;
    }
    if (id) {
      values.push(id);
      where += ` AND n.id=$${values.length}`;
    } else where += " AND n.read_at IS NULL";
    const rows = await tx.query<{ id: string }>(
      `UPDATE personal_notifications n SET read_at=COALESCE(n.read_at,now()) FROM tasks t WHERE t.id=n.task_id AND ${where} RETURNING n.id`,
      values,
    );
    if (id && !rows.length) throw new HttpError(404, "Bildirim bulunamadı.");
    return { ok: true, updated: rows.length };
  });
}
