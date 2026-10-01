import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  buildMonthGrid,
  calendarDateKey,
  calendarDayLabel,
  calendarMonthLabel,
  filterCalendarTasks,
  groupCalendarTasks,
  shiftMonth,
  startOfMonth,
} from "../lib/calendar";
import { task } from "./fixtures";

test("a Monday-starting month begins on that Monday and always has six complete weeks", () => {
  const days = buildMonthGrid("2024-01-19");
  assert.equal(days.length, 42);
  assert.equal(new Set(days.map((day) => day.date)).size, 42);
  assert.equal(days[0].date, "2024-01-01");
  assert.equal(days.at(-1)?.date, "2024-02-11");
  assert.equal(days.filter((day) => day.inMonth).length, 31);
  days.forEach((day, index) => {
    assert.equal(day.weekend, index % 7 >= 5);
    if (index) assert.equal(day.date, addCalendarDays(days[index - 1].date, 1));
  });
});

test("a Sunday-starting month includes all six preceding days", () => {
  const days = buildMonthGrid("2026-11-01");
  assert.equal(days[0].date, "2026-10-26");
  assert.equal(days[6].date, "2026-11-01");
  assert.equal(days[6].inMonth, true);
  assert.equal(days.at(-1)?.date, "2026-12-06");
});

test("February includes leap day only in leap years, including century rules", () => {
  for (const [year, count] of [
    [2024, 29],
    [2025, 28],
    [2000, 29],
    [2100, 28],
  ]) {
    const days = buildMonthGrid(`${year}-02-01`);
    assert.equal(days.filter((day) => day.inMonth).length, count);
    assert.equal(
      days.some((day) => day.date === `${year}-02-29`),
      count === 29,
    );
  }
  assert.equal(buildMonthGrid("2024-02-01")[0].date, "2024-01-29");
  assert.equal(buildMonthGrid("2024-02-01").at(-1)?.date, "2024-03-10");
});

test("month navigation crosses years and never skips a month when starting on day 31", () => {
  assert.equal(shiftMonth("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftMonth("2027-01-31", -1), "2026-12-01");
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-01");
  assert.equal(shiftMonth("2026-11-30", 14), "2028-01-01");
  const december = buildMonthGrid("2026-12-15");
  assert.equal(december[0].date, "2026-11-30");
  assert.equal(december.at(-1)?.date, "2027-01-10");
});

test("day arithmetic stays on calendar dates across leap days and daylight-saving boundaries", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addCalendarDays("2026-11-01", -1), "2026-10-31");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("invalid calendar dates cannot silently roll into another month", () => {
  for (const value of [
    "2025-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "01/10/2026",
    "",
  ]) {
    assert.throws(() => buildMonthGrid(value), RangeError);
    assert.equal(calendarDateKey(value), null);
  }
  assert.throws(() => addCalendarDays("2026-10-01", 1.5), RangeError);
  assert.throws(() => shiftMonth("2026-10-01", Number.NaN), RangeError);
});

test("date labels are Turkish and timestamp suffixes preserve their written due day", () => {
  assert.equal(startOfMonth("2026-10-31"), "2026-10-01");
  assert.equal(calendarMonthLabel("2024-02-01"), "Şubat 2024");
  assert.match(calendarDayLabel("2026-10-01"), /1 Ekim 2026 Perşembe/);
  assert.equal(calendarDateKey("2026-10-01T23:30:00-07:00"), "2026-10-01");
  assert.equal(calendarDateKey(null), null);
  assert.equal(calendarDateKey(undefined), null);
});

test("task grouping retains undated tasks, preserves source records and sorts real priorities", () => {
  const tasks = [
    task({ id: "low", priority: 10 }),
    task({ id: "complete", priority: 1, status: "completed" }),
    task({ id: "high", priority: 1 }),
    task({ id: "undated", dueDate: null }),
    task({ id: "invalid-date", dueDate: "2026-02-30" }),
  ];
  const before = structuredClone(tasks);
  const groups = groupCalendarTasks(tasks);
  assert.deepEqual(
    groups.dated.get("2026-10-03")?.map((item) => item.id),
    ["high", "low", "complete"],
  );
  assert.deepEqual(groups.undated.map((item) => item.id).sort(), [
    "invalid-date",
    "undated",
  ]);
  assert.equal(
    [...groups.dated.values()].flat().length + groups.undated.length,
    tasks.length,
  );
  assert.deepEqual(tasks, before);
});

test("hotel, owner and status filters only narrow the supplied scoped task set", () => {
  const tasks = [
    task({
      id: "mine",
      hotelId: "hotel-a",
      assigneeId: "owner",
      status: "review",
    }),
    task({
      id: "done",
      hotelId: "hotel-a",
      assigneeId: "owner",
      status: "completed",
    }),
    task({ id: "other", hotelId: "hotel-a", assigneeId: "other" }),
    task({ id: "empty", hotelId: "hotel-b", assigneeId: null, dueDate: null }),
  ];
  assert.deepEqual(
    filterCalendarTasks(
      tasks,
      { hotelId: "hotel-a", assignee: "mine", status: "open" },
      "owner",
    ).map((item) => item.id),
    ["mine"],
  );
  assert.deepEqual(
    filterCalendarTasks(
      tasks,
      { hotelId: "", assignee: "user:owner", status: "completed" },
      "other",
    ).map((item) => item.id),
    ["done"],
  );
  assert.deepEqual(
    filterCalendarTasks(
      tasks,
      { hotelId: "", assignee: "unassigned", status: "all" },
      "owner",
    ).map((item) => item.id),
    ["empty"],
  );
  assert.deepEqual(
    filterCalendarTasks(
      tasks,
      { hotelId: "not-visible", assignee: "all", status: "all" },
      "owner",
    ),
    [],
  );
});
