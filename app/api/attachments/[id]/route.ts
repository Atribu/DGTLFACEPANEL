import {
  assertSameOrigin,
  handle,
  json,
  requireUser,
} from "../../../../lib/server/http";
import {
  attachmentDisposition,
  deleteAttachment,
  downloadAttachment,
} from "../../../../lib/server/attachments";
import { idSchema } from "../../../../lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const { attachment, content } = await downloadAttachment(user, id);
    return new Response(content, {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Content-Length": String(content.byteLength),
        "Content-Disposition": attachmentDisposition(attachment.fileName!),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}

export async function DELETE(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    return json(await deleteAttachment(user, id));
  });
}
