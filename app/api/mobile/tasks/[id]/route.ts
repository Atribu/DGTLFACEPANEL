import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../../lib/server/http";
import { updateTask } from "../../../../../lib/server/repository";
import { idSchema } from "../../../../../lib/server/validation";
import { mobilePatchSchema, taskVersion } from "../../../../../lib/server/mobile-sync";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const input = await readBody(request, mobilePatchSchema);
    // A slow request body must not preserve permissions revoked during upload.
    const user = await requireUser();
    const { task } = await updateTask(user, id, input.payload, input.expectedVersion);
    return json({ task, version: taskVersion(task) });
  });
}
