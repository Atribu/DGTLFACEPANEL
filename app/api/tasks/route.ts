import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../lib/server/http";
import { createTask } from "../../../lib/server/repository";
import { createTaskSchema } from "../../../lib/server/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    return json(
      await createTask(user, await readBody(request, createTaskSchema)),
      201,
    );
  });
}
