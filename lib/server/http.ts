import { ZodError, type ZodType } from "zod";
import { getCurrentUser } from "./auth";
import type { User } from "../types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: `Geçersiz bilgi: ${error.issues[0]?.path.join(".") || "istek"}. ${error.issues[0]?.message || ""}`,
        },
        400,
      );
    console.error("API error:", error);
    return json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500);
  }
}
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Devam etmek için giriş yapın.");
  return user;
}
export function requireAdmin(user: User) {
  if (user.role !== "admin" || user.active === false)
    throw new HttpError(403, "Bu işlem için yönetici yetkisi gerekiyor.");
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next's development server can normalize request.url to localhost even when
  // the browser used 127.0.0.1. Host preserves the browser's actual target.
  const requestUrl = new URL(request.url);
  const expected =
    process.env.APP_ORIGIN ||
    `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (!origin || origin !== new URL(expected).origin)
    throw new HttpError(403, "İstek kaynağı doğrulanamadı.");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new HttpError(403, "Bu kaynaktan işlem yapılamaz.");
}
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(400, "JSON içerik gerekiyor.");
  if (Number(request.headers.get("content-length") || 0) > 32768)
    throw new HttpError(400, "İstek çok büyük.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "İstek içeriği eksik.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new HttpError(400, "İstek çok büyük.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Geçerli JSON gönderin.");
  }
  return schema.parse(value);
}
