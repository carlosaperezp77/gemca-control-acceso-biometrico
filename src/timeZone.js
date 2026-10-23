/**
 * Utilidades de fecha/hora para la zona horaria de GEMCA (America/Caracas,
 * UTC-4 fijo, sin horario de verano). Se implementa con aritmetica manual
 * sobre epoch para no depender de la zona horaria configurada en el
 * servidor donde corra la aplicacion.
 */

const OFFSET_MS = -4 * 60 * 60 * 1000; // UTC-4

function pad(n) {
  return String(n).padStart(2, "0");
}

function shiftToLocal(date) {
  return new Date(date.getTime() + OFFSET_MS);
}

function localDateKey(date) {
  const d = shiftToLocal(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function localTimeLabel(date) {
  const d = shiftToLocal(date);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Devuelve el instante UTC correspondiente al viernes 00:00 hora GEMCA
 * de la semana laboral (viernes-jueves) que contiene `date`. */
function weekStartFor(date) {
  const local = shiftToLocal(date);
  const dow = local.getUTCDay(); // 0=domingo .. 6=sabado, viernes=5
  const diff = (dow - 5 + 7) % 7;
  const localMidnightUtcFields = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const weekStartLocalMidnight = localMidnightUtcFields - diff * 24 * 60 * 60 * 1000;
  return new Date(weekStartLocalMidnight - OFFSET_MS);
}

function weekEndFor(weekStart) {
  return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}

function weekLabel(weekStart) {
  const end = new Date(weekEndFor(weekStart).getTime());
  const s = shiftToLocal(weekStart);
  const e = shiftToLocal(end);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${pad(s.getUTCDate())} ${meses[s.getUTCMonth()]} - ${pad(e.getUTCDate())} ${meses[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

module.exports = { OFFSET_MS, localDateKey, localTimeLabel, weekStartFor, weekEndFor, weekLabel };
