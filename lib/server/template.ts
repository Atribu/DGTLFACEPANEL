import { randomUUID } from "node:crypto";
import reference from "../../docs/gorev-referansi.json";
import type { Task } from "../types";

export const sourceTasks = reference.checklist.tasks;
export const departments = [
  ...new Set(sourceTasks.map((task) => task.responsibleRole)),
];

export function buildTemplateTasks(
  hotelId: string,
  assigneeId: string | null,
  now = new Date().toISOString(),
): Task[] {
  return sourceTasks.map((source) => ({
    id: randomUUID(),
    hotelId,
    code: source.sourceTaskId,
    title: source.task,
    description:
      source.notes ||
      `Kaynak: Ana Checklist, satır ${source.sourceRow}. ${source.completionCriterion}`,
    stage: source.stage.trim(),
    department: source.responsibleRole,
    assigneeId,
    priority:
      source.priority === "Kritik" ? 1 : source.priority === "Yüksek" ? 3 : 5,
    status: "planned",
    dueDate: null,
    hotelInput: source.hotelInput,
    waitingReason: "",
    checklist: source.completionCriterion
      ? [{ id: randomUUID(), text: source.completionCriterion, done: false }]
      : [],
    createdAt: now,
    updatedAt: now,
  }));
}
