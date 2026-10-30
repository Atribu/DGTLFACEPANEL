import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "../lib/server/db";
import type { Hotel, User } from "../lib/types";
import { migrateUserSchema } from "../lib/server/user-schema";
import { migrateAttachmentSchema } from "../lib/server/attachment-schema";
import { migrateNotificationSchema } from "../lib/server/notification-schema";
import { migrateRecurrenceSchema } from "../lib/server/recurrence-schema";
import { migrateHotelSchema } from "../lib/server/hotel-schema";
import { migrateOwnerConsoleSchema } from "../lib/server/owner-console-schema";
import { archiveHotel, restoreHotel, deleteHotel, deleteHotelSchema, hotelLifecycleSchema, listArchivedHotels, type HotelLifecycleEvent } from "../lib/server/hotel-lifecycle";
import { resolveSessionUser } from "../lib/server/auth";
import { activity, admin, comment, hotel, observer, owner, stamp, task } from "./fixtures";

// Every operation uses this in-memory PostgreSQL database; no .data or production access.
const globals = globalThis as typeof globalThis & { dgtlDatabase?: Promise<Database> };
const previousDatabase = globals.dgtlDatabase;
const multiObserver: User = { ...observer, id: "multi-observer", email: "multi@example.test", hotelIds: ["hotel-a", "hotel-b"] };
const legacyStaff: User = { ...owner, id: "legacy-staff", email: "legacy@example.test", hotelIds: ["hotel-a"] };
let local: PGlite;
let db: Database;

before(async () => {
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    query: async <T>(sql: string, params: unknown[] = []) => (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => local.transaction((tx) => fn({
      query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows,
    })),
    close: () => local.close(),
  };
  await local.exec(`
    CREATE TABLE app_meta (key text PRIMARY KEY,value text NOT NULL);
    CREATE TABLE app_users (id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,data jsonb NOT NULL);
    CREATE TABLE hotels (id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks (id text PRIMARY KEY,hotel_id text NOT NULL REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities (id text PRIMARY KEY,hotel_id text NOT NULL REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
    CREATE TABLE task_comments (id text PRIMARY KEY,task_id text NOT NULL REFERENCES tasks(id),data jsonb NOT NULL);
  `);
  await migrateUserSchema(db);
  await migrateAttachmentSchema(db);
  await migrateNotificationSchema(db);
  await migrateRecurrenceSchema(db);
  await migrateHotelSchema(db);
  await migrateOwnerConsoleSchema(db);
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec("TRUNCATE account_sessions,account_events,hotel_events,recurrence_occurrences,recurrence_rules,personal_notifications,task_attachments,task_comments,activities,tasks,hotels,user_events,app_users,app_meta");
  for (const user of [admin, owner, observer, multiObserver, legacyStaff]) {
    await db.query("INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,'unused-test-hash',$3::jsonb)", [user.id, user.email, JSON.stringify(user)]);
  }
  for (const id of ["hotel-a", "hotel-b"]) {
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [id, JSON.stringify(hotel(id))]);
    const item = task({ id: `task-${id}`, hotelId: id });
    await db.query("INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)", [item.id, id, owner.id, JSON.stringify(item)]);
    const note = comment(item.id);
    await db.query("INSERT INTO task_comments(id,task_id,data) VALUES ($1,$2,$3::jsonb)", [note.id, item.id, JSON.stringify(note)]);
    const event = activity(id, item.id);
    await db.query("INSERT INTO activities(id,hotel_id,task_id,data) VALUES ($1,$2,$3,$4::jsonb)", [event.id, id, item.id, JSON.stringify(event)]);
    await db.query("INSERT INTO task_attachments(id,task_id,uploader_id,data,content) VALUES ($1,$2,$3,$4::jsonb,$5)", [`file-${id}`, item.id, owner.id, JSON.stringify({ kind: "file", name: `file-${id}.txt` }), Buffer.from(`private bytes ${id}`)]);
    await db.query("INSERT INTO personal_notifications(id,user_id,task_id,hotel_id,event_key,data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [`notification-${id}`, owner.id, item.id, id, `event-${id}`, JSON.stringify({ text: `notification ${id}` })]);
    const rule = { id: `rule-${id}`, hotelId: id, assigneeId: owner.id, active: true, nextRunOn: "2026-10-30", updatedAt: stamp, blockedReason: null };
    await db.query("INSERT INTO recurrence_rules(id,hotel_id,assignee_id,active,next_run_on,data) VALUES ($1,$2,$3,true,'2026-10-30',$4::jsonb)", [rule.id, id, owner.id, JSON.stringify(rule)]);
    await db.query("INSERT INTO recurrence_occurrences(rule_id,scheduled_on,task_id) VALUES ($1,'2026-10-23',$2)", [rule.id, item.id]);
  }
  const done = task({ id: "completed-a", status: "completed" });
  await db.query("INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)", [done.id, done.hotelId, done.assigneeId, JSON.stringify(done)]);
  await db.query("INSERT INTO task_attachments(id,task_id,uploader_id,data,content,deleted_at,deleted_by) VALUES ('deleted-file-a','completed-a',$1,$2::jsonb,$3,$4,$1)", [owner.id, JSON.stringify({ kind: "file", name: "deleted.txt" }), Buffer.from("soft deleted bytes"), stamp]);
  const paused = { id: "paused-rule-a", hotelId: "hotel-a", active: false, updatedAt: stamp, nextRunOn: "2026-10-30" };
  await db.query("INSERT INTO recurrence_rules(id,hotel_id,assignee_id,active,next_run_on,data) VALUES ($1,$2,$3,false,'2026-10-30',$4::jsonb)", [paused.id, paused.hotelId, owner.id, JSON.stringify(paused)]);
  await db.query("INSERT INTO app_meta(key,value) VALUES ('checklist-import-v1','completed')");
});

