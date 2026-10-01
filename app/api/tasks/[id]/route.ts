import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../lib/server/http";
import { taskDetail, updateTask } from "../../../../lib/server/repository";
import { idSchema, patchTaskSchema } from "../../../../lib/server/validation";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(await taskDetail(user, id));
  });
}
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(
      await updateTask(user, id, await readBody(request, patchTaskSchema)),
    );
  });
}
