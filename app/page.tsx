import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <Suspense
      fallback={<div className="app-loading">Çalışma alanı yükleniyor…</div>}
    >
      <Workspace />
    </Suspense>
  );
}