after(async () => {
  if (previousDatabase) globals.dgtlDatabase = previousDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

async function dataRows(table: "tasks" | "task_comments" | "task_attachments" | "activities" | "personal_notifications" | "recurrence_rules") {
  return db.query(`SELECT * FROM ${table} ORDER BY id`);
}
async function storedHotel(id = "hotel-a") {
  return (await db.query<{ data: Hotel }>("SELECT data FROM hotels WHERE id=$1", [id]))[0]?.data;
}
async function events() {
  return (await db.query<{ data: HotelLifecycleEvent }>("SELECT data FROM hotel_events ORDER BY data->>'createdAt',id")).map(({ data }) => data);
}
const confirm = (item: Hotel) => ({ confirmationName: item.name, archivedAt: item.archivedAt });

test("additive hotel migration preserves data and can run repeatedly", async () => {
  await migrateHotelSchema(db);
  await migrateHotelSchema(db);
  assert.deepEqual(await storedHotel(), hotel("hotel-a"));
  assert.equal((await db.query("SELECT id FROM tasks")).length, 3);
});

test("archive preserves hotel content and membership, pauses active rules, and is idempotent", async () => {
  const tables = ["tasks", "task_comments", "task_attachments", "activities", "personal_notifications"] as const;
  const beforeRows = await Promise.all(tables.map(dataRows));
  const people = await db.query("SELECT * FROM app_users ORDER BY id");
  const otherRules = await db.query("SELECT * FROM recurrence_rules WHERE hotel_id='hotel-b'");
  const pausedBefore = await db.query("SELECT * FROM recurrence_rules WHERE id='paused-rule-a'");
  const result = await archiveHotel(admin, "hotel-a");
  assert.ok(result.hotel.archivedAt);
  assert.deepEqual({ ...result.hotel, archivedAt: undefined }, { ...hotel("hotel-a"), archivedAt: undefined });
  assert.deepEqual(await Promise.all(tables.map(dataRows)), beforeRows);
  assert.deepEqual(await db.query("SELECT * FROM app_users ORDER BY id"), people);
  assert.deepEqual(await db.query("SELECT * FROM recurrence_rules WHERE hotel_id='hotel-b'"), otherRules);
  assert.deepEqual(await db.query("SELECT * FROM recurrence_rules WHERE id='paused-rule-a'"), pausedBefore);
  const [rule] = await db.query<{ active: boolean; data: { active: boolean; nextRunOn: string; updatedAt: string } }>("SELECT active,data FROM recurrence_rules WHERE id='rule-hotel-a'");
  assert.equal(rule.active, false);
  assert.equal(rule.data.active, false);
  assert.equal(rule.data.nextRunOn, "2026-10-30");
  assert.equal(rule.data.updatedAt, result.hotel.archivedAt);
  assert.deepEqual(await archiveHotel(admin, "hotel-a"), result);
  const audit = await events();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "archive");
  assert.deepEqual(audit[0].counts, { tasks: 2, comments: 1, attachments: 2, recurrences: 2 });
});

test("archive list excludes active hotels and counts even soft-deleted file records", async () => {
  assert.deepEqual(await listArchivedHotels(admin), { hotels: [] });
  const { hotel: archived } = await archiveHotel(admin, "hotel-a");
  assert.deepEqual(await listArchivedHotels(admin), { hotels: [{ hotel: archived, counts: { tasks: 2, comments: 1, attachments: 2, recurrences: 2 } }] });
});

test("restore recovers the hotel unchanged and never automatically resumes paused schedules", async () => {
  const beforeTasks = await dataRows("tasks");
  await archiveHotel(admin, "hotel-a");
  const pausedRules = await dataRows("recurrence_rules");
  assert.deepEqual(await restoreHotel(admin, "hotel-a"), { hotel: hotel("hotel-a") });
  assert.deepEqual(await storedHotel(), hotel("hotel-a"));
  assert.deepEqual(await dataRows("tasks"), beforeTasks);
  assert.deepEqual(await dataRows("recurrence_rules"), pausedRules);
  assert.deepEqual(await listArchivedHotels(admin), { hotels: [] });
  await restoreHotel(admin, "hotel-a");
  assert.deepEqual((await events()).map((item) => item.action).sort(), ["archive", "restore"]);
});

test("only a current active administrator can list, archive, restore or permanently delete", async () => {
  for (const actor of [owner, observer, { ...admin, active: false }, { ...admin, deletedAt: stamp }]) {
    await assert.rejects(listArchivedHotels(actor), { status: 403 });
    await assert.rejects(archiveHotel(actor, "hotel-a"), { status: 403 });
    await assert.rejects(restoreHotel(actor, "hotel-a"), { status: 403 });
    await assert.rejects(deleteHotel(actor, "hotel-a", { confirmationName: "hotel-a", archivedAt: stamp }), { status: 403 });
  }
  for (const changes of [{ role: "staff" }, { active: false }, { deletedAt: stamp }]) {
    await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [admin.id, JSON.stringify({ ...admin, ...changes })]);
    await assert.rejects(listArchivedHotels(admin), { status: 403 });
    await assert.rejects(archiveHotel(admin, "hotel-a"), { status: 403 });
    await assert.rejects(restoreHotel(admin, "hotel-a"), { status: 403 });
    await assert.rejects(deleteHotel(admin, "hotel-a", { confirmationName: "hotel-a", archivedAt: stamp }), { status: 403 });
  }
  assert.equal((await storedHotel()).archivedAt, undefined);
  assert.equal((await events()).length, 0);
});

