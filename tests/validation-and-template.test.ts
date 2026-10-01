import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSchema, patchTaskSchema } from "../lib/server/validation";
import { buildTemplateTasks, sourceTasks } from "../lib/server/template";
import { stamp } from "./fixtures";

const validCreate = {
  hotelId: "hotel-a",
  title: "Bir görev",
  department: "Web & IT",
  priority: 1,
  checklist: ["Başarılı test"],
};

test("priority is a number between 1 and 10 for both creation and manager edits", () => {
  for (let priority = 1; priority <= 10; priority++) {
    assert.equal(
      createTaskSchema.safeParse({ ...validCreate, priority }).success,
      true,
    );
    assert.equal(
      patchTaskSchema.safeParse({ action: "update", priority }).success,
      true,
    );
  }
  for (const priority of [
    0,
    -1,
    11,
    1.5,
    "1",
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.equal(
      createTaskSchema.safeParse({ ...validCreate, priority }).success,
      false,
      `create ${String(priority)}`,
    );
    assert.equal(
      patchTaskSchema.safeParse({ action: "update", priority }).success,
      false,
      `update ${String(priority)}`,
    );
  }
});

test("task edit payloads reject status, hotel, identity and checklist mass assignment", () => {
  for (const extra of [
    { status: "completed" },
    { hotelId: "hotel-b" },
    { id: "task-b" },
    { checklist: [] },
    { role: "admin" },
  ]) {
    assert.equal(
      patchTaskSchema.safeParse({
        action: "update",
        title: "Güncellendi",
        ...extra,
      }).success,
      false,
    );
  }
  assert.equal(
    createTaskSchema.safeParse({ ...validCreate, status: "completed" }).success,
    false,
  );
  assert.equal(
    patchTaskSchema.safeParse({ action: "status", status: "review" }).success,
    false,
  );
  assert.equal(
    patchTaskSchema.safeParse({ action: "status", status: "completed" })
      .success,
    false,
  );
});

test("review return requires a nonempty reason and reopening is an explicit action", () => {
  assert.equal(patchTaskSchema.safeParse({ action: "return" }).success, false);
  assert.equal(
    patchTaskSchema.safeParse({ action: "return", reason: "   " }).success,
    false,
  );
  assert.equal(
    patchTaskSchema.safeParse({
      action: "return",
      reason: "Mobil testi tamamlayın.",
    }).success,
    true,
  );
  assert.equal(patchTaskSchema.safeParse({ action: "reopen" }).success, true);
  assert.equal(
    patchTaskSchema.safeParse({ action: "reopen", status: "in_progress" })
      .success,
    false,
  );
});

test("invalid calendar dates and malformed identifiers are rejected", () => {
  for (const dueDate of [
    "2026-02-30",
    "2026-13-01",
    "01/10/2026",
    "2026-10-01T12:00:00Z",
  ]) {
    assert.equal(
      createTaskSchema.safeParse({ ...validCreate, dueDate }).success,
      false,
    );
  }
  assert.equal(
    createTaskSchema.safeParse({ ...validCreate, dueDate: "2028-02-29" })
      .success,
    true,
  );
  assert.equal(
    createTaskSchema.safeParse({ ...validCreate, hotelId: "../../hotel-a" })
      .success,
    false,
  );
});

test("the source preserves 93 distinct rows and the documented duplicate display codes", () => {
  assert.equal(sourceTasks.length, 93);
  assert.equal(new Set(sourceTasks.map((item) => item.sourceRow)).size, 93);
  const byCode = new Map<string, number[]>();
  for (const item of sourceTasks)
    byCode.set(item.sourceTaskId, [
      ...(byCode.get(item.sourceTaskId) || []),
      item.sourceRow,
    ]);
  assert.deepEqual(
    [...byCode].filter(([, rows]) => rows.length > 1),
    [
      ["DAT-008", [13, 14, 79]],
      ["PMS-002", [31, 32]],
    ],
  );
  for (const item of sourceTasks) {
    assert.ok(item.task.trim(), `${item.sourceTaskId} needs a title`);
    assert.ok(
      item.responsibleRole.trim(),
      `${item.sourceTaskId} needs a responsible department`,
    );
    assert.ok(
      item.completionCriterion.trim(),
      `${item.sourceTaskId} needs a completion criterion`,
    );
  }
});

test("each hotel receives independent task and checklist identities while source facts are preserved", () => {
  const first = buildTemplateTasks("hotel-a", null, stamp);
  const second = buildTemplateTasks("hotel-b", "owner", stamp);
  assert.equal(first.length, 93);
  assert.equal(second.length, 93);
  assert.equal(new Set([...first, ...second].map((item) => item.id)).size, 186);
  const criteria = [...first, ...second].flatMap((item) => item.checklist);
  assert.equal(new Set(criteria.map((item) => item.id)).size, criteria.length);
  first.forEach((item, index) => {
    const source = sourceTasks[index];
    assert.equal(item.hotelId, "hotel-a");
    assert.equal(item.assigneeId, null);
    assert.equal(item.code, source.sourceTaskId);
    assert.equal(item.title, source.task);
    assert.equal(item.department, source.responsibleRole);
    assert.equal(item.hotelInput, source.hotelInput);
    assert.equal(item.checklist[0]?.text, source.completionCriterion);
    assert.equal(
      item.checklist.every((criterion) => !criterion.done),
      true,
    );
    assert.equal(item.status, "planned");
    assert.equal(item.createdAt, stamp);
    assert.equal(second[index].hotelId, "hotel-b");
    assert.equal(second[index].assigneeId, "owner");
  });
  first[0].checklist[0].done = true;
  assert.equal(
    second[0].checklist[0].done,
    false,
    "hotels must not share mutable checklist objects",
  );
});
