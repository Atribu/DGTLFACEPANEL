import assert from "node:assert/strict";
import test from "node:test";
import { validMaintenanceToken } from "../lib/server/maintenance-secret";

test("scheduled endpoint requires the exact independent bearer secret", () => {
  const secret = "test-worker-secret-that-is-not-a-session-cookie";
  assert.equal(validMaintenanceToken(`Bearer ${secret}`, secret), true);
  assert.equal(validMaintenanceToken("Bearer ", ""), false);
  assert.equal(validMaintenanceToken("Bearer short", "short"), false);
  for (const header of [
    null,
    "",
    secret,
    "Bearer ",
    `bearer ${secret}`,
    `Bearer ${secret}x`,
    `Bearer ${secret.slice(0, -1)}x`,
    `Basic ${secret}`,
  ])
    assert.equal(validMaintenanceToken(header, secret), false);
});
