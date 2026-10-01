import type { Queryable } from "./db";

export async function migrateRecurrenceSchema(tx: Queryable) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS recurrence_rules (id text PRIMARY KEY, hotel_id text NOT NULL REFERENCES hotels(id), assignee_id text NOT NULL REFERENCES app_users(id), active boolean NOT NULL, next_run_on date NOT NULL, data jsonb NOT NULL)",
  );
  await tx.query(
    "CREATE INDEX IF NOT EXISTS recurrence_due_idx ON recurrence_rules(active,next_run_on)",
  );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS recurrence_occurrences (rule_id text NOT NULL REFERENCES recurrence_rules(id), scheduled_on date NOT NULL, task_id text UNIQUE REFERENCES tasks(id), PRIMARY KEY(rule_id,scheduled_on))",
  );
}
