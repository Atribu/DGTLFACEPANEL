import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  addCalendarDays,
  createRecurrenceSchema,
  isCalendarDay,
  istanbulToday,
  nextOccurrence,
  occurrenceOnOrAfter,
  type RecurrenceRule,
} from "../lib/recurrence";
import {
  createRecurrence,
  listRecurrences,
  RECURRENCE_CATCH_UP_LIMIT,
  runDueRecurrences,
  updateRecurrence,
} from "../lib/server/recurrences";
import { migrateRecurrenceSchema } from "../lib/server/recurrence-schema";
import { migrateNotificationSchema } from "../lib/server/notification-schema";
import type { Database, Queryable } from "../lib/server/db";
import type { Task } from "../lib/types";
import { admin, hotel, observer, otherStaff, owner } from "./fixtures";

const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
const previous = globals.dgtlDatabase;
let local: PGlite;
let db: Database;
const today = istanbulToday();
const input = (extra = {}) => ({
  hotelId: "hotel-a",
  title: "Haftalık kontrol",
  description: "Fiyatları kontrol edin.",
  department: "Web & IT",
  assigneeId: owner.id,
  priority: 1,
  checklist: ["Fiyatlar kontrol edildi", "Farklar kaydedildi"],
  frequency: "weekly",
  startsOn: today,
  dueOffsetDays: 2,
  ...extra,
});
const tasks = async () =>
  (
    await db.query<{ data: Task }>(
      "SELECT data FROM tasks ORDER BY data->>'recurrenceScheduledOn'",
    )
  ).map((row) => row.data);

before(async () => {
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    close: () => local.close(),
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      local.transaction((tx) =>
        fn({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await tx.query<R>(sql, params)).rows,
        }),
      ),
  };
  await local.exec(`
    CREATE TABLE app_users(id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE hotels(id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks(id text PRIMARY KEY,hotel_id text NOT NULL REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities(id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
  `);
  await migrateRecurrenceSchema(db);
  await migrateNotificationSchema(db);
  globals.dgtlDatabase = Promise.resolve(db);
});
beforeEach(async () => {
  globals.dgtlDatabase = Promise.resolve(db);
  await local.exec(
    "TRUNCATE personal_notifications,recurrence_occurrences,recurrence_rules,activities,tasks,hotels,app_users",
  );
  for (const user of [admin, owner, otherStaff, observer])
    await db.query("INSERT INTO app_users(id,data) VALUES ($1,$2::jsonb)", [
      user.id,
      JSON.stringify(user),
    ]);
  for (const item of [hotel("hotel-a"), hotel("hotel-b")])
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
      item.id,
      JSON.stringify(item),
    ]);
});
after(async () => {
  if (previous) globals.dgtlDatabase = previous;
  else delete globals.dgtlDatabase;
  await db.close();
});

