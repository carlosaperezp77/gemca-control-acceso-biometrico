require("dotenv").config();
const path = require("path");
const crypto = require("crypto");

/**
 * Configuracion de las dos sedes/equipos de GEMCA.
 *
 * Arquitectura: los equipos están en redes distintas (una por sede), así
 * que la App NO intenta entrar a buscarlos — cada equipo es el que envía
 * ("empuja") sus eventos de acceso a la App por internet, a un endpoint
 * propio por sede, protegido con un token. Así solo se necesita que cada
 * sede tenga salida normal a internet; no hace falta IP pública, VPN ni
 * redirección de puertos en ninguna de las dos.
 *
 * ingestToken: token secreto que identifica a cada equipo al empujar sus
 * datos (ver README, sección "Configurar el envío de eventos en cada equipo").
 *
 * Opcionalmente, si en el futuro se habilita una VPN o acceso directo a un
 * equipo, también se puede usar el modo de consulta directa (pull) con
 * baseUrl/usuario/contraseña — queda disponible pero no es necesario.
 */
const LOCATIONS = [
  {
    code: "ZONA_INDUSTRIAL",
    name: "Zona Industrial",
    model: process.env.DEVICE_ZI_MODEL || "DS-K1T321MFWX",
    ingestToken: process.env.DEVICE_ZI_TOKEN || "",
    // Opcional (modo pull de respaldo, solo si hay VPN/acceso directo):
    baseUrl: process.env.DEVICE_ZI_BASE_URL || "",
    username: process.env.DEVICE_ZI_USER || "",
    password: process.env.DEVICE_ZI_PASS || "",
  },
  {
    code: "TIENDA",
    name: "Tienda (Sede Principal)",
    model: process.env.DEVICE_TIENDA_MODEL || "DS-K1A802MF201",
    ingestToken: process.env.DEVICE_TIENDA_TOKEN || "",
    baseUrl: process.env.DEVICE_TIENDA_BASE_URL || "",
    username: process.env.DEVICE_TIENDA_USER || "",
    password: process.env.DEVICE_TIENDA_PASS || "",
  },
];

function warnIfTokenMissing(loc) {
  if (!loc.ingestToken) {
    // No se detiene la app: solo se avisa, para que el endpoint de esa
    // sede quede deshabilitado hasta que se configure su token en .env.
    console.warn(
      `[config] ${loc.name}: falta DEVICE_${loc.code === "ZONA_INDUSTRIAL" ? "ZI" : "TIENDA"}_TOKEN en .env — ` +
        `el endpoint de ingesta de esta sede no aceptará eventos hasta configurarlo.`
    );
  }
}
LOCATIONS.forEach(warnIfTokenMissing);

const CONFIG = {
  port: parseInt(process.env.PORT || "3000", 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, "..", "data", "acceso.db"),
  syncIntervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || "5", 10),
  // Estructura de semana de nomina de GEMCA: viernes a jueves.
  weekStartDay: 5, // 0=domingo ... 5=viernes
  locations: LOCATIONS,
  // Usuario/clave para entrar al panel y a la API (todo menos los endpoints
  // de ingesta, que ya usan su propio token por equipo). Sin esto configurado,
  // la App queda abierta — ver advertencia al arrancar.
  panelUser: process.env.PANEL_USER || "",
  panelPass: process.env.PANEL_PASS || "",
};

if (!CONFIG.panelUser || !CONFIG.panelPass) {
  console.warn(
    "[config] ADVERTENCIA: PANEL_USER/PANEL_PASS no están configurados en .env — " +
      "el panel y la API quedan SIN clave de acceso. Configúralos antes de desplegar en la nube."
  );
}

/** Utilidad para generar un token nuevo al configurar un equipo por primera vez. */
function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

module.exports = CONFIG;
module.exports.generateToken = generateToken;
