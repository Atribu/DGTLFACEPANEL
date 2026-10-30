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
import {
  archiveHotel,
  restoreHotel,
  deleteHotel,
  deleteHotelSchema,
  hotelLifecycleSchema,
} from "../../../../lib/server/hotel-lifecycle";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const schema = z.union([
  z.object({ managerId: idSchema }).strict(),
  hotelLifecycleSchema,
]);
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const input = await readBody(request, schema);
    if ("managerId" in input)
      return json(await updateHotelManager(user, id, input.managerId));
    return json(await (input.action === "archive" ? archiveHotel : restoreHotel)(user, id));
  });
}

export async function DELETE(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const input = await readBody(request, deleteHotelSchema);
    return json(await deleteHotel(user, id, input));
  });
}
