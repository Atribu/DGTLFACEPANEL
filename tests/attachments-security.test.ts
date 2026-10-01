import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from "../lib/attachments";
import type { Database, Queryable } from "../lib/server/db";
import {
  attachmentDisposition,
  createFileAttachment,
  createLinkAttachment,
  deleteAttachment,
  downloadAttachment,
  linkAttachmentSchema,
  listAttachments,
  readAttachmentUpload,
} from "../lib/server/attachments";
import { migrateAttachmentSchema } from "../lib/server/attachment-schema";
import { admin, hotel, observer, otherStaff, owner, task } from "./fixtures";

// Real PostgreSQL-compatible storage, entirely in memory; no workspace .data.
const globals = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};
const previousDatabase = globals.dgtlDatabase;
let local: PGlite;
let db: Database;
const pdf = Buffer.from(
  "%PDF-1.7\nDGTLFACE bytea persistence check\n%%EOF",
  "utf8",
);
const upload = (overrides = {}) => ({
  fileName: "İş kontrolü.pdf",
  mimeType: "application/pdf",
  bytes: pdf,
  ...overrides,
});
const link = (overrides = {}) => ({
  kind: "link",
  title: "Teslim bağlantısı",
  url: "https://example.test/delivery",
  ...overrides,
});

before(async () => {
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      local.transaction((tx) =>
        fn({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await tx.query<R>(sql, params)).rows,
        }),
      ),
    close: () => local.close(),
  };
  await local.exec(`
    CREATE TABLE app_users (id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE hotels (id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE tasks (id text PRIMARY KEY, hotel_id text REFERENCES hotels(id), data jsonb NOT NULL);
    CREATE TABLE activities (id text PRIMARY KEY, hotel_id text REFERENCES hotels(id), task_id text REFERENCES tasks(id), data jsonb NOT NULL);
  `);
  await migrateAttachmentSchema(db);
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec(
    "TRUNCATE task_attachments,activities,tasks,hotels,app_users",
  );
  for (const user of [admin, owner, otherStaff, observer])
    await db.query("INSERT INTO app_users(id,data) VALUES ($1,$2::jsonb)", [
      user.id,
      JSON.stringify(user),
    ]);
  for (const item of [hotel("hotel-a"), hotel("hotel-b")])
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
      item.id,
      JSON.stringify(item),
    ]);
  for (const item of [task(), task({ id: "task-b", hotelId: "hotel-b" })])
    await db.query(
      "INSERT INTO tasks(id,hotel_id,data) VALUES ($1,$2,$3::jsonb)",
      [item.id, item.hotelId, JSON.stringify(item)],
    );
});

