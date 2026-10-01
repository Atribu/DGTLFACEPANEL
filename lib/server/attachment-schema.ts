import type { Queryable } from "./db";
import { MAX_ATTACHMENT_BYTES } from "../attachments";

/** File bytes stay inside the same database and backup as the task records. */
export async function migrateAttachmentSchema(tx: Queryable) {
  await tx.query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id text PRIMARY KEY,
      task_id text NOT NULL REFERENCES tasks(id),
      uploader_id text NOT NULL REFERENCES app_users(id),
      data jsonb NOT NULL,
      content bytea,
      deleted_at timestamptz,
      deleted_by text REFERENCES app_users(id),
      CHECK (octet_length(content) <= ${MAX_ATTACHMENT_BYTES}),
      CHECK (
        (data->>'kind' = 'file' AND content IS NOT NULL) OR
        (data->>'kind' = 'link' AND content IS NULL)
      )
    )
  `);
  await tx.query(
    "CREATE INDEX IF NOT EXISTS attachments_task_active_idx ON task_attachments(task_id) WHERE deleted_at IS NULL",
  );
}
