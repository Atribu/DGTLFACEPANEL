import assert from "node:assert/strict";
import { test } from "node:test";
import type { BootstrapData } from "../lib/types";
import { workspaceResponse } from "../lib/server/sync-response";
import { admin, comment, hotel, observer, task } from "./fixtures";

function snapshot(): BootstrapData {
  return {
    user: admin,
    users: [admin],
    hotels: [hotel("hotel-a")],
    tasks: [task()],
    activities: [],
    comments: [],
    demo: false,
  };
}

test("web workspace validators return a bodyless 304 and keep private no-store headers", async () => {
  const data = snapshot();
  const first = workspaceResponse(data, null);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), data);
  assert.match(first.headers.get("etag")!, /^"[a-f0-9]{64}"$/);
  const unchanged = workspaceResponse(data, first.headers.get("etag"));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  for (const response of [first, unchanged]) {
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("etag"), first.headers.get("etag"));
  }
});

test("web workspace validators change for task updates, new comments and initialization warnings", () => {
  const before = snapshot();
  const etag = workspaceResponse(before, null).headers.get("etag");
  for (const after of [
    { ...before, tasks: [{ ...before.tasks[0], priority: 1 }] },
    { ...before, comments: [comment("task-a")] },
    { ...before, checklistImportWarning: "Aktarım yeniden denenmeli." },
  ]) {
    const response = workspaceResponse(after, etag);
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.get("etag"), etag);
  }
});

test("web workspace validators cannot reuse another account's or former hotel's response", async () => {
  const before = snapshot();
  const etag = workspaceResponse(before, null).headers.get("etag");
  const scoped = { ...before, user: observer, users: [observer] };
  assert.equal(workspaceResponse(scoped, etag).status, 200);
  const scopedETag = workspaceResponse(scoped, null).headers.get("etag");
  const noHotels = { ...scoped, user: { ...observer, hotelIds: [] }, hotels: [], tasks: [] };
  const changed = workspaceResponse(noHotels, scopedETag);
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).tasks, []);
});
