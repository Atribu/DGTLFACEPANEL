import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "../lib/server/db";
import type { Hotel, Task, User } from "../lib/types";
import {
  applyChecklistImport,
  ChecklistImportError,
  ensureChecklistImport,
  HOTEL_NAMES,
  IMPORT_ID,
  planChecklistImport,
} from "../lib/server/checklist-import";
import { sourceTasks } from "../lib/server/template";

const admin: User = {
  id: "real-admin",
  name: "İş Yöneticisi",
  email: "admin@example.test",
  role: "admin",
  department: "Yönetim",
  hotelIds: [],
};
let local: PGlite;
let db: Database;
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
    CREATE TABLE app_meta(key text PRIMARY KEY,value text NOT NULL);
    CREATE TABLE app_users(id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,data jsonb NOT NULL);
    CREATE TABLE hotels(id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks(id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities(id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
  `);
});
beforeEach(async () => {
  await local.exec("TRUNCATE activities,tasks,hotels,app_users,app_meta");
  await db.query(
    "INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)",
    [admin.id, admin.email, "unused-test-hash", JSON.stringify(admin)],
  );
});
after(async () => {
  await db.close();
});

async function counts() {
  const [result] = await db.query<{
    hotels: number;
    tasks: number;
    activities: number;
    markers: number;
  }>(
    "SELECT (SELECT count(*)::int FROM hotels) AS hotels,(SELECT count(*)::int FROM tasks) AS tasks,(SELECT count(*)::int FROM activities) AS activities,(SELECT count(*)::int FROM app_meta) AS markers",
  );
  return result;
}
function hotel(id: string, name: string): Hotel {
  return {
    id,
    name,
    location: "Mevcut konum",
    contactName: "Mevcut yetkili",
    contactEmail: "owner@example.test",
    managerId: "existing-coordinator",
    services: ["SEO"],
    color: "#123456",
    stage: "operation",
    createdAt: "2020-01-01T00:00:00.000Z",
  };
}
async function addHotel(value: Hotel) {
  await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
    value.id,
    JSON.stringify(value),
  ]);
}
async function addTask(id: string, hotelId: string) {
  const value = {
    id,
    hotelId,
    code: "MANUAL-1",
    title: "Mevcut görev",
    status: "in_progress",
    assigneeId: null,
    checklist: [],
  };
  await db.query(
    "INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [id, hotelId, null, JSON.stringify(value)],
  );
}

test("preview is strictly read-only and repeated previews have stable hotel identities", async () => {
  const readonly: Queryable = {
    query: async <T>(sql: string, params?: unknown[]) => {
      assert.match(sql, /^SELECT /);
      return db.query<T>(sql, params);
    },
  };
  const first = await planChecklistImport(readonly, " ADMIN@EXAMPLE.TEST ");
  const second = await planChecklistImport(readonly, admin.email);
  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  assert.equal(first.tasksToCreate, 558);
  assert.deepEqual(
    first.hotels.map((item) => item.name),
    [...HOTEL_NAMES],
  );
  assert.ok(
    first.hotels.every(
      (item) => item.action === "create" && item.taskCount === 93,
    ),
  );
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await counts(), {
    hotels: 0,
    tasks: 0,
    activities: 0,
    markers: 0,
  });
});

test("creates six hotels and all 558 tasks, including duplicate display codes, without assignments", async () => {
  const result = await applyChecklistImport(db, admin.email);
  assert.equal(result.status, "imported");
  assert.equal(result.createdHotels, 6);
  assert.equal(result.createdTasks, 558);
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 558,
    activities: 6,
    markers: 1,
  });
  const hotels = await db.query<{ data: Hotel }>("SELECT data FROM hotels");
  for (const { data: value } of hotels) {
    assert.equal(value.managerId, admin.id);
    assert.equal(value.contactName, "");
    assert.equal(value.contactEmail, "");
    assert.equal(value.location, "");
    assert.deepEqual(value.services, []);
    const tasks = await db.query<{ data: Task; assignee_id: string | null }>(
      "SELECT data,assignee_id FROM tasks WHERE hotel_id=$1",
      [value.id],
    );
    assert.equal(tasks.length, 93);
    assert.equal(new Set(tasks.map(({ data }) => data.stage)).size, 12);
    assert.equal(tasks.filter(({ data }) => data.code === "DAT-008").length, 3);
    assert.equal(tasks.filter(({ data }) => data.code === "PMS-002").length, 2);
    for (const row of tasks) {
      assert.equal(row.data.status, "planned");
      assert.equal(row.data.assigneeId, null);
      assert.equal(row.assignee_id, null);
      assert.equal(row.data.dueDate, null);
      assert.ok(row.data.checklist.every((item) => !item.done));
      const source = sourceTasks.find(
        (item) =>
          item.task === row.data.title && item.sourceTaskId === row.data.code,
      )!;
      assert.ok(source);
      assert.equal(row.data.department, source.responsibleRole);
      assert.equal(row.data.hotelInput, source.hotelInput);
      assert.equal(row.data.checklist[0]?.text, source.completionCriterion);
    }
  }
  const rows = await db.query<{ data: Task }>("SELECT data FROM tasks");
  assert.equal(
    new Set(rows.flatMap(({ data }) => data.checklist.map((item) => item.id)))
      .size,
    558,
  );
});

test("reuses Turkish case-matched empty hotels and retains all existing metadata", async () => {
  const existing = hotel("existing-mi", "  Mİ HOTEL ");
  await addHotel(existing);
  const plan = await planChecklistImport(db, admin.email);
  assert.equal(plan.hotels[4].action, "reuse");
  assert.equal(plan.hotels[4].id, existing.id);
  const result = await applyChecklistImport(db, admin.email);
  assert.equal(result.createdHotels, 5);
  assert.equal(result.reusedHotels, 1);
  const [row] = await db.query<{ data: Hotel }>(
    "SELECT data FROM hotels WHERE id=$1",
    [existing.id],
  );
  assert.deepEqual(row.data, existing);
});

test("retry verifies imported identities and preserves later status, notes, metadata and manual tasks", async () => {
  const first = await applyChecklistImport(db, admin.email);
  const hotelId = first.plan.hotels[0].id;
  const [row] = await db.query<{ id: string; data: Task }>(
    "SELECT id,data FROM tasks WHERE hotel_id=$1 LIMIT 1",
    [hotelId],
  );
  row.data.status = "completed";
  row.data.description = "Ekip açıklaması";
  row.data.checklist[0].done = true;
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    row.id,
    JSON.stringify(row.data),
  ]);
  await db.query(
    "UPDATE hotels SET data=jsonb_set(data,'{name}','\"Güncellenen otel adı\"'::jsonb) WHERE id=$1",
    [hotelId],
  );
  await addTask("later-manual-task", hotelId);
  const before = await db.query("SELECT id,data FROM tasks ORDER BY id");
  const second = await applyChecklistImport(db, admin.email);
  assert.equal(second.status, "already_imported");
  assert.equal(second.createdTasks, 0);
  assert.equal(second.plan.tasksToCreate, 0);
  assert.deepEqual(
    await db.query("SELECT id,data FROM tasks ORDER BY id"),
    before,
  );
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 559,
    activities: 6,
    markers: 1,
  });
});

test("concurrent retries serialize into exactly one import", async () => {
  const results = await Promise.all([
    applyChecklistImport(db, admin.email),
    applyChecklistImport(db, admin.email),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "already_imported",
    "imported",
  ]);
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 558,
    activities: 6,
    markers: 1,
  });
});

test("task batch failure rolls back hotels, tasks, audit and completion marker together", async () => {
  let inserted = 0;
  const failing: Database = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("INSERT INTO tasks") && ++inserted === 2)
              throw new Error("Injected write failure");
            return tx.query<T>(sql, params);
          },
        }),
      ),
  };
  await assert.rejects(
    applyChecklistImport(failing, admin.email),
    /Injected write failure/,
  );
  assert.deepEqual(await counts(), {
    hotels: 0,
    tasks: 0,
    activities: 0,
    markers: 0,
  });
  assert.equal(
    (await applyChecklistImport(db, admin.email)).status,
    "imported",
  );
});

test("runtime initialization uses six task batches and repeated openings use a single marker read", async () => {
  let batches = 0;
  const tracked: Database = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("INSERT INTO tasks")) batches++;
            return tx.query<T>(sql, params);
          },
        }),
      ),
  };
  await ensureChecklistImport(tracked, admin.email);
  assert.equal(batches, 6);
  let reads = 0;
  await ensureChecklistImport(
    {
      ...db,
      query: async <T>(sql: string, params?: unknown[]) => {
        assert.equal(sql, "SELECT key FROM app_meta WHERE key=$1");
        reads++;
        return db.query<T>(sql, params);
      },
      transaction: async () =>
        assert.fail("A completed import needs no transaction"),
    },
    admin.email,
  );
  assert.equal(reads, 1);
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 558,
    activities: 6,
    markers: 1,
  });
});

test("runtime completion marker preserves deletions and changed task codes even with an older source hash", async () => {
  await ensureChecklistImport(db, admin.email);
  const rows = await db.query<{ id: string; hotel_id: string; data: Task }>(
    "SELECT id,hotel_id,data FROM tasks ORDER BY id LIMIT 2",
  );
  await db.query("DELETE FROM tasks WHERE id=$1", [rows[0].id]);
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    rows[1].id,
    JSON.stringify({
      ...rows[1].data,
      code: "TEAM-EDITED-CODE",
      description: "Ekibin kaydettiği not",
      status: "completed",
    }),
  ]);
  await db.query(
    "UPDATE hotels SET data=jsonb_set(data,'{name}','\"Ekibin yeni otel adı\"'::jsonb) WHERE id=$1",
    [rows[1].hotel_id],
  );
  const [stored] = await db.query<{ value: string }>(
    "SELECT value FROM app_meta WHERE key=$1",
    [IMPORT_ID],
  );
  const marker = JSON.parse(stored.value);
  marker.sourceHash = "0".repeat(64);
  await db.query("UPDATE app_meta SET value=$2 WHERE key=$1", [
    IMPORT_ID,
    JSON.stringify(marker),
  ]);
  const before = await db.query("SELECT id,data FROM tasks ORDER BY id");
  const beforeHotels = await db.query("SELECT id,data FROM hotels ORDER BY id");
  await ensureChecklistImport(db, admin.email);
  assert.deepEqual(
    await db.query("SELECT id,data FROM tasks ORDER BY id"),
    before,
  );
  assert.deepEqual(
    await db.query("SELECT id,data FROM hotels ORDER BY id"),
    beforeHotels,
  );
  assert.equal((await counts()).tasks, 557);
});

test("runtime rechecks completion inside the lock if an earlier marker read was stale", async () => {
  await ensureChecklistImport(db, admin.email);
  await db.query("DELETE FROM tasks WHERE id=(SELECT id FROM tasks LIMIT 1)");
  let locked = false;
  const stale: Database = {
    ...db,
    query: async <T>() => [] as T[],
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("LOCK TABLE hotels,tasks")) locked = true;
            assert.ok(
              !sql.startsWith("INSERT"),
              "Completed imports must not write",
            );
            return tx.query<T>(sql, params);
          },
        }),
      ),
  };
  await ensureChecklistImport(stale, admin.email);
  assert.equal(locked, true);
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 557,
    activities: 6,
    markers: 1,
  });
});

test("concurrent runtime openings create one set of tasks and one completion marker", async () => {
  await Promise.all([
    ensureChecklistImport(db, admin.email),
    ensureChecklistImport(db, admin.email),
    ensureChecklistImport(db, admin.email),
  ]);
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 558,
    activities: 6,
    markers: 1,
  });
});

test("runtime batch failure rolls back all content and a subsequent opening retries successfully", async () => {
  let batches = 0;
  const failing: Database = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("INSERT INTO tasks") && ++batches === 2)
              throw new Error("Transient runtime write failure");
            return tx.query<T>(sql, params);
          },
        }),
      ),
  };
  await assert.rejects(
    ensureChecklistImport(failing, admin.email),
    /Transient runtime/,
  );
  assert.deepEqual(await counts(), {
    hotels: 0,
    tasks: 0,
    activities: 0,
    markers: 0,
  });
  await ensureChecklistImport(db, admin.email);
  assert.equal((await counts()).tasks, 558);
  assert.equal((await counts()).markers, 1);
});

test("runtime import refuses conflicting existing work without a completion marker", async () => {
  await addHotel(hotel("existing-beach", HOTEL_NAMES[0]));
  await addTask("existing-task", "existing-beach");
  const before = await db.query("SELECT id,data FROM tasks ORDER BY id");
  await assert.rejects(ensureChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /görev var/,
  });
  assert.deepEqual(
    await db.query("SELECT id,data FROM tasks ORDER BY id"),
    before,
  );
  assert.deepEqual(await counts(), {
    hotels: 1,
    tasks: 1,
    activities: 0,
    markers: 0,
  });
});

test("nonempty matching hotel is refused without altering existing work or unrelated hotels", async () => {
  await addHotel(hotel("existing-beach", HOTEL_NAMES[0]));
  await addTask("existing-task", "existing-beach");
  await addHotel(hotel("unrelated", "Başka otel"));
  const before = await counts();
  await assert.rejects(applyChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /görev var/,
  });
  assert.deepEqual(await counts(), before);
});

test("unrelated hotel and its work remain byte-for-byte equivalent during successful import", async () => {
  await addHotel(hotel("unrelated", "Başka otel"));
  await addTask("unrelated-task", "unrelated");
  const beforeHotels = await db.query(
    "SELECT * FROM hotels WHERE id='unrelated'",
  );
  const beforeTasks = await db.query(
    "SELECT * FROM tasks WHERE id='unrelated-task'",
  );
  await applyChecklistImport(db, admin.email);
  assert.deepEqual(
    await db.query("SELECT * FROM hotels WHERE id='unrelated'"),
    beforeHotels,
  );
  assert.deepEqual(
    await db.query("SELECT * FROM tasks WHERE id='unrelated-task'"),
    beforeTasks,
  );
});

test("ambiguous normalized hotel names are refused", async () => {
  await addHotel(hotel("one", "Mi Hotel"));
  await addHotel(hotel("two", " Mİ   HOTEL "));
  await assert.rejects(applyChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /birden fazla/,
  });
  assert.deepEqual(await counts(), {
    hotels: 2,
    tasks: 0,
    activities: 0,
    markers: 0,
  });
});

test("missing, observer and inactive accounts are refused", async () => {
  await assert.rejects(
    planChecklistImport(db, "missing@example.test"),
    ChecklistImportError,
  );
  for (const change of [{ role: "observer" }, { active: false }]) {
    await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
      admin.id,
      JSON.stringify({ ...admin, ...change }),
    ]);
    await assert.rejects(
      applyChecklistImport(db, admin.email),
      ChecklistImportError,
    );
  }
  assert.deepEqual(await counts(), {
    hotels: 0,
    tasks: 0,
    activities: 0,
    markers: 0,
  });
});

test("demo database and malformed completion marker are refused", async () => {
  await db.query(
    "INSERT INTO app_meta(key,value) VALUES ('demo-seeded-v1','1')",
  );
  await assert.rejects(applyChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /Demo/,
  });
  await db.query("DELETE FROM app_meta");
  for (const marker of [
    "not JSON",
    "{}",
    JSON.stringify({ importId: IMPORT_ID }),
  ]) {
    await db.query(
      "INSERT INTO app_meta(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
      [IMPORT_ID, marker],
    );
    await assert.rejects(applyChecklistImport(db, admin.email), {
      name: "ChecklistImportError",
      message: /tamamlama kaydı geçersiz/,
    });
  }
  assert.deepEqual(await counts(), {
    hotels: 0,
    tasks: 0,
    activities: 0,
    markers: 1,
  });
});

test("completion marker with a changed source hash cannot bypass verification", async () => {
  await applyChecklistImport(db, admin.email);
  const [row] = await db.query<{ value: string }>(
    "SELECT value FROM app_meta WHERE key=$1",
    [IMPORT_ID],
  );
  const marker = JSON.parse(row.value);
  marker.sourceHash = "0".repeat(64);
  await db.query("UPDATE app_meta SET value=$2 WHERE key=$1", [
    IMPORT_ID,
    JSON.stringify(marker),
  ]);
  await assert.rejects(applyChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /kaynakla eşleşmiyor/,
  });
});

test("missing or wrongly mapped imported tasks are detected without repairing over user data", async () => {
  const result = await applyChecklistImport(db, admin.email);
  const [row] = await db.query<{ id: string; data: Task }>(
    "SELECT id,data FROM tasks LIMIT 1",
  );
  const original = row.data;
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    row.id,
    JSON.stringify({ ...original, code: "WRONG" }),
  ]);
  await assert.rejects(planChecklistImport(db, admin.email), {
    name: "ChecklistImportError",
    message: /eşleşmesi doğrulanamadı/,
  });
  await db.query("UPDATE tasks SET data=$2::jsonb WHERE id=$1", [
    row.id,
    JSON.stringify(original),
  ]);
  const anotherHotel = result.plan.hotels.find(
    (hotel) => hotel.id !== original.hotelId,
  )!;
  await db.query("UPDATE tasks SET hotel_id=$2 WHERE id=$1", [
    row.id,
    anotherHotel.id,
  ]);
  await assert.rejects(
    planChecklistImport(db, admin.email),
    ChecklistImportError,
  );
  await db.query("DELETE FROM tasks WHERE id=$1", [row.id]);
  await assert.rejects(
    applyChecklistImport(db, admin.email),
    ChecklistImportError,
  );
  assert.deepEqual(await counts(), {
    hotels: 6,
    tasks: 557,
    activities: 6,
    markers: 1,
  });
});
