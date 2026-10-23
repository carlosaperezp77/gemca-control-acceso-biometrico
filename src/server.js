const express = require("express");
const path = require("path");
const cron = require("node-cron");
const multer = require("multer");

const CONFIG = require("./config");
const { syncAllLocations, statusAllLocations } = require("./sync");
const { listEmployees, upsertEmployee } = require("./employees");
const { buildWeeklyReport } = require("./attendance");
const { buildWeeklyExcelBuffer } = require("./reports");
const { parsePush } = require("./ingest");
const { storeEvents, recordUnparsedPush } = require("./eventsStore");
const { requirePanelAuth } = require("./auth");
const db = require("./db");

const LOCATION_BY_SLUG = Object.fromEntries(
  CONFIG.locations.map((l) => [l.code === "ZONA_INDUSTRIAL" ? "zona-industrial" : "tienda", l])
);

const app = express();

// Parsers de proposito general para el resto de la API (dashboard, etc.)
app.use(express.json({ limit: "200kb" }));

// El panel y la API de consulta piden usuario/clave (PANEL_USER/PANEL_PASS).
// Los endpoints de ingesta (/api/ingest/*) quedan afuera: cada equipo ya se
// identifica con su propio token (ver src/config.js).
app.use((req, res, next) => {
  if (req.path.startsWith("/api/ingest/")) return next();
  return requirePanelAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Parsers específicos para lo que empujan los equipos (ver src/ingest.js):
// JSON ya queda cubierto por express.json() de arriba; esto cubre XML/texto
// plano y multipart/form-data (algunos firmwares envían el evento como un
// campo de texto dentro de un formulario, junto con una foto opcional).
const ingestTextParser = express.text({ type: ["text/xml", "application/xml", "text/plain"], limit: "500kb" });
const ingestMulter = multer({ limits: { fileSize: 5 * 1024 * 1024 } }).any();

app.post("/api/ingest/:locationSlug", ingestTextParser, ingestMulter, (req, res) => {
  const location = LOCATION_BY_SLUG[req.params.locationSlug];
  if (!location) {
    return res.status(404).json({ error: "sede desconocida" });
  }

  const token = req.query.token || req.headers["x-ingest-token"];
  if (!location.ingestToken) {
    return res.status(503).json({ error: `falta configurar DEVICE_${location.code === "ZONA_INDUSTRIAL" ? "ZI" : "TIENDA"}_TOKEN en .env` });
  }
  if (token !== location.ingestToken) {
    return res.status(401).json({ error: "token inválido" });
  }

  const contentType = req.headers["content-type"] || "";
  let bodyForParsing = req.body;

  if (contentType.includes("multipart/form-data")) {
    // Se busca el campo que trae el evento (nombre típico: event_log); si no
    // se reconoce el nombre, se toma el primer campo de texto recibido.
    const fields = req.body || {};
    bodyForParsing = fields.event_log || fields.eventLog || Object.values(fields)[0];
  }

  const { events, parseError } = parsePush(contentType, bodyForParsing);

  if (events.length === 0) {
    recordUnparsedPush({
      locationCode: location.code,
      contentType,
      rawBody: typeof bodyForParsing === "string" ? bodyForParsing : JSON.stringify(bodyForParsing),
      error: parseError || "no se encontraron eventos interpretables en el envío",
    });
    // Se responde 200 para que el equipo no quede reintentando indefinidamente;
    // el envío queda guardado en unparsed_pushes para revisión.
    return res.status(200).json({ ok: true, stored: 0, note: "evento no reconocido; guardado para revisión" });
  }

  const stored = storeEvents(location.code, events, "push");
  res.status(200).json({ ok: true, stored });
});

app.get("/api/status", async (req, res) => {
  try {
    res.json(await statusAllLocations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/unparsed", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const rows = db
    .prepare(`SELECT id, location_code, content_type, substr(raw_body,1,2000) AS raw_body, error, received_at FROM unparsed_pushes ORDER BY id DESC LIMIT ?`)
    .all(limit);
  res.json(rows);
});

app.post("/api/sync", async (req, res) => {
  try {
    res.json(await syncAllLocations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/employees", (req, res) => {
  res.json(listEmployees());
});

app.post("/api/employees", (req, res) => {
  const { employeeNo, name, allowedZonaIndustrial, allowedTienda, active } = req.body || {};
  if (!employeeNo || !name) {
    return res.status(400).json({ error: "employeeNo y name son obligatorios" });
  }
  const emp = upsertEmployee({ employeeNo, name, allowedZonaIndustrial, allowedTienda, active });
  res.json(emp);
});

app.get("/api/attendance/week", (req, res) => {
  const ref = req.query.date ? new Date(req.query.date) : new Date();
  res.json(buildWeeklyReport(ref));
});

app.get("/api/attendance/export", async (req, res) => {
  try {
    const ref = req.query.date ? new Date(req.query.date) : new Date();
    const { buffer, weekLabel } = await buildWeeklyExcelBuffer(ref);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="asistencia_gemca_${weekLabel.replace(/\s+/g, "_")}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startScheduler() {
  const anyPullConfigured = CONFIG.locations.some((l) => l.baseUrl);
  if (!anyPullConfigured) {
    console.log("[sync] modo pull de respaldo no configurado (no hay baseUrl en .env) — la App trabaja solo con lo que empujan los equipos");
    return;
  }
  const minutes = CONFIG.syncIntervalMinutes;
  cron.schedule(`*/${minutes} * * * *`, async () => {
    const results = await syncAllLocations();
    console.log("[sync pull]", results.map((r) => `${r.locationCode}:${r.ok ? r.eventsStored + " nuevos" : "error(" + r.error + ")"}`).join(", "));
  });
  console.log(`[sync] consulta directa (pull) de respaldo cada ${minutes} minuto(s)`);
}

if (require.main === module) {
  app.listen(CONFIG.port, () => {
    console.log(`App Control de Acceso Biométrico - GEMCA escuchando en puerto ${CONFIG.port}`);
    console.log(
      CONFIG.panelUser && CONFIG.panelPass
        ? "  Panel protegido con usuario/clave (PANEL_USER/PANEL_PASS)"
        : "  ADVERTENCIA: panel SIN clave de acceso — configura PANEL_USER/PANEL_PASS antes de desplegar"
    );
    CONFIG.locations.forEach((l) => {
      const slug = l.code === "ZONA_INDUSTRIAL" ? "zona-industrial" : "tienda";
      console.log(`  Endpoint de ingesta ${l.name}: POST /api/ingest/${slug}?token=${l.ingestToken ? "****" : "(falta configurar)"}`);
    });
    startScheduler();
  });
}

module.exports = app;
