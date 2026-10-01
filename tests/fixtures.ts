import type { Activity, Hotel, Task, TaskComment, User } from "../lib/types";

export const stamp = "2026-10-01T09:00:00.000Z";
export const admin: User = {
  id: "admin",
  name: "Yönetici",
  email: "admin@example.test",
  role: "admin",
  department: "Yönetim",
  hotelIds: [],
};
export const owner: User = {
  id: "owner",
  name: "Görev Sahibi",
  email: "owner@example.test",
  role: "staff",
  department: "Web & IT",
  hotelIds: [],
};
export const otherStaff: User = {
  id: "other-staff",
  name: "Diğer Personel",
  email: "other@example.test",
  role: "staff",
  department: "SEO",
  hotelIds: [],
};
export const observer: User = {
  id: "observer",
  name: "Otel Gözlemcisi",
  email: "observer@example.test",
  role: "observer",
  department: "Otel Yönetimi",
  hotelIds: ["hotel-a"],
};
export const hotel = (id: string): Hotel => ({
  id,
  name: id,
  location: "Antalya",
  stage: "onboarding",
  services: ["Web & IT"],
  managerId: owner.id,
  contactName: "Otel Yetkilisi",
  contactEmail: "hotel@example.test",
  color: "#008080",
  createdAt: stamp,
});
export const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-a",
  hotelId: "hotel-a",
  code: "WEB-001",
  title: "Rezervasyon bağlantısını test et",
  description: "Test rezervasyonu yap.",
  stage: "Kurulum",
  department: "Web & IT",
  assigneeId: owner.id,
  priority: 3,
  status: "in_progress",
  dueDate: "2026-10-03",
  hotelInput: "Rezervasyon paneli erişimi",
  waitingReason: "",
  checklist: [
    { id: "criterion-a", text: "Test rezervasyonu başarılı.", done: false },
  ],
  createdAt: stamp,
  updatedAt: stamp,
  ...overrides,
});
export const activity = (hotelId: string, taskId: string): Activity => ({
  id: `activity-${taskId}`,
  hotelId,
  taskId,
  userId: owner.id,
  userName: owner.name,
  message: "Durum güncellendi.",
  createdAt: stamp,
});
export const comment = (taskId: string): TaskComment => ({
  id: `comment-${taskId}`,
  taskId,
  userId: owner.id,
  userName: owner.name,
  body: "Kontrol notu.",
  createdAt: stamp,
});
