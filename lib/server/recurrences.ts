import { randomUUID } from "node:crypto";
import {
  createRecurrenceSchema,
  patchRecurrenceSchema,
  istanbulToday,
  isCalendarDay,
  occurrenceOnOrAfter,
  nextOccurrence,
  addCalendarDays,
  type RecurrenceRule,
} from "../recurrence";
import type { Activity, Task, User } from "../types";
import { getDb, type Queryable } from "./db";
import { HttpError, requireAdmin } from "./http";
import { notifyTaskChange } from "./notifications";

export const RECURRENCE_CATCH_UP_LIMIT = 12;
class RetryRule extends Error {}

async function lockPeople(tx: Queryable, ids: string[]) {
  return (
    await tx.query<{ data: User }>(
      "SELECT data FROM app_users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
      [[...new Set(ids)].sort()],
    )
  ).map((row) => row.data);
}
function validAssignee(user: User | undefined) {
  return !!user && user.active !== false && user.role !== "observer";
}
function freshAdmin(users: User[], actor: User) {
  const fresh = users.find((user) => user.id === actor.id);
  if (!fresh) throw new HttpError(403, "Yönetici hesabı bulunamadı.");
  requireAdmin(fresh);
  return fresh;
}
async function saveRule(tx: Queryable, rule: RecurrenceRule) {
  await tx.query(
    "UPDATE recurrence_rules SET assignee_id=$2,active=$3,next_run_on=$4::date,data=$5::jsonb WHERE id=$1",
    [
      rule.id,
      rule.assigneeId,
      rule.active,
      rule.nextRunOn,
      JSON.stringify(rule),
    ],
  );
}
async function audit(
  tx: Queryable,
  rule: RecurrenceRule,
  actor: User | null,
  taskId: string | null,
  message: string,
) {
  const item: Activity = {
    id: randomUUID(),
    hotelId: rule.hotelId,
    taskId,
    userId: actor?.id || "system",
    userName: actor?.name || "Düzenli işler",
    message,
    createdAt: new Date().toISOString(),
  };
  await tx.query(
    "INSERT INTO activities(id,hotel_id,task_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [item.id, item.hotelId, taskId, JSON.stringify(item)],
  );
}

export async function listRecurrences(user: User) {
  requireAdmin(user);
  const db = await getDb();
  const recurrences = (
    await db.query<{ data: RecurrenceRule }>(
      "SELECT data FROM recurrence_rules ORDER BY active DESC,next_run_on,id",
    )
  ).map((row) => row.data);
  return { recurrences };
}
export async function createRecurrence(actor: User, rawInput: unknown) {
  requireAdmin(actor);
  const input = createRecurrenceSchema.parse(rawInput);
  if (input.startsOn < istanbulToday())
    throw new HttpError(
      400,
      "Başlangıç tarihi bugün veya sonraki bir gün olmalı.",
    );
  const db = await getDb();
  return db.transaction(async (tx) => {
    const people = await lockPeople(tx, [actor.id, input.assigneeId]);
    const fresh = freshAdmin(people, actor);
    if (!validAssignee(people.find((user) => user.id === input.assigneeId)))
      throw new HttpError(
        409,
        "Sorumlu, aktif bir personel veya yönetici olmalı.",
      );
    if (
      !(await tx.query("SELECT id FROM hotels WHERE id=$1", [input.hotelId]))
        .length
    )
      throw new HttpError(404, "Otel bulunamadı.");
    const now = new Date().toISOString();
    const recurrence: RecurrenceRule = {
      ...input,
      id: randomUUID(),
      active: true,
      nextRunOn: input.startsOn,
      lastRunOn: null,
      blockedReason: null,
      createdBy: fresh.id,
      createdByName: fresh.name,
      createdAt: now,
      updatedAt: now,
    };
    await tx.query(
      "INSERT INTO recurrence_rules(id,hotel_id,assignee_id,active,next_run_on,data) VALUES ($1,$2,$3,true,$4::date,$5::jsonb)",
      [
        recurrence.id,
        recurrence.hotelId,
        recurrence.assigneeId,
        recurrence.nextRunOn,
        JSON.stringify(recurrence),
      ],
    );
    await audit(
      tx,
      recurrence,
      fresh,
      null,
      `Düzenli iş oluşturuldu: ${recurrence.title}.`,
    );
    return { recurrence };
  });
}

