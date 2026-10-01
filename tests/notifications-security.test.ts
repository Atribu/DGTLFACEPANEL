import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Task, User } from "../lib/types";
import type { Database, Queryable } from "../lib/server/db";
import {
  generateDueNotifications,
  listNotifications,
  markNotificationRead,
  notificationReadSchema,
  notifyTaskChange,
} from "../lib/server/notifications";
import { migrateNotificationSchema } from "../lib/server/notification-schema";
import { admin, hotel, observer, otherStaff, owner, task } from "./fixtures";

const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
const previousDatabase = globals.dgtlDatabase;
let local: PGlite;
let db: Database;
const secondAdmin: User = { ...admin, id: "second-admin" };
const otherObserver: User = {
  ...observer,
  id: "other-observer",
  hotelIds: ["hotel-b"],
};
const inactiveAdmin: User = { ...admin, id: "inactive-admin", active: false };
const inactiveObserver: User = {
  ...observer,
  id: "inactive-observer",
  active: false,
};

before(async () => {
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      local.transaction((tx) =>
        fn({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await tx.query<R>(sql, params)).rows,
        }),
      ),
    close: () => local.close(),
  };
  await local.exec(`
    CREATE TABLE app_users (id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE hotels (id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE tasks (id text PRIMARY KEY, hotel_id text REFERENCES hotels(id), data jsonb NOT NULL);
  `);
  await migrateNotificationSchema(db);
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec("TRUNCATE personal_notifications,tasks,hotels,app_users");
  for (const user of [
    admin,
    secondAdmin,
    owner,
    otherStaff,
    observer,
    otherObserver,
    inactiveAdmin,
    inactiveObserver,
  ])
    await db.query("INSERT INTO app_users(id,data) VALUES ($1,$2::jsonb)", [
      user.id,
      JSON.stringify(user),
    ]);
  for (const item of [hotel("hotel-a"), hotel("hotel-b")])
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
      item.id,
      JSON.stringify(item),
    ]);
  for (const item of [
    task(),
    task({
      id: "task-b",
      hotelId: "hotel-b",
      assigneeId: otherStaff.id,
      dueDate: "2026-10-02",
    }),
    task({ id: "no-date", dueDate: null }),
    task({ id: "future", dueDate: "2026-10-10" }),
    task({ id: "completed", status: "completed", dueDate: "2026-10-01" }),
  ])
    await db.query(
      "INSERT INTO tasks(id,hotel_id,data) VALUES ($1,$2,$3::jsonb)",
      [item.id, item.hotelId, JSON.stringify(item)],
    );
});

after(async () => {
  if (previousDatabase) globals.dgtlDatabase = previousDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

const changed = (
  actor: User | null,
  before: Task | null,
  after: Task,
  detail = {},
) => db.transaction((tx) => notifyTaskChange(tx, actor, before, after, detail));

test("assignment sends one personal notification, excludes the actor and deduplicates a stable event key", async () => {
  const key = { eventKey: "task-created-1" };
  assert.deepEqual(await changed(admin, null, task(), key), { created: 1 });
  assert.deepEqual(await changed(admin, null, task(), key), { created: 0 });
  await migrateNotificationSchema(db);
  const result = await listNotifications(owner);
  assert.equal(result.unreadCount, 1);
  assert.equal(result.notifications[0].kind, "assigned");
  assert.equal(result.notifications[0].userId, owner.id);
  assert.equal((await listNotifications(admin)).notifications.length, 0);
  assert.deepEqual(
    await changed(owner, null, task(), { eventKey: "self-created" }),
    { created: 0 },
  );
  assert.deepEqual(await changed(admin, task(), task()), { created: 0 });
  const next = task({ assigneeId: otherStaff.id });
  assert.deepEqual(await changed(admin, task(), next), { created: 1 });
  assert.equal(
    (await listNotifications(otherStaff)).notifications[0].kind,
    "assigned",
  );
});

test("priority and deadline edits reach the assignee; inactive or observer assignees receive nothing", async () => {
  const after = task({ priority: 1, dueDate: "2026-10-05" });
  assert.deepEqual(await changed(admin, task(), after), { created: 2 });
  assert.deepEqual(
    (await listNotifications(owner)).notifications
      .map((item) => item.kind)
      .sort(),
    ["due_date_changed", "priority_changed"],
  );
  assert.deepEqual(await changed(owner, task(), after), { created: 0 });
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
    owner.id,
    JSON.stringify({ ...owner, active: false }),
  ]);
  assert.deepEqual(await changed(admin, task(), after), { created: 0 });
  assert.deepEqual(
    await changed(admin, null, task({ assigneeId: observer.id })),
    { created: 0 },
  );
});

