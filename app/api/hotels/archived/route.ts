import { handle, json, requireUser } from "../../../../lib/server/http";
import { listArchivedHotels } from "../../../../lib/server/hotel-lifecycle";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => json(await listArchivedHotels(await requireUser())));
}
