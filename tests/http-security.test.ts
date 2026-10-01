import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOrigin, readBody, requireAdmin } from "../lib/server/http";
import { commentSchema } from "../lib/server/validation";
import { hashPassword, verifyPassword } from "../lib/server/password";
import { admin, observer, otherStaff, owner } from "./fixtures";

const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000")
  .origin;
const request = (headers: Record<string, string>, body = "{}") =>
  new Request(`${origin}/api/tasks`, { method: "POST", headers, body });

test("mutations reject missing/cross-site origins even when a browser might send cookies", () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(request({ origin, "sec-fetch-site": "same-origin" })),
  );
  assert.throws(() => assertSameOrigin(request({})), { status: 403 });
  assert.throws(
    () => assertSameOrigin(request({ origin: "https://other.example.test" })),
    { status: 403 },
  );
  assert.throws(
    () => assertSameOrigin(request({ origin, "sec-fetch-site": "cross-site" })),
    { status: 403 },
  );
});

test("JSON parsing rejects malformed, oversized, and wrong-content-type bodies", async () => {
  await assert.rejects(
    readBody(
      request({ "content-type": "text/plain" }, '{"body":"not"}'),
      commentSchema,
    ),
    { status: 400 },
  );
  await assert.rejects(
    readBody(
      request({ "content-type": "application/json" }, "{invalid"),
      commentSchema,
    ),
    { status: 400 },
  );
  await assert.rejects(
    readBody(
      request(
        { "content-type": "application/json" },
        JSON.stringify({ body: "x".repeat(33000) }),
      ),
      commentSchema,
    ),
    { status: 400 },
  );
  assert.deepEqual(
    await readBody(
      request(
        { "content-type": "application/json" },
        '{"body":"  Kontrol edildi.  "}',
      ),
      commentSchema,
    ),
    { body: "Kontrol edildi." },
  );
});

test("the common manager guard rejects every non-manager role", () => {
  assert.doesNotThrow(() => requireAdmin(admin));
  for (const user of [owner, otherStaff, observer])
    assert.throws(() => requireAdmin(user), { status: 403 });
});

test("password hashes are independently salted, verify correct passwords, and reject malformed hashes", async () => {
  const first = await hashPassword("Test-only-password-123!");
  const second = await hashPassword("Test-only-password-123!");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("Test-only-password-123!", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(
    await verifyPassword("Test-only-password-123!", "scrypt:bad:missing"),
    false,
  );
  assert.equal(
    await verifyPassword("Test-only-password-123!", "plaintext"),
    false,
  );
});