test("review requests reach active administrators, returns carry the reason, and only scoped observers receive waiting and approval updates", async () => {
  const review = task({ status: "review" });
  assert.deepEqual(await changed(owner, task(), review), { created: 2 });
  assert.equal(
    (await listNotifications(admin)).notifications[0].kind,
    "review_requested",
  );
  await changed(admin, review, task(), {
    reason: "Rezervasyon bağlantısını tekrar kontrol edin.",
  });
  assert.match(
    (await listNotifications(owner)).notifications[0].message,
    /Rezervasyon bağlantısını tekrar kontrol edin/,
  );
  const waiting = task({
    status: "waiting",
    waitingReason: "Otel görselleri bekleniyor.",
  });
  assert.deepEqual(await changed(owner, task(), waiting), { created: 3 });
  const observerWaiting = (await listNotifications(observer)).notifications;
  assert.equal(observerWaiting[0].kind, "waiting");
  assert.match(observerWaiting[0].message, /Otel görselleri/);
  assert.deepEqual(
    await changed(admin, review, task({ status: "completed" })),
    { created: 2 },
  );
  assert.equal((await listNotifications(observer)).unreadCount, 2);
  assert.equal((await listNotifications(otherObserver)).unreadCount, 0);
  const inactive = await db.query(
    "SELECT id FROM personal_notifications WHERE user_id=ANY($1::text[])",
    [[inactiveAdmin.id, inactiveObserver.id]],
  );
  assert.equal(inactive.length, 0);
});

test("personal reads cannot inspect or mark another user's notifications, including read-all", async () => {
  await changed(admin, null, task());
  await changed(owner, task(), task({ status: "review" }));
  const own = (await listNotifications(owner)).notifications[0];
  const another = (await listNotifications(admin)).notifications[0];
  await assert.rejects(markNotificationRead(owner, another.id), {
    status: 404,
  });
  await assert.rejects(markNotificationRead(otherStaff, own.id), {
    status: 404,
  });
  await markNotificationRead(owner, own.id);
  assert.equal((await listNotifications(owner)).unreadCount, 0);
  assert.ok((await listNotifications(owner)).notifications[0].readAt);
  const readAt = (await listNotifications(owner)).notifications[0].readAt;
  await markNotificationRead(owner, own.id);
  assert.equal(
    (await listNotifications(owner)).notifications[0].readAt,
    readAt,
  );
  await markNotificationRead(owner);
  assert.equal((await listNotifications(admin)).unreadCount, 1);
  assert.equal((await listNotifications(otherStaff)).notifications.length, 0);
});

