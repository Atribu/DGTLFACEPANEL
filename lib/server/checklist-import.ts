import { createHash } from "node:crypto";
import { z } from "zod";
import type { Activity, Hotel, Task, User } from "../types";
import type { Database, Queryable } from "./db";
import { buildTemplateTasks, sourceTasks } from "./template";

export class ChecklistImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChecklistImportError";
  }
}

export const IMPORT_ID = "hotel-checklist-2026-10-v1";
export const HOTEL_NAMES = [
  "Miramare Beach",
  "Miramare Quenn",
  "Port Nature Luxury Resort",
  "SY Hotels",
  "Mi Hotel",
  "Teona Hotel",
] as const;

export interface ImportHotelPlan {
  id: string;
  name: string;
  action: "create" | "reuse" | "already_imported";
  taskCount: number;
}
export interface ImportPlan {
  importId: string;
  sourceHash: string;
  admin: Pick<User, "id" | "name" | "email">;
  status: "ready" | "already_imported";
  hotels: ImportHotelPlan[];
  totalTasks: number;
  tasksToCreate: number;
}
export interface ImportResult {
  status: "imported" | "already_imported";
  plan: ImportPlan;
  createdHotels: number;
  reusedHotels: number;
  createdTasks: number;
}

const markerSchema = z
  .object({
    importId: z.literal(IMPORT_ID),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: z.iso.datetime(),
    hotels: z
      .array(z.object({ id: z.string().min(1), name: z.string() }).strict())
      .length(HOTEL_NAMES.length),
  })
  .strict();
type Marker = z.infer<typeof markerSchema>;

const normalizeName = (name: string) =>
  name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
