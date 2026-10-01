import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  addComment,
  bootstrap,
  createTask,
  taskDetail,
  updateTask,
} from "../lib/server/repository";
import type { Database, Queryable } from "../lib/server/db";
import type { Activity, Hotel, Task, TaskComment, User } from "../lib/types";
import { createTaskSchema, patchTaskSchema } from "../lib/server/validation";
import {
  activity,
  admin,
  comment,
  hotel,
  observer,
  otherStaff,
  owner,
  task,
} from "./fixtures";

// A query adapter, not a database connection. It exercises repository authorization
// and transitions without opening the app's persistent PGlite/PostgreSQL database.
class MemoryQueries implements Database {
  storage = "postgres" as const;
  tasks = new Map<string, Task>();
  hotels: Hotel[] = [hotel("hotel-a"), hotel("hotel-b")];
  users: User[] = [admin, owner, otherStaff, observer];
  comments: TaskComment[] = [comment("task-a"), comment("task-b")];
  activities: Activity[] = [
    activity("hotel-a", "task-a"),
    activity("hotel-b", "task-b"),
  ];
  writeCount = 0;
  notifications: unknown[] = [];

  constructor() {
    for (const item of [
      task(),
      task({ id: "task-b", hotelId: "hotel-b", assigneeId: otherStaff.id }),
      task({
        id: "review-a",
        status: "review",
        checklist: [
          { id: "criterion-review", text: "Kontrol edildi", done: true },
        ],
      }),
      task({
        id: "completed-a",
        status: "completed",
        checklist: [
          { id: "criterion-completed", text: "Kontrol edildi", done: true },
        ],
      }),
    ])
      this.tasks.set(item.id, item);
  }

  async close() {}
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const before = structuredClone({
      tasks: this.tasks,
      comments: this.comments,
      activities: this.activities,
      writeCount: this.writeCount,
      notifications: this.notifications,
    });
    try {
      return await fn(this);
    } catch (error) {
      Object.assign(this, before);
      throw error;
    }
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    let rows: { data: unknown }[];
    if (sql.startsWith("SELECT data FROM tasks WHERE id=$1")) {
      const found = this.tasks.get(String(params[0]));
      rows = found ? [{ data: found }] : [];
    } else if (sql.startsWith("SELECT data FROM tasks ")) {
      const visible = [...this.tasks.values()].filter(
        (item) =>
          !sql.includes("hotel_id=ANY") ||
          (params[0] as string[]).includes(item.hotelId),
      );
      rows = visible.map((data) => ({ data }));
    } else if (sql.startsWith("SELECT data FROM hotels ")) {
      rows = this.hotels
        .filter(
          (item) =>
            !sql.includes("id=ANY") ||
            (params[0] as string[]).includes(item.id),
        )
        .map((data) => ({ data }));
    } else if (sql.startsWith("SELECT data FROM app_users")) {
      rows = this.users
        .filter((item) => !sql.includes("WHERE id=$1") || item.id === params[0])
        .map((data) => ({ data }));
    } else if (sql.startsWith("SELECT c.data FROM task_comments")) {
      rows = this.comments
        .filter(
          (item) =>
            !sql.includes("hotel_id=ANY") ||
            (params[0] as string[]).includes(
              this.tasks.get(item.taskId)!.hotelId,
            ),
        )
        .map((data) => ({ data }));
    } else if (sql.startsWith("SELECT data FROM task_comments")) {
      rows = this.comments
        .filter((item) => item.taskId === params[0])
        .map((data) => ({ data }));
    } else if (sql.startsWith("SELECT data FROM activities")) {
      rows = this.activities
        .filter(
          (item) =>
            (!sql.includes("hotel_id=ANY") ||
              (params[0] as string[]).includes(item.hotelId)) &&
            (!sql.includes("WHERE task_id=$1") || item.taskId === params[0]),
        )
        .map((data) => ({ data }));
    } else if (sql.startsWith("UPDATE tasks SET")) {
      this.tasks.set(String(params[0]), JSON.parse(String(params[2])) as Task);
      this.writeCount++;
      rows = [];
    } else if (sql.startsWith("INSERT INTO activities")) {
      this.activities.push(JSON.parse(String(params[3])) as Activity);
      this.writeCount++;
      rows = [];
    } else if (sql.startsWith("INSERT INTO task_comments")) {
      this.comments.push(JSON.parse(String(params[2])) as TaskComment);
      this.writeCount++;
      rows = [];
    } else if (sql.startsWith("INSERT INTO personal_notifications")) {
      this.notifications.push(JSON.parse(String(params[5])));
      this.writeCount++;
      return [{ id: params[0] }] as T[];
    } else
      throw new Error(`Unexpected database access in isolated test: ${sql}`);
    return structuredClone(rows) as T[];
  }
}

