import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "../lib/server/db";
import type { User } from "../lib/types";
import { migrateUserSchema } from "../lib/server/user-schema";
import { migrateNotificationSchema } from "../lib/server/notification-schema";
import { migrateAttachmentSchema } from "../lib/server/attachment-schema";
import { migrateRecurrenceSchema } from "../lib/server/recurrence-schema";
import { isSystemOwner, isAssignableUser, ownerPrivacyContext, redactOwnerReferences, SYSTEM_OWNER_EMAIL, SYSTEM_OWNER_ALIAS, SYSTEM_OWNER_ALIAS_ID } from "../lib/server/owner-identity";
import { isValidOwnerPasswordHash, migrateOwnerSchema, provisionSystemOwner } from "../lib/server/owner-schema";
import { ownerBootstrapPasswordHash } from "../lib/server/owner-bootstrap";
import { createUser, createUserSchema, updateUser, updateUserSchema, deleteUser, listUsers } from "../lib/server/users";
import { bootstrap, taskDetail, addComment, createTask, updateHotelManager } from "../lib/server/repository";
import { createLinkAttachment, listAttachments } from "../lib/server/attachments";
import { createRecurrence, listRecurrences, updateRecurrence } from "../lib/server/recurrences";
import { getHotelReport } from "../lib/server/reports";
import { notifyTaskChange } from "../lib/server/notifications";
import { initializeBundledChecklist } from "../lib/server/checklist-initialization";
import { IMPORT_ID } from "../lib/server/checklist-import";
import { createTaskSchema } from "../lib/server/validation";
import { hashPassword } from "../lib/server/password";
import { istanbulToday } from "../lib/recurrence";
import { admin, owner as staff, observer, hotel, task } from "./fixtures";

