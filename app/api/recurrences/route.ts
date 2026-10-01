import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../lib/server/http";
import { createRecurrenceSchema } from "../../../lib/recurrence";
import {
  createRecurrence,
  listRecurrences,
} from "../../../lib/server/recurrences";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => json(await listRecurrences(await requireUser())));
}
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    return json(
      await createRecurrence(
        user,
        await readBody(request, createRecurrenceSchema),
      ),
      201,
    );
  });
}
