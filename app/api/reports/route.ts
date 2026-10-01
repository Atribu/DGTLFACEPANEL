import { handle, json, requireUser } from "../../../lib/server/http";
import { getHotelReport, parseReportQuery } from "../../../lib/server/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const report = await getHotelReport(
      user,
      parseReportQuery(new URL(request.url).searchParams),
    );
    return json({ report });
  });
}