export async function updateRecurrence(
  actor: User,
  ruleId: string,
  rawInput: unknown,
) {
  requireAdmin(actor);
  const input = patchRecurrenceSchema.parse(rawInput);
  const db = await getDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [snapshot] = await tx.query<{ data: RecurrenceRule }>(
          "SELECT data FROM recurrence_rules WHERE id=$1",
          [ruleId],
        );
        if (!snapshot) throw new HttpError(404, "Düzenli iş bulunamadı.");
        const people = await lockPeople(tx, [
          actor.id,
          snapshot.data.assigneeId,
          ...(input.action === "update" && input.assigneeId
            ? [input.assigneeId]
            : []),
        ]);
        const fresh = freshAdmin(people, actor);
        const [locked] = await tx.query<{ data: RecurrenceRule }>(
          "SELECT data FROM recurrence_rules WHERE id=$1 FOR UPDATE",
          [ruleId],
        );
        if (!locked) throw new HttpError(404, "Düzenli iş bulunamadı.");
        const rule = locked.data;
        if (rule.assigneeId !== snapshot.data.assigneeId) throw new RetryRule();
        if (input.action === "pause") rule.active = false;
        else {
          if (input.action === "update") {
            const { action: _, ...changes } = input;
            for (const [field, value] of Object.entries(changes))
              if (value !== undefined) Object.assign(rule, { [field]: value });
          }
          if (
            !validAssignee(people.find((user) => user.id === rule.assigneeId))
          )
            throw new HttpError(
              409,
              "Sorumlu aktif değil. Devam etmek için aktif bir personel veya yönetici seçin.",
            );
          rule.blockedReason = null;
          if (input.action === "resume" && !rule.active) {
            rule.active = true;
            const resumeOn =
              rule.lastRunOn && rule.lastRunOn >= istanbulToday()
                ? addCalendarDays(rule.lastRunOn, 1)
                : istanbulToday();
            rule.nextRunOn = occurrenceOnOrAfter(
              rule.startsOn,
              rule.frequency,
              resumeOn,
            );
          }
        }
        rule.updatedAt = new Date().toISOString();
        await saveRule(tx, rule);
        await audit(
          tx,
          rule,
          fresh,
          null,
          input.action === "pause"
            ? `Düzenli iş duraklatıldı: ${rule.title}.`
            : input.action === "resume"
              ? `Düzenli iş devam ettirildi; duraklama dönemleri atlandı: ${rule.title}.`
              : `Düzenli işin sonraki görevleri için bilgiler güncellendi: ${rule.title}.`,
        );
        return { recurrence: rule };
      });
    } catch (error) {
      if (!(error instanceof RetryRule)) throw error;
    }
  }
  throw new HttpError(
    409,
    "Düzenli iş başka bir işlemde değişti. Lütfen tekrar deneyin.",
  );
}

