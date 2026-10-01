import { STATUS_LABELS, type Hotel, type Task, type TaskStatus } from "./types";
import { addCalendarDays, shiftMonth, startOfMonth } from "./calendar";

export interface ReportFilters {
  hotelId: string;
  from: string;
  to: string;
  includeUndated: boolean;
}

export interface ReportTask {
  id: string;
  code: string;
  title: string;
  department: string;
  assigneeName: string;
  priority: number;
  dueDate: string | null;
  status: TaskStatus;
  waitingReason: string;
  overdue: boolean;
}

export interface HotelReport {
  hotel: Pick<Hotel, "id" | "name" | "location" | "services">;
  filters: ReportFilters;
  generatedAt: string;
  today: string;
  summary: Record<TaskStatus, number> & {
    total: number;
    overdue: number;
    completionRate: number;
  };
  tasks: ReportTask[];
  undated: { count: number; included: boolean; tasks: ReportTask[] };
}

export class ReportValidationError extends Error {}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function validateReportFilters(input: {
  hotelId?: unknown;
  from?: unknown;
  to?: unknown;
  includeUndated?: unknown;
}): ReportFilters {
  if (
    typeof input.hotelId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.hotelId)
  ) {
    throw new ReportValidationError("Rapor için bir otel seçin.");
  }
  if (!validDate(input.from) || !validDate(input.to)) {
    throw new ReportValidationError(
      "Başlangıç ve bitiş için geçerli tarihler seçin.",
    );
  }
  if (input.from > input.to)
    throw new ReportValidationError(
      "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
    );
  const inclusiveDays =
    (Date.parse(`${input.to}T00:00:00Z`) -
      Date.parse(`${input.from}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (inclusiveDays > 366)
    throw new ReportValidationError(
      "Tek raporda en fazla 366 günlük dönem seçebilirsiniz.",
    );
  if (
    ![undefined, false, true, "false", "true"].includes(
      input.includeUndated as boolean | string | undefined,
    )
  ) {
    throw new ReportValidationError("Tarihsiz görev seçimi geçersiz.");
  }
  return {
    hotelId: input.hotelId,
    from: input.from,
    to: input.to,
    includeUndated:
      input.includeUndated === true || input.includeUndated === "true",
  };
}

export function defaultReportPeriod(
  today: string,
): Pick<ReportFilters, "from" | "to"> {
  return {
    from: startOfMonth(today),
    to: addCalendarDays(shiftMonth(today, 1), -1),
  };
}

export function reportQuery(filters: ReportFilters): string {
  return new URLSearchParams({
    hotelId: filters.hotelId,
    from: filters.from,
    to: filters.to,
    includeUndated: String(filters.includeUndated),
  }).toString();
}

export function reportDateLabel(date: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function buildHotelReport(
  hotel: Hotel,
  tasks: Task[],
  assigneeNames: ReadonlyMap<string, string>,
  rawFilters: ReportFilters,
  now = new Date(),
): HotelReport {
  const filters = validateReportFilters(rawFilters);
  if (hotel.id !== filters.hotelId)
    throw new ReportValidationError("Rapor oteli ile filtre eşleşmiyor.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
  }).format(now);
  const hotelTasks = tasks.filter((task) => task.hotelId === hotel.id);
  const inPeriod = hotelTasks.filter(
    (task) =>
      validDate(task.dueDate) &&
      task.dueDate >= filters.from &&
      task.dueDate <= filters.to,
  );
  const undatedTasks = hotelTasks.filter((task) => !task.dueDate);
  const toRow = (task: Task): ReportTask => ({
    id: task.id,
    code: task.code,
    title: task.title,
    department: task.department,
    assigneeName: task.assigneeId
      ? assigneeNames.get(task.assigneeId) || "Sorumlu bilgisi yok"
      : "Atanmadı",
    priority: task.priority,
    dueDate: task.dueDate,
    status: task.status,
    waitingReason: task.waitingReason,
    overdue: Boolean(
      task.dueDate && task.dueDate < today && task.status !== "completed",
    ),
  });
  const order = (a: Task, b: Task) =>
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
    a.priority - b.priority ||
    a.id.localeCompare(b.id);
  const rows = [...inPeriod].sort(order).map(toRow);
  const summary: HotelReport["summary"] = {
    total: rows.length,
    planned: 0,
    in_progress: 0,
    waiting: 0,
    review: 0,
    completed: 0,
    overdue: rows.filter((task) => task.overdue).length,
    completionRate: 0,
  };
  for (const task of rows) summary[task.status]++;
  summary.completionRate = summary.total
    ? Math.round((summary.completed / summary.total) * 100)
    : 0;
  return {
    hotel: {
      id: hotel.id,
      name: hotel.name,
      location: hotel.location,
      services: [...hotel.services],
    },
    filters,
    generatedAt: now.toISOString(),
    today,
    summary,
    tasks: rows,
    undated: {
      count: undatedTasks.length,
      included: filters.includeUndated,
      tasks: filters.includeUndated
        ? [...undatedTasks].sort(order).map(toRow)
        : [],
    },
  };
}

/** Quote every field and neutralize formula prefixes before Excel reads the CSV. */
export function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[ \u00a0]*[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCsv(report: HotelReport): string {
  const rows: Array<Array<string | number | boolean | null>> = [
    ["DGTLFACE · Otel iş raporu"],
    ["Otel", report.hotel.name],
    ["Konum", report.hotel.location],
    ["Teslim tarihi başlangıcı", report.filters.from],
    ["Teslim tarihi bitişi", report.filters.to],
    [
      "Rapor oluşturma zamanı (Türkiye)",
      new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Europe/Istanbul",
      }).format(new Date(report.generatedAt)),
    ],
    [
      "Rapor kapsamı",
      "Teslim tarihi bu dönemde olan görevlerin güncel durumu. Dönem içinde tamamlanan işler raporu değildir.",
    ],
    ["Dönemde teslim tarihli görev", report.summary.total],
    ["Güncel durumda tamamlanan", report.summary.completed],
    ["Devam ediyor", report.summary.in_progress],
    ["Bekliyor", report.summary.waiting],
    ["Kontrol bekliyor", report.summary.review],
    ["Planlandı", report.summary.planned],
    ["Bugün itibarıyla geciken", report.summary.overdue],
    ["Oteldeki tarihsiz görev", report.undated.count],
    [
      "Tarihsiz görevler ek bölümde",
      report.undated.included ? "Evet" : "Hayır",
    ],
    [],
    [
      "Kapsam",
      "Görev kodu",
      "Görev",
      "Departman",
      "Sorumlu",
      "Öncelik (1 en yüksek)",
      "Teslim tarihi",
      "Güncel durum",
      "Gecikme",
      "Bekleme nedeni",
    ],
  ];
  const addRow = (task: ReportTask, scope: string) =>
    rows.push([
      scope,
      task.code,
      task.title,
      task.department,
      task.assigneeName,
      task.priority,
      task.dueDate,
      STATUS_LABELS[task.status],
      task.overdue ? "Gecikti" : "",
      task.waitingReason,
    ]);
  report.tasks.forEach((task) => addRow(task, "Seçili teslim tarihi dönemi"));
  report.undated.tasks.forEach((task) =>
    addRow(task, "Tarihsiz görevler · Ek bölüm"),
  );
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function reportFilename(report: HotelReport): string {
  const name =
    report.hotel.name
      .toLocaleLowerCase("tr")
      .replaceAll("ı", "i")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "otel";
  return `dgtlface-${name}-${report.filters.from}-${report.filters.to}.csv`;
}