const globals = globalThis as typeof globalThis & { dgtlDatabase?: Promise<Database> };
const previous = globals.dgtlDatabase;
let local: PGlite;
let db: Database;
let passwordHash: string;
let systemOwner: User;

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
    CREATE TABLE tasks (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
    CREATE TABLE task_comments (id text PRIMARY KEY,task_id text REFERENCES tasks(id),data jsonb NOT NULL);
  `);
  await migrateUserSchema(db);
  await migrateNotificationSchema(db);
  await migrateRecurrenceSchema(db);
  await migrateAttachmentSchema(db);
  await migrateOwnerSchema(db);
  passwordHash = await hashPassword("Private-owner-test-password!");
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec("TRUNCATE task_attachments,recurrence_occurrences,recurrence_rules,personal_notifications,user_events,activities,task_comments,tasks,hotels,app_users,app_meta");
  for (const person of [admin, staff, observer])
    await db.query("INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)", [person.id, person.email, passwordHash, JSON.stringify(person)]);
  const h = hotel("hotel-a");
  await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [h.id, JSON.stringify(h)]);
  const t = task();
  await db.query("INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)", [t.id, t.hotelId, t.assigneeId, JSON.stringify(t)]);
  systemOwner = (await provisionSystemOwner(db, passwordHash))!;
});

after(async () => {
  if (previous) globals.dgtlDatabase = previous;
  else delete globals.dgtlDatabase;
  await db.close();
});

const userInput = (person: User) => ({ name: person.name, email: person.email, role: person.role, department: person.department, hotelIds: person.hotelIds, active: true });
const recurrenceInput = () => ({ hotelId: "hotel-a", title: "Haftalık kontrol", description: "Kontrol", department: "SEO", assigneeId: staff.id, priority: 2, checklist: ["Tamam"], frequency: "weekly", startsOn: istanbulToday(), dueOffsetDays: 2 });

test("owner privilege requires server flag, exact reserved email, admin role and an active account", () => {
  assert.equal(isSystemOwner(systemOwner), true);
  assert.equal(isAssignableUser(systemOwner), false);
  for (const change of [{ isOwner: false }, { email: "someone@example.test" }, { role: "staff" as const }, { active: false }, { deletedAt: "2026-10-23T00:00:00Z" }])
    assert.equal(isSystemOwner({ ...systemOwner, ...change }), false);
  assert.equal(isSystemOwner({ ...admin, email: SYSTEM_OWNER_EMAIL }), false);
});

test("explicit provisioning is idempotent and never replaces an existing password or identity", async () => {
  const changedHash = await hashPassword("A-different-owner-password!");
  assert.deepEqual(await provisionSystemOwner(db, changedHash), systemOwner);
  assert.equal(await provisionSystemOwner(db, undefined), undefined);
  const rows = await db.query<{ password_hash: string; auth_version: number }>("SELECT password_hash,auth_version FROM app_users WHERE id=$1", [systemOwner.id]);
  assert.equal(rows[0].password_hash, passwordHash);
  assert.equal(rows[0].auth_version, 1);
});

test("bundled bootstrap needs no environment setting and respects an explicit initial override", () => {
  const bundled = ownerBootstrapPasswordHash();
  assert.equal(isValidOwnerPasswordHash(bundled), true);
  assert.equal(ownerBootstrapPasswordHash(""), bundled);
  assert.equal(ownerBootstrapPasswordHash(passwordHash), passwordHash);
  assert.equal(ownerBootstrapPasswordHash("invalid"), "invalid");
  assert.equal(isValidOwnerPasswordHash(ownerBootstrapPasswordHash(" ")), false);
});

test("bundled bootstrap creates once and cannot overwrite database credentials on redeploy", async () => {
  // The seeded owner has no references in this isolated fixture.
  await db.query("DELETE FROM app_users WHERE id=$1", [systemOwner.id]);
  const bundled = ownerBootstrapPasswordHash();
  const created = (await provisionSystemOwner(db, bundled))!;
  const [first] = await db.query<{ password_hash: string }>("SELECT password_hash FROM app_users WHERE id=$1", [created.id]);
  assert.equal(first.password_hash, bundled);
  // Simulate a later password change in the database, then restart without env.
  await db.query("UPDATE app_users SET password_hash=$2,auth_version=2 WHERE id=$1", [created.id, passwordHash]);
  for (const configured of [ownerBootstrapPasswordHash(), ownerBootstrapPasswordHash(""), ownerBootstrapPasswordHash(bundled)]) {
    assert.deepEqual(await provisionSystemOwner(db, configured), created);
  }
  const rows = await db.query<{ password_hash: string; auth_version: number }>("SELECT password_hash,auth_version FROM app_users WHERE data->>'isOwner'='true'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].password_hash, passwordHash);
  assert.equal(rows[0].auth_version, 2);
});

test("bad hashes are rejected and an existing ordinary email is never silently promoted", async () => {
  assert.equal(isValidOwnerPasswordHash(passwordHash), true);
  for (const bad of ["plaintext-password", "scrypt:a:b", `${passwordHash}:extra`, ` ${passwordHash}`]) {
    assert.equal(isValidOwnerPasswordHash(bad), false);
    await assert.rejects(provisionSystemOwner(db, bad), /scrypt/);
  }
  const ordinary = { ...systemOwner, isOwner: false };
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [systemOwner.id, JSON.stringify(ordinary)]);
  await assert.rejects(provisionSystemOwner(db, passwordHash), /otomatik yükseltilmez/);
  assert.deepEqual((await db.query<{ data: User }>("SELECT data FROM app_users WHERE id=$1", [systemOwner.id]))[0].data, ordinary);
});

test("database enforces the single-owner invariant even for a direct second insert", async () => {
  await migrateOwnerSchema(db);
  await assert.rejects(db.query("INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)", ["second-owner", "second@example.test", passwordHash, JSON.stringify({ ...systemOwner, id: "second-owner", email: "second@example.test" })]), { code: "23505" });
});

test("ordinary user APIs reject privilege injection and reserved email, and cannot change or remove the owner", async () => {
  const { active: _, ...newUser } = userInput(admin);
  assert.equal(createUserSchema.safeParse({ ...newUser, password: "Strong-test-password!", isOwner: true }).success, false);
  assert.equal(updateUserSchema.safeParse({ ...userInput(admin), isOwner: true }).success, false);
  await assert.rejects(createUser(admin, { ...newUser, email: SYSTEM_OWNER_EMAIL, password: "Strong-test-password!" }), { status: 409 });
  await assert.rejects(updateUser(admin, staff.id, { ...userInput(staff), email: SYSTEM_OWNER_EMAIL }), { status: 409 });
  for (const actor of [admin, systemOwner]) {
    await assert.rejects(updateUser(actor, systemOwner.id, userInput(systemOwner)), { status: 404 });
    await assert.rejects(deleteUser(actor, systemOwner.id), { status: 404 });
  }
});

test("shared bootstrap, task history, attachments and user audit conceal the owner but preserve stored authorship", async () => {
  const { comment } = await addComment(systemOwner, "task-a", "Paylaşılan kontrol notu.");
  await createLinkAttachment(systemOwner, "task-a", { kind: "link", title: "Belge", url: "https://example.com/document" });
  await updateUser(systemOwner, staff.id, { ...userInput(staff), name: "Yeni Personel Adı" });
  for (const viewer of [admin, staff, observer]) {
    const snapshot = await bootstrap(viewer);
    assert.equal(snapshot.users.some((person) => person.id === systemOwner.id), false);
    assert.equal(snapshot.comments[0].userId, SYSTEM_OWNER_ALIAS_ID);
    assert.equal(snapshot.comments[0].userName, SYSTEM_OWNER_ALIAS);
    assert.equal(snapshot.comments[0].body, "Paylaşılan kontrol notu.");
    assert.equal((await taskDetail(viewer, "task-a")).comments[0].userName, SYSTEM_OWNER_ALIAS);
    assert.equal((await listAttachments(viewer, "task-a")).attachments[0].userId, SYSTEM_OWNER_ALIAS_ID);
    assert.equal(JSON.stringify(snapshot).includes(systemOwner.email), false);
    assert.equal(JSON.stringify(snapshot).includes(systemOwner.id), false);
  }
  const list = await listUsers(admin);
  assert.equal(list.users.some((person) => person.id === systemOwner.id), false);
  assert.equal(list.events[0].actorName, SYSTEM_OWNER_ALIAS);
  assert.equal((await listUsers(systemOwner)).events[0].actorId, systemOwner.id);
  assert.equal((await bootstrap(systemOwner)).comments[0].userName, systemOwner.name);
  const [persisted] = await db.query<{ data: { userId: string; userName: string } }>("SELECT data FROM task_comments WHERE id=$1", [comment.id]);
  assert.equal(persisted.data.userId, systemOwner.id);
  assert.equal(persisted.data.userName, systemOwner.name);
});

test("projection leaves user-provided content intact and hides only author metadata", async () => {
  const body = `${systemOwner.name} ${systemOwner.email}`;
  const original = { userId: systemOwner.id, userName: systemOwner.name, body, title: body, url: `https://example.com/${systemOwner.id}` };
  const result = redactOwnerReferences(original, await ownerPrivacyContext(db, admin));
  assert.equal(result.userId, SYSTEM_OWNER_ALIAS_ID);
  assert.equal(result.userName, SYSTEM_OWNER_ALIAS);
  assert.equal(result.body, body);
  assert.equal(result.title, body);
  assert.equal(result.url, original.url);
  assert.equal(original.userId, systemOwner.id);
});

