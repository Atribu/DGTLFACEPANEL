import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../../../lib/server/http";
import {
  assertCanAttach,
  createFileAttachment,
  createLinkAttachment,
  linkAttachmentSchema,
  listAttachments,
  readAttachmentUpload,
} from "../../../../../lib/server/attachments";
import { idSchema } from "../../../../../lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(await listAttachments(user, id));
  });
}

export async function POST(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    await assertCanAttach(user, id);
    if (
      request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return json(
        await createLinkAttachment(
          user,
          id,
          await readBody(request, linkAttachmentSchema),
        ),
        201,
      );
    }
    return json(
      await createFileAttachment(user, id, await readAttachmentUpload(request)),
      201,
    );
  });
}
