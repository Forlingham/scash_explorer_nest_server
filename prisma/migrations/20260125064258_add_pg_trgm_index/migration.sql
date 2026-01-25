-- Add pg_trgm index for DapData.dataContent fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "DapData_dataContent_trgm_idx" ON "DapData" USING gin ("dataContent" gin_trgm_ops);
