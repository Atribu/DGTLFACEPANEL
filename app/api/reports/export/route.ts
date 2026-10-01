import { handle, requireUser } from "../../../../lib/server/http";
import {
  getHotelReport,
  parseReportQuery,
} from "../../../../lib/server/reports";
import { reportCsv, reportFilename } from "../../../../lib/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const report = await getHotelReport(
      user,
      parseReportQuery(new URL(request.url).searchParams),
    );
    return new Response(reportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${reportFilename(report)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