test("monthly dates clamp short months without drifting from the original anchor", () => {
  assert.equal(
    nextOccurrence("2027-01-31", "monthly", "2027-01-31"),
    "2027-02-28",
  );
  assert.equal(
    nextOccurrence("2027-01-31", "monthly", "2027-02-28"),
    "2027-03-31",
  );
  assert.equal(
    nextOccurrence("2028-01-31", "monthly", "2028-01-31"),
    "2028-02-29",
  );
  assert.equal(
    nextOccurrence("2028-01-31", "monthly", "2028-02-29"),
    "2028-03-31",
  );
  assert.equal(
    occurrenceOnOrAfter("2027-01-31", "monthly", "2027-04-29"),
    "2027-04-30",
  );
  assert.equal(
    occurrenceOnOrAfter("2027-01-31", "monthly", "2027-05-01"),
    "2027-05-31",
  );
});
test("weekly dates retain the start weekday and Istanbul date boundaries", () => {
  assert.equal(
    nextOccurrence("2026-03-26", "weekly", "2026-03-26"),
    "2026-04-02",
  );
  assert.equal(
    occurrenceOnOrAfter("2026-03-26", "weekly", "2026-04-03"),
    "2026-04-09",
  );
  assert.equal(istanbulToday(new Date("2026-10-01T21:10:00Z")), "2026-10-02");
  assert.equal(isCalendarDay("2026-02-30"), false);
  for (const value of [0, 11, 1.5])
    assert.equal(
      createRecurrenceSchema.safeParse(input({ priority: value })).success,
      false,
    );
  assert.equal(
    createRecurrenceSchema.safeParse(input({ dueOffsetDays: 31 })).success,
    false,
  );
  assert.equal(
    createRecurrenceSchema.safeParse(input({ checklist: [] })).success,
    false,
  );
});
test("only managers manage or list plans and new plans reject past dates and inactive/observer assignees", async () => {
  for (const actor of [owner, observer]) {
    await assert.rejects(createRecurrence(actor, input()), { status: 403 });
    await assert.rejects(listRecurrences(actor), { status: 403 });
  }
  await assert.rejects(
    createRecurrence(admin, input({ startsOn: addCalendarDays(today, -1) })),
    { status: 400 },
  );
  await assert.rejects(
    createRecurrence(admin, input({ assigneeId: observer.id })),
    { status: 409 },
  );
  const { recurrence } = await createRecurrence(admin, input());
  await assert.rejects(
    updateRecurrence(owner, recurrence.id, { action: "pause" }),
    { status: 403 },
  );
  await db.query(
    "UPDATE app_users SET data=jsonb_set(data,'{active}','false'::jsonb) WHERE id=$1",
    [owner.id],
  );
  await assert.rejects(createRecurrence(admin, input()), { status: 409 });
});
test("parallel workers produce a single independent task, audit, notification and occurrence", async () => {
  const { recurrence } = await createRecurrence(admin, input());
  const outcomes = await Promise.all([
    runDueRecurrences(today),
    runDueRecurrences(today),
    runDueRecurrences(today),
  ]);
  assert.equal(
    outcomes.reduce((sum, item) => sum + item.created, 0),
    1,
  );
  const generated = await tasks();
  assert.equal(generated.length, 1);
  assert.equal(generated[0].recurrenceId, recurrence.id);
  assert.equal(generated[0].dueDate, addCalendarDays(today, 2));
  assert.equal(generated[0].status, "planned");
  assert.equal(generated[0].priority, 1);
  assert.equal(
    generated[0].checklist.every((item) => !item.done),
    true,
  );
  assert.equal(
    (await db.query("SELECT id FROM personal_notifications")).length,
    1,
  );
  assert.equal(
    (await db.query("SELECT id FROM activities WHERE task_id IS NOT NULL"))
      .length,
    1,
  );
  assert.equal(
    (await db.query("SELECT rule_id FROM recurrence_occurrences")).length,
    1,
  );
  await migrateRecurrenceSchema(db);
  assert.equal((await runDueRecurrences(today)).created, 0);
});
test("later periods and edited plans preserve earlier task contents and independent checklist IDs", async () => {
  const { recurrence } = await createRecurrence(admin, input());
  await runDueRecurrences(today);
  const first = (await tasks())[0];
  await updateRecurrence(admin, recurrence.id, {
    action: "update",
    title: "Yeni dönem başlığı",
    priority: 4,
    checklist: ["Yeni kriter"],
  });
  assert.equal((await runDueRecurrences(addCalendarDays(today, 7))).created, 1);
  const generated = await tasks();
  assert.equal(generated[0].title, first.title);
  assert.equal(generated[0].priority, 1);
  assert.equal(generated[1].title, "Yeni dönem başlığı");
  assert.equal(generated[1].priority, 4);
  assert.notEqual(generated[0].checklist[0].id, generated[1].checklist[0].id);
  assert.deepEqual(
    generated[0].checklist.map((item) => item.text),
    input().checklist,
  );
});

