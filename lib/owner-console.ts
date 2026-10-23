import type { Role } from "./types";

export type OwnerEventKind = "operation" | "user" | "session";
export interface OwnerEvent {
  id: string;
  kind: OwnerEventKind;
  actorId: string | null;
  actorName: string;
  message: string;
  createdAt: string;
  hotelId: string | null;
  hotelName: string | null;
  taskId: string | null;
  taskTitle: string | null;
}
export interface OwnerTeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  deletedAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  channels: Array<"web" | "mobile">;
  openTasks: number;
  overdueTasks: number;
}
export interface OwnerConsoleData {
  generatedAt: string;
  presenceWindowSeconds: number;
  summary: {
    online: number;
    activeUsers: number;
    openTasks: number;
    overdueTasks: number;
    awaitingReview: number;
    waitingTasks: number;
    failedLoginsToday: number;
  };
  team: OwnerTeamMember[];
  hotels: Array<{ id: string; name: string; openTasks: number; overdueTasks: number; awaitingReview: number; waitingTasks: number }>;
  events: OwnerEvent[];
  hasMore: boolean;
  offset: number;
  limit: number;
}
