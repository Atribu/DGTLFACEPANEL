export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TASK_ATTACHMENTS = 20;
export const ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,.pptx,.zip";
export const ATTACHMENT_FORMAT_LABEL =
  "PDF, PNG, JPG, WEBP, TXT, CSV, DOCX, XLSX, PPTX, ZIP";

export interface TaskAttachment {
  id: string;
  taskId: string;
  kind: "file" | "link";
  title: string;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  userId: string;
  userName: string;
  createdAt: string;
}
