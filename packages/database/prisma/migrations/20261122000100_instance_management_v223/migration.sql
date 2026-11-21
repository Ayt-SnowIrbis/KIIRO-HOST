-- Instance Management v2.2.3: additive lifecycle, access and network foundations.
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'CHANGE_PASSWORD';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'SSH_KEY_ADD';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'SSH_KEY_REMOVE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'SNAPSHOT_RESTORE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'MIGRATE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'RESCUE_ENABLE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'RESCUE_DISABLE';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'FIREWALL_SYNC';
ALTER TYPE "BackupStatus" ADD VALUE IF NOT EXISTS 'DELETING';

CREATE TYPE "SnapshotStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DELETING');
CREATE TYPE "FirewallDirection" AS ENUM ('INGRESS', 'EGRESS');
CREATE TYPE "FirewallAction" AS ENUM ('ALLOW', 'DENY');
CREATE TYPE "FirewallProtocol" AS ENUM ('TCP', 'UDP', 'ICMP', 'ANY');

ALTER TABLE "snapshots"
  ADD COLUMN "status" "SnapshotStatus" NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN "size_bytes" BIGINT,
  ADD COLUMN "error" TEXT,
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

ALTER TABLE "backups"
  ADD COLUMN "storage_provider" VARCHAR(80),
  ADD COLUMN "checksum" VARCHAR(128),
  ADD COLUMN "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "snapshots_instance_id_status_idx" ON "snapshots"("instance_id", "status");
CREATE INDEX "backups_status_expires_at_idx" ON "backups"("status", "expires_at");

CREATE TABLE "instance_ssh_keys" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "public_key" TEXT NOT NULL,
  "fingerprint" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "instance_ssh_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instance_ssh_keys_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "instance_ssh_keys_instance_id_fingerprint_key"
  ON "instance_ssh_keys"("instance_id", "fingerprint");
CREATE INDEX "instance_ssh_keys_instance_id_revoked_at_idx"
  ON "instance_ssh_keys"("instance_id", "revoked_at");

CREATE TABLE "instance_firewall_rules" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "direction" "FirewallDirection" NOT NULL,
  "action" "FirewallAction" NOT NULL DEFAULT 'ALLOW',
  "protocol" "FirewallProtocol" NOT NULL DEFAULT 'TCP',
  "port_start" INTEGER,
  "port_end" INTEGER,
  "cidr" VARCHAR(64) NOT NULL,
  "description" VARCHAR(160),
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "instance_firewall_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instance_firewall_rules_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_firewall_rules_port_range_check"
    CHECK (
      ("protocol" IN ('ICMP', 'ANY') AND "port_start" IS NULL AND "port_end" IS NULL)
      OR
      ("protocol" IN ('TCP', 'UDP') AND "port_start" BETWEEN 1 AND 65535
        AND "port_end" BETWEEN "port_start" AND 65535)
    )
);
CREATE INDEX "instance_firewall_rules_instance_id_direction_priority_idx"
  ON "instance_firewall_rules"("instance_id", "direction", "priority");
