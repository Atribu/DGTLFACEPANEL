// Opt-in integration check: node tests/http-smoke.mjs
// Runs a separate Next server and real PGlite database inside a temporary copy.
// Never reads local environment files or opens the workspace's .data directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "dgtlface-http-smoke-"));
let server;
let serverLog = "";
let checks = 0;

async function availablePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

try {
  for (const name of [
    "app",
    "components",
    "lib",
    "docs",
    "public",
    "scripts",
    "package.json",
    "package-lock.json",
    ".node-version",
    "next.config.ts",
    "tsconfig.json",
    "next-env.d.ts",
  ]) {
    await cp(path.join(root, name), path.join(temporary, name), {
      recursive: true,
    });
  }
  await symlink(
    path.join(root, "node_modules"),
    path.join(temporary, "node_modules"),
    "dir",
  );
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const jobsSecret = randomBytes(48).toString("base64url");
  const ownerPassword = randomBytes(24).toString("base64url");
  const ownerSalt = randomBytes(16).toString("hex");
  const ownerHash = `scrypt:${ownerSalt}:${scryptSync(ownerPassword, ownerSalt, 64).toString("hex")}`;
  server = spawn(
    process.execPath,
    ["scripts/dev.cjs", "--webpack", "--port", String(port)],
    {
      cwd: temporary,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: "",
        APP_ORIGIN: origin,
        SESSION_SECRET: randomBytes(48).toString("base64url"),
        JOBS_SECRET: jobsSecret,
        ENABLE_DEMO: "true",
        NEXT_TELEMETRY_DISABLED: "1",
        SYSTEM_OWNER_PASSWORD_HASH: ownerHash,
      },
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverLog = (serverLog + chunk).slice(-16000);
    });
  }
  let ready = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error("Isolated server exited during startup.");
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.storage, "pglite");
        assert.equal(health.demo, true);
        ready = true;
        break;
      }
    } catch {
      /* The server may still be compiling its health route. */
    }
    await delay(300);
  }
  assert.equal(ready, true, "Isolated server did not become ready.");

  async function request(
    cookie,
    method,
    pathname,
    body,
    expected = 200,
    extraHeaders = {},
  ) {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(method !== "GET" ? { Origin: origin } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const result = response.status === 304 ? null : await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${pathname}: ${JSON.stringify(result)}`,
    );
    checks++;
    return { result, response };
  }
  async function login(email, password = "Demo2026!") {
    const { response } = await request(null, "POST", "/api/login", {
      email,
      password,
    });
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("dgtlface-session="));
    assert.ok(cookie, "Login must issue the actual session cookie.");
    assert.match(cookie, /HttpOnly/i);
    return cookie.split(";")[0];
  }
  await request(null, "GET", "/api/bootstrap", undefined, 401);
  const admin = await login("admin@dgtlface.demo");
  const staff = await login("ayse@dgtlface.demo");
  const observer = await login("otel@dgtlface.demo");
  const { result: baseline, response: baselineResponse } = await request(admin, "GET", "/api/bootstrap");
  assert.equal(baselineResponse.headers.get("cache-control"), "private, no-store");
  const webConditional = { "If-None-Match": baselineResponse.headers.get("etag") };
  await request(admin, "GET", "/api/bootstrap", undefined, 304, webConditional);
  await request(null, "GET", "/api/bootstrap", undefined, 401, webConditional);
  assert.equal(baseline.hotels.length, 4);
  assert.equal(
    baseline.tasks.length,
    135,
    "Database must be a fresh disposable seed.",
  );
  const { result: scoped } = await request(observer, "GET", "/api/bootstrap", undefined, 200, webConditional);
  assert.deepEqual(
    scoped.hotels.map((item) => item.id),
    ["hotel-luna"],
  );
  assert.ok(scoped.tasks.every((item) => item.hotelId === "hotel-luna"));
  assert.ok(scoped.activities.every((item) => item.hotelId === "hotel-luna"));
  assert.ok(
    scoped.users
      .filter((item) => item.id !== scoped.user.id)
      .every((item) => item.email === ""),
  );
  const foreignTask = baseline.tasks.find(
    (item) => item.hotelId !== "hotel-luna",
  );
  await request(
    observer,
    "GET",
    `/api/tasks/${foreignTask.id}`,
    undefined,
    404,
  );
  console.log(
    "PASS: login cookies, unauthenticated rejection and observer data isolation",
  );

  const draft = {
    hotelId: "hotel-luna",
    title: "HTTP pilot iş akışı",
    description: "Geçici test verisi",
    department: "Proje Yöneticisi",
    assigneeId: "user-ayse",
    priority: 1,
    dueDate: "2026-11-05",
    checklist: ["İlk kontrol", "Son kontrol"],
  };
  await request(admin, "POST", "/api/tasks", { ...draft, priority: 0 }, 400);
  await request(admin, "POST", "/api/tasks", { ...draft, priority: 11 }, 400);
  await request(staff, "POST", "/api/tasks", draft, 403);
  await request(observer, "POST", "/api/tasks", draft, 403);
  const { result: created } = await request(
    admin,
    "POST",
    "/api/tasks",
    draft,
    201,
  );
  const task = created.task;
  const taskUrl = `/api/tasks/${task.id}`;
  assert.equal(task.priority, 1);
  const { response: beforePriorityChange } = await request(admin, "GET", "/api/bootstrap");
  await request(admin, "PATCH", taskUrl, { action: "update", priority: 10 });
  const { result: afterPriorityChange, response: changedWorkspace } = await request(admin, "GET", "/api/bootstrap", undefined, 200, {
    "If-None-Match": beforePriorityChange.headers.get("etag"),
  });
  assert.equal(afterPriorityChange.tasks.find((item) => item.id === task.id).priority, 10);
  assert.notEqual(changedWorkspace.headers.get("etag"), beforePriorityChange.headers.get("etag"));
  await request(admin, "PATCH", taskUrl, { action: "update", priority: 1 });
  await request(
    admin,
    "PATCH",
    taskUrl,
    { action: "update", priority: 1.5 },
    400,
  );
  await request(
    staff,
    "PATCH",
    taskUrl,
    { action: "update", priority: 2 },
    403,
  );
  await request(
    observer,
    "PATCH",
    taskUrl,
    { action: "status", status: "in_progress" },
    403,
  );
  await request(
    observer,
    "POST",
    `${taskUrl}/comments`,
    { body: "Yetkisiz yorum" },
    403,
  );
  await request(
    admin,
    "PATCH",
    taskUrl,
    { action: "status", status: "in_progress" },
    403,
    { Origin: "https://example.test" },
  );
  console.log(
    "PASS: priority boundaries, forbidden mutations and cross-site request rejection",
  );

  await request(staff, "PATCH", taskUrl, {
    action: "status",
    status: "in_progress",
  });
  await request(
    staff,
    "PATCH",
    taskUrl,
    { action: "status", status: "waiting" },
    400,
  );
  await request(staff, "PATCH", taskUrl, {
    action: "status",
    status: "waiting",
    waitingReason: "Otel görselleri bekleniyor",
  });
  await request(staff, "PATCH", taskUrl, {
    action: "status",
    status: "in_progress",
  });
  await request(staff, "PATCH", taskUrl, { action: "submit" }, 400);
  for (const criterion of task.checklist) {
    await request(staff, "PATCH", taskUrl, {
      action: "checklist",
      itemId: criterion.id,
      done: true,
    });
  }
  await request(
    staff,
    "POST",
    `${taskUrl}/comments`,
    { body: "Kontroller tamamlandı." },
    201,
  );
  await request(staff, "PATCH", taskUrl, { action: "submit" });
  await request(staff, "PATCH", taskUrl, { action: "approve" }, 403);
  await request(
    staff,
    "PATCH",
    taskUrl,
    { action: "checklist", itemId: task.checklist[0].id, done: false },
    403,
  );
  await request(admin, "PATCH", taskUrl, {
    action: "return",
    reason: "Son kontrolü tekrarla",
  });
  await request(staff, "PATCH", taskUrl, { action: "submit" });
  const { result: approved } = await request(admin, "PATCH", taskUrl, {
    action: "approve",
  });
  assert.equal(approved.task.status, "completed");
  await request(staff, "PATCH", taskUrl, { action: "reopen" }, 403);
  const { result: reopened } = await request(admin, "PATCH", taskUrl, {
    action: "reopen",
    reason: "Ek kontrol",
  });
  assert.equal(reopened.task.status, "in_progress");
  const { result: detail } = await request(admin, "GET", taskUrl);
  assert.equal(detail.comments[0].body, "Kontroller tamamlandı.");
  assert.ok(
    detail.activities.some((item) =>
      item.message.includes("Son kontrolü tekrarla"),
    ),
  );
  assert.ok(
    detail.activities.some((item) =>
      item.message.includes("yönetici onayıyla tamamlandı"),
    ),
  );
  console.log(
    "PASS: staff checklist → review → manager return → approval → reopening with recorded history",
  );

  const { result: addedHotel } = await request(
    admin,
    "POST",
    "/api/hotels",
    {
      name: "HTTP geçici pilot oteli",
      location: "Antalya",
      services: ["SEO"],
      managerId: "user-ayse",
      contactName: "Pilot Yetkilisi",
      contactEmail: "pilot@example.test",
      template: true,
    },
    201,
  );
  assert.equal(addedHotel.tasks.length, 93);
  assert.equal(new Set(addedHotel.tasks.map((item) => item.id)).size, 93);
  assert.ok(
    addedHotel.tasks.every(
      (item) =>
        item.hotelId === addedHotel.hotel.id && item.status === "planned",
    ),
  );
  assert.ok(
    addedHotel.tasks
      .filter((item) => item.department === "Proje Yöneticisi")
      .every((item) => item.assigneeId === "user-ayse"),
  );
  const { result: stillScoped } = await request(
    observer,
    "GET",
    "/api/bootstrap",
  );
  assert.deepEqual(
    stillScoped.hotels.map((item) => item.id),
    ["hotel-luna"],
  );
  await request(
    observer,
    "GET",
    `/api/tasks/${addedHotel.tasks[0].id}`,
    undefined,
    404,
  );
  console.log(
    "PASS: new hotel receives 93 independent template tasks; observer scope stays restricted",
  );

  async function uploadFile(cookie, target, bytes, name, type, expected = 201) {
    const form = new FormData();
    form.set("file", new File([bytes], name, { type }));
    const response = await fetch(`${origin}${target}`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    const result = await response.json();
    assert.equal(
      response.status,
      expected,
      `Multipart ${target}: ${JSON.stringify(result)}`,
    );
    checks++;
    return result;
  }
  async function downloadFile(cookie, id, bytes, mime) {
    const response = await fetch(`${origin}/api/attachments/${id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-disposition"),
      /^attachment; filename="[^"]+"; filename\*=UTF-8''/,
    );
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(
      response.headers.get("content-length"),
      String(bytes.byteLength),
    );
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    checks++;
  }
  const attachmentUrl = `${taskUrl}/attachments`;
  const pdfBytes = Buffer.from("%PDF-1.7\nHTTP attachment evidence\n%%EOF");
  const { attachment: pdfAttachment } = await uploadFile(
    staff,
    attachmentUrl,
    pdfBytes,
    "İş kanıtı.pdf",
    "application/pdf",
  );
  assert.equal(pdfAttachment.userId, "user-ayse");
  await downloadFile(observer, pdfAttachment.id, pdfBytes, "application/pdf");
  await request(
    null,
    "GET",
    `/api/attachments/${pdfAttachment.id}`,
    undefined,
    401,
  );
  await request(null, "GET", attachmentUrl, undefined, 401);
  await request(
    observer,
    "DELETE",
    `/api/attachments/${pdfAttachment.id}`,
    undefined,
    403,
  );
  const txtBytes = Buffer.from("Türkçe teslim notu\nKontrol tamamlandı.");
  const { attachment: textAttachment } = await uploadFile(
    admin,
    attachmentUrl,
    txtBytes,
    "Teslim.txt",
    "text/plain",
  );
  await downloadFile(observer, textAttachment.id, txtBytes, "text/plain");
  await request(
    staff,
    "DELETE",
    `/api/attachments/${textAttachment.id}`,
    undefined,
    403,
  );
  const { result: attachedLink } = await request(
    staff,
    "POST",
    attachmentUrl,
    {
      kind: "link",
      title: "Onay bağlantısı",
      url: "https://example.test/teslim",
    },
    201,
  );
  await request(
    admin,
    "GET",
    `/api/attachments/${attachedLink.attachment.id}`,
    undefined,
    404,
  );
  await request(
    staff,
    "POST",
    attachmentUrl,
    { kind: "link", title: "Geçersiz", url: "javascript:alert(1)" },
    400,
  );
  await request(
    observer,
    "POST",
    attachmentUrl,
    { kind: "link", title: "Yetkisiz", url: "https://example.test/" },
    403,
  );
  await uploadFile(
    staff,
    attachmentUrl,
    Buffer.from("<script>alert(1)</script>"),
    "fake.pdf",
    "application/pdf",
    400,
  );
  await uploadFile(
    staff,
    attachmentUrl,
    Buffer.alloc(10 * 1024 * 1024 + 1),
    "large.txt",
    "text/plain",
    413,
  );
  const { result: attachmentsList } = await request(
    observer,
    "GET",
    attachmentUrl,
  );
  assert.equal(attachmentsList.attachments.length, 3);
  assert.equal(
    JSON.stringify(attachmentsList).includes("HTTP attachment evidence"),
    false,
  );
  const foreignAttachments = `/api/tasks/${addedHotel.tasks[0].id}/attachments`;
  const { attachment: privateAttachment } = await uploadFile(
    admin,
    foreignAttachments,
    pdfBytes,
    "private.pdf",
    "application/pdf",
  );
  await request(observer, "GET", foreignAttachments, undefined, 404);
  await request(
    observer,
    "GET",
    `/api/attachments/${privateAttachment.id}`,
    undefined,
    404,
  );
  await request(
    observer,
    "DELETE",
    `/api/attachments/${privateAttachment.id}`,
    undefined,
    404,
  );
  await request(staff, "PATCH", taskUrl, { action: "submit" });
  await request(
    admin,
    "POST",
    attachmentUrl,
    { kind: "link", title: "Kilitli", url: "https://example.test/" },
    403,
  );
  await request(
    admin,
    "DELETE",
    `/api/attachments/${pdfAttachment.id}`,
    undefined,
    403,
  );
  await request(admin, "PATCH", taskUrl, { action: "reopen" });
  await request(staff, "DELETE", `/api/attachments/${pdfAttachment.id}`);
  await request(
    observer,
    "GET",
    `/api/attachments/${pdfAttachment.id}`,
    undefined,
    404,
  );
  const { result: afterRemoval } = await request(
    observer,
    "GET",
    attachmentUrl,
  );
  assert.equal(afterRemoval.attachments.length, 2);
  console.log(
    "PASS: PDF/TXT uploads and secure downloads, links, scope/ownership, file limits, approval locks and soft removal",
  );

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
  }).format(new Date());
  const plusDays = (date, amount) => {
    const shifted = new Date(`${date}T12:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + amount);
    return shifted.toISOString().slice(0, 10);
  };
  await request(null, "GET", "/api/notifications", undefined, 401);
  const { result: controlCreated } = await request(
    admin,
    "POST",
    "/api/tasks",
    {
      ...draft,
      title: '=HYPERLINK("https://example.test","Kontrol")',
      priority: 3,
      dueDate: today,
      checklist: ["Bildirim kontrolünü tamamla"],
    },
    201,
  );
  const controlTask = controlCreated.task;
  const controlUrl = `/api/tasks/${controlTask.id}`;
  const { result: firstNotifications } = await request(
    staff,
    "GET",
    "/api/notifications",
  );
  assert.ok(
    firstNotifications.notifications.every(
      (item) => item.userId === "user-ayse",
    ),
  );
  assert.ok(
    firstNotifications.notifications.some(
      (item) => item.taskId === controlTask.id && item.kind === "assigned",
    ),
  );
  assert.ok(
    firstNotifications.notifications.some(
      (item) => item.taskId === controlTask.id && item.kind === "due_today",
    ),
  );
  await request(admin, "PATCH", controlUrl, {
    action: "update",
    priority: 1,
    dueDate: plusDays(today, 1),
  });
  await request(staff, "PATCH", controlUrl, {
    action: "status",
    status: "waiting",
    waitingReason: "Otel onayı bekleniyor.",
  });
  await request(staff, "PATCH", controlUrl, {
    action: "status",
    status: "in_progress",
  });
  await request(staff, "PATCH", controlUrl, {
    action: "checklist",
    itemId: controlTask.checklist[0].id,
    done: true,
  });
  await request(staff, "PATCH", controlUrl, { action: "submit" });
  await request(admin, "PATCH", controlUrl, {
    action: "return",
    reason: "Bildirim kanıtını tekrar kontrol edin.",
  });
  await request(staff, "PATCH", controlUrl, { action: "submit" });
  await request(admin, "PATCH", controlUrl, { action: "approve" });
  const { result: personal } = await request(
    staff,
    "GET",
    "/api/notifications",
  );
  const personalControl = personal.notifications.filter(
    (item) => item.taskId === controlTask.id,
  );
  for (const kind of [
    "assigned",
    "due_today",
    "priority_changed",
    "due_date_changed",
    "returned",
    "approved",
  ])
    assert.ok(
      personalControl.some((item) => item.kind === kind),
      `Missing personal event ${kind}`,
    );
  assert.match(
    personalControl.find((item) => item.kind === "returned").message,
    /Bildirim kanıtını tekrar kontrol edin/,
  );
  const { result: managerNotifications } = await request(
    admin,
    "GET",
    "/api/notifications",
  );
  const managerReview = managerNotifications.notifications.find(
    (item) =>
      item.taskId === controlTask.id && item.kind === "review_requested",
  );
  assert.ok(managerReview);
  const { result: observerNotifications } = await request(
    observer,
    "GET",
    "/api/notifications",
  );
  assert.ok(
    observerNotifications.notifications.every(
      (item) => item.userId === "user-otel" && item.hotelId === "hotel-luna",
    ),
  );
  assert.ok(
    observerNotifications.notifications.some(
      (item) => item.taskId === controlTask.id && item.kind === "waiting",
    ),
  );
  assert.ok(
    observerNotifications.notifications.some(
      (item) => item.taskId === controlTask.id && item.kind === "approved",
    ),
  );
  assert.ok(
    observerNotifications.notifications.every(
      (item) => !["due_today", "overdue"].includes(item.kind),
    ),
  );
  await request(
    staff,
    "PATCH",
    "/api/notifications",
    { action: "read", id: managerReview.id },
    404,
  );
  const ownNotification = personalControl.find(
    (item) => item.kind === "approved",
  );
  await request(staff, "PATCH", "/api/notifications", {
    action: "read",
    id: ownNotification.id,
  });
  await request(
    staff,
    "PATCH",
    "/api/notifications",
    { action: "read_all", userId: "user-admin" },
    400,
  );
  await request(
    staff,
    "PATCH",
    "/api/notifications",
    { action: "read_all" },
    403,
    { Origin: "https://example.test" },
  );
  await request(staff, "PATCH", "/api/notifications", { action: "read_all" });
  const { result: readPersonal } = await request(
    staff,
    "GET",
    "/api/notifications",
  );
  assert.equal(readPersonal.unreadCount, 0);
  assert.ok(readPersonal.notifications.every((item) => item.readAt));
  const { result: managerUnread } = await request(
    admin,
    "GET",
    "/api/notifications",
  );
  assert.equal(
    managerUnread.notifications.find((item) => item.id === managerReview.id)
      .readAt,
    null,
  );
  console.log(
    "PASS: personal notification events, deadline reminders, observer scope and read ownership",
  );

  await request(null, "POST", "/api/internal/maintenance", undefined, 401);
  await request(admin, "POST", "/api/internal/maintenance", undefined, 401);
  await request(null, "POST", "/api/internal/maintenance", undefined, 401, {
    Authorization: "Bearer incorrect-secret",
  });
  const runMaintenance = () =>
    request(null, "POST", "/api/internal/maintenance", undefined, 200, {
      Authorization: `Bearer ${jobsSecret}`,
    });
  await request(null, "GET", "/api/recurrences", undefined, 401);
  await request(staff, "GET", "/api/recurrences", undefined, 403);
  await request(observer, "GET", "/api/recurrences", undefined, 403);
  const recurrenceDraft = {
    hotelId: "hotel-luna",
    title: "HTTP haftalık operasyon kontrolü",
    description: "Geçici test kuralı",
    department: "Proje Yöneticisi",
    assigneeId: "user-ayse",
    priority: 2,
    checklist: ["Haftalık ölçümü kontrol et"],
    frequency: "weekly",
    startsOn: today,
    dueOffsetDays: 2,
  };
  await request(staff, "POST", "/api/recurrences", recurrenceDraft, 403);
  await request(observer, "POST", "/api/recurrences", recurrenceDraft, 403);
  await request(
    admin,
    "POST",
    "/api/recurrences",
    { ...recurrenceDraft, assigneeId: "user-otel" },
    409,
  );
  const { result: addedRecurrence } = await request(
    admin,
    "POST",
    "/api/recurrences",
    recurrenceDraft,
    201,
  );
  const recurrenceId = addedRecurrence.recurrence.id;
  const recurrenceUrl = `/api/recurrences/${recurrenceId}`;
  await runMaintenance();
  await runMaintenance();
  const { result: generatedData } = await request(
    admin,
    "GET",
    "/api/bootstrap",
  );
  const generatedTasks = generatedData.tasks.filter(
    (item) => item.recurrenceId === recurrenceId,
  );
  assert.equal(
    generatedTasks.length,
    1,
    "Repeated maintenance must not duplicate an occurrence.",
  );
  assert.equal(generatedTasks[0].recurrenceScheduledOn, today);
  assert.equal(generatedTasks[0].dueDate, plusDays(today, 2));
  assert.equal(generatedTasks[0].assigneeId, "user-ayse");
  assert.equal(generatedTasks[0].status, "planned");
  const { result: recurringNotifications } = await request(
    staff,
    "GET",
    "/api/notifications",
  );
  assert.equal(
    recurringNotifications.notifications.filter(
      (item) =>
        item.taskId === generatedTasks[0].id && item.kind === "assigned",
    ).length,
    1,
  );
  await request(staff, "PATCH", recurrenceUrl, { action: "pause" }, 403);
  await request(observer, "PATCH", recurrenceUrl, { action: "pause" }, 403);
  const { result: paused } = await request(admin, "PATCH", recurrenceUrl, {
    action: "pause",
  });
  assert.equal(paused.recurrence.active, false);
  await runMaintenance();
  const { result: resumed } = await request(admin, "PATCH", recurrenceUrl, {
    action: "resume",
  });
  assert.equal(resumed.recurrence.active, true);
  assert.equal(resumed.recurrence.nextRunOn, plusDays(today, 7));
  await request(
    admin,
    "PATCH",
    recurrenceUrl,
    { action: "update", priority: 11 },
    400,
  );
  await request(admin, "PATCH", recurrenceUrl, {
    action: "update",
    title: "Gelecek dönem için güncel başlık",
    priority: 1,
  });
  const { result: preservedTask } = await request(
    admin,
    "GET",
    `/api/tasks/${generatedTasks[0].id}`,
  );
  assert.equal(preservedTask.task.title, recurrenceDraft.title);
  assert.equal(preservedTask.task.priority, 2);
  const { result: ruleList } = await request(admin, "GET", "/api/recurrences");
  assert.equal(
    ruleList.recurrences.find((item) => item.id === recurrenceId).lastRunOn,
    today,
  );
  console.log(
    "PASS: maintenance bearer authorization, recurring task generation/deduplication and pause/resume",
  );

  const reportParameters = new URLSearchParams({
    hotelId: "hotel-luna",
    from: today,
    to: plusDays(today, 30),
    includeUndated: "false",
  });
  const reportUrl = `/api/reports?${reportParameters}`;
  await request(null, "GET", reportUrl, undefined, 401);
  const { result: observerReport } = await request(observer, "GET", reportUrl);
  assert.equal(observerReport.report.hotel.id, "hotel-luna");
  assert.equal(
    observerReport.report.tasks.find((item) => item.id === controlTask.id)
      .status,
    "completed",
  );
  const lunaTaskIds = new Set([
    ...generatedData.tasks
      .filter((item) => item.hotelId === "hotel-luna")
      .map((item) => item.id),
    controlTask.id,
  ]);
  assert.ok(
    observerReport.report.tasks.every((item) => lunaTaskIds.has(item.id)),
  );
  await request(staff, "GET", reportUrl);
  const foreignReportParameters = new URLSearchParams(reportParameters);
  foreignReportParameters.set("hotelId", addedHotel.hotel.id);
  await request(
    observer,
    "GET",
    `/api/reports?${foreignReportParameters}`,
    undefined,
    404,
  );
  await request(
    observer,
    "GET",
    `/api/reports/export?${foreignReportParameters}`,
    undefined,
    404,
  );
  const { result: datedOnly } = await request(
    admin,
    "GET",
    `/api/reports?${foreignReportParameters}`,
  );
  assert.equal(datedOnly.report.summary.total, 0);
  assert.equal(datedOnly.report.undated.count, 93);
  assert.equal(datedOnly.report.undated.tasks.length, 0);
  foreignReportParameters.set("includeUndated", "true");
  const { result: undatedReport } = await request(
    admin,
    "GET",
    `/api/reports?${foreignReportParameters}`,
  );
  assert.equal(undatedReport.report.summary.total, 0);
  assert.equal(undatedReport.report.undated.tasks.length, 93);
  await request(admin, "GET", `${reportUrl}&from=${today}`, undefined, 400);
  await request(
    admin,
    "GET",
    `/api/reports?hotelId=hotel-luna&from=2026-02-30&to=2026-03-01`,
    undefined,
    400,
  );
  const csvResponse = await fetch(
    `${origin}/api/reports/export?${reportParameters}`,
    { headers: { Cookie: observer } },
  );
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
  assert.match(
    csvResponse.headers.get("content-disposition"),
    /^attachment; filename="dgtlface-.+\.csv"$/,
  );
  assert.equal(csvResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(csvResponse.headers.get("cache-control"), /no-store/);
  const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [239, 187, 191]);
  const csvText = csvBytes.toString("utf8");
  assert.ok(
    csvText.includes('"\'=HYPERLINK(""https://example.test"",""Kontrol"")"'),
    "CSV formula cells must be neutralized.",
  );
  assert.ok(csvText.includes("Luna Resort"));
  assert.equal(csvText.includes(addedHotel.hotel.name), false);
  assert.equal(csvText.includes("ayse@dgtlface.demo"), false);
  checks++;
  console.log(
    "PASS: hotel report access scope, undated-task separation, CSV headers and formula neutralization",
  );

  const mobileUrl = "/api/mobile/bootstrap";
  const { result: mobileData, response: mobileResponse } = await request(admin, "GET", mobileUrl);
  assert.ok(mobileData.tasks.every((item) => /^[a-f0-9]{64}$/.test(mobileData.taskVersions[item.id])));
  assert.equal(mobileData.activities, undefined);
  assert.equal(mobileResponse.headers.get("cache-control"), "private, no-cache");
  assert.ok(mobileResponse.headers.get("vary").split(",").map((value) => value.trim().toLowerCase()).includes("cookie"));
  const conditional = { "If-None-Match": mobileResponse.headers.get("etag") };
  await request(admin, "GET", mobileUrl, undefined, 304, conditional);
  await request(null, "GET", mobileUrl, undefined, 401, conditional);
  const { result: mobileScoped } = await request(observer, "GET", mobileUrl, undefined, 200, conditional);
  assert.ok(mobileScoped.tasks.every((item) => item.hotelId === "hotel-luna"));
  assert.deepEqual(Object.keys(mobileScoped.taskVersions).sort(), mobileScoped.tasks.map((item) => item.id).sort());
  assert.ok(mobileScoped.comments.every((item) => mobileScoped.taskVersions[item.taskId]));

  const { result: mobileCreated } = await request(admin, "POST", "/api/tasks", {
    ...draft,
    title: "Geçici mobil eşitleme testi",
  }, 201);
  const mobileTaskId = mobileCreated.task.id;
  const mobileTaskUrl = `/api/mobile/tasks/${mobileTaskId}`;
  const { result: freshMobile } = await request(staff, "GET", mobileUrl);
  const mobilePatch = {
    expectedVersion: freshMobile.taskVersions[mobileTaskId],
    payload: { action: "checklist", itemId: mobileCreated.task.checklist[0].id, done: true },
  };
  await request(null, "PATCH", mobileTaskUrl, mobilePatch, 401);
  await request(staff, "PATCH", mobileTaskUrl, mobilePatch, 403, { Origin: "https://example.test" });
  await request(observer, "PATCH", mobileTaskUrl, mobilePatch, 403);
  await request(observer, "PATCH", `/api/mobile/tasks/${foreignTask.id}`, mobilePatch, 404);
  await request(staff, "PATCH", mobileTaskUrl, { payload: mobilePatch.payload }, 400);
  const { result: mobileChanged } = await request(staff, "PATCH", mobileTaskUrl, mobilePatch);
  assert.equal(mobileChanged.task.checklist[0].done, true);
  assert.match(mobileChanged.version, /^[a-f0-9]{64}$/);
  assert.notEqual(mobileChanged.version, mobilePatch.expectedVersion);
  await request(staff, "PATCH", mobileTaskUrl, { ...mobilePatch, payload: { ...mobilePatch.payload, done: false } }, 409);
  const { result: changedInWeb } = await request(admin, "GET", `/api/tasks/${mobileTaskId}`);
  assert.equal(changedInWeb.task.checklist[0].done, true);
  await request(admin, "PATCH", `/api/tasks/${mobileTaskId}`, { action: "update", description: "Webden güncel açıklama" });
  await request(staff, "PATCH", mobileTaskUrl, { ...mobilePatch, expectedVersion: mobileChanged.version }, 409);
  const { result: changedOnMobile } = await request(staff, "GET", mobileUrl);
  assert.equal(changedOnMobile.tasks.find((item) => item.id === mobileTaskId).description, "Webden güncel açıklama");

  const mobileNote = { body: "Telefondan ortak not", requestId: "http-mobile-note-1" };
  await request(staff, "POST", `${mobileTaskUrl}/comments`, mobileNote, 403, { Origin: "https://example.test" });
  await request(observer, "POST", `${mobileTaskUrl}/comments`, mobileNote, 403);
  const { result: firstMobileNote } = await request(staff, "POST", `${mobileTaskUrl}/comments`, mobileNote, 201);
  const { result: retriedMobileNote } = await request(staff, "POST", `${mobileTaskUrl}/comments`, mobileNote, 201);
  assert.deepEqual(firstMobileNote, retriedMobileNote);
  await request(staff, "POST", `${mobileTaskUrl}/comments`, { ...mobileNote, body: "Farklı not" }, 409);
  const { result: notesInWeb } = await request(admin, "GET", `/api/tasks/${mobileTaskId}`);
  assert.equal(notesInWeb.comments.filter((item) => item.id === firstMobileNote.comment.id).length, 1);
  assert.equal(notesInWeb.comments.find((item) => item.id === firstMobileNote.comment.id).body, mobileNote.body);
  const slowUser = {
    name: "Geçici mobil yetki testi",
    email: "mobile-revocation@example.test",
    role: "admin",
    department: "Test",
    hotelIds: [],
  };
  const { result: slowAccount } = await request(admin, "POST", "/api/users", {
    ...slowUser, password: "TemporaryMobile2026!",
  }, 201);
  const slowCookie = await login(slowUser.email, "TemporaryMobile2026!");
  const delayedRequests = [];
  const finishBodies = [];
  for (const [method, pathname, body] of [
    ["PATCH", mobileTaskUrl, {
      expectedVersion: changedOnMobile.taskVersions[mobileTaskId],
      payload: { ...mobilePatch.payload, done: false },
    }],
    ["POST", `${mobileTaskUrl}/comments`, { body: "Revoked upload must not be saved", requestId: "revoked-upload" }],
  ]) {
    const bytes = Buffer.from(JSON.stringify(body));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        finishBodies.push(() => { controller.enqueue(bytes.subarray(1)); controller.close(); });
      },
    });
    delayedRequests.push(fetch(`${origin}${pathname}`, {
      method,
      headers: { Cookie: slowCookie, Origin: origin, "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
      signal: AbortSignal.timeout(10000),
    }));
  }
  await delay(100);
  await request(admin, "PATCH", `/api/users/${slowAccount.user.id}`, { ...slowUser, active: false });
  finishBodies.forEach((finish) => finish());
  for (const response of await Promise.all(delayedRequests)) {
    assert.equal(response.status, 401);
    await response.json();
    checks++;
  }
  const { result: afterRevocation } = await request(admin, "GET", `/api/tasks/${mobileTaskId}`);
  assert.equal(afterRevocation.task.checklist[0].done, true);
  assert.ok(afterRevocation.comments.every((item) => item.body !== "Revoked upload must not be saved"));
  console.log("PASS: mobile authenticated ETags, scoped versions, CSRF, optimistic conflicts, web visibility and durable note retries");

  const removableUser = {
    name: "Geçmişi korunacak ekip üyesi",
    email: "removal-history@example.test",
    role: "staff",
    department: "Test",
    hotelIds: [],
  };
  const removalPassword = "TemporaryRemoval2026!";
  const { result: removable } = await request(admin, "POST", "/api/users", {
    ...removableUser, password: removalPassword,
  }, 201);
  const removalId = removable.user.id;
  const removalUrl = `/api/users/${removalId}`;
  const removalCookie = await login(removableUser.email, removalPassword);
  await request(null, "DELETE", removalUrl, undefined, 401);
  await request(staff, "DELETE", removalUrl, undefined, 403);
  await request(observer, "DELETE", removalUrl, undefined, 403);
  await request(admin, "DELETE", removalUrl, undefined, 403, { Origin: "https://example.test" });
  await request(admin, "DELETE", `/api/users/${baseline.user.id}`, undefined, 409);
  const { result: removalTask } = await request(admin, "POST", "/api/tasks", {
    ...draft, title: "Silinen hesabın tamamlanmış işi", assigneeId: removalId,
    checklist: ["Teslim kontrolü"],
  }, 201);
  const removalTaskUrl = `/api/tasks/${removalTask.task.id}`;
  await request(admin, "DELETE", removalUrl, undefined, 409);
  await request(removalCookie, "POST", `${removalTaskUrl}/comments`, {
    body: "Hesap kapatılsa da bu teslim notu korunmalı.",
  }, 201);
  const historyBytes = Buffer.from("Silme sonrası korunacak teslim dosyası.");
  const { attachment: historyAttachment } = await uploadFile(
    removalCookie, `${removalTaskUrl}/attachments`, historyBytes,
    "teslim-gecmisi.txt", "text/plain",
  );
  await request(removalCookie, "PATCH", removalTaskUrl, {
    action: "checklist", itemId: removalTask.task.checklist[0].id, done: true,
  });
  await request(removalCookie, "PATCH", removalTaskUrl, { action: "submit" });
  await request(admin, "PATCH", removalTaskUrl, { action: "approve" });
  const { result: historyBeforeDelete } = await request(admin, "GET", removalTaskUrl);
  const { result: deleted } = await request(admin, "DELETE", removalUrl);
  assert.equal(deleted.user.active, false);
  assert.ok(deleted.user.deletedAt);
  await request(admin, "DELETE", removalUrl);
  await request(removalCookie, "GET", "/api/bootstrap", undefined, 401);
  await request(removalCookie, "GET", "/api/mobile/bootstrap", undefined, 401);
  await request(null, "POST", "/api/login", {
    email: removableUser.email, password: removalPassword,
  }, 401);
  await request(admin, "PATCH", removalUrl, { ...removableUser, active: true }, 404);
  const { result: remainingUsers } = await request(admin, "GET", "/api/users");
  assert.equal(remainingUsers.users.some((user) => user.id === removalId), false);
  const { result: historicalBootstrap } = await request(admin, "GET", "/api/bootstrap");
  assert.equal(historicalBootstrap.users.find((user) => user.id === removalId).name, removableUser.name);
  const { result: historyAfterDelete } = await request(admin, "GET", removalTaskUrl);
  assert.deepEqual(historyAfterDelete, historyBeforeDelete);
  await downloadFile(admin, historyAttachment.id, historyBytes, "text/plain");
  await request(admin, "POST", "/api/tasks", { ...draft, assigneeId: removalId }, 400);
  console.log("PASS: user deletion authorization/CSRF, responsibility guard, revoked web/mobile sessions and preserved task/comment/file history");

  const ownerEmail = "oguzkilinc.ant@gmail.com";
  const ownerCookie = await login(ownerEmail, ownerPassword);
  const { result: ownerWorkspace } = await request(ownerCookie, "GET", "/api/bootstrap");
  const ownerId = ownerWorkspace.user.id;
  assert.equal(ownerWorkspace.user.isOwner, true);
  assert.ok(ownerWorkspace.users.every(user => user.id !== ownerId));
  await request(null, "GET", "/api/owner/console", undefined, 401);
  for (const cookie of [admin, staff, observer]) {
    await request(cookie, "GET", "/api/owner/console", undefined, 403);
  }
  await request(admin, "DELETE", `/api/users/${ownerId}`, undefined, 404);
  await request(admin, "PATCH", `/api/users/${ownerId}`, {
    name: "Different", email: "different@example.test", role: "admin", department: "Test", hotelIds: [], active: true,
  }, 404);
  await request(admin, "POST", "/api/users", {
    name: "Reserved", email: ownerEmail, role: "admin", department: "Test", hotelIds: [], password: ownerPassword,
  }, 409);
  const { result: ownerWork } = await request(ownerCookie, "POST", "/api/tasks", {
    ...draft, title: "Sahip hesabı gizlilik denetimi",
  }, 201);
  await request(ownerCookie, "POST", `/api/tasks/${ownerWork.task.id}/comments`, {
    body: "Özel yönetim kontrolü tamamlandı.",
  }, 201);
  const { result: trueHistory } = await request(ownerCookie, "GET", `/api/tasks/${ownerWork.task.id}`);
  assert.ok(trueHistory.activities.some(item => item.userId === ownerId));
  assert.ok(trueHistory.comments.some(item => item.userId === ownerId));
  const secretValues = [ownerId, ownerEmail, "Oğuz Kılınç"];
  for (const cookie of [admin, staff, observer]) {
    for (const pathname of ["/api/bootstrap", "/api/mobile/bootstrap", `/api/tasks/${ownerWork.task.id}`]) {
      const { result } = await request(cookie, "GET", pathname);
      const serialized = JSON.stringify(result);
      for (const value of secretValues) assert.ok(!serialized.includes(value), `Owner leaked through ${pathname}`);
    }
  }
  const { result: publicUsers } = await request(admin, "GET", "/api/users");
  for (const value of secretValues) assert.ok(!JSON.stringify(publicUsers).includes(value));
  await request(null, "POST", "/api/login", {email: "ayse@dgtlface.demo", password: "incorrect-password"}, 401);
  const { result: ownerDashboard, response: ownerResponse } = await request(ownerCookie, "GET", "/api/owner/console");
  assert.equal(ownerResponse.headers.get("cache-control"), "no-store");
  assert.ok(ownerDashboard.summary.failedLoginsToday >= 1);
  assert.ok(ownerDashboard.team.find(user => user.id === "user-ayse").online);
  assert.ok(ownerDashboard.team.every(user => user.id !== ownerId));
  const {result: filteredOwnerEvents} = await request(ownerCookie,"GET",`/api/owner/console?actorId=${ownerId}&kind=operation`);
  assert.ok(filteredOwnerEvents.events.length > 0);
  assert.ok(filteredOwnerEvents.events.every(event => event.actorId === ownerId && event.kind === "operation"));
  await request(ownerCookie,"GET","/api/owner/console?from=2026-02-30",undefined,400);
  const secondStaffSession = await login("ayse@dgtlface.demo");
  await request(secondStaffSession,"GET","/api/mobile/bootstrap");
  await request(staff,"POST","/api/logout",{});
  await request(staff,"GET","/api/bootstrap",undefined,401);
  await request(secondStaffSession,"GET","/api/mobile/bootstrap");
  const {result: withOtherDevice} = await request(ownerCookie,"GET","/api/owner/console");
  assert.equal(withOtherDevice.team.find(user => user.id === "user-ayse").online, true);
  console.log("PASS: exclusive hidden owner account, owner-only console, privacy across web/mobile/history, login auditing, per-device presence and revoked logout cookies");

  // A disposable hotel exercises the entire archive lifecycle without changing
  // the seeded hotels or the earlier user/owner privacy assertions.
  const lifecycleName = "HTTP arşiv yaşam döngüsü oteli";
  const { result: lifecycleCreated } = await request(admin, "POST", "/api/hotels", {
    name: lifecycleName,
    location: "Antalya",
    services: ["SEO"],
    managerId: "user-ayse",
    contactName: "Arşiv Testi",
    contactEmail: "hotel-lifecycle@example.test",
    template: false,
  }, 201);
  const lifecycleId = lifecycleCreated.hotel.id;
  const lifecycleUrl = `/api/hotels/${lifecycleId}`;
  const { result: lifecycleObserverCreated } = await request(admin, "POST", "/api/users", {
    name: "Arşiv oteli gözlemcisi",
    email: "hotel-lifecycle-observer@example.test",
    password: "TemporaryHotelObserver2026!",
    role: "observer",
    department: "Test",
    hotelIds: [lifecycleId],
  }, 201);
  const lifecycleObserver = await login("hotel-lifecycle-observer@example.test", "TemporaryHotelObserver2026!");
  const { result: lifecycleTaskCreated } = await request(admin, "POST", "/api/tasks", {
    ...draft, hotelId: lifecycleId, title: "Arşivde korunacak görev",
  }, 201);
  const lifecycleTask = lifecycleTaskCreated.task;
  const lifecycleTaskUrl = `/api/tasks/${lifecycleTask.id}`;
  await request(secondStaffSession, "POST", `${lifecycleTaskUrl}/comments`, {
    body: "Arşivden geri alındığında aynı kalacak açıklama.",
  }, 201);
  const lifecycleBytes = Buffer.from("Arşivde korunacak, kalıcı silmede kaldırılacak dosya.");
  const { attachment: lifecycleFile } = await uploadFile(secondStaffSession,
    `${lifecycleTaskUrl}/attachments`, lifecycleBytes, "arsiv-kaniti.txt", "text/plain");
  const { result: lifecycleLink } = await request(secondStaffSession, "POST", `${lifecycleTaskUrl}/attachments`, {
    kind: "link", title: "Arşiv bağlantısı", url: "https://example.test/archive-evidence",
  }, 201);
  const { result: lifecycleRecurrenceCreated } = await request(admin, "POST", "/api/recurrences", {
    ...recurrenceDraft, hotelId: lifecycleId, title: "Arşivde duracak düzenli iş",
  }, 201);
  const lifecycleRuleId = lifecycleRecurrenceCreated.recurrence.id;
  const lifecycleRuleUrl = `/api/recurrences/${lifecycleRuleId}`;
  const { result: lifecycleDetailBefore } = await request(admin, "GET", lifecycleTaskUrl);
  const { result: lifecycleAttachmentsBefore } = await request(admin, "GET", `${lifecycleTaskUrl}/attachments`);
  await downloadFile(lifecycleObserver, lifecycleFile.id, lifecycleBytes, "text/plain");
  const { response: lifecycleWebBefore } = await request(admin, "GET", "/api/bootstrap");
  const { result: lifecycleMobileBefore, response: lifecycleMobileResponse } = await request(admin, "GET", "/api/mobile/bootstrap");
  const { result: lifecycleNotificationsBefore } = await request(secondStaffSession, "GET", "/api/notifications");
  assert.ok(lifecycleNotificationsBefore.notifications.some(item => item.hotelId === lifecycleId));
  const activeDeleteBody = { confirmationName: lifecycleName, archivedAt: new Date().toISOString() };
  await request(null, "GET", "/api/hotels/archived", undefined, 401);
  await request(null, "PATCH", lifecycleUrl, { action: "archive" }, 401);
  await request(null, "DELETE", lifecycleUrl, activeDeleteBody, 401);
  for (const cookie of [secondStaffSession, lifecycleObserver]) {
    await request(cookie, "GET", "/api/hotels/archived", undefined, 403);
    await request(cookie, "PATCH", lifecycleUrl, { action: "archive" }, 403);
    await request(cookie, "PATCH", lifecycleUrl, { action: "restore" }, 403);
    await request(cookie, "DELETE", lifecycleUrl, activeDeleteBody, 403);
  }
  await request(admin, "PATCH", lifecycleUrl, { action: "archive" }, 403, { Origin: "https://example.test" });
  await request(admin, "DELETE", lifecycleUrl, activeDeleteBody, 409);
  const { result: firstArchive } = await request(admin, "PATCH", lifecycleUrl, { action: "archive" });
  const firstArchivedAt = firstArchive.hotel.archivedAt;
  assert.ok(firstArchivedAt);
  const { result: repeatedArchive } = await request(admin, "PATCH", lifecycleUrl, { action: "archive" });
  assert.equal(repeatedArchive.hotel.archivedAt, firstArchivedAt, "Archiving twice must preserve its original timestamp.");
  for (const [pathname, etag] of [
    ["/api/bootstrap", lifecycleWebBefore.headers.get("etag")],
    ["/api/mobile/bootstrap", lifecycleMobileResponse.headers.get("etag")],
  ]) {
    const { result } = await request(admin, "GET", pathname, undefined, 200, { "If-None-Match": etag });
    assert.ok(result.hotels.every(item => item.id !== lifecycleId));
    assert.ok(result.tasks.every(item => item.hotelId !== lifecycleId));
    assert.ok(result.comments.every(item => item.taskId !== lifecycleTask.id));
    assert.ok((result.activities || []).every(item => item.hotelId !== lifecycleId));
    assert.equal(result.taskVersions?.[lifecycleTask.id], undefined);
  }
  for (const cookie of [admin, secondStaffSession, lifecycleObserver]) {
    await request(cookie, "GET", lifecycleTaskUrl, undefined, 404);
    await request(cookie, "GET", `${lifecycleTaskUrl}/attachments`, undefined, 404);
    await request(cookie, "GET", `/api/attachments/${lifecycleFile.id}`, undefined, 404);
  }
  const { result: archivedObserverWorkspace } = await request(lifecycleObserver, "GET", "/api/mobile/bootstrap");
  assert.equal(archivedObserverWorkspace.hotels.length, 0);
  assert.equal(archivedObserverWorkspace.tasks.length, 0);
  await request(admin, "PATCH", lifecycleUrl, { managerId: "user-admin" }, 404);
  await request(admin, "POST", "/api/tasks", { ...draft, hotelId: lifecycleId }, 404);
  await request(admin, "PATCH", lifecycleTaskUrl, { action: "update", title: "Arşivde değişmemeli" }, 404);
  await request(secondStaffSession, "PATCH", lifecycleTaskUrl, {
    action: "checklist", itemId: lifecycleTask.checklist[0].id, done: true,
  }, 404);
  await request(secondStaffSession, "POST", `${lifecycleTaskUrl}/comments`, { body: "Arşivde eklenmemeli" }, 404);
  await request(secondStaffSession, "PATCH", `/api/mobile/tasks/${lifecycleTask.id}`, {
    expectedVersion: lifecycleMobileBefore.taskVersions[lifecycleTask.id],
    payload: { action: "checklist", itemId: lifecycleTask.checklist[0].id, done: true },
  }, 404);
  await request(secondStaffSession, "POST", `/api/mobile/tasks/${lifecycleTask.id}/comments`, {
    body: "Arşivde mobil not eklenmemeli", requestId: "archived-hotel-note",
  }, 404);
  await request(admin, "POST", `${lifecycleTaskUrl}/attachments`, {
    kind: "link", title: "Arşivde eklenmemeli", url: "https://example.test/forbidden",
  }, 404);
  await uploadFile(admin, `${lifecycleTaskUrl}/attachments`, Buffer.from("Arşivde eklenmemeli"), "blocked.txt", "text/plain", 404);
  await request(admin, "DELETE", `/api/attachments/${lifecycleFile.id}`, undefined, 404);
  const archivedReport = new URLSearchParams({ hotelId: lifecycleId, from: today, to: plusDays(today, 30), includeUndated: "true" });
  await request(admin, "GET", `/api/reports?${archivedReport}`, undefined, 404);
  await request(admin, "GET", `/api/reports/export?${archivedReport}`, undefined, 404);
  await request(admin, "POST", "/api/recurrences", { ...recurrenceDraft, hotelId: lifecycleId }, 404);
  await request(admin, "PATCH", lifecycleRuleUrl, { action: "resume" }, 404);
  const { result: archivedRules } = await request(admin, "GET", "/api/recurrences");
  assert.ok(archivedRules.recurrences.every(item => item.hotelId !== lifecycleId));
  const { result: archivedNotifications } = await request(secondStaffSession, "GET", "/api/notifications");
  assert.ok(archivedNotifications.notifications.every(item => item.hotelId !== lifecycleId));
  const { result: archivedOwnerConsole } = await request(ownerCookie, "GET", "/api/owner/console");
  assert.ok(archivedOwnerConsole.hotels.every(item => item.id !== lifecycleId));
  const { result: firstArchiveList, response: archiveListResponse } = await request(admin, "GET", "/api/hotels/archived");
  assert.match(archiveListResponse.headers.get("cache-control"), /no-store/);
  const archiveEntryBeforeMaintenance = firstArchiveList.hotels.find(item => item.hotel.id === lifecycleId);
  assert.equal(archiveEntryBeforeMaintenance.hotel.archivedAt, firstArchivedAt);
  assert.ok(archiveEntryBeforeMaintenance.counts.tasks >= 1);
  assert.equal(archiveEntryBeforeMaintenance.counts.comments, 1);
  assert.equal(archiveEntryBeforeMaintenance.counts.attachments, 2);
  assert.equal(archiveEntryBeforeMaintenance.counts.recurrences, 1);
  await runMaintenance();
  const { result: archiveAfterMaintenance } = await request(admin, "GET", "/api/hotels/archived");
  assert.deepEqual(archiveAfterMaintenance.hotels.find(item => item.hotel.id === lifecycleId).counts,
    archiveEntryBeforeMaintenance.counts, "Maintenance must not generate tasks for archived hotels.");
  await request(admin, "DELETE", lifecycleUrl, { ...activeDeleteBody, archivedAt: firstArchivedAt, confirmationName: "Yanlış otel" }, 400);
  await request(admin, "DELETE", lifecycleUrl, { ...activeDeleteBody, archivedAt: firstArchivedAt }, 403, { Origin: "https://example.test" });
  await request(admin, "PATCH", lifecycleUrl, { action: "restore" });
  const { result: restoredDetail } = await request(admin, "GET", lifecycleTaskUrl);
  assert.deepEqual(restoredDetail, lifecycleDetailBefore, "Restore must preserve the task, checklist, notes and task history.");
  const { result: restoredAttachments } = await request(lifecycleObserver, "GET", `${lifecycleTaskUrl}/attachments`);
  assert.deepEqual(restoredAttachments, lifecycleAttachmentsBefore);
  assert.ok(restoredAttachments.attachments.some(item => item.id === lifecycleLink.attachment.id));
  await downloadFile(lifecycleObserver, lifecycleFile.id, lifecycleBytes, "text/plain");
  const { result: restoredRules } = await request(admin, "GET", "/api/recurrences");
  const restoredRule = restoredRules.recurrences.find(item => item.id === lifecycleRuleId);
  assert.equal(restoredRule.active, false, "Restore must not silently resume a recurring job.");
  const { result: restoredWorkspace } = await request(admin, "GET", "/api/bootstrap");
  assert.ok(restoredWorkspace.hotels.some(item => item.id === lifecycleId && !item.archivedAt));
  await request(admin, "DELETE", lifecycleUrl, { confirmationName: lifecycleName, archivedAt: firstArchivedAt }, 409);
  const { result: secondArchive } = await request(admin, "PATCH", lifecycleUrl, { action: "archive" });
  assert.notEqual(secondArchive.hotel.archivedAt, firstArchivedAt);
  await request(admin, "DELETE", lifecycleUrl, { confirmationName: lifecycleName, archivedAt: firstArchivedAt }, 409);
  const { result: unrelatedBeforePurge } = await request(admin, "GET", `/api/tasks/${mobileTaskId}`);
  const { result: purgedHotel } = await request(ownerCookie, "DELETE", lifecycleUrl, {
    confirmationName: lifecycleName, archivedAt: secondArchive.hotel.archivedAt,
  });
  assert.equal(purgedHotel.deleted, true);
  assert.equal(purgedHotel.hotelId, lifecycleId);
  assert.deepEqual(purgedHotel.counts, archiveEntryBeforeMaintenance.counts);
  await request(admin, "PATCH", lifecycleUrl, { action: "restore" }, 404);
  await request(admin, "GET", lifecycleTaskUrl, undefined, 404);
  await request(admin, "GET", `/api/attachments/${lifecycleFile.id}`, undefined, 404);
  await request(admin, "PATCH", lifecycleRuleUrl, { action: "resume" }, 404);
  const { result: finalArchive } = await request(admin, "GET", "/api/hotels/archived");
  assert.ok(finalArchive.hotels.every(item => item.hotel.id !== lifecycleId));
  const { result: unrelatedAfterPurge } = await request(admin, "GET", `/api/tasks/${mobileTaskId}`);
  assert.deepEqual(unrelatedAfterPurge, unrelatedBeforePurge, "Purging a hotel must not change other hotels' data.");
  const { result: usersAfterHotelPurge } = await request(admin, "GET", "/api/users");
  assert.deepEqual(usersAfterHotelPurge.users.find(item => item.id === lifecycleObserverCreated.user.id).hotelIds, []);
  await request(lifecycleObserver, "GET", "/api/bootstrap", undefined, 401);
  const { result: lifecycleAudit } = await request(ownerCookie, "GET", `/api/owner/console?q=${encodeURIComponent(lifecycleName)}`);
  assert.ok(lifecycleAudit.events.some(event => event.hotelId === lifecycleId && event.actorId === ownerId && /sil/i.test(event.message)),
    "Owner audit must preserve who permanently deleted the hotel.");
  await runMaintenance();
  const { result: afterPurgeMaintenance } = await request(admin, "GET", "/api/bootstrap");
  assert.ok(afterPurgeMaintenance.hotels.every(item => item.id !== lifecycleId));
  assert.ok(afterPurgeMaintenance.tasks.every(item => item.hotelId !== lifecycleId));
  assert.ok(afterPurgeMaintenance.hotels.some(item => item.id === "hotel-luna"));
  console.log("PASS: hotel archive authorization/CSRF, web/mobile/task/file/report isolation, paused scheduling, restore preservation, stale deletion guards, complete purge and retained owner audit");
  console.log(
    `PASS: ${checks} real HTTP requests verified against the disposable database.`,
  );
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    const closed = once(server, "close");
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    const force = setTimeout(() => {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }, 5000);
    force.unref();
    await closed;
    clearTimeout(force);
  }
  await rm(temporary, { recursive: true, force: true });
}
