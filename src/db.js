// Se usa el módulo de SQLite incluido en el propio Node.js (node:sqlite) en
// vez de "better-sqlite3": así no hace falta compilar nada al instalar
// (ni en Windows ni al desplegar), porque no depende de un módulo nativo.
// Requiere Node.js 22.5 o superior (ver "engines" en package.json).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");

fs.mkdirSync(path.dirname(CONFIG.dbPath), { recursive: true });
const db = new DatabaseSync(CONFIG.dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  employee_no TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_zona_industrial INTEGER NOT NULL DEFAULT 1,
  allowed_tienda INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_code TEXT NOT NULL,
  employee_no TEXT,
  employee_name TEXT,
  event_time TEXT NOT NULL, -- ISO 8601 UTC
  attendance_status TEXT,
  source TEXT NOT NULL DEFAULT 'push', -- push | pull
  authorized INTEGER NOT NULL DEFAULT 1,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_code, employee_no, event_time)
);

CREATE INDEX IF NOT EXISTS idx_events_time ON events(event_time);
CREATE INDEX IF NOT EXISTS idx_events_employee ON events(employee_no);

-- Cualquier envío recibido de un equipo que no se pudo interpretar
-- (formato distinto al esperado) se guarda aquí completo, para poder
-- revisarlo y ajustar el interprete sin perder la información.
CREATE TABLE IF NOT EXISTS unparsed_pushes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_code TEXT,
  content_type TEXT,
  raw_body TEXT,
  error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
  location_code TEXT PRIMARY KEY,
  last_event_received_at TEXT, -- ultima vez que llegó un evento (push) o se sincronizó (pull)
  last_sync_ok INTEGER,
  last_sync_error TEXT,
  last_sync_at TEXT,
  -- usado solo por el modo pull de respaldo:
  last_synced_until TEXT
);
`);

module.exports = db;
