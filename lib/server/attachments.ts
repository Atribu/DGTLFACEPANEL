import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENTS,
  type TaskAttachment,
} from "../attachments";
import type { Task, User } from "../types";
import { getDb, type Queryable } from "./db";
import { HttpError } from "./http";
import { canEditChecklist, canManage, canViewTask } from "./policies";
import { audit } from "./repository";

export const linkAttachmentSchema = z
  .object({
    kind: z.literal("link"),
    title: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !/[\u0000-\u001f\u007f]/.test(value)
          );
        } catch {
          return false;
        }
      }, "Bağlantı http:// veya https:// ile başlamalı ve kullanıcı bilgisi içermemeli.")
      .transform((value) => new URL(value).href),
  })
  .strict();

export interface AttachmentUpload {
  title?: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

const fileTypes: Record<
  string,
  {
    mime: string;
    accepted?: string[];
    signature?: "pdf" | "png" | "jpeg" | "webp" | "zip";
  }
> = {
  pdf: { mime: "application/pdf", signature: "pdf" },
  png: { mime: "image/png", signature: "png" },
  jpg: { mime: "image/jpeg", signature: "jpeg" },
  jpeg: { mime: "image/jpeg", signature: "jpeg" },
  webp: { mime: "image/webp", signature: "webp" },
  txt: { mime: "text/plain" },
  csv: {
    mime: "text/csv",
    accepted: ["application/csv", "application/vnd.ms-excel"],
  },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signature: "zip",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    signature: "zip",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    signature: "zip",
  },
  zip: {
    mime: "application/zip",
    accepted: ["application/x-zip-compressed"],
    signature: "zip",
  },
};

function normalizedFile(input: AttachmentUpload) {
  const fileName = input.fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (!fileName || fileName.length > 200)
    throw new HttpError(400, "Dosya adı 1–200 karakter olmalı.");
  const extension = fileName.split(".").pop()!.toLowerCase();
  const type = Object.hasOwn(fileTypes, extension)
    ? fileTypes[extension]
    : undefined;
  if (!type || !fileName.includes("."))
    throw new HttpError(400, "Bu dosya türü desteklenmiyor.");
  if (!input.bytes.byteLength) throw new HttpError(400, "Boş dosya eklenemez.");
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    throw new HttpError(413, "Dosya en fazla 10 MB olabilir.");
  const providedMime = input.mimeType.split(";")[0].trim().toLowerCase();
  if (
    providedMime &&
    providedMime !== "application/octet-stream" &&
    ![type.mime, ...(type.accepted ?? [])].includes(providedMime)
  )
    throw new HttpError(400, "Dosyanın türü ile uzantısı eşleşmiyor.");
  const bytes = Buffer.from(input.bytes);
  const matches = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const validSignature =
    !type.signature ||
    {
      pdf: bytes.subarray(0, 5).toString("ascii") === "%PDF-",
      png: matches([137, 80, 78, 71, 13, 10, 26, 10]),
      jpeg: matches([255, 216, 255]),
      webp:
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP",
      zip:
        matches([80, 75, 3, 4]) ||
        matches([80, 75, 5, 6]) ||
        matches([80, 75, 7, 8]),
    }[type.signature];
  if (!validSignature)
    throw new HttpError(
      400,
      "Dosya içeriği belirtilen dosya türüyle eşleşmiyor.",
    );
  const title = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .parse(input.title?.trim() || fileName);
  return { fileName, mimeType: type.mime, title, bytes };
}

