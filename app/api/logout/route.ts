import { getSession } from "../../../lib/server/auth";
import { assertSameOrigin, handle, json } from "../../../lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await getSession();
    session.destroy();
    return json({ ok: true });
  });
}
