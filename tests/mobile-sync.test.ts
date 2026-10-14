import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "../lib/server/db";
import type { Task } from "../lib/types";
import { addComment, bootstrap, taskDetail, updateTask } from "../lib/server/repository";
import {
  mobileBootstrapData,
  mobileBootstrapResponse,
  mobileCommentSchema,
  mobilePatchSchema,
  taskVersion,
} from "../lib/server/mobile-sync";
import { admin, hotel, observer, otherStaff, owner, task } from "./fixtures";
import { patchTaskSchema } from "../lib/server/validation";

const globals = globalThis as typeof globalThis & { dgtlDatabase?: Promise<Database> };
let originalDatabase: Promise<Database> | undefined;
let local: PGlite;
let db: Database;
let failAudit = false;
const queries: string[] = [];

before(async () => {
  originalDatabase = globals.dgtlDatabase;
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    query: async <T>(sql: string, params: unknown[] = []) => (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => local.transaction((tx) => fn({
      query: async <R>(sql: string, params: unknown[] = []) => {
        queries.push(sql);
        if (failAudit && sql.startsWith("INSERT INTO activities")) throw new Error("Simulated audit failure");
        return (await tx.query<R>(sql, params)).rows;
      },
    })),
    close: () => local.close(),
  };
  globals.dgtlDatabase = Promise.resolve(db);
  await local.exec(`
    CREATE TABLE app_users(id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE hotels(id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks(id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE task_comments(id text PRIMARY KEY,task_id text REFERENCES tasks(id),data jsonb NOT NULL);
    CREATE TABLE activities(id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
    CREATE TABLE personal_notifications(id text PRIMARY KEY,user_id text,task_id text,hotel_id text,event_key text,data jsonb,created_at timestamptz,UNIQUE(user_id,event_key));
  `);
});

beforeEach(async () => {
  failAudit = false;
  queries.length = 0;
  await local.exec("TRUNCATE personal_notifications,activities,task_comments,tasks,hotels,app_users");
  for (const user of [admin, owner, otherStaff, observer])
    await db.query("INSERT INTO app_users(id,data) VALUES ($1,$2::jsonb)", [user.id, JSON.stringify(user)]);
  for (const id of ["hotel-a", "hotel-b"])
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [id, JSON.stringify(hotel(id))]);
  for (const item of [task(), task({ id: "task-b", hotelId: "hotel-b", assigneeId: otherStaff.id })])
    await db.query("INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)", [item.id, item.hotelId, item.assigneeId, JSON.stringify(item)]);
});

