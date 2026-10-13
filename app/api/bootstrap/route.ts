import { handle, json, requireUser } from "../../../lib/server/http";
import { bootstrap } from "../../../lib/server/repository";
import { runMaintenance } from "../../../lib/server/maintenance";
import { getDb } from "../../../lib/server/db";
import { isDemo } from "../../../lib/server/config";
import { initializeBundledChecklist } from "../../../lib/server/checklist-initialization";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const checklistImportWarning = await initializeBundledChecklist(
      await getDb(),
      user,
      isDemo(),
    );
    await runMaintenance();
    return json({ ...(await bootstrap(user)), checklistImportWarning });
  });
}
