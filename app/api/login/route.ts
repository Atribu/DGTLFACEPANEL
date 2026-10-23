import { getSession } from "../../../lib/server/auth";
import { randomUUID } from "node:crypto";
import { getDb } from "../../../lib/server/db";
import { recordFailedLogin, recordLogin } from "../../../lib/server/presence";
import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  HttpError,
} from "../../../lib/server/http";
import { authenticate } from "../../../lib/server/login";
import { loginSchema } from "../../../lib/server/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody(request, loginSchema);
    const { user, authVersion } = await authenticate(body.email, body.password).catch(async error => {
      if (error instanceof HttpError && error.status === 401) {
        await recordFailedLogin(await getDb(), body.email);
      }
      throw error;
    });
    const session = await getSession();
    session.userId = user.id;
    session.authenticatedAt = Date.now();
    session.authVersion = authVersion;
    session.sessionId = randomUUID();
    await recordLogin(await getDb(), user, session);
    await session.save();
    return json({ user });
  });
}
