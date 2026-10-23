/**
 * Autenticación simple (HTTP Basic) para el panel y la API de consulta
 * (empleados, asistencia, estado, export). Los endpoints de ingesta
 * (/api/ingest/*) NO usan esto — cada equipo se identifica con su propio
 * token (ver src/config.js, ingestToken).
 *
 * Si PANEL_USER/PANEL_PASS no están configurados en .env, se deja pasar
 * (con una advertencia ya impresa al arrancar) para no bloquear un
 * ambiente de desarrollo local — pero antes de desplegar en la nube deben
 * configurarse.
 */
const crypto = require("crypto");
const CONFIG = require("./config");

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Igual se hace una comparación de longitud fija para no filtrar por
    // tiempo cuánto coincide; al no calzar el largo, siempre es inválido.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requirePanelAuth(req, res, next) {
  if (!CONFIG.panelUser || !CONFIG.panelPass) return next(); // sin configurar: ver advertencia en consola

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
    if (timingSafeEqualStr(user, CONFIG.panelUser) && timingSafeEqualStr(pass, CONFIG.panelPass)) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="App Control de Acceso Biométrico - GEMCA"');
  return res.status(401).send("Acceso restringido");
}

module.exports = { requirePanelAuth };
