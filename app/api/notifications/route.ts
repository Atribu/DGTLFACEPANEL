import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../lib/server/http";
import {
  generateDueNotifications,
  listNotifications,
  markNotificationRead,
  notificationReadSchema,
} from "../../../lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    await generateDueNotifications();
    return json(await listNotifications(user));
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = await readBody(request, notificationReadSchema);
    return json(
      await markNotificationRead(
        user,
        input.action === "read" ? input.id : undefined,
      ),
    );
  });
}