const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
let originalDatabase: Promise<Database> | undefined;
let memory: MemoryQueries;
beforeEach(() => {
  originalDatabase = globals.dgtlDatabase;
  memory = new MemoryQueries();
  globals.dgtlDatabase = Promise.resolve(memory);
});
afterEach(() => {
  if (originalDatabase) globals.dgtlDatabase = originalDatabase;
  else delete globals.dgtlDatabase;
});

const patch = (body: unknown) => patchTaskSchema.parse(body);

test("observer bootstrap isolates hotels, tasks, comments, activity and unrelated user identities", async () => {
  const visible = await bootstrap(observer);
  assert.deepEqual(
    visible.hotels.map((item) => item.id),
    ["hotel-a"],
  );
  assert.ok(visible.tasks.length > 0);
  assert.equal(
    visible.tasks.every((item) => item.hotelId === "hotel-a"),
    true,
  );
  assert.equal(
    visible.activities.every((item) => item.hotelId === "hotel-a"),
    true,
  );
  assert.equal(
    visible.comments.every((item) =>
      visible.tasks.some((task) => task.id === item.taskId),
    ),
    true,
  );
  assert.equal(
    visible.users.some((item) => item.id === otherStaff.id),
    false,
  );
  assert.equal(visible.users.find((item) => item.id === owner.id)?.email, "");
  assert.equal(
    visible.users.find((item) => item.id === observer.id)?.email,
    observer.email,
  );

  const none = await bootstrap({ ...observer, hotelIds: [] });
  assert.deepEqual(none.hotels, []);
  assert.deepEqual(none.tasks, []);
  assert.deepEqual(none.comments, []);
  assert.deepEqual(none.activities, []);
  assert.deepEqual(
    none.users.map((item) => item.id),
    [observer.id],
  );
});

test("observer cannot fetch another hotel by task ID or mutate even their own hotel tasks", async () => {
  await assert.rejects(taskDetail(observer, "task-b"), { status: 404 });
  const own = await taskDetail(observer, "task-a");
  assert.equal(own.task.hotelId, "hotel-a");
  await assert.rejects(
    updateTask(
      observer,
      "task-a",
      patch({
        action: "status",
        status: "waiting",
        waitingReason: "Bekleniyor",
      }),
    ),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(
      observer,
      "task-a",
      patch({ action: "checklist", itemId: "criterion-a", done: true }),
    ),
    { status: 403 },
  );
  await assert.rejects(addComment(observer, "task-a", "Yorum"), {
    status: 403,
  });
  assert.equal(memory.writeCount, 0);
});

test("staff cannot change priority, assign tasks, create tasks, or mutate another staff member’s work", async () => {
  await assert.rejects(
    updateTask(owner, "task-a", patch({ action: "update", priority: 1 })),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(
      owner,
      "task-a",
      patch({ action: "update", assigneeId: otherStaff.id }),
    ),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(
      owner,
      "task-b",
      patch({ action: "status", status: "in_progress" }),
    ),
    { status: 403 },
  );
  await assert.rejects(addComment(owner, "task-b", "Yorum"), { status: 403 });
  await assert.rejects(
    createTask(
      owner,
      createTaskSchema.parse({
        hotelId: "hotel-a",
        title: "Görev",
        department: "SEO",
        priority: 1,
      }),
    ),
    { status: 403 },
  );
  assert.equal(memory.writeCount, 0);
});