const stableId = (...parts: Array<string | number>) => {
  const hash = createHash("sha256")
    .update(JSON.stringify([IMPORT_ID, ...parts]))
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
function sourceHash() {
  if (
    sourceTasks.length !== 93 ||
    new Set(sourceTasks.map((item) => item.sourceRow)).size !== 93
  )
    throw new ChecklistImportError(
      "Aktarım kaynağı 93 benzersiz kaynak satırından oluşmalı.",
    );
  return createHash("sha256")
    .update(JSON.stringify({ hotels: HOTEL_NAMES, tasks: sourceTasks }))
    .digest("hex");
}
function templateTasks(hotelId: string, stamp: string): Task[] {
  return buildTemplateTasks(hotelId, null, stamp).map((task, index) => ({
    ...task,
    id: stableId("task", hotelId, sourceTasks[index].sourceRow),
    checklist: task.checklist.map((item, criterionIndex) => ({
      ...item,
      id: stableId(
        "criterion",
        hotelId,
        sourceTasks[index].sourceRow,
        criterionIndex,
      ),
    })),
  }));
}
async function findAdmin(db: Queryable, adminEmail: string, lock = false) {
  const email = adminEmail.trim().toLowerCase();
  if (!z.email().safeParse(email).success)
    throw new ChecklistImportError(
      "Geçerli bir yönetici e-posta adresi gerekiyor.",
    );
  const rows = await db.query<{ id: string; email: string; data: User }>(
    `SELECT id,email,data FROM app_users WHERE LOWER(email)=$1${lock ? " FOR UPDATE" : ""}`,
    [email],
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.data.id !== row.id ||
    row.data.role !== "admin" ||
    row.data.active === false
  )
    throw new ChecklistImportError(
      "Aktarım için mevcut, aktif bir yönetici hesabı gerekiyor.",
    );
  if (row.data.email.trim().toLowerCase() !== email)
    throw new ChecklistImportError(
      "Yönetici hesabının e-posta kaydı tutarsız.",
    );
  return row.data;
}
async function verifyImported(db: Queryable, marker: Marker) {
  const ids = marker.hotels.map((hotel) => hotel.id);
  const hotels = await db.query<{ id: string; data: Hotel }>(
    "SELECT id,data FROM hotels WHERE id=ANY($1::text[])",
    [ids],
  );
  if (
    hotels.length !== HOTEL_NAMES.length ||
    hotels.some((hotel) => hotel.data.id !== hotel.id)
  )
    throw new ChecklistImportError(
      "Aktarım kaydı var ancak altı otel doğrulanamadı; hiçbir veri değiştirilmedi.",
    );
  const tasks = await db.query<{ id: string; hotel_id: string; data: Task }>(
    "SELECT id,hotel_id,data FROM tasks WHERE hotel_id=ANY($1::text[])",
    [ids],
  );
  const actual = new Map(tasks.map((task) => [task.id, task]));
  for (const hotel of marker.hotels) {
    const expected = templateTasks(hotel.id, marker.completedAt);
    for (const task of expected) {
      const row = actual.get(task.id);
      if (
        !row ||
        row.hotel_id !== hotel.id ||
        row.data.id !== task.id ||
        row.data.hotelId !== hotel.id ||
        row.data.code !== task.code
      )
        throw new ChecklistImportError(
          "Aktarım görevlerinin kaynak satırı/otel eşleşmesi doğrulanamadı.",
        );
    }
  }
}

/** SELECT-only preview; callers can run this in a read-only database transaction. */
export async function planChecklistImport(
  db: Queryable,
  adminEmail: string,
): Promise<ImportPlan> {
  const admin = await findAdmin(db, adminEmail);
  const hash = sourceHash();
  const metadata = await db.query<{ key: string; value: string }>(
    "SELECT key,value FROM app_meta WHERE key=ANY($1::text[])",
    [["demo-seeded-v1", IMPORT_ID]],
  );
  if (metadata.some((row) => row.key === "demo-seeded-v1"))
    throw new ChecklistImportError(
      "Demo veritabanına canlı içerik aktarımı yapılamaz.",
    );
  const stored = metadata.find((row) => row.key === IMPORT_ID);
  const base = {
    importId: IMPORT_ID,
    sourceHash: hash,
    admin: { id: admin.id, name: admin.name, email: admin.email },
    totalTasks: 93 * HOTEL_NAMES.length,
  };
  if (stored) {
    let marker: Marker;
    try {
      marker = markerSchema.parse(JSON.parse(stored.value));
    } catch {
      throw new ChecklistImportError(
        "Aktarım tamamlama kaydı geçersiz; hiçbir veri değiştirilmedi.",
      );
    }
    if (
      marker.sourceHash !== hash ||
      new Set(marker.hotels.map((hotel) => hotel.id)).size !==
        HOTEL_NAMES.length ||
      marker.hotels.some((hotel, index) => hotel.name !== HOTEL_NAMES[index])
    )
      throw new ChecklistImportError(
        "Aktarım tamamlama kaydı mevcut kaynakla eşleşmiyor.",
      );
    await verifyImported(db, marker);
    return {
      ...base,
      status: "already_imported",
      tasksToCreate: 0,
      hotels: marker.hotels.map((hotel) => ({
        ...hotel,
        action: "already_imported",
        taskCount: 93,
      })),
    };
  }
  const current = await db.query<{ id: string; data: Hotel }>(
    "SELECT id,data FROM hotels",
  );
  const hotels: ImportHotelPlan[] = HOTEL_NAMES.map((name) => {
    const matches = current.filter(
      (row) => normalizeName(row.data.name) === normalizeName(name),
    );
    if (matches.length > 1)
      throw new ChecklistImportError(
        `Aynı ada sahip birden fazla otel var: ${name}.`,
      );
    const match = matches[0];
    if (match && match.data.id !== match.id)
      throw new ChecklistImportError(`Otel kimliği tutarsız: ${name}.`);
    const id = match?.id ?? stableId("hotel", normalizeName(name));
    if (!match && current.some((row) => row.id === id))
      throw new ChecklistImportError(
        `Aktarım otel kimliği başka bir kayıtla çakışıyor: ${name}.`,
      );
    return { id, name, action: match ? "reuse" : "create", taskCount: 93 };
  });
  const existingTasks = await db.query<{ id: string }>(
    "SELECT id FROM tasks WHERE hotel_id=ANY($1::text[])",
    [hotels.map((hotel) => hotel.id)],
  );
  if (existingTasks.length)
    throw new ChecklistImportError(
      "Eşleşen otellerden en az birinde görev var. Mevcut işler korunarak aktarım durduruldu.",
    );
  const generatedIds = hotels.flatMap((hotel) =>
    templateTasks(hotel.id, "2000-01-01T00:00:00.000Z").map((task) => task.id),
  );
  const collisions = await db.query<{ id: string }>(
    "SELECT id FROM tasks WHERE id=ANY($1::text[])",
    [generatedIds],
  );
  if (collisions.length)
    throw new ChecklistImportError(
      "Aktarım görev kimliği mevcut bir kayıtla çakışıyor.",
    );
  return { ...base, status: "ready", hotels, tasksToCreate: base.totalTasks };
}

/** Atomic and repeatable; never connects to a database or provisions users itself. */
export async function applyChecklistImport(
  db: Database,
  adminEmail: string,
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    await findAdmin(tx, adminEmail, true);
    // Lock tables before checking names/counts so another session cannot fill an empty hotel mid-import.
    await tx.query("LOCK TABLE hotels,tasks IN SHARE ROW EXCLUSIVE MODE");
    return importInTransaction(tx, adminEmail);
  });
}