test("permanent deletion requires archived state, exact trimmed name and current archive generation", async () => {
  await assert.rejects(deleteHotel(admin, "hotel-a", { confirmationName: "hotel-a", archivedAt: stamp }), { status: 409 });
  const { hotel: archived } = await archiveHotel(admin, "hotel-a");
  await assert.rejects(deleteHotel(admin, "hotel-a", { ...confirm(archived), confirmationName: "HOTEL-A" }), { status: 400 });
  await assert.rejects(deleteHotel(admin, "hotel-a", { ...confirm(archived), archivedAt: stamp }), { status: 409 });
  await restoreHotel(admin, "hotel-a");
  await assert.rejects(deleteHotel(admin, "hotel-a", confirm(archived)), { status: 409 });
  assert.equal((await db.query("SELECT id FROM tasks")).length, 3);
  assert.equal((await db.query("SELECT id FROM task_attachments")).length, 3);
  assert.equal((await events()).filter((item) => item.action === "delete").length, 0);
});

test("permanent deletion removes every dependent record and bytes while preserving the other hotel", async () => {
  const otherHotel = await storedHotel("hotel-b");
  const otherTask = await db.query("SELECT * FROM tasks WHERE hotel_id='hotel-b'");
  const otherFiles = await db.query("SELECT * FROM task_attachments WHERE task_id='task-hotel-b'");
  const otherRule = await db.query("SELECT * FROM recurrence_rules WHERE hotel_id='hotel-b'");
  const { hotel: archived } = await archiveHotel(admin, "hotel-a");
  const result = await deleteHotel(admin, "hotel-a", { ...confirm(archived), confirmationName: "  hotel-a  " });
  assert.deepEqual(result, { deleted: true, hotelId: "hotel-a", counts: { tasks: 2, comments: 1, attachments: 2, recurrences: 2 } });
  assert.equal(await storedHotel(), undefined);
  assert.deepEqual(await storedHotel("hotel-b"), otherHotel);
  assert.deepEqual(await db.query("SELECT * FROM tasks WHERE hotel_id='hotel-b'"), otherTask);
  assert.deepEqual(await db.query("SELECT * FROM task_attachments WHERE task_id='task-hotel-b'"), otherFiles);
  assert.deepEqual(await db.query("SELECT * FROM recurrence_rules WHERE hotel_id='hotel-b'"), otherRule);
  for (const table of ["tasks", "task_comments", "task_attachments", "activities", "personal_notifications", "recurrence_rules"] as const) {
    const rows = await dataRows(table);
    assert.equal(rows.length, 1, table);
    assert.equal(JSON.stringify(rows).includes("hotel-a"), false, table);
  }
  assert.deepEqual(await db.query("SELECT rule_id,task_id FROM recurrence_occurrences"), [{ rule_id: "rule-hotel-b", task_id: "task-hotel-b" }]);
  assert.deepEqual(await db.query("SELECT * FROM app_meta"), [{ key: "checklist-import-v1", value: "completed" }]);
  const receipts = await events();
  assert.equal(receipts.filter((item) => item.action === "delete").length, 1);
  assert.equal(JSON.stringify(receipts).includes("private bytes"), false);
  assert.equal(JSON.stringify(receipts).includes("Kontrol notu"), false);
  await assert.rejects(deleteHotel(admin, "hotel-a", confirm(archived)), { status: 404 });
});

