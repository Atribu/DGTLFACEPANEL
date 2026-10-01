export type NotificationKind =
  | "assigned"
  | "priority_changed"
  | "due_date_changed"
  | "returned"
  | "approved"
  | "review_requested"
  | "waiting"
  | "due_today"
  | "overdue";

export interface PersonalNotification {
  id: string;
  userId: string;
  taskId: string;
  hotelId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  notifications: PersonalNotification[];
  unreadCount: number;
}
