import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const isProduction = () => process.env.NODE_ENV === "production";
export const isDemo = () =>
  !isProduction() &&
  (process.env.ENABLE_DEMO === "true" || !process.env.DATABASE_URL);

export function checkEnvironment() {
  if (isProduction() && !process.env.DATABASE_URL)
    throw new Error("Production requires DATABASE_URL.");
  if (
    isProduction() &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  )
    throw new Error(
      "Production requires SESSION_SECRET with at least 32 characters.",
    );
  if (isProduction() && process.env.ENABLE_DEMO === "true")
    throw new Error("Demo accounts are disabled in production.");
}

export async function sessionSecret(): Promise<string> {
  checkEnvironment();
  if (process.env.SESSION_SECRET) {
    if (process.env.SESSION_SECRET.length < 32)
      throw new Error("SESSION_SECRET must contain at least 32 characters.");
    return process.env.SESSION_SECRET;
  }
  const folder = path.join(process.cwd(), ".data");
  const file = path.join(folder, "session-secret");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(48).toString("base64url");
  try {
    await writeFile(file, secret, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
  return secret;
}