test("hotel scope and active status are reloaded from persisted user data for every list and read", async () => {
  await changed(
    admin,
    task({ status: "review" }),
    task({ status: "completed" }),
  );
  const notification = (await listNotifications(observer)).notifications[0];
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
    observer.id,
    JSON.stringify({ ...observer, hotelIds: ["hotel-b"] }),
  ]);
  assert.deepEqual(await listNotifications(observer), {
    notifications: [],
    unreadCount: 0,
  });
  await assert.rejects(markNotificationRead(observer, notification.id), {
    status: 404,
  });
  assert.deepEqual(await markNotificationRead(observer), {
    ok: true,
    updated: 0,
  });
  const [stored] = await db.query<{ read_at: Date | null }>(
    "SELECT read_at FROM personal_notifications WHERE id=$1",
    [notification.id],
  );
  assert.equal(stored.read_at, null);
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
    owner.id,
    JSON.stringify({ ...owner, active: false }),
  ]);
  await assert.rejects(listNotifications(owner), { status: 403 });
  await assert.rejects(markNotificationRead(owner), { status: 403 });
});

test("deadline reminders are date-keyed, skip closed/undated/future tasks and observers, and stay unique across concurrent runs", async () => {
  const runs = await Promise.all([
    generateDueNotifications("2026-10-03"),
    generateDueNotifications("2026-10-03"),
  ]);
  assert.equal(
    runs.reduce((total, item) => total + item.created, 0),
    6,
  );
  assert.equal(
    (await listNotifications(owner)).notifications[0].kind,
    "due_today",
  );
  assert.equal(
    (await listNotifications(otherStaff)).notifications[0].kind,
    "overdue",
  );
  assert.equal((await listNotifications(admin)).unreadCount, 2);
  assert.equal((await listNotifications(observer)).unreadCount, 0);
  assert.deepEqual(await generateDueNotifications("2026-10-03"), {
    created: 0,
  });
  assert.deepEqual(await generateDueNotifications("2026-10-04"), {
    created: 3,
  });
  assert.deepEqual(await generateDueNotifications("2026-10-05"), {
    created: 0,
  });
  assert.equal((await listNotifications(owner)).unreadCount, 2);
  await assert.rejects(generateDueNotifications("2026-02-30"), { status: 400 });
});

test("deadline changes create a new reminder key and administrators assigned to a task are not duplicated", async () => {
  await generateDueNotifications("2026-10-03");
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    "task-a",
    JSON.stringify(task({ assigneeId: admin.id, dueDate: "2026-10-04" })),
  ]);
  assert.deepEqual(await generateDueNotifications("2026-10-04"), {
    created: 2,
  });
  const adminNew = (await listNotifications(admin)).notifications.filter(
    (item) => item.taskId === "task-a" && item.kind === "due_today",
  );
  assert.equal(adminNew.length, 2);
  assert.equal((await listNotifications(owner)).notifications.length, 1);
});

test("the list caps at 100 while unread count and read-all cover all visible records", async () => {
  for (let i = 0; i < 105; i++)
    await changed(null, null, task(), { eventKey: `recurrence:test:${i}` });
  let listed = await listNotifications(owner);
  assert.equal(listed.notifications.length, 100);
  assert.equal(listed.unreadCount, 105);
  assert.deepEqual(await markNotificationRead(owner), {
    ok: true,
    updated: 105,
  });
  listed = await listNotifications(owner);
  assert.equal(listed.unreadCount, 0);
  assert.ok(listed.notifications.every((item) => item.readAt));
  await changed(null, null, task(), { eventKey: "newest-event" });
  listed = await listNotifications(owner);
  assert.equal(listed.notifications[0].readAt, null);
  assert.equal(listed.unreadCount, 1);
});

test("notification inserts roll back with the containing task transaction and API bodies reject recipient injection", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await notifyTaskChange(tx, admin, null, task());
      throw new Error("Roll back task change");
    }),
    /Roll back task change/,
  );
  assert.equal((await listNotifications(owner)).notifications.length, 0);
  assert.equal(
    notificationReadSchema.safeParse({ action: "read_all", userId: admin.id })
      .success,
    false,
  );
  assert.equal(
    notificationReadSchema.safeParse({ action: "read", id: "bad/id" }).success,
    false,
  );
  assert.equal(
    notificationReadSchema.safeParse({ action: "read_all" }).success,
    true,
  );
});
