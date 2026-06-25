-- ============================================================
-- BP Dashboard — Supabase 数据库初始化
-- 在 Supabase SQL Editor 中执行此脚本
-- https://supabase.com/dashboard/project/fgibhpggdmimxjknqqah/sql/new
-- ============================================================

-- 1. 删除旧表（如果存在）
DROP TABLE IF EXISTS dashboard_data;

-- 2. 创建新表
CREATE TABLE dashboard_data (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period TEXT NOT NULL,
  region TEXT NOT NULL,
  level4 TEXT DEFAULT '',
  level5 TEXT DEFAULT '',
  vendor TEXT NOT NULL,
  payment DOUBLE PRECISION NOT NULL DEFAULT 0,
  hours DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- 3. 索引加速查询
CREATE INDEX idx_dashboard_data_period ON dashboard_data (period);
CREATE INDEX idx_dashboard_data_region ON dashboard_data (region);
CREATE INDEX idx_dashboard_data_vendor ON dashboard_data (vendor);

-- 4. 打开 RLS 但允许所有已认证请求读取
ALTER TABLE dashboard_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read" ON dashboard_data
  FOR SELECT USING (true);

CREATE POLICY "Allow anon insert" ON dashboard_data
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon update" ON dashboard_data
  FOR UPDATE USING (true);

CREATE POLICY "Allow anon delete" ON dashboard_data
  FOR DELETE USING (true);
