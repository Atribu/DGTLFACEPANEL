import type { BootstrapData, Task } from "./types";
export type View =
  | "overview"
  | "hotels"
  | "hotel"
  | "tasks"
  | "task"
  | "calendar"
  | "notifications"
  | "recurrences"
  | "reports"
  | "team"
  | "users"
  | "permissions";
export interface ViewProps {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
  navigate: (view: View, id?: string) => void;
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.error || "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
    );
  return data;
}
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toLocaleUpperCase("tr");
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(
    new Date(),
  );
export function dateLabel(date: string | null) {
  if (!date) return "Tarih yok";
  if (date.slice(0, 10) === today()) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(date.slice(0, 10) + "T12:00:00+03:00"));
}
export const isOverdue = (task: Task) =>
  !!task.dueDate &&
  task.dueDate.slice(0, 10) < today() &&
  task.status !== "completed";
export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort(
    (a, b) =>
      Number(a.status === "completed") - Number(b.status === "completed") ||
      a.priority - b.priority ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
export const departments = [
  "Proje Yöneticisi",
  "Web & IT",
  "Sosyal Medya",
  "Analytics",
  "Performans Pazarlama",
  "Çağrı Merkezi",
  "Dijital Strateji",
  "SEO",
  "Kreatif Ekip",
];
