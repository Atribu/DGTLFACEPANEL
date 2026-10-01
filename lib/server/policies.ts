import type { Task, TaskStatus, User } from "../types";

export function canViewHotel(user: User, hotelId: string): boolean {
  if (user.active === false) return false;
  return (
    user.role === "admin" ||
    user.role === "staff" ||
    user.hotelIds.includes(hotelId)
  );
}
export function canViewTask(user: User, task: Task): boolean {
  return canViewHotel(user, task.hotelId);
}
export function canManage(user: User): boolean {
  return user.role === "admin" && user.active !== false;
}
export function canWorkOnTask(user: User, task: Task): boolean {
  return (
    canViewTask(user, task) &&
    (user.role === "admin" ||
      (user.role === "staff" && task.assigneeId === user.id))
  );
}
export function canEditChecklist(user: User, task: Task): boolean {
  return (
    canWorkOnTask(user, task) &&
    task.status !== "review" &&
    task.status !== "completed"
  );
}
export function canSetStatus(
  user: User,
  task: Task,
  status: TaskStatus,
): boolean {
  return (
    canEditChecklist(user, task) &&
    ["planned", "in_progress", "waiting"].includes(status)
  );
}
export function canSubmitTask(user: User, task: Task): boolean {
  return (
    canEditChecklist(user, task) && task.checklist.every((item) => item.done)
  );
}
export function canApproveTask(user: User, task: Task): boolean {
  return canManage(user) && task.status === "review";
}
export function canReturnTask(user: User, task: Task): boolean {
  return canManage(user) && task.status === "review";
}
