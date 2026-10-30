import { randomUUID } from "node:crypto";
import type {
  Activity,
  BootstrapData,
  Hotel,
  Task,
  TaskComment,
  User,
} from "../types";
import { STATUS_LABELS } from "../types";
import { getDb, type Queryable } from "./db";
import { lockActiveActor, requireActiveHotel } from "./hotel-access";
import { isDemo } from "./config";
import { HttpError, requireAdmin } from "./http";
import {
  canApproveTask,
  canEditChecklist,
  canReturnTask,
  canSetStatus,
  canSubmitTask,
  canViewTask,
  canWorkOnTask,
} from "./policies";
import { buildTemplateTasks } from "./template";
import { insertTask } from "./seed";
import {
  createHotelSchema,
  createTaskSchema,
  patchTaskSchema,
} from "./validation";
import type { z } from "zod";
import { notifyTaskChange } from "./notifications";
import { mobileCommentId, taskVersion } from "./mobile-sync";
import {
  isAssignableUser,
  isProtectedOwner,
  ownerPrivacyContext,
  redactOwnerReferences,
} from "./owner-identity";

export async function audit(
  tx: Queryable,
  user: User,
  hotelId: string,
  taskId: string | null,
  message: string,
) {
  const activity: Activity = {
    id: randomUUID(),
    hotelId,
    taskId,
    userId: user.id,
    userName: user.name,
    message,
    createdAt: new Date().toISOString(),
  };
  await tx.query(
    "INSERT INTO activities(id,hotel_id,task_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [activity.id, hotelId, taskId, JSON.stringify(activity)],
  );
  return activity;
}

export async function bootstrap(user: User): Promise<BootstrapData> {
  const db = await getDb();
  const scope = user.role === "observer" ? user.hotelIds : null;
  const hotels = (
    await db.query<{ data: Hotel }>(
      `SELECT data FROM hotels WHERE data->>'archivedAt' IS NULL ${scope ? "AND id=ANY($1::text[])" : ""} ORDER BY data->>'createdAt',id`,
      scope ? [scope] : [],
    )
  ).map((row) => row.data);
  const tasks = (
    await db.query<{ data: Task }>(
      `SELECT t.data FROM tasks t JOIN hotels h ON h.id=t.hotel_id WHERE h.data->>'archivedAt' IS NULL ${scope ? "AND t.hotel_id=ANY($1::text[])" : ""} ORDER BY (t.data->>'priority')::int,t.data->>'dueDate' NULLS LAST,t.data->>'title'`,
      scope ? [scope] : [],
    )
  ).map((row) => row.data);
  const activities = (
    await db.query<{ data: Activity }>(
      `SELECT a.data FROM activities a JOIN hotels h ON h.id=a.hotel_id WHERE h.data->>'archivedAt' IS NULL ${scope ? "AND a.hotel_id=ANY($1::text[])" : ""} ORDER BY a.data->>'createdAt' DESC LIMIT 250`,
      scope ? [scope] : [],
    )
  ).map((row) => row.data);
  const comments = (
    await db.query<{ data: TaskComment }>(
      `SELECT c.data FROM task_comments c JOIN tasks t ON t.id=c.task_id JOIN hotels h ON h.id=t.hotel_id WHERE h.data->>'archivedAt' IS NULL ${scope ? "AND t.hotel_id=ANY($1::text[])" : ""} ORDER BY c.data->>'createdAt'`,
      scope ? [scope] : [],
    )
  ).map((row) => row.data);
  let users = (
    await db.query<{ data: User }>(
      "SELECT data FROM app_users ORDER BY data->>'name'",
    )
  ).map((row) => row.data).filter((person) => !isProtectedOwner(person));
  if (scope) {
    const visibleUsers = new Set([
      user.id,
      ...tasks.map((task) => task.assigneeId),
      ...hotels.map((hotel) => hotel.managerId),
      ...activities.map((item) => item.userId),
      ...comments.map((item) => item.userId),
    ]);
    users = users
      .filter((item) => visibleUsers.has(item.id))
      .map((item) =>
        item.id === user.id
          ? item
          : {
              ...item,
              email: "",
              hotelIds: item.hotelIds.filter((id) => scope.includes(id)),
            },
      );
  }
  return redactOwnerReferences(
    { user, users, hotels, tasks, activities, comments, demo: isDemo() },
    await ownerPrivacyContext(db, user),
  );
}

