import { z } from "zod";

export type RecurrenceFrequency = "weekly" | "monthly";
export interface RecurrenceRule {
  id: string;
  hotelId: string;
  title: string;
  description: string;
  department: string;
  assigneeId: string;
  priority: number;
  checklist: string[];
  frequency: RecurrenceFrequency;
  startsOn: string;
  dueOffsetDays: number;
  active: boolean;
  nextRunOn: string;
  lastRunOn: string | null;
  blockedReason: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export function isCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addCalendarDays(day: string, offset: number) {
  if (!isCalendarDay(day) || !Number.isInteger(offset))
    throw new Error("Geçerli bir tarih ve gün sayısı gerekiyor.");
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function anchoredMonth(startsOn: string, offset: number) {
  const [year, month, anchor] = startsOn.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const end = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchor, end));
  return target.toISOString().slice(0, 10);
}
/** Returns an occurrence on or after a day, always anchored to the original start. */
export function occurrenceOnOrAfter(
  startsOn: string,
  frequency: RecurrenceFrequency,
  day: string,
) {
  if (!isCalendarDay(startsOn) || !isCalendarDay(day))
    throw new Error("Geçerli bir takvim tarihi gerekiyor.");
  if (day <= startsOn) return startsOn;
  if (frequency === "weekly") {
    const difference =
      (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${startsOn}T12:00:00Z`)) /
      86400000;
    return addCalendarDays(startsOn, Math.ceil(difference / 7) * 7);
  }
  const [year, month] = day.split("-").map(Number);
  const [startYear, startMonth] = startsOn.split("-").map(Number);
  const offset = (year - startYear) * 12 + month - startMonth;
  const candidate = anchoredMonth(startsOn, offset);
  return candidate >= day ? candidate : anchoredMonth(startsOn, offset + 1);
}
export function nextOccurrence(
  startsOn: string,
  frequency: RecurrenceFrequency,
  previous: string,
) {
  return occurrenceOnOrAfter(startsOn, frequency, addCalendarDays(previous, 1));
}

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const shortText = z.string().trim().min(1).max(200);
const day = z.string().refine(isCalendarDay, "Geçerli bir tarih girin.");
const editable = {
  title: shortText,
  description: z.string().trim().max(5000),
  department: shortText,
  assigneeId: id,
  priority: z.number().int().min(1).max(10),
  checklist: z.array(z.string().trim().min(1).max(2000)).min(1).max(30),
  dueOffsetDays: z.number().int().min(0).max(30),
};
export const createRecurrenceSchema = z
  .object({
    ...editable,
    description: editable.description.default(""),
    hotelId: id,
    frequency: z.enum(["weekly", "monthly"]),
    startsOn: day,
  })
  .strict();
export const patchRecurrenceSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z
    .object({
      action: z.literal("update"),
      ...z.object(editable).partial().shape,
    })
    .strict(),
]);
