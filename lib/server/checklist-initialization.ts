import type { User } from "../types";
import type { Database } from "./db";
import { isUserActive } from "./user-policies";
import { isProtectedOwner } from "./owner-identity";
import {
  ChecklistImportError,
  ensureChecklistImport,
  IMPORT_ID,
} from "./checklist-import";

/** Called only after authentication; import failures must not hide the workspace. */
export async function initializeBundledChecklist(
  db: Database,
  user: User,
  demo: boolean,
): Promise<string | undefined> {
  if (demo || user.role !== "admin" || !isUserActive(user)) return;
  try {
    if (isProtectedOwner(user)) {
      const imported = await db.query("SELECT key FROM app_meta WHERE key=$1", [IMPORT_ID]);
      return imported.length ? undefined : "İlk içerik aktarımını standart yönetici hesabıyla tamamlayın.";
    }
    await ensureChecklistImport(db, user.email);
  } catch (error) {
    if (error instanceof ChecklistImportError) return error.message;
    // Database errors can contain connection details or record contents.
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    console.error("Checklist initialization failed", {
      importId: IMPORT_ID,
      code: /^[A-Z0-9]{5}$/.test(code) ? code : "unknown",
    });
    return "Görev listesi şu anda eklenemedi. Lütfen tekrar deneyin.";
  }
}
