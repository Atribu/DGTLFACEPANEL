import { handle, json, requireUser } from "../../../lib/server/http";
import { bootstrap } from "../../../lib/server/repository";
import { runMaintenance } from "../../../lib/server/maintenance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    await runMaintenance();
    return json(await bootstrap(user));
  });
}