test("owner cannot be assigned tasks, hotels or recurring jobs and automatic import leaves work untouched", async () => {
  await assert.rejects(createTask(admin, createTaskSchema.parse({ hotelId: "hotel-a", title: "Kontrol", department: "SEO", priority: 2, assigneeId: systemOwner.id })), { status: 400 });
  await assert.rejects(updateHotelManager(admin, "hotel-a", systemOwner.id), { status: 400 });
  await assert.rejects(createRecurrence(admin, { ...recurrenceInput(), assigneeId: systemOwner.id }), { status: 409 });
  assert.match((await initializeBundledChecklist(db, systemOwner, false))!, /standart yönetici/);
  assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM hotels"))[0].count, 1);
  await db.query("INSERT INTO app_meta(key,value) VALUES ($1,'{}')", [IMPORT_ID]);
  assert.equal(await initializeBundledChecklist(db, systemOwner, false), undefined);
});

test("recurrence metadata is private after an ordinary admin edits an owner-created rule", async () => {
  const { recurrence } = await createRecurrence(systemOwner, recurrenceInput());
  assert.equal(recurrence.createdBy, systemOwner.id);
  assert.equal((await listRecurrences(admin)).recurrences[0].createdByName, SYSTEM_OWNER_ALIAS);
  const changed = await updateRecurrence(admin, recurrence.id, { action: "pause" });
  assert.equal(changed.recurrence.createdBy, SYSTEM_OWNER_ALIAS_ID);
  assert.equal((await listRecurrences(systemOwner)).recurrences[0].createdBy, systemOwner.id);
});

test("legacy report identities are projected and routine notification broadcasts exclude the private account", async () => {
  const legacy = task({ assigneeId: systemOwner.id });
  await db.query("UPDATE tasks SET assignee_id=$2,data=$3::jsonb WHERE id=$1", [legacy.id, systemOwner.id, JSON.stringify(legacy)]);
  const filters = { hotelId: "hotel-a", from: "2026-10-01", to: "2026-10-31", includeUndated: false };
  assert.equal((await getHotelReport(admin, filters)).tasks[0].assigneeName, SYSTEM_OWNER_ALIAS);
  assert.equal((await getHotelReport(systemOwner, filters)).tasks[0].assigneeName, systemOwner.name);
  await notifyTaskChange(db, staff, task(), task({ status: "review" }));
  const notifications = await db.query<{ user_id: string }>("SELECT user_id FROM personal_notifications");
  assert.deepEqual(notifications.map((item) => item.user_id), [admin.id]);
});
