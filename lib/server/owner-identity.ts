import type { User } from "../types";
import type { Queryable } from "./db";
import { isUserActive } from "./user-policies";

// Keep the private address out of client bundles and ordinary user APIs.
export const SYSTEM_OWNER_EMAIL = "oguzkilinc.ant@gmail.com";
export const SYSTEM_OWNER_ALIAS = "Sistem yönetimi";
export const SYSTEM_OWNER_ALIAS_ID = "system-management";

export function isProtectedOwner(user: User): boolean {
  return user.isOwner === true;
}

export function isSystemOwner(user: User): boolean {
  return (
    isProtectedOwner(user) &&
    isUserActive(user) &&
    user.role === "admin" &&
    user.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL
  );
}

export function isAssignableUser(user: User): boolean {
  return isUserActive(user) && user.role !== "observer" && !isProtectedOwner(user);
}

export interface OwnerPrivacyContext {
  owners: ReadonlyMap<string, Pick<User, "name" | "email">>;
}

export async function ownerPrivacyContext(
  db: Queryable,
  viewer: User,
): Promise<OwnerPrivacyContext> {
  if (isSystemOwner(viewer)) return { owners: new Map() };
  const rows = await db.query<{ data: User }>(
    "SELECT data FROM app_users WHERE data->>'isOwner'='true'",
  );
  return { owners: new Map(rows.filter(({ data }) => isProtectedOwner(data)).map(({ data }) => [data.id, data])) };
}

const identityPairs = [
  ["userId", "userName"],
  ["actorId", "actorName"],
  ["targetId", "targetName"],
  ["createdBy", "createdByName"],
  ["assigneeId", "assigneeName"],
  ["managerId", "managerName"],
] as const;

/** Only identity metadata is projected; user-written bodies, titles and files stay intact. */
export function redactOwnerReferences<T>(value: T, context: OwnerPrivacyContext): T {
  if (!context.owners.size || value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => redactOwnerReferences(item, context)) as T;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactOwnerReferences(item, context)]),
  );
  for (const [idKey, nameKey] of identityPairs) {
    if (typeof result[idKey] === "string" && context.owners.has(result[idKey])) {
      result[idKey] = SYSTEM_OWNER_ALIAS_ID;
      if (nameKey in result) result[nameKey] = SYSTEM_OWNER_ALIAS;
    }
  }
  return result as T;
}
