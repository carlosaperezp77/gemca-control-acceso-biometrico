// Fuerza una sincronización manual por consulta directa (pull) de respaldo,
// solo tiene efecto en las sedes que tengan baseUrl configurado en .env.
//   npm run sync
const { syncAllLocations } = require("./sync");

(async () => {
  const results = await syncAllLocations();
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
})();
