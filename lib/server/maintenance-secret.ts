import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function maintenanceSecret(): Promise<string> {
  const configured = process.env.JOBS_SECRET;
  if (configured) {
    if (configured.length < 32)
      throw new Error("JOBS_SECRET must contain at least 32 characters.");
    return configured;
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("Set JOBS_SECRET for the production worker.");
  const folder = path.join(process.cwd(), ".data");
  const file = path.join(folder, "jobs-secret");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(48).toString("base64url");
  try {
    await writeFile(file, secret, { flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
}

export function validMaintenanceToken(
  header: string | null,
  secret: string,
): boolean {
  if (secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
