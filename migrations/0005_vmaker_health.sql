-- Only migrate the original, uncustomized homepage probe. Preserve historical
-- heartbeats, but do not let them determine the new endpoint's current state.
CREATE TABLE _vmaker_health_migration (id TEXT PRIMARY KEY);
INSERT INTO _vmaker_health_migration
SELECT m.id FROM monitors m LEFT JOIN monitor_settings s ON s.monitor_id=m.id
WHERE m.id='vmaker' AND m.url IN ('https://vmaker.xmtlz.dev','https://vmaker.xmtlz.dev/')
  AND m.method='GET' AND m.expected_status=200 AND m.interval_min=3
  AND COALESCE(s.keyword,'')='' AND COALESCE(s.json_path,'')=''
  AND COALESCE(s.json_expected,'')='';

INSERT OR IGNORE INTO monitors
  (id,name,group_name,url,method,expected_status,interval_min,timeout_ms,order_num,enabled,created_at)
SELECT 'vmaker-homepage','vMaker 首页渲染',group_name,'https://vmaker.xmtlz.dev/',
  'GET',200,30,timeout_ms,(SELECT COALESCE(MAX(order_num),0)+1 FROM monitors),enabled,unixepoch()
FROM monitors WHERE id IN (SELECT id FROM _vmaker_health_migration)
  AND (SELECT COUNT(*) FROM monitors)<20
  AND NOT EXISTS (SELECT 1 FROM monitors WHERE id<>'vmaker'
    AND url IN ('https://vmaker.xmtlz.dev','https://vmaker.xmtlz.dev/'));

-- Carry maintenance over to the new monitor; do not enable a paused service.
INSERT OR IGNORE INTO monitor_settings(monitor_id,maintenance_until)
SELECT 'vmaker-homepage',COALESCE(s.maintenance_until,0)
FROM _vmaker_health_migration t LEFT JOIN monitor_settings s ON s.monitor_id=t.id
WHERE EXISTS (SELECT 1 FROM monitors WHERE id='vmaker-homepage');

INSERT INTO monitor_settings(monitor_id,probe_after_id)
SELECT id,COALESCE((SELECT MAX(id) FROM heartbeats),0) FROM _vmaker_health_migration WHERE true
ON CONFLICT(monitor_id) DO UPDATE SET probe_after_id=excluded.probe_after_id;
UPDATE monitors SET url='https://vmaker.xmtlz.dev/api/health',
  name=CASE WHEN name='vMaker 创意作品集' THEN 'vMaker 存活接口' ELSE name END
WHERE id IN (SELECT id FROM _vmaker_health_migration);
DELETE FROM alert_state WHERE monitor_id IN (SELECT id FROM _vmaker_health_migration);
DELETE FROM alert_outbox WHERE monitor_id IN (SELECT id FROM _vmaker_health_migration);
UPDATE status_revision SET revision=revision+1 WHERE key='status';
DELETE FROM status_cache;
DROP TABLE _vmaker_health_migration;
