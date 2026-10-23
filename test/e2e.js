/**
 * Prueba de extremo a extremo del modelo de ingesta (push):
 *  1. Pre-registra empleados con sus permisos por sede.
 *  2. Levanta la App real (servidor Express) en un puerto de prueba.
 *  3. Simula a los dos equipos empujando eventos por HTTP a sus endpoints
 *     de ingesta — con JSON anidado (formato recomendado), JSON plano y
 *     XML (para probar los tres caminos de interpretación), más un envío
 *     con token incorrecto, uno a una sede inexistente y uno con formato
 *     no reconocido (para validar que no se pierde: queda en revisión).
 *  4. Verifica el reporte semanal (horas, marcaje incompleto, acceso no
 *     autorizado), el Excel y el panel web.
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TEST_DB = path.join(__dirname, "output", "test-acceso.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  const f = TEST_DB + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

process.env.DB_PATH = TEST_DB;
process.env.DEVICE_ZI_MODEL = "DS-K1T321MFWX";
process.env.DEVICE_ZI_TOKEN = "token-zona-industrial-test";
process.env.DEVICE_TIENDA_MODEL = "DS-K1A802MF201";
process.env.DEVICE_TIENDA_TOKEN = "token-tienda-test";
process.env.PANEL_USER = "th-gemca";
process.env.PANEL_PASS = "clave-de-prueba";
process.env.PORT = "4600";

function hoursAgoIso(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

const AUTH_HEADER = { Authorization: "Basic " + Buffer.from(`${process.env.PANEL_USER}:${process.env.PANEL_PASS}`).toString("base64") };

async function main() {
  const { upsertEmployee, listEmployees } = require("../src/employees");
  const { buildWeeklyReport } = require("../src/attendance");
  const { buildWeeklyExcelBuffer } = require("../src/reports");
  const ExcelJS = require("exceljs");
  const app = require("../src/server");

  console.log("== 1) Pre-registrando empleados con permisos por sede ==");
  upsertEmployee({ employeeNo: "1001", name: "Ana Torres", allowedZonaIndustrial: true, allowedTienda: false });
  upsertEmployee({ employeeNo: "1002", name: "Luis Ramírez", allowedZonaIndustrial: true, allowedTienda: false });
  upsertEmployee({ employeeNo: "1003", name: "María Gómez", allowedZonaIndustrial: false, allowedTienda: true });
  upsertEmployee({ employeeNo: "1004", name: "Pedro Salas", allowedZonaIndustrial: false, allowedTienda: true });
  assert.strictEqual(listEmployees().length, 4);

  console.log("== 2) Levantando la App ==");
  const server = app.listen(4600);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:4600";

  async function push(slug, token, payload, { contentType = "application/json" } = {}) {
    const url = `${base}/api/ingest/${slug}?token=${encodeURIComponent(token)}`;
    const body = contentType === "application/json" ? JSON.stringify(payload) : payload;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  console.log("== 3) Simulando los eventos que empujarían los dos equipos ==");

  // Zona Industrial — formato JSON anidado (el recomendado), como lo
  // mandaría el equipo configurado con parameterFormatType=JSON.
  let r = await push("zona-industrial", "token-zona-industrial-test", {
    dateTime: hoursAgoIso(8),
    eventType: "AccessControllerEvent",
    AccessControllerEvent: { employeeNoString: "1001", name: "Ana Torres", attendanceStatus: "checkIn" },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual(r.json.stored, 1);

  r = await push("zona-industrial", "token-zona-industrial-test", {
    dateTime: hoursAgoIso(1),
    eventType: "AccessControllerEvent",
    AccessControllerEvent: { employeeNoString: "1001", name: "Ana Torres", attendanceStatus: "checkOut" },
  });
  assert.strictEqual(r.json.stored, 1);

  // Luis: solo entrada (marcaje incompleto)
  r = await push("zona-industrial", "token-zona-industrial-test", {
    dateTime: hoursAgoIso(7.5),
    AccessControllerEvent: { employeeNoString: "1002", name: "Luis Ramírez", attendanceStatus: "checkIn" },
  });
  assert.strictEqual(r.json.stored, 1);

  // María se marca en Zona Industrial (NO tiene permiso ahí) — formato JSON plano
  r = await push("zona-industrial", "token-zona-industrial-test", {
    time: hoursAgoIso(7.8),
    employeeNoString: "1003",
    name: "María Gómez",
    attendanceStatus: "checkIn",
  });
  assert.strictEqual(r.json.stored, 1);

  // Tienda — María (sí autorizada aquí), formato JSON plano
  r = await push("tienda", "token-tienda-test", {
    time: hoursAgoIso(7),
    employeeNoString: "1003",
    name: "María Gómez",
    attendanceStatus: "checkIn",
  });
  assert.strictEqual(r.json.stored, 1);
  r = await push("tienda", "token-tienda-test", {
    time: hoursAgoIso(0.5),
    employeeNoString: "1003",
    name: "María Gómez",
    attendanceStatus: "checkOut",
  });
  assert.strictEqual(r.json.stored, 1);

  // Pedro — formato XML (equipo configurado con parameterFormatType=XML)
  const xmlIn = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <dateTime>${hoursAgoIso(7.2)}</dateTime>
  <eventType>AccessControllerEvent</eventType>
  <AccessControllerEvent>
    <employeeNoString>1004</employeeNoString>
    <name>Pedro Salas</name>
    <attendanceStatus>checkIn</attendanceStatus>
  </AccessControllerEvent>
</EventNotificationAlert>`;
  r = await push("tienda", "token-tienda-test", xmlIn, { contentType: "application/xml" });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual(r.json.stored, 1, "el evento XML de Pedro (entrada) debió guardarse");

  const xmlOut = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <dateTime>${hoursAgoIso(0.8)}</dateTime>
  <AccessControllerEvent>
    <employeeNoString>1004</employeeNoString>
    <name>Pedro Salas</name>
    <attendanceStatus>checkOut</attendanceStatus>
  </AccessControllerEvent>
</EventNotificationAlert>`;
  r = await push("tienda", "token-tienda-test", xmlOut, { contentType: "application/xml" });
  assert.strictEqual(r.json.stored, 1, "el evento XML de Pedro (salida) debió guardarse");

  console.log("== 4) Validando rechazos y manejo de envíos no reconocidos ==");

  r = await push("zona-industrial", "token-incorrecto", { dateTime: hoursAgoIso(1), AccessControllerEvent: { employeeNoString: "9999" } });
  assert.strictEqual(r.status, 401, "un token incorrecto debe rechazarse");

  const resUnknown = await fetch(`${base}/api/ingest/sede-inventada?token=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.strictEqual(resUnknown.status, 404, "una sede desconocida debe dar 404");

  r = await push("zona-industrial", "token-zona-industrial-test", "esto-no-es-ni-json-ni-xml", { contentType: "text/plain" });
  assert.strictEqual(r.status, 200, "un formato no reconocido no debe hacer fallar al equipo (se guarda para revisión)");
  assert.strictEqual(r.json.stored, 0);

  const resUnparsed = await fetch(`${base}/api/unparsed`, { headers: AUTH_HEADER });
  const unparsedList = await resUnparsed.json();
  assert.ok(unparsedList.length >= 1, "el envío no reconocido debe quedar guardado en unparsed_pushes");

  console.log("== 5) Validando el reporte semanal de asistencia ==");
  const report = buildWeeklyReport(new Date());

  const ana = report.employees.find((e) => e.employeeNo === "1001");
  assert.ok(ana.totalHours > 6 && ana.totalHours < 8, `horas de Ana fuera de rango: ${ana.totalHours}`);
  assert.strictEqual(ana.unauthorizedCount, 0);

  const luis = report.employees.find((e) => e.employeeNo === "1002");
  assert.ok(luis.days.some((d) => d.marcajesIncompletos), "Luis debe tener un día marcado como incompleto");

  const maria = report.employees.find((e) => e.employeeNo === "1003");
  assert.ok(maria.unauthorizedCount >= 1, "María debe tener al menos un acceso no autorizado (se marcó en Zona Industrial)");
  assert.ok(report.anomalies.some((a) => a.employeeNo === "1003" && a.locationCode === "ZONA_INDUSTRIAL"));

  const pedro = report.employees.find((e) => e.employeeNo === "1004");
  assert.ok(pedro.totalHours > 5 && pedro.totalHours < 8, `horas de Pedro (via XML) fuera de rango: ${pedro.totalHours}`);
  assert.strictEqual(pedro.unauthorizedCount, 0);

  console.log("== 6) Generando y validando el reporte Excel ==");
  const { buffer } = await buildWeeklyExcelBuffer(new Date());
  const outPath = path.join(__dirname, "output", "reporte_prueba.xlsx");
  fs.writeFileSync(outPath, Buffer.from(buffer));
  const wbCheck = new ExcelJS.Workbook();
  await wbCheck.xlsx.readFile(outPath);
  assert.deepStrictEqual(wbCheck.worksheets.map((s) => s.name), ["Resumen semanal", "Detalle diario", "Accesos no autorizados"]);
  console.log(`Excel generado correctamente en ${outPath} (${fs.statSync(outPath).size} bytes)`);

  console.log("== 7) Probando que el panel y la API de consulta piden clave de acceso ==");

  const rNoAuth = await fetch(`${base}/api/status`);
  assert.strictEqual(rNoAuth.status, 401, "sin usuario/clave, /api/status debe rechazarse");

  const rBadAuth = await fetch(`${base}/api/status`, { headers: { Authorization: "Basic " + Buffer.from("x:y").toString("base64") } });
  assert.strictEqual(rBadAuth.status, 401, "con clave incorrecta, /api/status debe rechazarse");

  const rHomeNoAuth = await fetch(`${base}/`);
  assert.strictEqual(rHomeNoAuth.status, 401, "sin usuario/clave, el panel debe rechazarse");

  console.log("== 8) Probando el panel web y /api/status con las credenciales correctas ==");
  const rStatus = await fetch(`${base}/api/status`, { headers: AUTH_HEADER });
  const statusJson = await rStatus.json();
  assert.strictEqual(statusJson.length, 2);
  assert.ok(statusJson.every((s) => s.pushConfigured));
  assert.ok(statusJson.every((s) => s.lastEventReceivedAt), "ambas sedes deben mostrar último evento recibido");

  const rHome = await fetch(`${base}/`, { headers: AUTH_HEADER });
  const html = await rHome.text();
  assert.ok(html.includes("Control de Acceso Biométrico"));

  const rExport = await fetch(`${base}/api/attendance/export`, { headers: AUTH_HEADER });
  assert.strictEqual(rExport.status, 200, "con credenciales correctas, la exportación a Excel debe funcionar");

  // Los endpoints de ingesta NO deben pedir usuario/clave del panel — solo su propio token.
  r = await push("zona-industrial", "token-zona-industrial-test", {
    dateTime: hoursAgoIso(0.1),
    AccessControllerEvent: { employeeNoString: "1001", name: "Ana Torres", attendanceStatus: "checkOut" },
  });
  assert.strictEqual(r.status, 200, "la ingesta no debe requerir usuario/clave del panel");

  console.log("\n✅ Todas las verificaciones end-to-end pasaron correctamente.");
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Falló la prueba end-to-end:", err);
  process.exit(1);
});