export async function runDueRecurrences(today = istanbulToday()) {
  if (!isCalendarDay(today)) throw new Error("Geçerli işlem tarihi gerekiyor.");
  const db = await getDb();
  const candidates = await db.query<{ id: string }>(
    "SELECT id FROM recurrence_rules WHERE active=true AND next_run_on<=$1::date ORDER BY (data->>'blockedReason' IS NOT NULL),next_run_on,id LIMIT 100",
    [today],
  );
  let created = 0,
    blockedRules = 0;
  for (const { id } of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await db.transaction(async (tx) => {
          const [snapshot] = await tx.query<{ data: RecurrenceRule }>(
            "SELECT data FROM recurrence_rules WHERE id=$1",
            [id],
          );
          if (!snapshot) return { created: 0, blocked: false };
          const people = await lockPeople(tx, [snapshot.data.assigneeId]);
          const [locked] = await tx.query<{ data: RecurrenceRule }>(
            "SELECT data FROM recurrence_rules WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!locked) return { created: 0, blocked: false };
          const rule = locked.data;
          if (rule.assigneeId !== snapshot.data.assigneeId)
            throw new RetryRule();
          if (!rule.active || rule.nextRunOn > today)
            return { created: 0, blocked: false };
          if (
            !validAssignee(people.find((user) => user.id === rule.assigneeId))
          ) {
            const reason =
              "Sorumlu artık aktif bir personel veya yönetici değil. Yeni bir sorumlu seçin.";
            if (rule.blockedReason !== reason) {
              rule.blockedReason = reason;
              rule.updatedAt = new Date().toISOString();
              await saveRule(tx, rule);
              await audit(
                tx,
                rule,
                null,
                null,
                `Düzenli iş beklemeye alındı: ${reason}`,
              );
            }
            return { created: 0, blocked: true };
          }
          let count = 0;
          for (
            let cycle = 0;
            cycle < RECURRENCE_CATCH_UP_LIMIT && rule.nextRunOn <= today;
            cycle++
          ) {
            const day = rule.nextRunOn;
            const reserved = await tx.query(
              "INSERT INTO recurrence_occurrences(rule_id,scheduled_on) VALUES ($1,$2::date) ON CONFLICT DO NOTHING RETURNING rule_id",
              [rule.id, day],
            );
            if (reserved.length) {
              const now = new Date().toISOString();
              const task: Task & {
                recurrenceId: string;
                recurrenceScheduledOn: string;
              } = {
                id: randomUUID(),
                hotelId: rule.hotelId,
                code: `REC-${rule.id.slice(0, 6).toUpperCase()}-${day.replaceAll("-", "")}`,
                title: rule.title,
                description: rule.description,
                department: rule.department,
                assigneeId: rule.assigneeId,
                priority: rule.priority,
                status: "planned",
                dueDate: addCalendarDays(day, rule.dueOffsetDays),
                stage: "Düzenli işler",
                hotelInput: "",
                waitingReason: "",
                checklist: rule.checklist.map((text) => ({
                  id: randomUUID(),
                  text,
                  done: false,
                })),
                createdAt: now,
                updatedAt: now,
                recurrenceId: rule.id,
                recurrenceScheduledOn: day,
              };
              await tx.query(
                "INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)",
                [task.id, task.hotelId, task.assigneeId, JSON.stringify(task)],
              );
              await tx.query(
                "UPDATE recurrence_occurrences SET task_id=$3 WHERE rule_id=$1 AND scheduled_on=$2::date",
                [rule.id, day, task.id],
              );
              await audit(
                tx,
                rule,
                null,
                task.id,
                `${day} dönemi için düzenli görev oluşturuldu.`,
              );
              await notifyTaskChange(tx, null, null, task, {
                eventKey: `recurrence:${rule.id}:${day}`,
              });
              count++;
            }
            rule.lastRunOn = day;
            rule.nextRunOn = nextOccurrence(rule.startsOn, rule.frequency, day);
          }
          rule.blockedReason = null;
          rule.updatedAt = new Date().toISOString();
          await saveRule(tx, rule);
          return { created: count, blocked: false };
        });
        created += result.created;
        if (result.blocked) blockedRules++;
        break;
      } catch (error) {
        if (!(error instanceof RetryRule) || attempt === 2) throw error;
      }
    }
  }
  const remaining = await db.query(
    "SELECT id FROM recurrence_rules WHERE active=true AND next_run_on<=$1::date AND data->>'blockedReason' IS NULL LIMIT 1",
    [today],
  );
  return {
    created,
    processedRules: candidates.length,
    blockedRules,
    hasMore: remaining.length > 0,
  };
}
