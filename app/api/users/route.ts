import {
  assertSameOrigin,
  handle,
  json,
  readBody,
  requireUser,
} from "../../../lib/server/http";
import {
  createUser,
  createUserSchema,
  listUsers,
} from "../../../lib/server/users";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => json(await listUsers(await requireUser())));
}
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    return json(
      await createUser(user, await readBody(request, createUserSchema)),
      201,
    );
  });
}
