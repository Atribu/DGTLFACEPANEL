import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  buildHotelReport,
  csvCell,
  defaultReportPeriod,
  reportCsv,
  reportFilename,
  ReportValidationError,
  validateReportFilters,
  type ReportFilters,
} from "../lib/reports";
import { getHotelReport, parseReportQuery } from "../lib/server/reports";
import type { Database, Queryable } from "../lib/server/db";
import type { Hotel, Task } from "../lib/types";
import { admin, hotel, observer, owner, task } from "./fixtures";

const filters: ReportFilters = {
  hotelId: "hotel-a",
  from: "2026-10-01",
  to: "2026-10-31",
  includeUndated: false,
};
const now = new Date("2026-10-01T22:15:00Z"); // 2 October in Istanbul.
const names = new Map([[owner.id, owner.name]]);
const periodTasks = (): Task[] => [
  task({ id: "planned", status: "planned", dueDate: "2026-10-01" }),
  task({ id: "completed", status: "completed", dueDate: "2026-10-01" }),
  task({ id: "progress", status: "in_progress", dueDate: "2026-10-02" }),
  task({
    id: "waiting",
    status: "waiting",
    dueDate: "2026-10-03",
    waitingReason: "Otel onayı bekleniyor.",
  }),
  task({ id: "review", status: "review", dueDate: "2026-10-31" }),
  task({
    id: "before",
    status: "completed",
    dueDate: "2026-09-30",
    updatedAt: "2026-10-02T00:00:00Z",
  }),
  task({ id: "after", dueDate: "2026-11-01" }),
  task({ id: "undated", dueDate: null }),
  task({
    id: "foreign",
    hotelId: "hotel-b",
    title: "Başka otele özel görev",
    dueDate: "2026-10-01",
    assigneeId: "private-person",
  }),
];

class ReportsDatabase implements Database {
  storage = "postgres" as const;
  hotels: Hotel[] = [hotel("hotel-a"), hotel("hotel-b")];
  tasks = periodTasks();
  queries: Array<{ sql: string; params: unknown[] }> = [];
  async close() {}
  transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    return fn(this);
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.queries.push({ sql, params });
    if (sql === "SELECT data FROM hotels WHERE id=$1")
      return this.hotels
        .filter((item) => item.id === params[0])
        .map((data) => ({ data })) as T[];
    if (sql === "SELECT data FROM tasks WHERE hotel_id=$1")
      return this.tasks
        .filter((item) => item.hotelId === params[0])
        .map((data) => ({ data })) as T[];
    if (
      sql ===
      "SELECT id,data->>'name' AS name FROM app_users WHERE id=ANY($1::text[])"
    ) {
      return [
        { id: owner.id, name: owner.name },
        { id: "private-person", name: "Başka Otelin Kişisi" },
      ].filter((item) => (params[0] as string[]).includes(item.id)) as T[];
    }
    throw new Error(`Unexpected report query: ${sql}`);
  }
}

const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
let previous: Promise<Database> | undefined;
let memory: ReportsDatabase;
beforeEach(() => {
  previous = globals.dgtlDatabase;
  memory = new ReportsDatabase();
  globals.dgtlDatabase = Promise.resolve(memory);
});
afterEach(() => {
  globals.dgtlDatabase = previous;
});

test("report period validation includes both endpoints and accepts at most 366 real calendar days", () => {
  assert.equal(
    validateReportFilters({ ...filters, from: "2024-01-01", to: "2024-12-31" })
      .to,
    "2024-12-31",
  );
  assert.equal(
    validateReportFilters({ ...filters, from: "2026-10-01", to: "2026-10-01" })
      .from,
    "2026-10-01",
  );
  for (const invalid of [
    { from: "2024-01-01", to: "2025-01-01" },
    { from: "2026-11-01", to: "2026-10-01" },
    { from: "2026-02-30" },
    { to: "2025-02-29" },
    { hotelId: "" },
    { hotelId: "../hotel-a" },
    { includeUndated: "yes" },
    { from: "2026-10-01T00:00:00Z" },
  ])
    assert.throws(
      () => validateReportFilters({ ...filters, ...invalid }),
      ReportValidationError,
    );
  assert.equal(
    validateReportFilters({ ...filters, includeUndated: "true" })
      .includeUndated,
    true,
  );
});

