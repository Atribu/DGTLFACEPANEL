import { runMaintenance } from "../../../../lib/server/maintenance";
import {
  maintenanceSecret,
  validMaintenanceToken,
} from "../../../../lib/server/maintenance-secret";
import { handle, HttpError, json } from "../../../../lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    if (
      !validMaintenanceToken(
        request.headers.get("authorization"),
        await maintenanceSecret(),
      )
    )
      throw new HttpError(401, "Çalıştırma yetkisi doğrulanamadı.");
    return json({ result: await runMaintenance(true) });
  });
}
