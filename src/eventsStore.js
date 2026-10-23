/**
 * Almacena eventos normalizados (ya sea que hayan llegado por push o por
 * consulta directa/pull) aplicando el control de permisos por sede.
 * Es el punto único donde los eventos entran a la base de datos.
 */
const db = require("./db");
const { ensureEmployee, isAuthorizedAt } = require("./employees");

const insertEventStmt = db.prepare(`
  INSERT OR IGNORE INTO events
    (location_code, employee_no, employee_name, event_time, attendance_status, source, authorized, raw_json)
  VALUES
    (@locationCode, @employeeNo, @employeeName, @eventTime, @attendanceStatus, @source, @authorized, @rawJson)
`);

const upsertSyncStateStmt = db.prepare(`
  INSERT INTO sync_state (location_code, last_event_received_at, last_sync_ok, last_sync_error, last_sync_at, last_synced_until)
  VALUES (@locationCode, @lastEventReceivedAt, @lastSyncOk, @lastSyncError, datetime('now'), @lastSyncedUntil)
  ON CONFLICT(location_code) DO UPDATE SET
    last_event_received_at = COALESCE(excluded.last_event_received_at, sync_state.last_event_received_at),
    last_sync_ok = excluded.last_sync_ok,
    last_sync_error = excluded.last_sync_error,
    last_sync_at = excluded.last_sync_at,
    last_synced_until = COALESCE(excluded.last_synced_until, sync_state.last_synced_until)
`);

const unparsedPushStmt = db.prepare(`
  INSERT INTO unparsed_pushes (location_code, content_type, raw_body, error)
  VALUES (@locationCode, @contentType, @rawBody, @error)
`);

function getSyncState(locationCode) {
  return db.prepare(`SELECT * FROM sync_state WHERE location_code = ?`).get(locationCode);
}

/**
 * Guarda una tanda de eventos normalizados para una sede.
 * events: [{ employeeNo, employeeName, time (Date), attendanceStatus, raw }]
 */
function storeEvents(locationCode, events, source) {
  let stored = 0;
  // node:sqlite no tiene el helper db.transaction(...) de better-sqlite3;
  // se envuelve manualmente con BEGIN/COMMIT (y ROLLBACK si algo falla).
  db.exec("BEGIN");
  try {
    for (const ev of events) {
      if (!ev.employeeNo || !ev.time || Number.isNaN(ev.time.getTime())) continue;
      const employee = ensureEmployee(ev.employeeNo, ev.employeeName, locationCode);
      const authorized = isAuthorizedAt(employee, locationCode);
      const info = insertEventStmt.run({
        locationCode,
        employeeNo: ev.employeeNo,
        employeeName: ev.employeeName || employee.name,
        eventTime: ev.time.toISOString(),
        attendanceStatus: ev.attendanceStatus || null,
        source,
        authorized: authorized ? 1 : 0,
        rawJson: JSON.stringify(ev.raw || {}),
      });
      if (info.changes > 0) stored += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  upsertSyncStateStmt.run({
    locationCode,
    lastEventReceivedAt: events.length ? new Date().toISOString() : null,
    lastSyncOk: 1,
    lastSyncError: null,
    lastSyncedUntil: null,
  });

  return stored;
}

function recordSyncError(locationCode, errorMessage) {
  upsertSyncStateStmt.run({
    locationCode,
    lastEventReceivedAt: null,
    lastSyncOk: 0,
    lastSyncError: errorMessage,
    lastSyncedUntil: null,
  });
}

function recordUnparsedPush({ locationCode, contentType, rawBody, error }) {
  unparsedPushStmt.run({
    locationCode: locationCode || null,
    contentType: contentType || null,
    rawBody: typeof rawBody === "string" ? rawBody.slice(0, 20000) : JSON.stringify(rawBody).slice(0, 20000),
    error: error || null,
  });
}

function countUnparsedPushes() {
  return db.prepare(`SELECT COUNT(*) AS n FROM unparsed_pushes`).get().n;
}

module.exports = { storeEvents, recordSyncError, recordUnparsedPush, countUnparsedPushes, getSyncState };