test("default periods include the last day of leap February and December", () => {
  assert.deepEqual(defaultReportPeriod("2024-02-18"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.deepEqual(defaultReportPeriod("2026-12-31"), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
});

test("current-status aggregation uses only the requested hotel's due dates, never update/completion dates", () => {
  const source = periodTasks();
  const before = structuredClone(source);
  const report = buildHotelReport(
    hotel("hotel-a"),
    source,
    names,
    filters,
    now,
  );
  assert.equal(report.today, "2026-10-02");
  assert.deepEqual(report.summary, {
    total: 5,
    planned: 1,
    in_progress: 1,
    waiting: 1,
    review: 1,
    completed: 1,
    overdue: 1,
    completionRate: 20,
  });
  assert.deepEqual(report.tasks.map((item) => item.id).sort(), [
    "completed",
    "planned",
    "progress",
    "review",
    "waiting",
  ]);
  assert.equal(
    report.tasks.find((item) => item.id === "waiting")?.waitingReason,
    "Otel onayı bekleniyor.",
  );
  assert.equal(report.undated.count, 1);
  assert.equal(report.undated.included, false);
  assert.deepEqual(report.undated.tasks, []);
  assert.deepEqual(source, before);
});

test("undated tasks are an explicit separate appendix and do not change period denominators", () => {
  const report = buildHotelReport(
    hotel("hotel-a"),
    periodTasks(),
    names,
    { ...filters, includeUndated: true },
    now,
  );
  assert.equal(report.summary.total, 5);
  assert.equal(report.summary.completionRate, 20);
  assert.equal(report.undated.included, true);
  assert.deepEqual(
    report.undated.tasks.map((item) => item.id),
    ["undated"],
  );
  assert.equal(report.undated.tasks[0].overdue, false);
});

test("empty report ratios are zero and unknown or missing assignees have truthful labels", () => {
  const empty = buildHotelReport(hotel("hotel-a"), [], names, filters, now);
  assert.equal(empty.summary.total, 0);
  assert.equal(empty.summary.completionRate, 0);
  const result = buildHotelReport(
    hotel("hotel-a"),
    [
      task({ id: "missing", assigneeId: "gone" }),
      task({ id: "none", assigneeId: null }),
    ],
    names,
    filters,
    now,
  );
  assert.equal(
    result.tasks.find((item) => item.id === "missing")?.assigneeName,
    "Sorumlu bilgisi yok",
  );
  assert.equal(
    result.tasks.find((item) => item.id === "none")?.assigneeName,
    "Atanmadı",
  );
});

test("observer report authorization rejects cross-hotel access before any database read", async () => {
  await assert.rejects(
    getHotelReport(observer, { ...filters, hotelId: "hotel-b" }, now),
    { status: 404 },
  );
  assert.equal(memory.queries.length, 0);
  await assert.rejects(
    getHotelReport({ ...observer, hotelIds: [] }, filters, now),
    { status: 404 },
  );
  await assert.rejects(
    getHotelReport({ ...admin, active: false }, filters, now),
    { status: 404 },
  );
});

test("observer reports expose selected-hotel task names without other-hotel or private user fields", async () => {
  const result = await getHotelReport(observer, filters, now);
  assert.equal(result.hotel.id, "hotel-a");
  assert.equal(result.summary.total, 5);
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    "Başka otele özel görev",
    "Başka Otelin Kişisi",
    "private-person",
    "contactEmail",
    "hotelIds",
    "password",
    owner.email,
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
  const peopleQuery = memory.queries.find((item) =>
    item.sql.includes("AS name"),
  );
  assert.deepEqual(peopleQuery?.params, [[owner.id]]);
});

test("administrators and staff can report another hotel while nonexistent hotels return 404", async () => {
  for (const user of [admin, owner]) {
    const result = await getHotelReport(
      user,
      { ...filters, hotelId: "hotel-b" },
      now,
    );
    assert.equal(result.summary.total, 1);
    assert.equal(result.tasks[0].assigneeName, "Başka Otelin Kişisi");
  }
  await assert.rejects(
    getHotelReport(admin, { ...filters, hotelId: "missing" }, now),
    { status: 404 },
  );
});

test("query parsing rejects duplicate/invalid filters and missing hotel selection", () => {
  assert.equal(
    parseReportQuery(
      new URLSearchParams("hotelId=hotel-a&from=2026-10-01&to=2026-10-31"),
    ).includeUndated,
    false,
  );
  for (const query of [
    "hotelId=hotel-a&hotelId=hotel-b&from=2026-10-01&to=2026-10-31",
    "from=2026-10-01&to=2026-10-31",
    "hotelId=hotel-a&from=2026-10-01&to=2026-10-31&includeUndated=1",
  ])
    assert.throws(() => parseReportQuery(new URLSearchParams(query)), {
      status: 400,
    });
});

test("CSV field quoting neutralizes Excel formulas, tabs, carriage returns and quoted separators", () => {
  for (const input of [
    '=HYPERLINK("https://example.test")',
    "+1",
    "-1+2",
    "@SUM(A1)",
    "  =1+1",
    "\tformula",
    "\rformula",
    " \tformula",
    "\u0000=1",
  ]) {
    assert.ok(csvCell(input).startsWith("\"'"), JSON.stringify(input));
  }
  assert.equal(
    csvCell('Otel; "A"\nİkinci satır'),
    '"Otel; ""A""\nİkinci satır"',
  );
  assert.equal(csvCell(5), '"5"');
  assert.equal(csvCell(null), '""');
});

test("CSV has a UTF-8 BOM, semicolon columns and a separate optional undated scope", () => {
  const report = buildHotelReport(
    { ...hotel("hotel-a"), name: "İzmir Çeşme / Otel" },
    periodTasks(),
    names,
    { ...filters, includeUndated: true },
    now,
  );
  const csv = reportCsv(report);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"Görev kodu";"Görev";"Departman";"Sorumlu"'));
  assert.ok(csv.includes('"Tarihsiz görevler · Ek bölüm"'));
  assert.ok(csv.includes("Dönem içinde tamamlanan işler raporu değildir."));
  assert.equal(csv.includes("Başka otele özel görev"), false);
  assert.equal(
    reportFilename(report),
    "dgtlface-izmir-cesme-otel-2026-10-01-2026-10-31.csv",
  );
  const withoutAppendix = reportCsv(
    buildHotelReport(hotel("hotel-a"), periodTasks(), names, filters, now),
  );
  assert.equal(
    withoutAppendix.includes('"Tarihsiz görevler · Ek bölüm"'),
    false,
  );
});
