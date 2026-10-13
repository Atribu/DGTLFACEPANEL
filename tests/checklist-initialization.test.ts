import assert from "node:assert/strict";
import { test } from "node:test";
import type { Database } from "../lib/server/db";
import { initializeBundledChecklist } from "../lib/server/checklist-initialization";
import { ChecklistImportError } from "../lib/server/checklist-import";
import { admin, observer, owner } from "./fixtures";

function unavailableDatabase(error: Error): Database {
  return {
    storage: "postgres",
    query: async () => {
      throw error;
    },
    transaction: async () => {
      throw error;
    },
    close: async () => {},
  };
}

test("demo, staff, observer and inactive admin visits do not access the import database", async () => {
  let calls = 0;
  const db: Database = {
    ...unavailableDatabase(new Error("Must not be reached")),
    query: async () => {
      calls++;
      throw new Error("Must not be reached");
    },
    transaction: async () => {
      calls++;
      throw new Error("Must not be reached");
    },
  };
  for (const [user, demo] of [
    [admin, true],
    [owner, false],
    [observer, false],
    [{ ...admin, active: false }, false],
  ] as const) {
    assert.equal(await initializeBundledChecklist(db, user, demo), undefined);
  }
  assert.equal(calls, 0);
});

test("import conflicts become an actionable warning rather than rejecting workspace loading", async () => {
  const reason = "Aynı ada sahip birden fazla otel var: Mi Hotel.";
  const warning = await initializeBundledChecklist(
    unavailableDatabase(new ChecklistImportError(reason)),
    admin,
    false,
  );
  assert.equal(warning, reason);
});

test("unexpected database errors expose only a safe diagnostic code and permit a later retry", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  const error = Object.assign(new Error("Private database connection details"), {
    code: "55P03",
  });
  const warning = await initializeBundledChecklist(
    unavailableDatabase(error),
    admin,
    false,
  );
  assert.match(warning!, /tekrar deneyin/i);
  assert.doesNotMatch(warning!, /Private|55P03/);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(log.mock.calls[0].arguments[1].code, "55P03");
  assert.doesNotMatch(JSON.stringify(log.mock.calls[0].arguments), /Private/);

  // A later request sees the persisted completion marker; failures are not cached.
  const completed: Database = {
    ...unavailableDatabase(new Error("No transaction should run")),
    query: async <T>() => [{ key: "hotel-checklist-2026-10-v1" }] as T[],
  };
  assert.equal(
    await initializeBundledChecklist(completed, admin, false),
    undefined,
  );
});

test("arbitrary error codes cannot leak driver or connection details", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  await initializeBundledChecklist(
    unavailableDatabase(
      Object.assign(new Error("Private"), { code: "secret-url" }),
    ),
    admin,
    false,
  );
  assert.equal(log.mock.calls[0].arguments[1].code, "unknown");
  assert.doesNotMatch(
    JSON.stringify(log.mock.calls[0].arguments),
    /Private|secret-url/,
  );
});
