import { z } from "zod";
import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../lib/server/http";
import { updateHotelManager } from "../../../../lib/server/repository";
import { idSchema } from "../../../../lib/server/validation";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const schema = z.object({ managerId: idSchema }).strict();
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const input = await readBody(request, schema);
    return json(await updateHotelManager(user, id, input.managerId));
  });
}