after(async () => {
  if (originalDatabase) globals.dgtlDatabase = originalDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

const tick = { action: "checklist", itemId: "criterion-a", done: true } as const;
async function persistedTask() { return (await taskDetail(admin, "task-a")).task; }
async function counts() {
  const [row] = await db.query<{ comments: number; activities: number }>("SELECT (SELECT count(*)::int FROM task_comments) AS comments,(SELECT count(*)::int FROM activities) AS activities");
  return row;
}

test("mobile versions survive JSONB key reordering and detect changes even with identical timestamps", async () => {
  const original = task();
  assert.match(taskVersion(original), /^[a-f0-9]{64}$/);
  assert.equal(taskVersion(original), taskVersion(await persistedTask()));
  assert.equal(taskVersion(original), taskVersion(Object.fromEntries(Object.entries(original).reverse()) as unknown as Task));
  assert.notEqual(taskVersion(original), taskVersion({ ...original, checklist: [{ ...original.checklist[0], done: true }] }));
  assert.notEqual(taskVersion(original), taskVersion({ ...original, priority: 8 }));
});

test("mobile request schemas require a version and a bounded durable comment request ID", () => {
  assert.equal(mobilePatchSchema.safeParse({ payload: tick }).success, false);
  assert.equal(mobilePatchSchema.safeParse({ expectedVersion: "old", payload: tick }).success, false);
  assert.equal(mobilePatchSchema.safeParse({ expectedVersion: taskVersion(task()), payload: tick }).success, true);
  assert.equal(mobileCommentSchema.safeParse({ body: "Not" }).success, false);
  assert.equal(mobileCommentSchema.safeParse({ body: "Not", requestId: "../unsafe" }).success, false);
  assert.deepEqual(mobileCommentSchema.parse({ body: "  Not  ", requestId: "f712f879-f40e-4ca2-9f37-c02fc12c0160" }).body, "Not");
});

test("mobile bootstrap versions and conditional responses remain scoped to the authenticated user", async () => {
  await addComment(owner, "task-a", "Görünür not");
  await addComment(otherStaff, "task-b", "Başka otelin notu");
  const data = await bootstrap(observer);
  const first = mobileBootstrapResponse(data, null);
  const payload = await first.json();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, no-cache");
  assert.equal(first.headers.get("vary"), "Cookie");
  assert.deepEqual(Object.keys(payload.taskVersions), ["task-a"]);
  assert.deepEqual(payload.tasks.map((item: Task) => item.id), ["task-a"]);
  assert.equal(payload.comments.length, 1);
  assert.equal(payload.comments[0].body, "Görünür not");
  assert.equal(payload.users.some((user: { id: string }) => user.id === otherStaff.id), false);
  assert.equal(payload.activities, undefined);
  const unchanged = mobileBootstrapResponse(data, first.headers.get("etag"));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.equal(mobileBootstrapResponse(data, `W/${first.headers.get("etag")}`).status, 304);

  // An unrelated hotel's update must not leak via this observer's validator.
  await updateTask(admin, "task-b", patchTaskSchema.parse({ action: "update", priority: 1 }));
  assert.equal(mobileBootstrapResponse(await bootstrap(observer), first.headers.get("etag")).status, 304);
  const reduced = mobileBootstrapResponse(await bootstrap({ ...observer, hotelIds: [] }), first.headers.get("etag"));
  assert.equal(reduced.status, 200);
  assert.deepEqual((await reduced.json()).taskVersions, {});
  assert.equal(mobileBootstrapResponse(await bootstrap(admin), first.headers.get("etag")).status, 200);
});

test("mobile bootstrap ETag ignores database row order and changes for shared notes", async () => {
  const before = await bootstrap(admin);
  const response = mobileBootstrapResponse(before, null);
  const reordered = { ...before, tasks: [...before.tasks].reverse(), users: [...before.users].reverse(), hotels: [...before.hotels].reverse() };
  assert.equal(mobileBootstrapResponse(reordered, response.headers.get("etag")).status, 304);
  await addComment(owner, "task-a", "Yeni not");
  assert.equal(mobileBootstrapResponse(await bootstrap(admin), response.headers.get("etag")).status, 200);
  assert.equal(Object.keys(mobileBootstrapData(before).taskVersions).length, 2);
});

test("web edits reject a stale mobile update without losing any task data or creating an audit", async () => {
  const old = taskVersion(await persistedTask());
  await updateTask(admin, "task-a", patchTaskSchema.parse({ action: "update", description: "Webde yazılan açıklama" }));
  const before = await persistedTask();
  const beforeCounts = await counts();
  await assert.rejects(updateTask(owner, "task-a", tick, old), { status: 409 });
  assert.deepEqual(await persistedTask(), before);
  assert.deepEqual(await counts(), beforeCounts);
  const latest = taskVersion(before);
  const changed = await updateTask(owner, "task-a", tick, latest);
  assert.equal(changed.task.checklist[0].done, true);
  assert.equal(changed.task.description, "Webde yazılan açıklama");
  assert.equal(taskVersion(changed.task), taskVersion(await persistedTask()));
});

test("two mobile changes from the same version have only one winner after row locking", async () => {
  const version = taskVersion(await persistedTask());
  const outcomes = await Promise.allSettled([
    updateTask(owner, "task-a", tick, version),
    updateTask(owner, "task-a", { action: "status", status: "waiting", waitingReason: "Erişim" }, version),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  const failure = outcomes.find((item) => item.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.status, 409);
  assert.equal((await counts()).activities, 1);
  assert.equal(queries.filter((sql) => sql === "SELECT data FROM tasks WHERE id=$1 FOR UPDATE").length, 2);
});

test("mobile checks preserve observer, assignment and completed-task permissions", async () => {
  const version = taskVersion(await persistedTask());
  await assert.rejects(updateTask(observer, "task-a", tick, version), { status: 403 });
  await assert.rejects(updateTask(observer, "task-b", tick, version), { status: 404 });
  await assert.rejects(updateTask(otherStaff, "task-a", tick, version), { status: 403 });
  await assert.rejects(updateTask(owner, "task-a", patchTaskSchema.parse({ action: "update", priority: 1 }), version), { status: 403 });
  const completed = { ...(await persistedTask()), status: "completed" as const };
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [completed.id, JSON.stringify(completed)]);
  await assert.rejects(updateTask(admin, "task-a", tick, taskVersion(completed)), { status: 403 });
  assert.deepEqual(await counts(), { comments: 0, activities: 0 });
});

test("mobile comment retries are durable, concurrent and do not duplicate comments or audits", async () => {
  const outcomes = await Promise.all([
    addComment(owner, "task-a", "Telefondan not", "retry-1"),
    addComment(owner, "task-a", "Telefondan not", "retry-1"),
  ]);
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.deepEqual(await counts(), { comments: 1, activities: 1 });
  // A fresh repository call reads the database record, not an in-memory cache.
  assert.deepEqual(await addComment(owner, "task-a", "Telefondan not", "retry-1"), outcomes[0]);
  await assert.rejects(addComment(owner, "task-a", "Farklı içerik", "retry-1"), { status: 409 });
  assert.deepEqual(await counts(), { comments: 1, activities: 1 });
  const differentUser = await addComment(admin, "task-a", "Yönetici notu", "retry-1");
  assert.notEqual(differentUser.comment.id, outcomes[0].comment.id);
  const differentTask = await addComment(otherStaff, "task-b", "Başka görev notu", "retry-1");
  assert.notEqual(differentTask.comment.id, outcomes[0].comment.id);
});

test("idempotent comment retries check current task access before returning a prior comment", async () => {
  await addComment(owner, "task-a", "İlk not", "reassignment");
  await updateTask(admin, "task-a", patchTaskSchema.parse({ action: "update", assigneeId: otherStaff.id }));
  await assert.rejects(addComment(owner, "task-a", "İlk not", "reassignment"), { status: 403 });
  await assert.rejects(addComment(observer, "task-a", "Not", "observer"), { status: 403 });
  await assert.rejects(addComment(observer, "task-b", "Not", "observer"), { status: 404 });
  assert.equal((await counts()).comments, 1);
});

test("failed mutations roll back task versions and comment request IDs so a safe retry can succeed", async () => {
  const before = await persistedTask();
  failAudit = true;
  await assert.rejects(updateTask(owner, "task-a", tick, taskVersion(before)), /Simulated audit failure/);
  await assert.rejects(addComment(owner, "task-a", "Not", "rollback"), /Simulated audit failure/);
  assert.deepEqual(await persistedTask(), before);
  assert.deepEqual(await counts(), { comments: 0, activities: 0 });
  failAudit = false;
  await updateTask(owner, "task-a", tick, taskVersion(before));
  await addComment(owner, "task-a", "Not", "rollback");
  assert.deepEqual(await counts(), { comments: 1, activities: 2 });
});
