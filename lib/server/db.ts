import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { checkEnvironment, isDemo, isProduction } from "./config";
import { migrateUserSchema } from "./user-schema";
import { migrateAttachmentSchema } from "./attachment-schema";
import { migrateNotificationSchema } from "./notification-schema";
import { migrateRecurrenceSchema } from "./recurrence-schema";

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  storage: "postgres" | "pglite";
  close(): Promise<void>;
}
const globalDb = globalThis as typeof globalThis & {
  dgtlDatabase?: Promise<Database>;
};

function pgQuery(client: Pool | PoolClient): Queryable {
  return {
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await client.query(sql, params)).rows as T[],
  };
}

async function connect(): Promise<Database> {
  checkEnvironment();
  let db: Database;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
    db = {
      ...pgQuery(pool),
      storage: "postgres",
      close: () => pool.end(),
      async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const value = await fn(pgQuery(client));
          await client.query("COMMIT");
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    await mkdir(path.join(process.cwd(), ".data"), {
      recursive: true,
      mode: 0o700,
    });
    const local = new PGlite(path.join(process.cwd(), ".data", "postgres"));
    await local.waitReady;
    db = {
      storage: "pglite",
      close: () => local.close(),
      query: async <T>(sql: string, params: unknown[] = []) =>
        (await local.query<T>(sql, params)).rows,
      transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
        local.transaction((tx) =>
          fn({
            query: async <R>(sql: string, params: unknown[] = []) =>
              (await tx.query<R>(sql, params)).rows,
          }),
        ),
    };
  }
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        "CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL)",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS app_users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, data jsonb NOT NULL)",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS hotels (id text PRIMARY KEY, data jsonb NOT NULL)",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, hotel_id text NOT NULL REFERENCES hotels(id), assignee_id text REFERENCES app_users(id), data jsonb NOT NULL)",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS task_comments (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), data jsonb NOT NULL)",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS activities (id text PRIMARY KEY, hotel_id text NOT NULL REFERENCES hotels(id), task_id text REFERENCES tasks(id), data jsonb NOT NULL)",
      );
      await tx.query(
        "CREATE INDEX IF NOT EXISTS tasks_hotel_idx ON tasks(hotel_id)",
      );
      await tx.query(
        "CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id)",
      );
      await tx.query(
        "CREATE INDEX IF NOT EXISTS comments_task_idx ON task_comments(task_id)",
      );
      await tx.query(
        "CREATE INDEX IF NOT EXISTS activities_hotel_idx ON activities(hotel_id)",
      );
      await migrateUserSchema(tx);
      await migrateAttachmentSchema(tx);
      await migrateNotificationSchema(tx);
      await migrateRecurrenceSchema(tx);
    });
    if (
      isProduction() &&
      (await db.query("SELECT key FROM app_meta WHERE key='demo-seeded-v1'"))
        .length
    ) {
      throw new Error(
        "This database contains demo accounts. Use a separate production database.",
      );
    }
    if (isDemo()) {
      const { seedDemo } = await import("./seed");
      await seedDemo(db);
    }
    return db;
  } catch (error) {
    await db.close().catch(() => {});
    throw error;
  }
}

export function getDb(): Promise<Database> {
  globalDb.dgtlDatabase ??= connect().catch((error) => {
    delete globalDb.dgtlDatabase;
    throw error;
  });
  return globalDb.dgtlDatabase;
}
