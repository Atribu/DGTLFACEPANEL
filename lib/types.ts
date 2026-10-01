export type Role = "admin" | "staff" | "observer";
export type TaskStatus =
  "planned" | "in_progress" | "waiting" | "review" | "completed";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  hotelIds: string[];
  active?: boolean;
}
export interface Hotel {
  id: string;
  name: string;
  location: string;
  stage: "onboarding" | "operation";
  services: string[];
  managerId: string;
  contactName: string;
  contactEmail: string;
  color: string;
  createdAt: string;
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface Task {
  id: string;
  hotelId: string;
  code: string;
  title: string;
  description: string;
  stage: string;
  department: string;
  assigneeId: string | null;
  priority: number;
  status: TaskStatus;
  dueDate: string | null;
  hotelInput: string;
  waitingReason: string;
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
  recurrenceId?: string;
  recurrenceScheduledOn?: string;
}
export interface Activity {
  id: string;
  taskId: string | null;
  hotelId: string;
  userId: string;
  userName: string;
  message: string;
  createdAt: string;
}
export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}
export interface BootstrapData {
  user: User;
  users: User[];
  hotels: Hotel[];
  tasks: Task[];
  activities: Activity[];
  comments: TaskComment[];
  demo: boolean;
}
export const STATUS_LABELS: Record<TaskStatus, string> = {
  planned: "Planlandı",
  in_progress: "Devam ediyor",
  waiting: "Bekliyor",
  review: "Kontrol bekliyor",
  completed: "Tamamlandı",
};
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Yönetici",
  staff: "Personel",
  observer: "Otel gözlemcisi",
};
