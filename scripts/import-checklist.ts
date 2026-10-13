import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import type { Database, Queryable } from "../lib/server/db";
import {
  applyChecklistImport,
  ChecklistImportError,
  HOTEL_NAMES,
  IMPORT_ID,
  planChecklistImport,
} from "../lib/server/checklist-import";
import { sourceTasks } from "../lib/server/template";

class CommandError extends Error {}

function queryable(client: PoolClient): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(`Tek seferlik otel / görev aktarımı

  --catalog   Veritabanına bağlanmadan aktarılacak kaynak içeriği gösterir.
  (seçeneksiz) Canlı kayıtlara dokunmadan aktarım planını gösterir.
  --apply     Doğrulanmış aktarımı tek transaction içinde uygular.

Plan ve aktarım: DATABASE_URL ve IMPORT_ADMIN_EMAIL ortam değişkenleri gerekir.
Aktarım için NODE_ENV=production olmalıdır. Bağlantı adresi/şifre çıktıya yazılmaz.
Şema ve yönetici hesabı önceden oluşturulmuş olmalıdır.

Örnek: node --env-file=.env.local --import tsx scripts/import-checklist.ts
`);
    return;
  }
  if (args.some((arg) => !["--catalog", "--apply"].includes(arg)) || args.length > 1)
    throw new CommandError("Tek bir seçenek kullanın: --catalog, --apply veya seçenek olmadan önizleme.");

  if (args.includes("--catalog")) {
    console.log(JSON.stringify({
      importId: IMPORT_ID,
      source: "docs/gorev-referansi.json",
      hotels: HOTEL_NAMES,
      tasksPerHotel: sourceTasks.length,
      groupsPerHotel: new Set(sourceTasks.map((task) => task.stage.trim())).size,
      totalTasks: HOTEL_NAMES.length * sourceTasks.length,
      tasks: sourceTasks,
    }, null, 2));
    return;
  }

  const apply = args.includes("--apply");
  if (apply && process.env.NODE_ENV !== "production")
    throw new CommandError("Aktarım için NODE_ENV=production ayarlayın; önizleme için --apply seçeneğini kaldırın.");
  if (process.env.ENABLE_DEMO === "true")
    throw new CommandError("Bu aktarım demo modu açıkken çalıştırılamaz.");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new CommandError("DATABASE_URL tanımlı değil. Canlı sunucunun PostgreSQL bağlantısını ortam dosyasında ayarlayın.");
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new CommandError("DATABASE_URL geçerli bir PostgreSQL bağlantı adresi olmalı.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol))
    throw new CommandError("Aktarım yalnızca PostgreSQL bağlantısını destekler.");
  const parsedEmail = z.email().safeParse(process.env.IMPORT_ADMIN_EMAIL?.trim().toLowerCase());
  if (!parsedEmail.success)
    throw new CommandError("IMPORT_ADMIN_EMAIL alanına canlı paneldeki aktif yönetici hesabının e-postasını yazın.");

  // This standalone tool intentionally does not call getDb: a preview must
  // never initialize schemas, seed demo data, or open the local PGlite store.
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const db: Database = {
    storage: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await fn(queryable(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  try {
    const targetLabel = `${target.hostname}:${target.port || "5432"}${target.pathname}`;
    if (apply) {
      const result = await applyChecklistImport(db, parsedEmail.data);
      // A fresh read confirms committed rows. An interrupted/uncertain result
      // can be retried safely using the same fixed import ID.
      const verified = await planChecklistImport(db, parsedEmail.data);
      if (verified.status !== "already_imported")
        throw new CommandError("Aktarım sonrası kayıt doğrulaması tamamlanamadı. Yeniden önizleme çalıştırın.");
      console.log(JSON.stringify({ target: targetLabel, ...result, verifiedAfterCommit: true }, null, 2));
    } else {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        const plan = await planChecklistImport(queryable(client), parsedEmail.data);
        await client.query("COMMIT");
        console.log(JSON.stringify({ target: targetLabel, readOnly: true, plan }, null, 2));
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommandError || error instanceof ChecklistImportError) {
    console.error(error.message);
  } else {
    const code = typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && /^[A-Z0-9_]{2,30}$/.test(error.code)
      ? ` (${error.code})` : "";
    console.error(`Veritabanı bağlantısı veya aktarım tamamlanamadı${code}. Bağlantı ayarlarını ve veritabanı şemasını kontrol edin. Sonucu doğrulamak için önce önizleme çalıştırın.`);
  }
  process.exitCode = 1;
});
