import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import Login from "@/components/login";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const demo =
    process.env.NODE_ENV !== "production" &&
    (!process.env.DATABASE_URL || process.env.ENABLE_DEMO === "true");
  return <Login demo={demo} />;
}
