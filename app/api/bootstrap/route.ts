import { handle, requireUser } from "../../../lib/server/http";
import { bootstrap } from "../../../lib/server/repository";
import { runMaintenance } from "../../../lib/server/maintenance";
import { getDb } from "../../../lib/server/db";
import { isDemo } from "../../../lib/server/config";
import { initializeBundledChecklist } from "../../../lib/server/checklist-initialization";
import { workspaceResponse } from "../../../lib/server/sync-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const checklistImportWarning = await initializeBundledChecklist(
      await getDb(),
      user,
      isDemo(),
    );
    await runMaintenance();
    return workspaceResponse(
      { ...(await bootstrap(user)), checklistImportWarning },
      request.headers.get("if-none-match"),
    );
  });
}