async function findTask(
  tx: Queryable,
  user: User,
  taskId: string,
  lock = false,
): Promise<Task> {
  const [snapshot] = await tx.query<{ data: Task }>(
    "SELECT data FROM tasks WHERE id=$1", [taskId],
  );
  if (!snapshot || !canViewTask(user, snapshot.data))
    throw new HttpError(404, "Görev bulunamadı.");
  await requireActiveHotel(tx, snapshot.data.hotelId, lock);
  if (!lock) return snapshot.data;
  const [row] = await tx.query<{ data: Task }>(
    "SELECT data FROM tasks WHERE id=$1 FOR UPDATE", [taskId],
  );
  if (!row || !canViewTask(user, row.data))
    throw new HttpError(404, "Görev bulunamadı.");
  return row.data;
}
export async function taskDetail(user: User, taskId: string) {
  const db = await getDb();
  const task = await findTask(db, user, taskId);
  const comments = (
    await db.query<{ data: TaskComment }>(
      "SELECT data FROM task_comments WHERE task_id=$1 ORDER BY data->>'createdAt'",
      [taskId],
    )
  ).map((row) => row.data);
  const activities = (
    await db.query<{ data: Activity }>(
      "SELECT data FROM activities WHERE task_id=$1 ORDER BY data->>'createdAt' DESC",
      [taskId],
    )
  ).map((row) => row.data);
  return redactOwnerReferences(
    { task, comments, activities },
    await ownerPrivacyContext(db, user),
  );
}
async function validateAssignee(
  tx: Queryable,
  id: string | null | undefined,
  errorMessage = "Sorumlu, aktif bir personel veya yönetici olmalı.",
) {
  if (!id) return;
  const [row] = await tx.query<{ data: User }>(
    "SELECT data FROM app_users WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!row || !isAssignableUser(row.data))
    throw new HttpError(400, errorMessage);
}

export async function updateHotelManager(
  user: User,
  hotelId: string,
  managerId: string,
) {
  requireAdmin(user);
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Stable user lock order is shared with user deactivation/role updates.
    const users = await tx.query<{ data: User }>(
      "SELECT data FROM app_users ORDER BY id FOR UPDATE",
    );
    const actor = users.find((row) => row.data.id === user.id)?.data;
    if (!actor) throw new HttpError(403, "Yönetici yetkisi gerekiyor.");
    requireAdmin(actor);
    const hotel = await requireActiveHotel(tx, hotelId, true);
    if (hotel.managerId === managerId) return { hotel };
    await validateAssignee(tx, managerId);
    hotel.managerId = managerId;
    await tx.query("UPDATE hotels SET data=$2::jsonb WHERE id=$1", [
      hotelId,
      JSON.stringify(hotel),
    ]);
    const manager = users.find((row) => row.data.id === managerId)!.data;
    await audit(
      tx,
      actor,
      hotelId,
      null,
      `Otel sorumlusu ${manager.name} olarak değiştirildi. Mevcut görev atamaları korundu.`,
    );
    return { hotel };
  });
}
export async function createHotel(
  user: User,
  input: z.infer<typeof createHotelSchema>,
) {
  requireAdmin(user);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const actor = await lockActiveActor(tx, user);
    requireAdmin(actor);
    await validateAssignee(tx, input.managerId);
    const hotel: Hotel = {
      id: randomUUID(),
      name: input.name,
      location: input.location,
      services: input.services,
      managerId: input.managerId,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      stage: "onboarding",
      color: "#8b72ed",
      createdAt: new Date().toISOString(),
    };
    await tx.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
      hotel.id,
      JSON.stringify(hotel),
    ]);
    const tasks = input.template
      ? buildTemplateTasks(hotel.id, null, hotel.createdAt)
      : [];
    for (const task of tasks) {
      if (task.department === "Proje Yöneticisi")
        task.assigneeId = hotel.managerId;
      await insertTask(tx, task);
      if (task.assigneeId) await notifyTaskChange(tx, actor, null, task);
    }
    await audit(
      tx,
      actor,
      hotel.id,
      null,
      `Otel oluşturuldu${tasks.length ? `; kaynak şablondan ${tasks.length} görev eklendi` : ""}.`,
    );
    return { hotel, tasks };
  });
}
export async function createTask(
  user: User,
  input: z.infer<typeof createTaskSchema>,
) {
  requireAdmin(user);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const actor = await lockActiveActor(tx, user);
    requireAdmin(actor);
    await requireActiveHotel(tx, input.hotelId, true);
    await validateAssignee(tx, input.assigneeId);
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      hotelId: input.hotelId,
      code: `GOREV-${randomUUID().slice(0, 8).toUpperCase()}`,
      title: input.title,
      description: input.description ?? "",
      department: input.department,
      assigneeId: input.assigneeId ?? null,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      hotelInput: input.hotelInput ?? "",
      stage: input.stage ?? "Genel",
      status: "planned",
      waitingReason: "",
      checklist: (input.checklist ?? []).map((text) => ({
        id: randomUUID(),
        text,
        done: false,
      })),
      createdAt: now,
      updatedAt: now,
    };
    await insertTask(tx, task);
    await audit(
      tx,
      actor,
      task.hotelId,
      task.id,
      `Görev oluşturuldu. Öncelik: ${task.priority}.`,
    );
    await notifyTaskChange(tx, actor, null, task);
    return { task };
  });
}