test("the assigned worker must complete all criteria before submission, and only a manager can approve", async () => {
  await assert.rejects(
    updateTask(owner, "task-a", patch({ action: "submit" })),
    { status: 400 },
  );
  await updateTask(
    owner,
    "task-a",
    patch({ action: "checklist", itemId: "criterion-a", done: true }),
  );
  const submitted = await updateTask(
    owner,
    "task-a",
    patch({ action: "submit" }),
  );
  assert.equal(submitted.task.status, "review");
  await assert.rejects(
    updateTask(owner, "task-a", patch({ action: "approve" })),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(
      owner,
      "task-a",
      patch({ action: "checklist", itemId: "criterion-a", done: false }),
    ),
    { status: 403 },
  );
  const approved = await updateTask(
    admin,
    "task-a",
    patch({ action: "approve" }),
  );
  assert.equal(approved.task.status, "completed");
  assert.ok(
    memory.activities.some(
      (item) =>
        item.taskId === "task-a" &&
        item.userId === admin.id &&
        item.message.includes("onayıyla"),
    ),
  );
});

test("approval rejects non-review work and incomplete criteria, including for a manager", async () => {
  await assert.rejects(
    updateTask(admin, "task-a", patch({ action: "approve" })),
    { status: 400 },
  );
  memory.tasks.set("review-a", task({ id: "review-a", status: "review" }));
  await assert.rejects(
    updateTask(admin, "review-a", patch({ action: "approve" })),
    { status: 400 },
  );
  assert.equal(memory.writeCount, 0);
});

test("completed work can only be reopened explicitly by a manager and review return records its reason", async () => {
  await assert.rejects(
    updateTask(owner, "completed-a", patch({ action: "reopen" })),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(
      admin,
      "completed-a",
      patch({ action: "status", status: "in_progress" }),
    ),
    { status: 403 },
  );
  await assert.rejects(
    updateTask(admin, "task-a", patch({ action: "reopen" })),
    { status: 400 },
  );
  const reopened = await updateTask(
    admin,
    "completed-a",
    patch({ action: "reopen", reason: "Ek kontrol gerekli." }),
  );
  assert.equal(reopened.task.status, "in_progress");
  assert.ok(
    memory.activities.some(
      (item) =>
        item.taskId === "completed-a" &&
        item.message.includes("Ek kontrol gerekli."),
    ),
  );
  const returned = await updateTask(
    admin,
    "review-a",
    patch({ action: "return", reason: "Mobil testi tamamlayın." }),
  );
  assert.equal(returned.task.status, "in_progress");
  assert.ok(
    memory.activities.some(
      (item) =>
        item.taskId === "review-a" &&
        item.message.includes("Mobil testi tamamlayın."),
    ),
  );
});

test("managers can reprioritize work with an audit trail but cannot assign observers", async () => {
  await assert.rejects(
    updateTask(
      admin,
      "task-a",
      patch({ action: "update", assigneeId: observer.id }),
    ),
    { status: 400 },
  );
  const changed = await updateTask(
    admin,
    "task-a",
    patch({ action: "update", priority: 1 }),
  );
  assert.equal(changed.task.priority, 1);
  assert.ok(
    memory.activities.some(
      (item) => item.taskId === "task-a" && item.message.includes("3 → 1"),
    ),
  );
});

test("waiting requires an explanation, and the assigned worker can add a comment", async () => {
  await assert.rejects(
    updateTask(owner, "task-a", patch({ action: "status", status: "waiting" })),
    { status: 400 },
  );
  const waiting = await updateTask(
    owner,
    "task-a",
    patch({
      action: "status",
      status: "waiting",
      waitingReason: "Domain erişimi bekleniyor.",
    }),
  );
  assert.equal(waiting.task.waitingReason, "Domain erişimi bekleniyor.");
  const added = await addComment(owner, "task-a", "Otel ile görüşüldü.");
  assert.equal(added.comment.userId, owner.id);
  assert.equal(added.comment.body, "Otel ile görüşüldü.");
});
