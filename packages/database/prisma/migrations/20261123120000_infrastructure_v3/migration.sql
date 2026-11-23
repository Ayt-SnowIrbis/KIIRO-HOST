ALTER TABLE "ip_pools" ADD COLUMN "node_id" TEXT;
ALTER TABLE "ip_pools" ADD CONSTRAINT "ip_pools_node_id_fkey"
  FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ip_pools_node_id_region_id_idx" ON "ip_pools"("node_id", "region_id");