export async function updateTask(
  user: User,
  taskId: string,
  input: z.infer<typeof patchTaskSchema>,
  expectedVersion?: string,
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const actor = await lockActiveActor(tx, user);
    const task = await findTask(tx, actor, taskId, true);
    // Compare only after acquiring the row lock, so simultaneous writes cannot
    // both pass with a version read before the other transaction committed.
    if (expectedVersion !== undefined && taskVersion(task) !== expectedVersion)
      throw new HttpError(
        409,
        "Görev başka bir ekip üyesi tarafından güncellendi. Güncel bilgileri alıp tekrar deneyin.",
      );
    const before = structuredClone(task);
    let message = "";
    switch (input.action) {
      case "update": {
        requireAdmin(actor);
        const changes = input as unknown as { action: "update" } & Partial<
          z.infer<typeof createTaskSchema>
        >;
        if (
          changes.assigneeId !== undefined &&
          changes.assigneeId !== task.assigneeId
        ) {
          await validateAssignee(tx, changes.assigneeId);
        }
        const fields = [
          "title",
          "description",
          "department",
          "assigneeId",
          "priority",
          "dueDate",
          "hotelInput",
          "stage",
        ] as const;
        const oldPriority = task.priority;
        const changed = fields.filter(
          (field) =>
            changes[field] !== undefined && changes[field] !== task[field],
        );
        for (const field of changed)
          Object.assign(task, { [field]: changes[field] });
        if (!changed.length) return { task };
        message = changed.includes("priority")
          ? `Öncelik ${oldPriority} → ${task.priority} olarak değiştirildi.`
          : "Görev bilgileri güncellendi.";
        if (changed.length > 1 && changed.includes("priority"))
          message += " Diğer görev bilgileri güncellendi.";
        break;
      }
      case "status":
        if (!canSetStatus(actor, task, input.status))
          throw new HttpError(
            403,
            "Bu görevin durumunu değiştiremezsiniz. Kontrol veya tamamlanma aşamasındaki işleri yönetici geri açmalıdır.",
          );
        if (input.status === "waiting" && !input.waitingReason?.trim())
          throw new HttpError(400, "Bekleme nedenini yazın.");
        task.status = input.status;
        task.waitingReason =
          input.status === "waiting" ? input.waitingReason!.trim() : "";
        message = `Durum “${STATUS_LABELS[task.status]}” olarak değiştirildi.${task.waitingReason ? ` Neden: ${task.waitingReason}` : ""}`;
        break;
      case "checklist": {
        if (!canEditChecklist(actor, task))
          throw new HttpError(
            403,
            "Bu görevin kontrol listesini değiştiremezsiniz.",
          );
        const item = task.checklist.find((item) => item.id === input.itemId);
        if (!item) throw new HttpError(404, "Kontrol maddesi bulunamadı.");
        item.done = input.done;
        message = `Tamamlanma kriteri ${input.done ? "işaretlendi" : "yeniden açıldı"}: ${item.text}`;
        break;
      }
      case "submit":
        if (!canWorkOnTask(actor, task))
          throw new HttpError(403, "Bu görevi kontrole gönderemezsiniz.");
        if (!canSubmitTask(actor, task))
          throw new HttpError(
            400,
            "Önce tüm tamamlanma kriterlerini işaretleyin. Görev kontrol veya tamamlandı aşamasında olmamalı.",
          );
        task.status = "review";
        task.waitingReason = "";
        message = "Görev yönetici kontrolüne gönderildi.";
        break;
      case "approve":
        requireAdmin(actor);
        if (!canApproveTask(actor, task))
          throw new HttpError(
            400,
            "Yalnızca kontrol bekleyen işler onaylanabilir.",
          );
        if (!task.checklist.every((item) => item.done))
          throw new HttpError(400, "Tamamlanma kriterleri eksik.");
        task.status = "completed";
        task.waitingReason = "";
        message = "Görev yönetici onayıyla tamamlandı.";
        break;
      case "return":
        requireAdmin(actor);
        if (!canReturnTask(actor, task))
          throw new HttpError(
            400,
            "Yalnızca kontrol bekleyen işler geri gönderilebilir.",
          );
        task.status = "in_progress";
        task.waitingReason = "";
        message = `Görev düzeltme için geri gönderildi. Neden: ${input.reason}`;
        break;
      case "reopen":
        requireAdmin(actor);
        if (task.status !== "completed" && task.status !== "review")
          throw new HttpError(400, "Görev zaten çalışmaya açık.");
        await validateAssignee(
          tx,
          task.assigneeId,
          "Bu görevin sorumlusu artık aktif bir personel değil. Yeniden açmadan önce görevi aktif bir personele atayın.",
        );
        task.status = "in_progress";
        task.waitingReason = "";
        message = `Görev yönetici tarafından yeniden açıldı.${input.reason ? ` Neden: ${input.reason}` : ""}`;
        break;
    }
    task.updatedAt = new Date().toISOString();
    await tx.query(
      "UPDATE tasks SET assignee_id=$2,data=$3::jsonb WHERE id=$1",
      [task.id, task.assigneeId, JSON.stringify(task)],
    );
    await audit(tx, actor, task.hotelId, task.id, message);
    await notifyTaskChange(tx, actor, before, task, {
      reason: "reason" in input ? input.reason : undefined,
    });
    return { task };
  });
}
export async function addComment(
  user: User,
  taskId: string,
  body: string,
  requestId?: string,
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const actor = await lockActiveActor(tx, user);
    const task = await findTask(tx, actor, taskId, true);
    if (!canWorkOnTask(actor, task))
      throw new HttpError(
        403,
        "Yalnızca size atanan görevlere yorum yazabilirsiniz.",
      );
    const commentId = requestId
      ? mobileCommentId(actor.id, taskId, requestId)
      : randomUUID();
    if (requestId) {
      // The task lock serializes retries. Authorization is checked before any
      // lookup, including when access/assignment changed after the first write.
      const [existing] = await tx.query<{ data: TaskComment }>(
        "SELECT data FROM task_comments WHERE id=$1",
        [commentId],
      );
      if (existing) {
        if (
          existing.data.taskId !== taskId ||
          existing.data.userId !== actor.id ||
          existing.data.body !== body
        )
          throw new HttpError(
            409,
            "Bu notun gönderim kimliği başka bir içerik için kullanılmış. Yeni bir not olarak gönderin.",
          );
        return { comment: existing.data };
      }
    }
    const comment: TaskComment = {
      id: commentId,
      taskId,
      userId: actor.id,
      userName: actor.name,
      body,
      createdAt: new Date().toISOString(),
    };
    await tx.query(
      "INSERT INTO task_comments(id,task_id,data) VALUES ($1,$2,$3::jsonb)",
      [comment.id, taskId, JSON.stringify(comment)],
    );
    await audit(tx, actor, task.hotelId, taskId, "Göreve yorum eklendi.");
    return { comment };
  });
}
