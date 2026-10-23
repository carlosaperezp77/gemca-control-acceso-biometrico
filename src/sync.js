/**
 * Sincronización de respaldo por consulta directa (pull). Solo tiene
 * efecto para una sede si se configuró su baseUrl/usuario/contraseña en
 * .env (acceso directo o VPN). El flujo principal de la App no depende de
 * esto: ver src/ingest.js para el modo push (recomendado).
 */
const CONFIG = require("./config");
const { fetchAcsEvents, checkDeviceStatus } = require("./isapiClient");
const { storeEvents, recordSyncError, getSyncState } = require("./eventsStore");

async function syncLocation(location, { lookbackDays = 7 } = {}) {
  if (!location.baseUrl) return { ok: false, locationCode: location.code, error: "sin_configurar_pull" };

  const state = getSyncState(location.code);
  const now = new Date();
  const startTime = state?.last_synced_until ? new Date(state.last_synced_until) : new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  try {
    const events = await fetchAcsEvents(location, startTime, now);
    const stored = storeEvents(location.code, events, "pull");
    return { ok: true, locationCode: location.code, eventsFetched: events.length, eventsStored: stored };
  } catch (err) {
    recordSyncError(location.code, err.message);
    return { ok: false, locationCode: location.code, error: err.message };
  }
}

async function syncAllLocations(opts) {
  const results = [];
  for (const location of CONFIG.locations) {
    results.push(await syncLocation(location, opts));
  }
  return results;
}

async function statusAllLocations() {
  const results = [];
  for (const location of CONFIG.locations) {
    const state = getSyncState(location.code);
    const pull = location.baseUrl ? await checkDeviceStatus(location) : null;
    results.push({
      code: location.code,
      name: location.name,
      model: location.model,
      pushConfigured: !!location.ingestToken,
      pullConfigured: !!location.baseUrl,
      pullOnline: pull ? pull.online : null,
      pullReason: pull ? pull.reason : null,
      lastEventReceivedAt: state?.last_event_received_at || null,
      lastSyncAt: state?.last_sync_at || null,
      lastSyncOk: state ? !!state.last_sync_ok : null,
      lastSyncError: state?.last_sync_error || null,
    });
  }
  return results;
}

module.exports = { syncLocation, syncAllLocations, statusAllLocations };
