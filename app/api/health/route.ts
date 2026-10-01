import { getDb } from "../../../lib/server/db";
import { isDemo } from "../../../lib/server/config";
import { handle, json } from "../../../lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const db = await getDb();
    await db.query("SELECT 1");
    return json({ ok: true, storage: db.storage, demo: isDemo() });
  });
}
