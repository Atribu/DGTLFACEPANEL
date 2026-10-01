import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "../lib/server/db";
import type { User } from "../lib/types";
import { migrateUserSchema } from "../lib/server/user-schema";
import { migrateNotificationSchema } from "../lib/server/notification-schema";
import {
  createUser,
  createUserSchema,
  listUsers,
  updateUser,
  updateUserSchema,
} from "../lib/server/users";
import { authenticate } from "../lib/server/login";
import { resolveSessionUser } from "../lib/server/auth";
import { hashPassword, verifyPassword } from "../lib/server/password";
import {
  bootstrap,
  createHotel,
  createTask,
  taskDetail,
  updateHotelManager,
  updateTask,
} from "../lib/server/repository";
import {
  createHotelSchema,
  createTaskSchema,
  patchTaskSchema,
} from "../lib/server/validation";
import { admin, hotel, observer, otherStaff, owner, task } from "./fixtures";

// A real, isolated in-memory PostgreSQL engine. Never opens or modifies .data.
const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
const previousDatabase = globals.dgtlDatabase;
const secondAdmin: User = {
  ...admin,
  id: "admin-two",
  email: "admin2@example.test",
  name: "İkinci Yönetici",
};
const password = "Unique-test-password-2026!";
let local: PGlite;
let db: Database;
let passwordHash: string;

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
    CREATE TABLE app_users (id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,data jsonb NOT NULL);
    CREATE TABLE hotels (id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
    CREATE TABLE task_comments (id text PRIMARY KEY,task_id text REFERENCES tasks(id),data jsonb NOT NULL);
  `);
  await migrateUserSchema(db);
  await migrateNotificationSchema(db);
  passwordHash = await hashPassword(password);
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec(
    "TRUNCATE personal_notifications,user_events,activities,task_comments,tasks,hotels,app_users",
  );
  for (const user of [admin, secondAdmin, owner, otherStaff, observer]) {
    await db.query(
      "INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)",
      [user.id, user.email, passwordHash, JSON.stringify(user)],
    );
  }
  for (const item of [hotel("hotel-a"), hotel("hotel-b")]) {
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
      item.id,
      JSON.stringify(item),
    ]);
  }
  const item = task();
  await db.query(
    "INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [item.id, item.hotelId, item.assigneeId, JSON.stringify(item)],
  );
});

after(async () => {
  if (previousDatabase) globals.dgtlDatabase = previousDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

const edit = (user: User, overrides: Partial<User> = {}) =>
  updateUserSchema.parse({
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    hotelIds: user.hotelIds,
    active: user.active !== false,
    ...overrides,
  });
const draft = (overrides: Record<string, unknown> = {}) =>
  createUserSchema.parse({
    name: "Yeni Personel",
    email: "new@example.test",
    password,
    role: "staff",
    department: "SEO",
    hotelIds: [],
    ...overrides,
  });
const patch = (input: unknown) => patchTaskSchema.parse(input);

test("additive user migration preserves legacy users and accepts their version-one sessions", async () => {
  await migrateUserSchema(db);
  const [row] = await db.query<{ auth_version: number }>(
    "SELECT auth_version FROM app_users WHERE id=$1",
    [owner.id],
  );
  assert.equal(row.auth_version, 1);
  assert.equal(
    (
      await resolveSessionUser({
        userId: owner.id,
        authenticatedAt: Date.now(),
      })
    )?.id,
    owner.id,
  );
  assert.equal(
    await resolveSessionUser({
      userId: owner.id,
      authenticatedAt: Date.now(),
      authVersion: 99,
    }),
    null,
  );
});

test("only active administrators may create, edit or list users", async () => {
  for (const actor of [owner, observer, { ...admin, active: false }]) {
    await assert.rejects(createUser(actor, draft()), { status: 403 });
    await assert.rejects(updateUser(actor, otherStaff.id, edit(otherStaff)), {
      status: 403,
    });
    await assert.rejects(listUsers(actor), { status: 403 });
  }
});

test("creation normalizes email and internal hotel scope, hashes the password and never exposes it", async () => {
  const { user } = await createUser(
    admin,
    draft({ email: "  New@Example.Test  ", hotelIds: ["missing-hotel"] }),
  );
  assert.equal(user.email, "new@example.test");
  assert.equal(user.active, true);
  assert.deepEqual(user.hotelIds, []);
  const [stored] = await db.query<{ password_hash: string; data: User }>(
    "SELECT password_hash,data FROM app_users WHERE id=$1",
    [user.id],
  );
  assert.notEqual(stored.password_hash, password);
  assert.equal(await verifyPassword(password, stored.password_hash), true);
  assert.deepEqual(Object.keys(stored.data).sort(), [
    "active",
    "department",
    "email",
    "hotelIds",
    "id",
    "name",
    "role",
  ]);
  const result = await listUsers(admin);
  assert.equal(result.events.length, 1);
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(JSON.stringify(result).includes(stored.password_hash), false);
});

test("duplicate email matching is case-insensitive on create and edit, without partial writes", async () => {
  await assert.rejects(
    createUser(admin, draft({ email: admin.email.toUpperCase() })),
    { status: 409 },
  );
  await assert.rejects(
    updateUser(
      admin,
      otherStaff.id,
      edit(otherStaff, { email: admin.email.toUpperCase() }),
    ),
    { status: 409 },
  );
  const listed = await listUsers(admin);
  assert.equal(listed.users.length, 5);
  assert.equal(listed.events.length, 0);
  assert.equal(
    listed.users.find((user) => user.id === otherStaff.id)?.email,
    otherStaff.email,
  );
});

test("observers require at least one existing hotel and duplicate selections are removed", async () => {
  await assert.rejects(
    createUser(admin, draft({ role: "observer", hotelIds: [] })),
    { status: 400 },
  );
  await assert.rejects(
    createUser(admin, draft({ role: "observer", hotelIds: ["missing"] })),
    { status: 400 },
  );
  const { user } = await createUser(
    admin,
    draft({ role: "observer", hotelIds: ["hotel-b", "hotel-b"] }),
  );
  assert.deepEqual(user.hotelIds, ["hotel-b"]);
  assert.deepEqual(
    (await bootstrap(user)).hotels.map((item) => item.id),
    ["hotel-b"],
  );
  await assert.rejects(
    updateUser(admin, user.id, edit(user, { hotelIds: [] })),
    { status: 400 },
  );
});

test("disable blocks login and existing sessions; re-enable never resurrects a stale cookie", async () => {
  const initial = await authenticate(observer.email, password);
  const cookie = {
    userId: observer.id,
    authenticatedAt: Date.now(),
    authVersion: initial.authVersion,
  };
  assert.equal((await resolveSessionUser(cookie))?.id, observer.id);
  await updateUser(admin, observer.id, edit(observer, { active: false }));
  await assert.rejects(authenticate(observer.email, password), { status: 401 });
  assert.equal(await resolveSessionUser(cookie), null);
  await updateUser(admin, observer.id, edit(observer, { active: true }));
  assert.equal(await resolveSessionUser(cookie), null);
  assert.equal(
    await resolveSessionUser({ ...cookie, authVersion: undefined }),
    null,
  );
  const fresh = await authenticate(observer.email, password);
  assert.equal(fresh.authVersion, initial.authVersion + 2);
  assert.equal(
    (await resolveSessionUser({ ...cookie, authVersion: fresh.authVersion }))
      ?.id,
    observer.id,
  );
});

test("role and hotel-scope changes revoke old sessions; profile edits preserve the current session", async () => {
  const cookie = {
    userId: observer.id,
    authenticatedAt: Date.now(),
    authVersion: 1,
  };
  const { user } = await updateUser(
    admin,
    observer.id,
    edit(observer, { hotelIds: ["hotel-b"] }),
  );
  assert.equal(await resolveSessionUser(cookie), null);
  assert.deepEqual(
    (await bootstrap(user)).hotels.map((item) => item.id),
    ["hotel-b"],
  );
  const switched = await updateUser(
    admin,
    otherStaff.id,
    edit(otherStaff, { role: "observer", hotelIds: ["hotel-a"] }),
  );
  assert.equal(switched.user.role, "observer");
  assert.equal(
    await resolveSessionUser({
      userId: otherStaff.id,
      authenticatedAt: Date.now(),
      authVersion: 1,
    }),
    null,
  );
  const selfCookie = {
    userId: admin.id,
    authenticatedAt: Date.now(),
    authVersion: 1,
  };
  await updateUser(
    admin,
    admin.id,
    edit(admin, { name: "Yeni Yönetici Adı", email: "changed@example.test" }),
  );
  assert.equal(
    (await resolveSessionUser(selfCookie))?.name,
    "Yeni Yönetici Adı",
  );
});

test("self demotion and deactivation are rejected and stale administrator objects cannot authorize mutations", async () => {
  await assert.rejects(
    updateUser(admin, admin.id, edit(admin, { role: "staff" })),
    { status: 409 },
  );
  await assert.rejects(
    updateUser(admin, admin.id, edit(admin, { active: false })),
    { status: 409 },
  );
  await updateUser(admin, secondAdmin.id, edit(secondAdmin, { role: "staff" }));
  await assert.rejects(
    updateUser(secondAdmin, otherStaff.id, edit(otherStaff, { active: false })),
    { status: 403 },
  );
  await assert.rejects(createUser(secondAdmin, draft()), { status: 403 });
});

test("competing administrator deactivations retain an active administrator", async () => {
  const results = await Promise.allSettled([
    updateUser(admin, secondAdmin.id, edit(secondAdmin, { active: false })),
    updateUser(secondAdmin, admin.id, edit(admin, { active: false })),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rows = await db.query<{ data: User }>("SELECT data FROM app_users");
  assert.equal(
    rows.filter((row) => row.data.role === "admin" && row.data.active !== false)
      .length,
    1,
  );
});

test("open assignments and hotel responsibility block disable or observer conversion until reassigned", async () => {
  await assert.rejects(
    updateUser(admin, owner.id, edit(owner, { active: false })),
    { status: 409, message: /açık görevleri/ },
  );
  await assert.rejects(
    updateUser(
      admin,
      owner.id,
      edit(owner, { role: "observer", hotelIds: ["hotel-a"] }),
    ),
    { status: 409 },
  );
  const complete = task({ status: "completed", checklist: [] });
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    complete.id,
    JSON.stringify(complete),
  ]);
  await assert.rejects(
    updateUser(admin, owner.id, edit(owner, { active: false })),
    { status: 409, message: /otel sorumlusu/ },
  );
  await updateHotelManager(admin, "hotel-a", otherStaff.id);
  await updateHotelManager(admin, "hotel-b", otherStaff.id);
  const result = await updateUser(
    admin,
    owner.id,
    edit(owner, { active: false }),
  );
  assert.equal(result.user.active, false);
  const existing = await taskDetail(admin, complete.id);
  assert.equal(existing.task.assigneeId, owner.id);
  assert.equal(existing.task.status, "completed");
});

test("inactive or observer users cannot receive new assignments; completed history remains editable but cannot be reopened", async () => {
  await updateUser(admin, otherStaff.id, edit(otherStaff, { active: false }));
  for (const assigneeId of [otherStaff.id, observer.id]) {
    await assert.rejects(
      createTask(
        admin,
        createTaskSchema.parse({
          hotelId: "hotel-a",
          title: "Yeni görev",
          department: "SEO",
          priority: 2,
          assigneeId,
        }),
      ),
      { status: 400 },
    );
    await assert.rejects(
      createHotel(
        admin,
        createHotelSchema.parse({
          name: "Otel",
          location: "Antalya",
          services: ["SEO"],
          managerId: assigneeId,
          contactName: "Yetkili",
          contactEmail: "contact@example.test",
          template: false,
        }),
      ),
      { status: 400 },
    );
  }
  const completed = task({
    status: "completed",
    assigneeId: otherStaff.id,
    checklist: [],
  });
  await db.query("UPDATE tasks SET assignee_id=$2,data=$3::jsonb WHERE id=$1", [
    completed.id,
    otherStaff.id,
    JSON.stringify(completed),
  ]);
  await updateTask(
    admin,
    completed.id,
    patch({
      action: "update",
      title: "Geçmiş görev açıklaması",
      assigneeId: otherStaff.id,
    }),
  );
  await assert.rejects(
    updateTask(admin, completed.id, patch({ action: "reopen" })),
    { status: 400, message: /aktif bir personele atayın/ },
  );
  await updateTask(
    admin,
    completed.id,
    patch({ action: "update", assigneeId: owner.id }),
  );
  assert.equal(
    (await updateTask(admin, completed.id, patch({ action: "reopen" }))).task
      .status,
    "in_progress",
  );
});

test("hotel manager changes require an active internal account and leave task assignments intact", async () => {
  await assert.rejects(updateHotelManager(owner, "hotel-a", otherStaff.id), {
    status: 403,
  });
  await assert.rejects(updateHotelManager(admin, "hotel-a", observer.id), {
    status: 400,
  });
  const updated = await updateHotelManager(admin, "hotel-a", otherStaff.id);
  assert.equal(updated.hotel.managerId, otherStaff.id);
  assert.equal((await taskDetail(admin, "task-a")).task.assigneeId, owner.id);
  await assert.rejects(
    updateUser(admin, otherStaff.id, edit(otherStaff, { active: false })),
    { status: 409, message: /otel sorumlusu/ },
  );
});

test("user forms reject extra fields and short passwords rather than accepting privilege or hash injection", () => {
  assert.equal(
    createUserSchema.safeParse({ ...draft(), password: "short" }).success,
    false,
  );
  assert.equal(
    createUserSchema.safeParse({ ...draft(), auth_version: 999 }).success,
    false,
  );
  assert.equal(
    updateUserSchema.safeParse({ ...edit(owner), password_hash: "injected" })
      .success,
    false,
  );
  assert.equal(
    updateUserSchema.safeParse({ ...edit(owner), active: "false" }).success,
    false,
  );
});
