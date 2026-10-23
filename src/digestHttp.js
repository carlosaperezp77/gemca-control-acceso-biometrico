/**
 * Cliente HTTP con autenticacion Digest (RFC 2617), implementado sin
 * dependencias externas usando los modulos nativos http/https.
 *
 * Se usa solo para el modo de consulta directa (pull) de respaldo, por si
 * en el futuro se habilita VPN o acceso directo a algun equipo. El modo
 * principal de la App es que los equipos empujen sus eventos (ver
 * src/ingest.js), que no necesita este cliente.
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

function md5(str) {
  return crypto.createHash("md5").update(str, "utf8").digest("hex");
}

function parseDigestHeader(header) {
  const result = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    result[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return result;
}

function rawRequest({ hostname, port, protocol, path, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const lib = protocol === "https:" ? https : http;
    const req = lib.request(
      { hostname, port, path, method, headers, timeout: timeoutMs || 10000, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tiempo de espera agotado conectando al equipo")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function digestRequest(opts) {
  const { baseUrl, path, method = "GET", username, password, jsonBody, timeoutMs } = opts;
  const url = new URL(path, baseUrl);
  const body = jsonBody !== undefined ? (typeof jsonBody === "string" ? jsonBody : JSON.stringify(jsonBody)) : undefined;

  const baseHeaders = {
    "Content-Type": "application/json",
    ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
  };

  const common = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    protocol: url.protocol,
    path: url.pathname + url.search,
    method,
    body,
    timeoutMs,
  };

  const first = await rawRequest({ ...common, headers: baseHeaders });
  if (first.statusCode !== 401) return first;

  const authHeader = first.headers["www-authenticate"];
  if (!authHeader || !/Digest/i.test(authHeader)) return first;

  const challenge = parseDigestHeader(authHeader);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const realm = challenge.realm;
  const nonce = challenge.nonce;
  const qop = (challenge.qop || "").split(",")[0].trim();

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${url.pathname + url.search}`);

  let response, authParts;
  if (qop) {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    authParts = [
      `username="${username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${url.pathname + url.search}"`,
      `qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`, `response="${response}"`,
      challenge.opaque ? `opaque="${challenge.opaque}"` : null,
    ].filter(Boolean);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
    authParts = [
      `username="${username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${url.pathname + url.search}"`,
      `response="${response}"`, challenge.opaque ? `opaque="${challenge.opaque}"` : null,
    ].filter(Boolean);
  }

  const authorization = `Digest ${authParts.join(", ")}`;
  return rawRequest({ ...common, headers: { ...baseHeaders, Authorization: authorization } });
}

module.exports = { digestRequest };
