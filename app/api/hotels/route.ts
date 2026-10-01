import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../lib/server/http";
import { createHotel } from "../../../lib/server/repository";
import { createHotelSchema } from "../../../lib/server/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    return json(
      await createHotel(user, await readBody(request, createHotelSchema)),
      201,
    );
  });
}
