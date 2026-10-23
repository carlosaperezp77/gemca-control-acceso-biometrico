const db = require("./db");
const CONFIG = require("./config");
const { localDateKey, localTimeLabel, weekStartFor, weekEndFor, weekLabel } = require("./timeZone");

const LOCATION_NAME_BY_CODE = Object.fromEntries(CONFIG.locations.map((l) => [l.code, l.name]));

const IN_STATUSES = new Set(["checkIn", "breakIn", "overtimeIn"]);
const OUT_STATUSES = new Set(["checkOut", "breakOut", "overtimeOut"]);

function getEventsBetween(startDate, endDate) {
  return db
    .prepare(
      `SELECT * FROM events WHERE event_time >= ? AND event_time <= ? ORDER BY employee_no, event_time`
    )
    .all(startDate.toISOString(), endDate.toISOString());
}

/**
 * A partir de los eventos de un dia para un empleado, determina la hora
 * de entrada y de salida. Si el equipo reporto attendanceStatus
 * (checkIn/checkOut), se usa eso; si no, se asume que el primer evento
 * del dia es la entrada y el ultimo es la salida.
 */
function resolveInOut(dayEvents) {
  const withStatus = dayEvents.filter((e) => e.attendance_status);
  let inEvent, outEvent;

  if (withStatus.length > 0) {
    inEvent = withStatus.find((e) => IN_STATUSES.has(e.attendance_status)) || dayEvents[0];
    outEvent = [...withStatus].reverse().find((e) => OUT_STATUSES.has(e.attendance_status)) || dayEvents[dayEvents.length - 1];
  } else {
    inEvent = dayEvents[0];
    outEvent = dayEvents[dayEvents.length - 1];
  }

  if (inEvent === outEvent && dayEvents.length === 1) {
    outEvent = null; // un solo marcaje: no se puede calcular horas
  }

  return { inEvent, outEvent };
}

/**
 * Construye el reporte de asistencia semanal (semana GEMCA: viernes a jueves)
 * para todos los empleados con eventos en ese rango.
 */
function buildWeeklyReport(referenceDate = new Date()) {
  const weekStart = weekStartFor(referenceDate);
  const weekEnd = weekEndFor(weekStart);
  const events = getEventsBetween(weekStart, weekEnd);

  const byEmployee = new Map();
  for (const ev of events) {
    if (!byEmployee.has(ev.employee_no)) {
      byEmployee.set(ev.employee_no, { employeeNo: ev.employee_no, name: ev.employee_name, byDay: new Map() });
    }
    const emp = byEmployee.get(ev.employee_no);
    const dayKey = localDateKey(new Date(ev.event_time));
    if (!emp.byDay.has(dayKey)) emp.byDay.set(dayKey, []);
    emp.byDay.get(dayKey).push(ev);
  }

  const employees = [];
  const anomalies = [];

  for (const emp of byEmployee.values()) {
    const days = [];
    let totalHours = 0;
    const locationsUsed = new Set();
    let unauthorizedCount = 0;

    for (const [dayKey, dayEvents] of [...emp.byDay.entries()].sort()) {
      dayEvents.sort((a, b) => a.event_time.localeCompare(b.event_time));
      const { inEvent, outEvent } = resolveInOut(dayEvents);
      let hours = 0;
      if (inEvent && outEvent && outEvent.event_time > inEvent.event_time) {
        hours = (new Date(outEvent.event_time) - new Date(inEvent.event_time)) / 3600000;
      }
      hours = Math.round(hours * 100) / 100;
      totalHours += hours;

      const dayLocations = [...new Set(dayEvents.map((e) => LOCATION_NAME_BY_CODE[e.location_code] || e.location_code))];
      dayLocations.forEach((l) => locationsUsed.add(l));

      const dayUnauthorized = dayEvents.filter((e) => !e.authorized);
      unauthorizedCount += dayUnauthorized.length;
      for (const u of dayUnauthorized) {
        anomalies.push({
          employeeNo: emp.employeeNo,
          employeeName: emp.name,
          locationCode: u.location_code,
          locationName: LOCATION_NAME_BY_CODE[u.location_code] || u.location_code,
          time: u.event_time,
        });
      }

      days.push({
        dateKey: dayKey,
        in: inEvent ? localTimeLabel(new Date(inEvent.event_time)) : null,
        out: outEvent ? localTimeLabel(new Date(outEvent.event_time)) : null,
        hours,
        locations: dayLocations,
        marcajesIncompletos: !outEvent,
        eventos: dayEvents.length,
      });
    }

    totalHours = Math.round(totalHours * 100) / 100;

    employees.push({
      employeeNo: emp.employeeNo,
      name: emp.name,
      days,
      totalHours,
      locationsUsed: [...locationsUsed],
      unauthorizedCount,
    });
  }

  employees.sort((a, b) => a.name.localeCompare(b.name));

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    weekLabel: weekLabel(weekStart),
    employees,
    anomalies,
  };
}

module.exports = { buildWeeklyReport };