test("deletion trims hotel memberships and revokes only affected sessions without deleting accounts", async () => {
  const { hotel: archived } = await archiveHotel(admin, "hotel-a");
  await deleteHotel(admin, "hotel-a", confirm(archived));
  const rows = await db.query<{ data: User; auth_version: number }>("SELECT data,auth_version FROM app_users");
  assert.equal(rows.length, 5);
  for (const user of [observer, multiObserver, legacyStaff]) {
    const row = rows.find((item) => item.data.id === user.id)!;
    assert.deepEqual(row.data.hotelIds, user.hotelIds.filter((id) => id !== "hotel-a"));
    assert.equal(row.auth_version, 2);
    assert.equal(row.data.active, user.active);
    assert.equal(await resolveSessionUser({ userId: user.id, authenticatedAt: Date.now(), authVersion: 1 }), null);
    assert.equal((await resolveSessionUser({ userId: user.id, authenticatedAt: Date.now(), authVersion: 2 }))?.id, user.id);
  }
  for (const user of [admin, owner]) {
    assert.equal(rows.find((item) => item.data.id === user.id)?.auth_version, 1);
    assert.equal((await resolveSessionUser({ userId: user.id, authenticatedAt: Date.now(), authVersion: 1 }))?.id, user.id);
  }
});

test("missing hotels return not found and strict request validation rejects unconfirmed deletion", async () => {
  await assert.rejects(archiveHotel(admin, "missing"), { status: 404 });
  await assert.rejects(restoreHotel(admin, "missing"), { status: 404 });
  await assert.rejects(deleteHotel(admin, "missing", { confirmationName: "missing", archivedAt: stamp }), { status: 404 });
  assert.equal(deleteHotelSchema.safeParse({ confirmationName: "hotel-a" }).success, false);
  assert.equal(deleteHotelSchema.safeParse({ confirmationName: "hotel-a", archivedAt: stamp, force: true }).success, false);
  assert.equal(hotelLifecycleSchema.safeParse({ action: "archive", managerId: owner.id }).success, false);
  assert.equal(hotelLifecycleSchema.safeParse({ action: "delete" }).success, false);
});
