import { handle, json, requireUser } from "../../../lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => json({ user: await requireUser() }));
}
