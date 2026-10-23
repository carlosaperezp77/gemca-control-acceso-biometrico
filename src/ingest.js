/**
 * Interpreta lo que empuja cada lector Hikvision hacia la App.
 *
 * Los equipos de la familia DS-K1T/DS-K1A, al configurarse para "notificar"
 * eventos a un host (ISAPI: Event/notification/httpHosts), envían por cada
 * evento de acceso un cuerpo con esta forma general (en JSON, que es el
 * formato recomendado — ver README):
 *
 *   {
 *     "dateTime": "2026-10-21T08:00:00-04:00",
 *     "eventType": "AccessControllerEvent",
 *     "AccessControllerEvent": {
 *       "employeeNoString": "1001",
 *       "name": "Ana Torres",
 *       "attendanceStatus": "checkIn",
 *       ...
 *     }
 *   }
 *
 * El formato exacto puede variar levemente según el firmware del equipo.
 * Por eso este modulo:
 *   1) intenta interpretar JSON anidado (formato de arriba),
 *   2) si no, intenta JSON "plano" (los mismos campos sueltos, sin anidar),
 *   3) si no, intenta XML equivalente (EventNotificationAlert),
 *   4) si nada de eso calza, NO se descarta el envío: se guarda completo
 *      en la tabla unparsed_pushes para poder revisarlo y ajustar este
 *      intérprete sin haber perdido el dato.
 */

const { XMLParser } = require("fast-xml-parser");

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizeOne(rawEvent, fallbackTime) {
  const inner = rawEvent.AccessControllerEvent || rawEvent.accessControllerEvent || rawEvent;

  const employeeNo = pick(inner, ["employeeNoString", "employeeNo", "cardNo", "employeeId"]);
  const employeeName = pick(inner, ["name", "employeeName"]);
  const attendanceStatus = pick(inner, ["attendanceStatus"]);
  const timeRaw = pick(rawEvent, ["dateTime", "time"]) || pick(inner, ["dateTime", "time"]) || fallbackTime;

  if (!employeeNo || !timeRaw) return null;

  const time = new Date(timeRaw);
  if (Number.isNaN(time.getTime())) return null;

  return {
    employeeNo: String(employeeNo),
    employeeName: employeeName ? String(employeeName) : null,
    time,
    attendanceStatus: attendanceStatus || null,
    raw: rawEvent,
  };
}

function fromJson(obj) {
  // Algunos equipos mandan un solo evento por POST; otros, en modo de
  // "lote", mandan un arreglo. Se contemplan ambos casos.
  const list = Array.isArray(obj) ? obj : Array.isArray(obj.EventNotificationAlert) ? obj.EventNotificationAlert : [obj];
  return list.map((ev) => normalizeOne(ev)).filter(Boolean);
}

function fromXml(xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const root = parsed.EventNotificationAlert || parsed.eventNotificationAlert || parsed;
  return fromJson(root);
}

/**
 * @param {string} contentType
 * @param {string|object} body - string (JSON/XML crudo) u objeto ya parseado por express.json()
 * @returns {{events: Array, parseError: string|null}}
 */
function parsePush(contentType, body) {
  try {
    if (typeof body === "object" && body !== null) {
      return { events: fromJson(body), parseError: null };
    }
    const text = String(body || "").trim();
    if (!text) return { events: [], parseError: "cuerpo vacío" };

    if (text.startsWith("{") || text.startsWith("[")) {
      return { events: fromJson(JSON.parse(text)), parseError: null };
    }
    if (text.startsWith("<")) {
      return { events: fromXml(text), parseError: null };
    }
    return { events: [], parseError: "formato de cuerpo no reconocido (ni JSON ni XML)" };
  } catch (err) {
    return { events: [], parseError: err.message };
  }
}

module.exports = { parsePush };
