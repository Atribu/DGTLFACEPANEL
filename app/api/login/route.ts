import { getSession } from "../../../lib/server/auth";
import {
  assertSameOrigin,
  handle,
  json,
  readBody,
} from "../../../lib/server/http";
import { authenticate } from "../../../lib/server/login";
import { loginSchema } from "../../../lib/server/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody(request, loginSchema);
    const { user, authVersion } = await authenticate(body.email, body.password);
    const session = await getSession();
    session.userId = user.id;
    session.authenticatedAt = Date.now();
    session.authVersion = authVersion;
    await session.save();
    return json({ user });
  });
}