async function hasCompletionMarker(db: Queryable): Promise<boolean> {
  const rows = await db.query("SELECT key FROM app_meta WHERE key=$1", [
    IMPORT_ID,
  ]);
  return rows.length > 0;
}

/** Runtime initialization trusts the completion marker, preserving all subsequent team edits. */
export async function ensureChecklistImport(
  db: Database,
  adminEmail: string,
): Promise<void> {
  if (await hasCompletionMarker(db)) return;
  await db.transaction(async (tx) => {
    await tx.query("SET LOCAL lock_timeout='5s'");
    await findAdmin(tx, adminEmail, true);
    await tx.query("LOCK TABLE hotels,tasks IN SHARE ROW EXCLUSIVE MODE");
    // Another instance may have completed the import while this request waited.
    if (await hasCompletionMarker(tx)) return;
    await importInTransaction(tx, adminEmail);
  });
}

async function importInTransaction(
  tx: Queryable,
  adminEmail: string,
): Promise<ImportResult> {
  const plan = await planChecklistImport(tx, adminEmail);
  if (plan.status === "already_imported")
    return {
      status: "already_imported",
      plan,
      createdHotels: 0,
      reusedHotels: 0,
      createdTasks: 0,
    };
  const stamp = new Date().toISOString();
  for (const item of plan.hotels) {
    if (item.action === "create") {
      const hotel: Hotel = {
        id: item.id,
        name: item.name,
        location: "",
        services: [],
        managerId: plan.admin.id,
        contactName: "",
        contactEmail: "",
        stage: "onboarding",
        color: "#8b72ed",
        createdAt: stamp,
      };
      await tx.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
        hotel.id,
        JSON.stringify(hotel),
      ]);
    }
    await tx.query(
      `INSERT INTO tasks(id,hotel_id,assignee_id,data)
       SELECT value->>'id',value->>'hotelId',value->>'assigneeId',value
       FROM jsonb_array_elements($1::jsonb) AS imported(value)`,
      [JSON.stringify(templateTasks(item.id, stamp))],
    );
    const activity: Activity = {
      id: stableId("activity", item.id),
      hotelId: item.id,
      taskId: null,
      userId: plan.admin.id,
      userName: plan.admin.name,
      message: `Tek seferlik içerik aktarımıyla kaynak şablondan 93 görev eklendi (${IMPORT_ID}).`,
      createdAt: stamp,
    };
    await tx.query(
      "INSERT INTO activities(id,hotel_id,task_id,data) VALUES ($1,$2,$3,$4::jsonb)",
      [activity.id, item.id, null, JSON.stringify(activity)],
    );
  }
  const marker: Marker = {
    importId: IMPORT_ID,
    sourceHash: plan.sourceHash,
    completedAt: stamp,
    hotels: plan.hotels.map(({ id, name }) => ({ id, name })),
  };
  await verifyImported(tx, marker);
  await tx.query("INSERT INTO app_meta(key,value) VALUES ($1,$2)", [
    IMPORT_ID,
    JSON.stringify(marker),
  ]);
  return {
    status: "imported",
    plan,
    createdHotels: plan.hotels.filter((hotel) => hotel.action === "create")
      .length,
    reusedHotels: plan.hotels.filter((hotel) => hotel.action === "reuse")
      .length,
    createdTasks: plan.totalTasks,
  };
}