test("the monthly worker keeps the original day through a short month", async () => {
  const year = Number(today.slice(0, 4)) + 1;
  const startsOn = `${year}-01-31`;
  await createRecurrence(admin, input({ frequency: "monthly", startsOn }));
  assert.equal((await runDueRecurrences(`${year}-03-31`)).created, 3);
  const generated = await tasks();
  const februaryEnd = addCalendarDays(`${year}-03-01`, -1);
  assert.deepEqual(
    generated.map((item) => item.recurrenceScheduledOn),
    [startsOn, februaryEnd, `${year}-03-31`],
  );
  assert.equal(
    (await listRecurrences(admin)).recurrences[0].nextRunOn,
    `${year}-04-30`,
  );
});
test("pausing suppresses generation and resuming skips missed periods", async () => {
  const { recurrence } = await createRecurrence(admin, input());
  const prior = addCalendarDays(today, -42);
  const historical: RecurrenceRule = {
    ...recurrence,
    startsOn: prior,
    nextRunOn: prior,
  };
  await db.query(
    "UPDATE recurrence_rules SET next_run_on=$2::date,data=$3::jsonb WHERE id=$1",
    [recurrence.id, prior, JSON.stringify(historical)],
  );
  await updateRecurrence(admin, recurrence.id, { action: "pause" });
  assert.equal((await runDueRecurrences(today)).created, 0);
  const resumed = await updateRecurrence(admin, recurrence.id, {
    action: "resume",
  });
  assert.equal(resumed.recurrence.nextRunOn, today);
  assert.equal((await runDueRecurrences(today)).created, 1);
  assert.equal((await tasks())[0].recurrenceScheduledOn, today);
});
test("inactive assignees block generation until the manager reassigns the plan", async () => {
  const { recurrence } = await createRecurrence(admin, input());
  await db.query(
    "UPDATE app_users SET data=jsonb_set(data,'{active}','false'::jsonb) WHERE id=$1",
    [owner.id],
  );
  const blocked = await runDueRecurrences(today);
  assert.equal(blocked.created, 0);
  assert.equal(blocked.blockedRules, 1);
  assert.ok((await listRecurrences(admin)).recurrences[0].blockedReason);
  const audits = (await db.query("SELECT id FROM activities")).length;
  await runDueRecurrences(today);
  assert.equal((await db.query("SELECT id FROM activities")).length, audits);
  await updateRecurrence(admin, recurrence.id, {
    action: "update",
    assigneeId: otherStaff.id,
  });
  assert.equal((await runDueRecurrences(today)).created, 1);
  assert.equal((await tasks())[0].assigneeId, otherStaff.id);
});
test("catch-up is bounded per pass and a second pass finishes the backlog without duplicates", async () => {
  await createRecurrence(admin, input());
  const through = addCalendarDays(today, 20 * 7);
  const first = await runDueRecurrences(through);
  assert.equal(first.created, RECURRENCE_CATCH_UP_LIMIT);
  assert.equal(first.hasMore, true);
  const second = await runDueRecurrences(through);
  assert.equal(second.created, 21 - RECURRENCE_CATCH_UP_LIMIT);
  assert.equal(second.hasMore, false);
  assert.equal((await tasks()).length, 21);
  assert.equal((await runDueRecurrences(through)).created, 0);
});
test("one hundred older blocked plans do not starve a healthy due plan", async () => {
  const { recurrence: template } = await createRecurrence(admin, input());
  const prior = addCalendarDays(today, -7);
  for (let index = 0; index < 100; index++) {
    const blocked: RecurrenceRule = {
      ...template,
      id: index === 0 ? template.id : `blocked-${index}`,
      startsOn: prior,
      nextRunOn: prior,
      blockedReason:
        "Sorumlu artık aktif bir personel veya yönetici değil. Yeni bir sorumlu seçin.",
    };
    await db.query(
      "INSERT INTO recurrence_rules(id,hotel_id,assignee_id,active,next_run_on,data) VALUES ($1,$2,$3,true,$4::date,$5::jsonb) ON CONFLICT (id) DO UPDATE SET next_run_on=EXCLUDED.next_run_on,data=EXCLUDED.data",
      [
        blocked.id,
        blocked.hotelId,
        blocked.assigneeId,
        prior,
        JSON.stringify(blocked),
      ],
    );
  }
  await db.query(
    "UPDATE app_users SET data=jsonb_set(data,'{active}','false'::jsonb) WHERE id=$1",
    [owner.id],
  );
  const { recurrence: healthy } = await createRecurrence(
    admin,
    input({ assigneeId: otherStaff.id }),
  );

  const result = await runDueRecurrences(today);
  assert.equal(result.created, 1);
  assert.equal(result.processedRules, 100);
  assert.equal(result.blockedRules, 99);
  assert.equal(result.hasMore, false);
  const generated = await tasks();
  assert.equal(generated.length, 1);
  assert.equal(generated[0].recurrenceId, healthy.id);
  assert.equal(generated[0].recurrenceScheduledOn, today);
});
test("notification failure rolls back the task, occurrence, audit and schedule together", async () => {
  const { recurrence } = await createRecurrence(admin, input());
  const failing: Database = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("INSERT INTO personal_notifications"))
              throw new Error("Simulated notification storage failure");
            return tx.query<T>(sql, params);
          },
        }),
      ),
  };
  globals.dgtlDatabase = Promise.resolve(failing);
  await assert.rejects(
    runDueRecurrences(today),
    /Simulated notification storage failure/,
  );
  globals.dgtlDatabase = Promise.resolve(db);
  assert.equal((await tasks()).length, 0);
  assert.equal(
    (await db.query("SELECT rule_id FROM recurrence_occurrences")).length,
    0,
  );
  assert.equal(
    (await db.query("SELECT id FROM activities WHERE task_id IS NOT NULL"))
      .length,
    0,
  );
  assert.equal(
    (await listRecurrences(admin)).recurrences[0].nextRunOn,
    recurrence.nextRunOn,
  );
  assert.equal((await runDueRecurrences(today)).created, 1);
});
