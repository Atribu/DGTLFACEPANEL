import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../../../lib/server/http";
import { addComment } from "../../../../../../lib/server/repository";
import { idSchema } from "../../../../../../lib/server/validation";
import { mobileCommentSchema } from "../../../../../../lib/server/mobile-sync";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const input = await readBody(request, mobileCommentSchema);
    const user = await requireUser();
    return json(await addComment(user, id, input.body, input.requestId), 201);
  });
}
