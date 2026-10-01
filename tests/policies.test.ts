import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveTask,
  canEditChecklist,
  canManage,
  canReturnTask,
  canSetStatus,
  canSubmitTask,
  canViewHotel,
  canViewTask,
  canWorkOnTask,
} from "../lib/server/policies";
import { sortTasks } from "../lib/client";
import type { TaskStatus } from "../lib/types";
import { admin, observer, otherStaff, owner, task } from "./fixtures";

test("managers and staff can see all hotels; observers are restricted to explicit hotel membership", () => {
  for (const user of [admin, owner, otherStaff]) {
    assert.equal(canViewHotel(user, "hotel-a"), true);
    assert.equal(canViewHotel(user, "unrelated-hotel"), true);
  }
  assert.equal(canViewHotel(observer, "hotel-a"), true);
  assert.equal(canViewHotel(observer, "hotel-b"), false);
  assert.equal(canViewHotel({ ...observer, hotelIds: [] }, "hotel-a"), false);
  assert.equal(canViewTask(observer, task({ hotelId: "hotel-b" })), false);
});

test("staff may work only on their assigned tasks and observers never gain mutation rights", () => {
  const item = task();
  assert.equal(canWorkOnTask(admin, item), true);
  assert.equal(canWorkOnTask(owner, item), true);
  assert.equal(canViewTask(otherStaff, item), true);
  assert.equal(canWorkOnTask(otherStaff, item), false);
  assert.equal(canWorkOnTask(owner, task({ assigneeId: null })), false);
  assert.equal(
    canWorkOnTask(observer, task({ assigneeId: observer.id })),
    false,
  );
  for (const user of [owner, otherStaff, observer])
    assert.equal(canManage(user), false);
  assert.equal(canManage(admin), true);
});

test("review and completed work is immutable until an explicit manager transition", () => {
  for (const status of ["review", "completed"] as TaskStatus[]) {
    for (const user of [admin, owner, otherStaff, observer]) {
      const item = task({
        status,
        checklist: [{ id: "done", text: "Kontrol edildi", done: true }],
      });
      assert.equal(
        canEditChecklist(user, item),
        false,
        `${user.role} checklist ${status}`,
      );
      assert.equal(
        canSetStatus(user, item, "in_progress"),
        false,
        `${user.role} direct reopen ${status}`,
      );
      assert.equal(
        canSubmitTask(user, item),
        false,
        `${user.role} resubmit ${status}`,
      );
    }
  }
});

test("normal status changes cannot bypass the submission and approval workflow", () => {
  for (const user of [admin, owner]) {
    assert.equal(canSetStatus(user, task(), "planned"), true);
    assert.equal(canSetStatus(user, task(), "waiting"), true);
    assert.equal(canSetStatus(user, task(), "review"), false);
    assert.equal(canSetStatus(user, task(), "completed"), false);
  }
  assert.equal(canSubmitTask(owner, task()), false);
  const ready = task({
    checklist: [{ id: "ready", text: "Hazır", done: true }],
  });
  assert.equal(canSubmitTask(owner, ready), true);
  assert.equal(canSubmitTask(otherStaff, ready), false);
  assert.equal(canSubmitTask(observer, ready), false);
});

test("only managers can approve or return work that is waiting for review", () => {
  for (const status of [
    "planned",
    "in_progress",
    "waiting",
    "review",
    "completed",
  ] as TaskStatus[]) {
    for (const user of [admin, owner, otherStaff, observer]) {
      const expected = user.role === "admin" && status === "review";
      assert.equal(canApproveTask(user, task({ status })), expected);
      assert.equal(canReturnTask(user, task({ status })), expected);
    }
  }
});

test("task ordering uses ascending priority, then due date, and puts completed work last", () => {
  const source = [
    task({
      id: "finished",
      status: "completed",
      priority: 1,
      dueDate: "2026-09-01",
    }),
    task({ id: "p2", priority: 2, dueDate: "2026-09-01" }),
    task({ id: "p1-later", priority: 1, dueDate: "2026-10-05" }),
    task({ id: "p1-no-date", priority: 1, dueDate: null }),
    task({ id: "p1-sooner", priority: 1, dueDate: "2026-10-02" }),
  ];
  assert.deepEqual(
    sortTasks(source).map((item) => item.id),
    ["p1-sooner", "p1-later", "p1-no-date", "p2", "finished"],
  );
  assert.equal(
    source[0].id,
    "finished",
    "sorting must not mutate the input array",
  );
});
