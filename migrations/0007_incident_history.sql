-- Incident history is retained independently of the 30-day heartbeat window.
CREATE INDEX idx_incidents_created ON incidents(created_at DESC,id DESC);
CREATE INDEX idx_incidents_active ON incidents(created_at DESC,id DESC) WHERE status!='resolved';
CREATE INDEX idx_incidents_resolved ON incidents(resolved_at DESC,id DESC) WHERE status='resolved';

ALTER TABLE incidents ADD COLUMN monitor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN monitor_id_snapshot TEXT;
UPDATE incidents SET
  monitor_name=COALESCE((SELECT m.name FROM incident_monitors im JOIN monitors m ON m.id=im.monitor_id WHERE im.incident_id=incidents.id),''),
  monitor_id_snapshot=(SELECT monitor_id FROM incident_monitors WHERE incident_id=incidents.id);

CREATE TABLE incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('opened','updated','resolved','snapshot')),
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_incident_updates_incident_time ON incident_updates(incident_id,timestamp,id);
CREATE INDEX idx_incident_updates_time ON incident_updates(timestamp,incident_id);
CREATE INDEX idx_incident_updates_opened ON incident_updates(incident_id,timestamp,id) WHERE kind='opened';

-- Old releases overwrote diagnostics. Preserve the last known snapshot without
-- presenting it as a reconstructed sequence of earlier state changes.
INSERT INTO incident_updates(incident_id,kind,status,severity,title,description,timestamp)
SELECT id,'snapshot',status,severity,title,description,updated_at FROM incidents;
DELETE FROM status_cache;
