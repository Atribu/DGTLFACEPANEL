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
import { randomBytes } from "node:crypto";
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
    const result = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${pathname}: ${JSON.stringify(result)}`,
    );
    checks++;
    return { result, response };
  }
  async function login(email) {
    const { response } = await request(null, "POST", "/api/login", {
      email,
      password: "Demo2026!",
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
  const { result: baseline } = await request(admin, "GET", "/api/bootstrap");
  assert.equal(baseline.hotels.length, 4);
  assert.equal(
    baseline.tasks.length,
    135,
    "Database must be a fresh disposable seed.",
  );
  const { result: scoped } = await request(observer, "GET", "/api/bootstrap");
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
  await request(admin, "PATCH", taskUrl, { action: "update", priority: 10 });
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