// Apply a byte limit while streaming, before the multipart parser allocates files.
export async function readAttachmentUpload(
  request: Request,
): Promise<AttachmentUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;"))
    throw new HttpError(400, "Dosyayı form verisi olarak gönderin.");
  const maxRequest = MAX_ATTACHMENT_BYTES + 128 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > maxRequest)
    throw new HttpError(413, "Dosya en fazla 10 MB olabilir.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Dosya içeriği eksik.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequest) {
        await reader.cancel();
        throw new HttpError(413, "Dosya en fazla 10 MB olabilir.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    const body = new Uint8Array(Buffer.concat(chunks));
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }).formData();
  } catch {
    throw new HttpError(400, "Dosya formu okunamadı.");
  }
  if (
    [...form.keys()].some((key) => !["file", "title"].includes(key)) ||
    form.getAll("file").length !== 1 ||
    form.getAll("title").length > 1
  )
    throw new HttpError(
      400,
      "Her istekte yalnızca bir dosya ve başlık gönderin.",
    );
  const file = form.get("file");
  const title = form.get("title");
  if (!(file instanceof File) || (title !== null && typeof title !== "string"))
    throw new HttpError(400, "Geçerli bir dosya seçin.");
  const result = normalizedFile({
    title: title ?? undefined,
    fileName: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return result;
}

async function attachmentTask(
  tx: Queryable,
  user: User,
  taskId: string,
  lock = false,
) {
  const [row] = await tx.query<{ data: Task }>(
    `SELECT data FROM tasks WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [taskId],
  );
  if (!row || !canViewTask(user, row.data))
    throw new HttpError(404, "Görev bulunamadı.");
  return row.data;
}

async function currentActor(tx: Queryable, user: User) {
  const [row] = await tx.query<{ data: User }>(
    "SELECT data FROM app_users WHERE id=$1",
    [user.id],
  );
  if (!row || row.data.active === false)
    throw new HttpError(403, "Bu işlem için aktif hesap gerekiyor.");
  return row.data;
}

function requireEditable(user: User, task: Task) {
  if (!canEditChecklist(user, task))
    throw new HttpError(
      403,
      "Ekleri yalnızca aktif görevdeki sorumlu veya yönetici değiştirebilir. Kontroldeki ya da tamamlanmış görevi önce yeniden açın.",
    );
}

/** Early authorization before accepting a potentially large request body. */
export async function assertCanAttach(user: User, taskId: string) {
  const db = await getDb();
  requireEditable(user, await attachmentTask(db, user, taskId));
}

export async function listAttachments(user: User, taskId: string) {
  const db = await getDb();
  await attachmentTask(db, user, taskId);
  const rows = await db.query<{ data: TaskAttachment }>(
    "SELECT data FROM task_attachments WHERE task_id=$1 AND deleted_at IS NULL ORDER BY data->>'createdAt',id",
    [taskId],
  );
  return { attachments: rows.map((row) => row.data) };
}

async function insertAttachment(
  user: User,
  taskId: string,
  values: Pick<
    TaskAttachment,
    "kind" | "title" | "url" | "fileName" | "mimeType" | "size"
  >,
  content: Buffer | null,
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // The task lock also serializes task approval and other attachment changes.
    const task = await attachmentTask(tx, user, taskId, true);
    const actor = await currentActor(tx, user);
    requireEditable(actor, task);
    const [count] = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM task_attachments WHERE task_id=$1 AND deleted_at IS NULL",
      [taskId],
    );
    if (count.count >= MAX_TASK_ATTACHMENTS)
      throw new HttpError(
        409,
        "Bir görevde en fazla 20 ek bulunabilir. Yeni ek için önce bir eki kaldırın.",
      );
    const attachment: TaskAttachment = {
      id: randomUUID(),
      taskId,
      ...values,
      userId: actor.id,
      userName: actor.name,
      createdAt: new Date().toISOString(),
    };
    await tx.query(
      "INSERT INTO task_attachments(id,task_id,uploader_id,data,content) VALUES ($1,$2,$3,$4::jsonb,$5)",
      [attachment.id, taskId, actor.id, JSON.stringify(attachment), content],
    );
    await audit(
      tx,
      actor,
      task.hotelId,
      taskId,
      `${attachment.kind === "file" ? "Dosya" : "Bağlantı"} eklendi: ${attachment.title}`,
    );
    return { attachment };
  });
}

export async function createLinkAttachment(
  user: User,
  taskId: string,
  raw: unknown,
) {
  const input = linkAttachmentSchema.parse(raw);
  return insertAttachment(
    user,
    taskId,
    {
      ...input,
      fileName: null,
      mimeType: null,
      size: null,
    },
    null,
  );
}

export async function createFileAttachment(
  user: User,
  taskId: string,
  input: AttachmentUpload,
) {
  const file = normalizedFile(input);
  return insertAttachment(
    user,
    taskId,
    {
      kind: "file",
      title: file.title,
      url: null,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.bytes.byteLength,
    },
    file.bytes,
  );
}

export async function downloadAttachment(user: User, id: string) {
  const db = await getDb();
  const [row] = await db.query<{ data: TaskAttachment }>(
    "SELECT data FROM task_attachments WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!row) throw new HttpError(404, "Ek bulunamadı.");
  await attachmentTask(db, user, row.data.taskId);
  if (row.data.kind !== "file")
    throw new HttpError(404, "İndirilebilir dosya bulunamadı.");
  const [file] = await db.query<{ content: Uint8Array }>(
    "SELECT content FROM task_attachments WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!file) throw new HttpError(404, "Ek bulunamadı.");
  return { attachment: row.data, content: new Uint8Array(file.content) };
}

export async function deleteAttachment(user: User, id: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [initial] = await tx.query<{ task_id: string }>(
      "SELECT task_id FROM task_attachments WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    if (!initial) throw new HttpError(404, "Ek bulunamadı.");
    const task = await attachmentTask(tx, user, initial.task_id, true);
    const actor = await currentActor(tx, user);
    requireEditable(actor, task);
    const [row] = await tx.query<{ data: TaskAttachment }>(
      "SELECT data FROM task_attachments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    if (!row) throw new HttpError(404, "Ek bulunamadı.");
    if (!canManage(actor) && row.data.userId !== actor.id)
      throw new HttpError(
        403,
        "Yalnızca kendi eklediğiniz ekleri kaldırabilirsiniz.",
      );
    await tx.query(
      "UPDATE task_attachments SET deleted_at=now(),deleted_by=$2 WHERE id=$1",
      [id, actor.id],
    );
    await audit(
      tx,
      actor,
      task.hotelId,
      task.id,
      `Ek kaldırıldı: ${row.data.title}`,
    );
    return { ok: true };
  });
}

export function attachmentDisposition(fileName: string) {
  const ascii =
    fileName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/^\.+/, "") || "download";
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
