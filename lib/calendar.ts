import type { Task } from "./types";
import { sortTasks } from "./client";

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  weekend: boolean;
}

export interface CalendarFilters {
  hotelId: string;
  assignee: string;
  status: "all" | "open" | "completed";
}

function utcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Tarih YYYY-AA-GG biçiminde olmalı.");
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Geçerli bir takvim tarihi gerekiyor.");
  }
  return result;
}

/** Due dates are calendar dates; a timestamp suffix must not shift the day. */
export function calendarDateKey(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  try {
    utcDate(key);
    return key;
  } catch {
    return null;
  }
}

export function startOfMonth(date: string): string {
  utcDate(date);
  return `${date.slice(0, 7)}-01`;
}

export function addCalendarDays(date: string, amount: number): string {
  if (!Number.isInteger(amount))
    throw new RangeError("Gün farkı tam sayı olmalı.");
  const result = utcDate(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

/** Returns the target month's first day, so long months never skip February. */
export function shiftMonth(date: string, amount: number): string {
  if (!Number.isInteger(amount))
    throw new RangeError("Ay farkı tam sayı olmalı.");
  const result = utcDate(startOfMonth(date));
  result.setUTCMonth(result.getUTCMonth() + amount);
  return result.toISOString().slice(0, 10);
}

/** A fixed six-week calendar beginning on Monday, including adjacent days. */
export function buildMonthGrid(date: string): CalendarDay[] {
  const month = startOfMonth(date);
  const mondayOffset = (utcDate(month).getUTCDay() + 6) % 7;
  const first = addCalendarDays(month, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const current = addCalendarDays(first, index);
    return {
      date: current,
      day: Number(current.slice(8, 10)),
      inMonth: current.slice(0, 7) === month.slice(0, 7),
      weekend: index % 7 >= 5,
    };
  });
}

export function calendarMonthLabel(date: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(date));
}

export function calendarDayLabel(date: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(utcDate(date));
}

export function filterCalendarTasks(
  tasks: Task[],
  filters: CalendarFilters,
  currentUserId: string,
): Task[] {
  return tasks.filter((task) => {
    if (filters.hotelId && task.hotelId !== filters.hotelId) return false;
    if (filters.assignee === "mine" && task.assigneeId !== currentUserId)
      return false;
    if (filters.assignee === "unassigned" && task.assigneeId !== null)
      return false;
    if (
      filters.assignee.startsWith("user:") &&
      task.assigneeId !== filters.assignee.slice(5)
    )
      return false;
    if (filters.status === "open" && task.status === "completed") return false;
    if (filters.status === "completed" && task.status !== "completed")
      return false;
    return true;
  });
}

export function groupCalendarTasks(tasks: Task[]): {
  dated: Map<string, Task[]>;
  undated: Task[];
} {
  const dated = new Map<string, Task[]>();
  const undated: Task[] = [];
  for (const task of sortTasks(tasks)) {
    const date = calendarDateKey(task.dueDate);
    if (date) {
      const group = dated.get(date) || [];
      group.push(task);
      dated.set(date, group);
    } else {
      undated.push(task);
    }
  }
  return { dated, undated };
}
