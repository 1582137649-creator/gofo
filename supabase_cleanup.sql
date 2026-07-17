-- ============================================================
-- BP Dashboard - Supabase 数据清理与 RLS 修复脚本
-- 在 Supabase Dashboard > SQL Editor 中执行
-- ============================================================

-- 1. 清空 dashboard_data 表（TRUNCATE 绕过 RLS）
TRUNCATE TABLE dashboard_data RESTART IDENTITY;

-- 2. 重置自增序列
SELECT setval('dashboard_data_id_seq', 1, false);

-- 3. 确保 RLS 已启用
ALTER TABLE dashboard_data ENABLE ROW LEVEL SECURITY;

-- 4. 删除旧策略（如果存在）
DROP POLICY IF EXISTS "Enable read access for all users" ON dashboard_data;
DROP POLICY IF EXISTS "Allow all read on dashboard_data" ON dashboard_data;
DROP POLICY IF EXISTS "Enable insert for all users" ON dashboard_data;
DROP POLICY IF EXISTS "Enable delete for all users" ON dashboard_data;
DROP POLICY IF EXISTS "Enable update for all users" ON dashboard_data;

-- 5. 创建完整的 RLS 策略（允许 anon 读写）
CREATE POLICY "Enable read for all users" ON dashboard_data
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for all users" ON dashboard_data
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all users" ON dashboard_data
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all users" ON dashboard_data
  FOR DELETE USING (true);

-- 6. 验证
SELECT 'Cleanup complete' AS status;
SELECT COUNT(*) AS total_records FROM dashboard_data;
