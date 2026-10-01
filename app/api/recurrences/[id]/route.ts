import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../lib/server/http";
import { idSchema } from "../../../../lib/server/validation";
import { patchRecurrenceSchema } from "../../../../lib/recurrence";
import { updateRecurrence } from "../../../../lib/server/recurrences";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(
      await updateRecurrence(
        user,
        id,
        await readBody(request, patchRecurrenceSchema),
      ),
    );
  });
}
