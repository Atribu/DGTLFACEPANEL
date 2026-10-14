import { createHash } from "node:crypto";
import type { BootstrapData } from "../types";

/** Authenticate and scope the data before calling; validators are account-specific. */
export function workspaceResponse(data: BootstrapData, ifNoneMatch: string | null) {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    ETag: etag,
  };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  return new Response(body, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
