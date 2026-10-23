import { handle, json, requireUser } from "../../../../lib/server/http";
import { ownerConsole } from "../../../../lib/server/owner-console";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return json(await ownerConsole(user, query));
  });
}