after(async () => {
  if (previousDatabase) globals.dgtlDatabase = previousDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

test("file bytes persist separately from metadata and authorized observers download exact bytes", async () => {
  const { attachment } = await createFileAttachment(owner, "task-a", upload());
  assert.equal(attachment.size, pdf.length);
  assert.equal(attachment.userId, owner.id);
  await migrateAttachmentSchema(db);
  const listed = await listAttachments(observer, "task-a");
  assert.deepEqual(listed.attachments, [attachment]);
  assert.equal(JSON.stringify(listed).includes("persistence check"), false);
  assert.equal("content" in listed.attachments[0], false);
  const downloaded = await downloadAttachment(observer, attachment.id);
  assert.deepEqual(Buffer.from(downloaded.content), pdf);
  assert.equal(
    (await listAttachments(otherStaff, "task-a")).attachments.length,
    1,
  );
  const [stored] = await db.query<{ size: number }>(
    "SELECT octet_length(content) AS size FROM task_attachments WHERE id=$1",
    [attachment.id],
  );
  assert.equal(stored.size, pdf.length);
});

test("observer hotel isolation covers metadata, direct downloads, removal and creation", async () => {
  const { attachment } = await createFileAttachment(admin, "task-b", upload());
  await assert.rejects(listAttachments(observer, "task-b"), { status: 404 });
  await assert.rejects(downloadAttachment(observer, attachment.id), {
    status: 404,
  });
  await assert.rejects(deleteAttachment(observer, attachment.id), {
    status: 404,
  });
  await assert.rejects(createLinkAttachment(observer, "task-b", link()), {
    status: 404,
  });
  await assert.rejects(createLinkAttachment(observer, "task-a", link()), {
    status: 403,
  });
  await assert.rejects(createFileAttachment(otherStaff, "task-a", upload()), {
    status: 403,
  });
});

test("review and completed tasks reject additions and removals even by administrators", async () => {
  const { attachment } = await createLinkAttachment(owner, "task-a", link());
  for (const status of ["review", "completed"]) {
    await db.query(
      "UPDATE tasks SET data=jsonb_set(data,'{status}',$2::jsonb) WHERE id=$1",
      ["task-a", JSON.stringify(status)],
    );
    for (const actor of [admin, owner]) {
      await assert.rejects(createLinkAttachment(actor, "task-a", link()), {
        status: 403,
      });
      await assert.rejects(createFileAttachment(actor, "task-a", upload()), {
        status: 403,
      });
      await assert.rejects(deleteAttachment(actor, attachment.id), {
        status: 403,
      });
    }
    assert.equal(
      (await listAttachments(observer, "task-a")).attachments.length,
      1,
    );
  }
});

test("staff removal requires both authorship and current assignment; administrators can remove another author's item", async () => {
  const { attachment: own } = await createFileAttachment(
    owner,
    "task-a",
    upload(),
  );
  const { attachment: managed } = await createLinkAttachment(
    admin,
    "task-a",
    link(),
  );
  await assert.rejects(deleteAttachment(owner, managed.id), { status: 403 });
  await db.query(
    "UPDATE tasks SET data=jsonb_set(data,'{assigneeId}',$2::jsonb) WHERE id=$1",
    ["task-a", JSON.stringify(otherStaff.id)],
  );
  await assert.rejects(deleteAttachment(owner, own.id), { status: 403 });
  await assert.rejects(deleteAttachment(otherStaff, own.id), { status: 403 });
  await deleteAttachment(admin, own.id);
  await assert.rejects(downloadAttachment(admin, own.id), { status: 404 });
  await assert.rejects(deleteAttachment(admin, own.id), { status: 404 });
  assert.deepEqual(
    (await listAttachments(admin, "task-a")).attachments.map((item) => item.id),
    [managed.id],
  );
  const [stored] = await db.query<{ deleted_by: string; size: number }>(
    "SELECT deleted_by,octet_length(content) AS size FROM task_attachments WHERE id=$1 AND deleted_at IS NOT NULL",
    [own.id],
  );
  assert.equal(stored.deleted_by, admin.id);
  assert.equal(stored.size, pdf.length);
  const events = await db.query<{ data: { message: string } }>(
    "SELECT data FROM activities WHERE task_id=$1",
    ["task-a"],
  );
  assert.ok(
    events.some((row) => row.data.message.startsWith("Ek kaldırıldı:")),
  );
});

test("mixed attachment quota is serialized and soft removal frees a slot without restoring the deleted item", async () => {
  const { attachment: first } = await createFileAttachment(
    owner,
    "task-a",
    upload(),
  );
  for (let i = 1; i < MAX_TASK_ATTACHMENTS - 1; i++)
    await createLinkAttachment(
      owner,
      "task-a",
      link({ title: `Bağlantı ${i}` }),
    );
  const results = await Promise.allSettled([
    createLinkAttachment(owner, "task-a", link()),
    createFileAttachment(admin, "task-a", upload()),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = results.find((item) => item.status === "rejected");
  assert.equal(rejected?.reason.status, 409);
  assert.equal((await listAttachments(owner, "task-a")).attachments.length, 20);
  await deleteAttachment(owner, first.id);
  await createLinkAttachment(owner, "task-a", link());
  assert.equal((await listAttachments(owner, "task-a")).attachments.length, 20);
  await assert.rejects(downloadAttachment(owner, first.id), { status: 404 });
});

test("link validation rejects executable, credential-bearing and malformed URLs without fetching any URL", async () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//example.test",
    "https://user:secret@example.test",
    "https://example.test/\npath",
    "invalid",
  ]) {
    assert.equal(
      linkAttachmentSchema.safeParse(link({ url })).success,
      false,
      url,
    );
  }
  for (const url of [
    "https://example.test/ödev?x=1#dosya",
    "http://example.test:8080/file",
  ]) {
    const { attachment } = await createLinkAttachment(
      owner,
      "task-a",
      link({ url }),
    );
    assert.equal(attachment.url, new URL(url).href);
    await assert.rejects(downloadAttachment(owner, attachment.id), {
      status: 404,
    });
  }
  assert.equal(
    linkAttachmentSchema.safeParse({ ...link(), userId: admin.id }).success,
    false,
  );
  assert.equal(
    linkAttachmentSchema.safeParse(link({ title: " " })).success,
    false,
  );
});

test("file extension, MIME and signatures reject disguised executable content while binary fallback MIME is accepted", async () => {
  for (const input of [
    upload({ fileName: "run.html", mimeType: "text/html" }),
    upload({ fileName: "run.svg", mimeType: "image/svg+xml" }),
    upload({
      fileName: "run.constructor",
      mimeType: "application/octet-stream",
    }),
    upload({ mimeType: "text/html" }),
    upload({ bytes: Buffer.from("<html><script>alert(1)</script></html>") }),
    upload({ fileName: "image.png", mimeType: "image/png" }),
    upload({ fileName: "image.webp", mimeType: "image/webp" }),
    upload({
      fileName: "office.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    upload({ fileName: "archive.zip", mimeType: "application/zip" }),
    upload({ bytes: new Uint8Array() }),
  ])
    await assert.rejects(createFileAttachment(owner, "task-a", input), {
      status: 400,
    });
  const { attachment } = await createFileAttachment(
    owner,
    "task-a",
    upload({
      mimeType: "application/octet-stream",
      fileName: "../../İş kontrolü.pdf",
    }),
  );
  assert.equal(attachment.fileName, "İş kontrolü.pdf");
  assert.equal(attachment.mimeType, "application/pdf");
  await createFileAttachment(owner, "task-a", upload({ mimeType: "" }));
  const disposition = attachmentDisposition('İş "kontrolü".pdf');
  assert.match(
    disposition,
    /^attachment; filename="Is _kontrolu_\.pdf"; filename\*=UTF-8''/,
  );
  assert.ok(disposition.includes("%C4%B0"));
  assert.equal(/[\r\n]/.test(disposition), false);
});

test("10 MiB boundary persists exact bytes and over-limit files leave no metadata", async () => {
  const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES, 65);
  const { attachment } = await createFileAttachment(
    owner,
    "task-a",
    upload({ fileName: "boundary.txt", mimeType: "text/plain", bytes }),
  );
  assert.equal(attachment.size, MAX_ATTACHMENT_BYTES);
  assert.deepEqual(
    Buffer.from((await downloadAttachment(owner, attachment.id)).content),
    bytes,
  );
  await assert.rejects(
    createFileAttachment(
      owner,
      "task-a",
      upload({ bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) }),
    ),
    { status: 413 },
  );
  assert.equal((await listAttachments(owner, "task-a")).attachments.length, 1);
});

test("multipart reader caps actual streamed bytes before parsing and rejects duplicate files or malformed forms", async () => {
  const form = new FormData();
  form.set("file", new File([pdf], "test.pdf", { type: "application/pdf" }));
  form.set("title", "Kontrol kanıtı");
  const input = await readAttachmentUpload(
    new Request("http://localhost/upload", { method: "POST", body: form }),
  );
  assert.equal(input.title, "Kontrol kanıtı");
  assert.deepEqual(Buffer.from(input.bytes), pdf);
  form.append(
    "file",
    new File([pdf], "second.pdf", { type: "application/pdf" }),
  );
  await assert.rejects(
    readAttachmentUpload(
      new Request("http://localhost/upload", { method: "POST", body: form }),
    ),
    { status: 400 },
  );
  await assert.rejects(
    readAttachmentUpload(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=missing" },
        body: "bad form",
      }),
    ),
    { status: 400 },
  );
  await assert.rejects(
    readAttachmentUpload(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=x",
          "Content-Length": String(MAX_ATTACHMENT_BYTES + 128 * 1024 + 1),
        },
        body: "small",
      }),
    ),
    { status: 413 },
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(128 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=x" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readAttachmentUpload(request), { status: 413 });
  assert.equal(cancelled, true);
});

test("attachment mutation rechecks persisted actor permissions after body upload", async () => {
  const { attachment } = await createFileAttachment(admin, "task-a", upload());
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
    admin.id,
    JSON.stringify({ ...admin, role: "observer", hotelIds: ["hotel-a"] }),
  ]);
  await assert.rejects(createLinkAttachment(admin, "task-a", link()), {
    status: 403,
  });
  await assert.rejects(deleteAttachment(admin, attachment.id), { status: 403 });
  await db.query("UPDATE app_users SET data=$2::jsonb WHERE id=$1", [
    owner.id,
    JSON.stringify({ ...owner, active: false }),
  ]);
  await assert.rejects(createFileAttachment(owner, "task-a", upload()), {
    status: 403,
  });
});
