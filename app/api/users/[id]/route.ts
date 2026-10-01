import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../lib/server/http";
import { updateUser, updateUserSchema } from "../../../../lib/server/users";
import { idSchema } from "../../../../lib/server/validation";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(
      await updateUser(user, id, await readBody(request, updateUserSchema)),
    );
  });
}
