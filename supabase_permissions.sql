-- ============================================================
-- BP Dashboard — 权限管理表（Supabase）
-- 在 Supabase SQL Editor 中执行:
-- https://supabase.com/dashboard/project/fgibhpggdmimxjknqqah/sql/new
-- ============================================================

-- 创建权限配置表
CREATE TABLE IF NOT EXISTS bp_permissions (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_bp_permissions_key ON bp_permissions (key);

-- 插入默认配置（admin_open_ids 为空，region_permissions 6个大区均为空数组）
INSERT INTO bp_permissions (key, value) VALUES
  ('admin_open_ids', '[]'::jsonb),
  ('region_permissions', '{"MS中南大区":[],"WE美西大区":[],"TX德州大区":[],"NE东北大区":[],"GL大湖大区":[],"Ground项目部":[]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS 策略（允许匿名读写，和 dashboard_data 一致）
ALTER TABLE bp_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read on bp_permissions" ON bp_permissions FOR SELECT USING (true);
CREATE POLICY "Allow anon insert on bp_permissions" ON bp_permissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update on bp_permissions" ON bp_permissions FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete on bp_permissions" ON bp_permissions FOR DELETE USING (true);
