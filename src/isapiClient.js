/**
 * Cliente para la interfaz ISAPI de los lectores Hikvision — modo de
 * consulta directa (pull), de respaldo. Solo funciona si el equipo es
 * alcanzable desde donde corre la App (VPN o acceso directo). El modo
 * principal de la App no depende de este archivo (ver src/ingest.js).
 */

const { digestRequest } = require("./digestHttp");

const MAX_RESULTS_PER_PAGE = 30;
const MAX_PAGES_SAFETY = 500;

function toIsoWithOffset(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(off) / 60));
  const offM = pad(Math.abs(off) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offH}:${offM}`
  );
}

async function checkDeviceStatus(location) {
  if (!location.baseUrl) return { online: false, reason: "sin_configurar" };
  try {
    const res = await digestRequest({
      baseUrl: location.baseUrl,
      path: "/ISAPI/System/deviceInfo?format=json",
      method: "GET",
      username: location.username,
      password: location.password,
      timeoutMs: 8000,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) return { online: true, raw: res.body };
    return { online: false, reason: `http_${res.statusCode}` };
  } catch (err) {
    return { online: false, reason: err.message };
  }
}

async function fetchAcsEvents(location, startTime, endTime) {
  if (!location.baseUrl) throw new Error(`El equipo de ${location.name} no tiene baseUrl configurado (.env)`);

  const events = [];
  let searchResultPosition = 0;
  let totalMatches = Infinity;
  let page = 0;

  while (searchResultPosition < totalMatches && page < MAX_PAGES_SAFETY) {
    page += 1;
    const body = {
      AcsEventCond: {
        searchID: `gemca-${Date.now()}-${page}`,
        searchResultPosition,
        maxResults: MAX_RESULTS_PER_PAGE,
        major: 0,
        minor: 0,
        startTime: toIsoWithOffset(startTime),
        endTime: toIsoWithOffset(endTime),
      },
    };

    const res = await digestRequest({
      baseUrl: location.baseUrl,
      path: "/ISAPI/AccessControl/AcsEvent?format=json",
      method: "POST",
      username: location.username,
      password: location.password,
      jsonBody: body,
      timeoutMs: 15000,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Equipo ${location.name} respondio HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch (e) {
      throw new Error(`Respuesta no-JSON del equipo ${location.name}: ${res.body.slice(0, 200)}`);
    }

    const acs = parsed.AcsEvent || parsed;
    totalMatches = acs.totalMatches ?? 0;
    const infoList = acs.InfoList || [];

    for (const item of infoList) {
      if (!item.time) continue;
      events.push({
        employeeNo: item.employeeNoString || item.employeeNo || item.cardNo || null,
        employeeName: item.name || null,
        time: new Date(item.time),
        attendanceStatus: item.attendanceStatus || null,
        raw: item,
      });
    }

    searchResultPosition += infoList.length;
    if (infoList.length === 0) break;
  }

  return events;
}

module.exports = { fetchAcsEvents, checkDeviceStatus };
