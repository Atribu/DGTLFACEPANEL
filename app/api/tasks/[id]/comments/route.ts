import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../../lib/server/http";
import { addComment } from "../../../../../lib/server/repository";
import { commentSchema, idSchema } from "../../../../../lib/server/validation";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const body = await readBody(request, commentSchema);
    return json(await addComment(user, id, body.body), 201);
  });
}
