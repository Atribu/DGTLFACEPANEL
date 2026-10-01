import type { Hotel, Task, User } from "../types";
import {
  buildHotelReport,
  ReportValidationError,
  validateReportFilters,
  type ReportFilters,
} from "../reports";
import { getDb } from "./db";
import { HttpError } from "./http";
import { canViewHotel } from "./policies";

export function parseReportQuery(search: URLSearchParams): ReportFilters {
  for (const key of ["hotelId", "from", "to", "includeUndated"]) {
    if (search.getAll(key).length > 1)
      throw new HttpError(400, "Rapor filtresi birden fazla gönderilemez.");
  }
  try {
    return validateReportFilters({
      hotelId: search.get("hotelId"),
      from: search.get("from"),
      to: search.get("to"),
      includeUndated: search.get("includeUndated") ?? false,
    });
  } catch (error) {
    if (error instanceof ReportValidationError)
      throw new HttpError(400, error.message);
    throw error;
  }
}

export async function getHotelReport(
  user: User,
  rawFilters: ReportFilters,
  now = new Date(),
) {
  let filters: ReportFilters;
  try {
    filters = validateReportFilters(rawFilters);
  } catch (error) {
    if (error instanceof ReportValidationError)
      throw new HttpError(400, error.message);
    throw error;
  }
  if (!canViewHotel(user, filters.hotelId))
    throw new HttpError(404, "Otel bulunamadı.");
  const db = await getDb();
  const [hotel] = await db.query<{ data: Hotel }>(
    "SELECT data FROM hotels WHERE id=$1",
    [filters.hotelId],
  );
  if (!hotel) throw new HttpError(404, "Otel bulunamadı.");
  const tasks = (
    await db.query<{ data: Task }>("SELECT data FROM tasks WHERE hotel_id=$1", [
      filters.hotelId,
    ])
  ).map((row) => row.data);
  const reportTasks = tasks.filter(
    (task) =>
      (task.dueDate &&
        task.dueDate >= filters.from &&
        task.dueDate <= filters.to) ||
      (filters.includeUndated && !task.dueDate),
  );
  const ids = [
    ...new Set(
      reportTasks.flatMap((task) => (task.assigneeId ? [task.assigneeId] : [])),
    ),
  ];
  const people = ids.length
    ? await db.query<{ id: string; name: string }>(
        "SELECT id,data->>'name' AS name FROM app_users WHERE id=ANY($1::text[])",
        [ids],
      )
    : [];
  return buildHotelReport(
    hotel.data,
    tasks,
    new Map(people.map((person) => [person.id, person.name])),
    filters,
    now,
  );
}
