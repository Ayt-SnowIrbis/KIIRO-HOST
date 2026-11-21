ALTER TABLE "support_tickets"
  ADD COLUMN "category" VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "support_messages"
  ADD COLUMN "internal_note" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "support_tickets_status_priority_updated_at_idx" ON "support_tickets"("status","priority","updated_at");
CREATE INDEX "support_tickets_assigned_to_id_idx" ON "support_tickets"("assigned_to_id");
CREATE INDEX "support_messages_ticket_id_internal_note_created_at_idx" ON "support_messages"("ticket_id","internal_note","created_at");

CREATE TABLE "support_notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "href" VARCHAR(512) NOT NULL,
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_notifications_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "support_notifications_user_id_read_at_created_at_idx"
  ON "support_notifications"("user_id","read_at","created_at");
