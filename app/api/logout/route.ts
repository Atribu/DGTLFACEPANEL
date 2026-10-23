import { getSession, resolveSessionUser } from "../../../lib/server/auth";
import { getDb } from "../../../lib/server/db";
import { recordLogout } from "../../../lib/server/presence";
import { assertSameOrigin, handle, json } from "../../../lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await getSession();
    try {
      const user = await resolveSessionUser(session);
      if (user) await recordLogout(await getDb(), user, session);
    } finally {
      session.destroy();
    }
    return json({ ok: true });
  });
}
