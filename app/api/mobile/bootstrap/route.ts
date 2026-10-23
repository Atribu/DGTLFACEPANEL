import { handle, requireUser } from "../../../../lib/server/http";
import { bootstrap } from "../../../../lib/server/repository";
import { runMaintenance } from "../../../../lib/server/maintenance";
import { getDb } from "../../../../lib/server/db";
import { isDemo } from "../../../../lib/server/config";
import { initializeBundledChecklist } from "../../../../lib/server/checklist-initialization";
import { mobileBootstrapResponse } from "../../../../lib/server/mobile-sync";
import { getSession } from "../../../../lib/server/auth";
import { touchPresence } from "../../../../lib/server/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    await touchPresence(await getDb(), user, await getSession(), "mobile");
    const checklistImportWarning = await initializeBundledChecklist(
      await getDb(),
      user,
      isDemo(),
    );
    await runMaintenance();
    return mobileBootstrapResponse(
      { ...(await bootstrap(user)), checklistImportWarning },
      request.headers.get("if-none-match"),
    );
  });
}
