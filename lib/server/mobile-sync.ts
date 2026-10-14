import { createHash } from "node:crypto";
import { z } from "zod";
import type { BootstrapData, Task } from "../types";
import { commentSchema, idSchema, patchTaskSchema } from "./validation";

export const mobilePatchSchema = z
  .object({
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
    payload: patchTaskSchema,
  })
  .strict();

export const mobileCommentSchema = commentSchema
  .extend({ requestId: idSchema })
  .strict();

// PostgreSQL jsonb can reorder object keys. Versions must agree before and after
// a database round trip, while retaining meaningful array order (checklists).
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function taskVersion(task: Task): string {
  return digest(task);
}

export function mobileCommentId(
  userId: string,
  taskId: string,
  requestId: string,
): string {
  return digest(["mobile-comment-v1", userId, taskId, requestId]);
}

export function mobileBootstrapData(data: BootstrapData) {
  // Input comes from the existing authorization-scoped repository bootstrap.
  // Never hash or expose rows outside that result.
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    user: data.user,
    users: byId(data.users),
    hotels: byId(data.hotels),
    tasks: byId(data.tasks),
    comments: byId(data.comments),
    demo: data.demo,
    ...(data.checklistImportWarning
      ? { checklistImportWarning: data.checklistImportWarning }
      : {}),
    taskVersions: Object.fromEntries(
      data.tasks.map((task) => [task.id, taskVersion(task)]),
    ),
  };
}

/** Only call after authenticating and fetching the current user's scoped data. */
export function mobileBootstrapResponse(
  data: BootstrapData,
  ifNoneMatch: string | null,
): Response {
  const payload = mobileBootstrapData(data);
  const etag = `"${digest(payload)}"`;
  const headers = {
    "Cache-Control": "private, no-cache",
    Vary: "Cookie",
    ETag: etag,
  };
  const matches = ifNoneMatch
    ?.split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
  return matches
    ? new Response(null, { status: 304, headers })
    : Response.json(payload, { headers });
}
